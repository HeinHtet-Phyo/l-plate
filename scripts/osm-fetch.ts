// pnpm osm:fetch [id…] [--force] — fetch each area's OSM data once and commit it.
// Output (committed): apps/web/public/osm/<id>.json, in local metres around the area's origin.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { project, haversine } from '../apps/web/src/sim/geo.ts';
import { overpass } from './lib/overpass.ts';
import type { FreeStart, TestRoute } from '../packages/shared/src/index.ts';

const OUT_DIR = 'apps/web/public/osm';
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
const corridor = Number(args.find((a) => a.startsWith('--corridor='))?.split('=')[1] ?? 300);

const ROAD_RE =
  '^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|busway)$';
const POINT_RE = '^(traffic_signals|crossing|give_way|stop|mini_roundabout)$';
const r2 = (v: number) => Math.round(v * 100) / 100;

interface Area {
  id: string;
  origin: { lat: number; lng: number };
  radius: number;
  filter: string;
}

function thin(path: { lat: number; lng: number }[], minM: number) {
  const out = [path[0]];
  for (const p of path.slice(1)) if (haversine(out[out.length - 1], p) >= minM) out.push(p);
  const last = path[path.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function areas(): Area[] {
  const starts = JSON.parse(readFileSync('data/free-starts.json', 'utf8')) as FreeStart[];
  const routesFile = 'apps/web/src/routes/test-routes.json';
  const routes = (existsSync(routesFile) ? JSON.parse(readFileSync(routesFile, 'utf8')) : []) as TestRoute[];
  const list: Area[] = starts.map((s) => {
    const dLat = 800 / 111_195;
    const dLng = 800 / (111_195 * Math.cos((s.lat * Math.PI) / 180));
    return {
      id: s.id,
      origin: { lat: s.lat, lng: s.lng },
      radius: 800,
      filter: `(${(s.lat - dLat).toFixed(6)},${(s.lng - dLng).toFixed(6)},${(s.lat + dLat).toFixed(6)},${(s.lng + dLng).toFixed(6)})`,
    };
  });
  for (const r of routes) {
    const lats = r.path.map((p) => p.lat);
    const lngs = r.path.map((p) => p.lng);
    const origin = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
    const far = Math.max(...r.path.map((p) => haversine(origin, p)));
    const radius = Math.ceil((far + corridor) / 50) * 50;
    const poly = thin(r.path, 25).map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(',');
    list.push({ id: r.id, origin, radius, filter: `(around:${corridor},${poly})` });
  }
  return list;
}

function query(f: string): string {
  return `[out:json][timeout:180];
(
  way[highway~"${ROAD_RE}"][area!=yes]${f};
  node[highway~"${POINT_RE}"]${f};
  way[building]${f};
  node[natural=tree]${f};
  way[natural=tree_row]${f};
  way[leisure~"^(park|garden|pitch|playground|common)$"]${f};
  way[landuse~"^(grass|recreation_ground|village_green|meadow|forest)$"]${f};
  way[natural~"^(water|wood|scrub|grassland)$"]${f};
  relation[natural=water]${f};
  relation[leisure=park]${f};
  relation[landuse~"^(grass|forest)$"]${f};
  way[barrier=kerb]${f};
  way[footway=sidewalk]${f};
  way["area:highway"]${f};
);
out body geom qt;`;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function mph(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s.includes('nsl_dual')) return 70;
  if (s === 'national' || s.includes('nsl')) return 60;
  const m = s.match(/^(\d+)\s*(mph|km\/h)?/);
  if (!m) return null;
  return m[2] === 'km/h' ? Math.round(+m[1] / 1.609) : +m[1];
}

const NO_PARKING = new Set(['no', 'no_parking', 'no_stopping', 'separate', 'fire_lane']);
function parkingSide(t: Record<string, string>, side: 'left' | 'right'): boolean | null {
  const v =
    t[`parking:${side}`] ?? t['parking:both'] ?? t[`parking:lane:${side}`] ?? t['parking:lane:both'] ??
    t[`parking:${side}:restriction`];
  if (v == null) {
    const r = t[`parking:${side}:restriction`] ?? t['parking:both:restriction'];
    if (r && NO_PARKING.has(r)) return false;
    return null;
  }
  return !NO_PARKING.has(v);
}

type G = { lat: number; lon: number }[];

function stitch(ways: G[]): G[] {
  const rings: G[] = [];
  const pool = ways.filter((w) => w && w.length > 1).map((w) => w.slice());
  const same = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
  while (pool.length) {
    let ring = pool.shift()!;
    let guard = 0;
    while (!same(ring[0], ring[ring.length - 1]) && guard++ < 10_000) {
      const end = ring[ring.length - 1];
      const i = pool.findIndex((w) => same(w[0], end) || same(w[w.length - 1], end));
      if (i < 0) break;
      const w = pool.splice(i, 1)[0];
      ring = ring.concat(same(w[0], end) ? w.slice(1) : w.slice().reverse().slice(1));
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function areaKind(t: Record<string, string>): 'grass' | 'water' | 'wood' | null {
  if (t.natural === 'water' || t.water) return 'water';
  if (t.natural === 'wood' || t.natural === 'scrub' || t.landuse === 'forest') return 'wood';
  if (t.leisure || t.landuse || t.natural === 'grassland') return 'grass';
  return null;
}

function convert(a: Area, elements: any[]) {
  const P = (g: { lat: number; lon: number }) => {
    const [x, z] = project(a.origin, g.lat, g.lon);
    return [r2(x), r2(z)] as [number, number];
  };
  const ring = (g: G) => {
    const pts = g.map(P);
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    return pts;
  };
  const roads: any[] = [];
  const points: any[] = [];
  const buildings: any[] = [];
  const trees: any[] = [];
  const areasOut: any[] = [];
  const kerbs: [number, number][][] = [];
  const sidewalks: any[] = [];
  const surfaces: any[] = [];
  const roadRe = new RegExp(ROAD_RE);
  const pointRe = new RegExp(POINT_RE);
  const seen = new Set<string>();

  for (const e of elements) {
    const key = `${e.type}/${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t: Record<string, string> = e.tags ?? {};
    if (e.type === 'node') {
      if (t.natural === 'tree') {
        const [x, z] = P(e);
        trees.push({ x, z, h: num(t.height) });
      } else if (t.highway && pointRe.test(t.highway)) {
        const [x, z] = P(e);
        const zebra = t.crossing === 'zebra' || t.crossing_ref === 'zebra' || t['crossing:markings'] === 'zebra';
        points.push({ id: e.id, kind: t.highway, crossing: t.crossing ?? null, zebra, direction: t.direction ?? t['traffic_signals:direction'] ?? null, x, z });
      }
      continue;
    }
    if (e.type === 'way' && e.geometry) {
      const g = e.geometry as G;
      if (t.highway && roadRe.test(t.highway) && t.area !== 'yes') {
        if (t.highway === 'service' && /^(parking_aisle|driveway|drive-through)$/.test(t.service ?? '')) continue;
        const roundabout = t.junction === 'roundabout' || t.junction === 'circular';
        let oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' ? 1 : t.oneway === '-1' ? -1 : 0;
        if (roundabout || t.highway === 'motorway' || t.highway === 'motorway_link') oneway = t.oneway === 'no' ? 0 : 1;
        roads.push({
          id: e.id,
          highway: t.highway,
          name: t.name ?? t.ref ?? '',
          lanes: num(t.lanes),
          width: num(t.width ?? t['width:carriageway']),
          oneway,
          maxspeed: mph(t.maxspeed),
          lanesForward: num(t['lanes:forward']),
          lanesBackward: num(t['lanes:backward']),
          junction: t.junction ?? null,
          layer: num(t.layer) ?? 0,
          bridge: !!t.bridge && t.bridge !== 'no',
          tunnel: !!t.tunnel && t.tunnel !== 'no',
          nodes: e.nodes,
          pts: g.map(P),
          parking: { left: parkingSide(t, 'left'), right: parkingSide(t, 'right') },
        });
        continue;
      }
      if (t.building) {
        const pts = ring(g);
        if (pts.length < 3) continue;
        buildings.push({
          pts,
          kind: t.building,
          h: num(t.height),
          levels: num(t['building:levels']),
          mat: t['building:material'] ?? t['building:facade:material'] ?? null,
          colour: t['building:colour'] ?? null,
          roof: t['roof:shape'] ?? null,
          roofColour: t['roof:colour'] ?? null,
          shop: !!(t.shop || t.amenity),
          name: t.name ?? null,
        });
        continue;
      }
      if (t.natural === 'tree_row') {
        const pts = g.map(P);
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, az] = pts[i];
          const [bx, bz] = pts[i + 1];
          const L = Math.hypot(bx - ax, bz - az);
          for (let d = 0; d < L; d += 8) trees.push({ x: r2(ax + ((bx - ax) * d) / L), z: r2(az + ((bz - az) * d) / L), h: num(t.height) });
        }
        continue;
      }
      if (t.barrier === 'kerb') {
        kerbs.push(g.map(P));
        continue;
      }
      if (t.footway === 'sidewalk') {
        sidewalks.push({ pts: g.map(P), width: num(t.width) });
        continue;
      }
      if (t['area:highway']) {
        surfaces.push({ kind: t['area:highway'], pts: ring(g) });
        continue;
      }
      const k = areaKind(t);
      if (k) areasOut.push({ kind: k, pts: ring(g) });
      continue;
    }
    if (e.type === 'relation' && e.members) {
      const k = areaKind(t);
      if (!k) continue;
      const outers = (e.members as any[]).filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === '') && m.geometry).map((m) => m.geometry as G);
      for (const r of stitch(outers)) areasOut.push({ kind: k, pts: ring(r) });
    }
  }
  return {
    id: a.id,
    origin: a.origin,
    radius: a.radius,
    fetched: new Date().toISOString(),
    attribution: '© OpenStreetMap contributors (ODbL)',
    roads,
    points,
    buildings,
    trees,
    areas: areasOut,
    kerbs,
    sidewalks,
    surfaces,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const a of areas()) {
    if (only.length && !only.includes(a.id)) continue;
    const file = `${OUT_DIR}/${a.id}.json`;
    if (existsSync(file) && !force) {
      console.log(`${a.id}: already fetched (use --force to refetch)`);
      continue;
    }
    console.log(`${a.id}: fetching (radius ${a.radius} m)…`);
    const res = await overpass(query(a.filter), a.id);
    const data = convert(a, res.elements);
    writeFileSync(file, JSON.stringify(data));
    console.log(
      `  ${a.id}: ${data.roads.length} roads, ${data.buildings.length} buildings, ${data.trees.length} trees, ${data.points.length} points, ${data.areas.length} areas, ${data.kerbs.length} kerbs, ${data.sidewalks.length} sidewalks`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
