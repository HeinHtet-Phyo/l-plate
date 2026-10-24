// pnpm build:routes — route each test route through OSRM, convert steps, attach Overpass speed limits.
// Output (committed): apps/web/src/routes/test-routes.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { routeVia } from '../apps/server/src/osrm.ts';
import { project, closestOnSegment, cumulative } from '../apps/web/src/sim/geo.ts';
import { overpass } from './lib/overpass.ts';
import type { SpeedLimitSpan, TestRoute } from '../packages/shared/src/index.ts';

const OUT = 'apps/web/src/routes/test-routes.json';
const src = JSON.parse(readFileSync('data/routes.json', 'utf8')) as (Omit<TestRoute, 'path' | 'distance' | 'duration' | 'steps' | 'speedLimits'> & { roads?: string[] })[];
const previous: TestRoute[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const only = process.argv[2];

export function parseMaxspeed(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s.includes('nsl_dual') || s.includes('motorway')) return 70;
  if (s === 'national' || s.includes('nsl')) return 60;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph)?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2] && m[2] !== 'mph') return Math.round(n / 1.609);
  return Math.round(n);
}

function thin(path: { lat: number; lng: number }[], minM: number) {
  const o = path[0];
  const out = [path[0]];
  let [lx, lz] = project(o, path[0].lat, path[0].lng);
  for (const p of path.slice(1)) {
    const [x, z] = project(o, p.lat, p.lng);
    if (Math.hypot(x - lx, z - lz) >= minM) {
      out.push(p);
      lx = x;
      lz = z;
    }
  }
  const last = path[path.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

async function speedLimits(path: { lat: number; lng: number }[], id: string): Promise<SpeedLimitSpan[]> {
  const poly = thin(path, 25).map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(',');
  const q = `[out:json][timeout:90];way[highway][maxspeed](around:25,${poly});out tags geom qt;`;
  const res = await overpass(q, `${id} speed limits`);
  const o = path[0];
  const ways = res.elements
    .filter((e) => e.type === 'way' && e.geometry)
    .map((e) => ({ mph: parseMaxspeed(e.tags?.maxspeed), pts: (e.geometry as { lat: number; lon: number }[]).map((g) => project(o, g.lat, g.lon)) }))
    .filter((w) => w.mph != null);
  const pts = path.map((p) => project(o, p.lat, p.lng));
  const cum = cumulative(pts);
  const total = cum[cum.length - 1];
  const samples: (number | null)[] = [];
  const STEP = 10;
  let seg = 0;
  for (let d = 0; d <= total; d += STEP) {
    while (seg < pts.length - 2 && cum[seg + 1] < d) seg++;
    const a = pts[seg];
    const b = pts[seg + 1] ?? a;
    const L = cum[seg + 1] - cum[seg] || 1;
    const t = (d - cum[seg]) / L;
    const px = a[0] + (b[0] - a[0]) * t;
    const pz = a[1] + (b[1] - a[1]) * t;
    const dx = (b[0] - a[0]) / L;
    const dz = (b[1] - a[1]) / L;
    let best: number | null = null;
    let bestD = 25;
    for (const w of ways) {
      for (let i = 0; i < w.pts.length - 1; i++) {
        const [ax, az] = w.pts[i];
        const [bx, bz] = w.pts[i + 1];
        const c = closestOnSegment(px, pz, ax, az, bx, bz);
        if (c.dist >= bestD) continue;
        const sl = Math.hypot(bx - ax, bz - az) || 1;
        const cos = Math.abs(((bx - ax) * dx + (bz - az) * dz) / sl);
        if (cos < 0.7) continue;
        bestD = c.dist;
        best = w.mph;
      }
    }
    samples.push(best);
  }
  const spans: SpeedLimitSpan[] = [];
  samples.forEach((mph, i) => {
    const from = i * STEP;
    const to = Math.min(total, from + STEP);
    if (mph == null) return;
    const last = spans[spans.length - 1];
    if (last && last.mph === mph && Math.abs(last.to - from) < 1e-6) last.to = Math.round(to);
    else spans.push({ from: Math.round(from), to: Math.round(to), mph });
  });
  return spans;
}

async function main() {
  mkdirSync('apps/web/src/routes', { recursive: true });
  const out: TestRoute[] = [];
  for (const r of src) {
    const prev = previous.find((p) => p.id === r.id);
    if (only && r.id !== only) {
      if (prev) out.push(prev);
      continue;
    }
    console.log(`Routing ${r.id}…`);
    const routed = await routeVia(r.waypoints, r.start.heading);
    const pathHash = createHash('sha1').update(JSON.stringify(routed.path)).digest('hex').slice(0, 12);
    let limits: SpeedLimitSpan[] = [];
    if (prev && prev.pathHash === pathHash && prev.speedLimits?.length) {
      limits = prev.speedLimits;
      console.log(`  path unchanged; keeping ${limits.length} speed-limit spans`);
    } else {
      try {
        limits = await speedLimits(routed.path, r.id);
      } catch (e) {
        console.warn(`  speed limits unavailable: ${(e as Error).message}`);
        limits = prev?.speedLimits ?? [];
      }
    }
    const { roads: _roads, ...meta } = r;
    out.push({ ...meta, ...routed, speedLimits: limits, pathHash });
    console.log(`  ${(routed.distance / 1609).toFixed(1)} mi, ${routed.steps.length} steps, ${limits.length} limit spans`);
    console.log(`  first: ${routed.steps.slice(0, 3).map((s) => s.instruction).join(' | ')}`);
    await sleep(1500);
  }
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
