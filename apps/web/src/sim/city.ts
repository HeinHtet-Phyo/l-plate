// "Generated London": building heights/styles, house infill, parked cars, trees, streetlights.
// Pure data (no three.js) so it can be tested.
import { hash2, rng, closestOnSegment, haversine } from './geo.ts';
import type { OsmBuilding, OsmExtract, XZ } from './osm.ts';
import type { RoadNetwork, Segment } from './roads.ts';
import type { AreaGrid, LandCover } from './raster.ts';
import type { Signals } from './signals.ts';

export const STYLES = ['georgian-brick', 'victorian-red', 'stucco-white', 'portland-stone', 'office-glass', 'modern-flats', 'warehouse-brick'] as const;
export type Style = (typeof STYLES)[number];

export interface PlacedBuilding {
  pts: XZ[];
  h: number;
  storeys: number;
  style: Style;
  shopfront: boolean;
  roof: 'flat' | 'slate' | 'gable';
  /** Gable ridge direction (unit, along the house front) for infill houses. */
  ridge?: [number, number];
  tint: number;
  infill?: boolean;
}

const CHARING_CROSS = { lat: 51.5074, lng: -0.1278 };
const DOMESTIC = new Set(['house', 'terrace', 'semidetached_house', 'detached', 'semi', 'bungalow', 'residential']);
const SMALL = new Set(['shed', 'garage', 'garages', 'hut', 'roof', 'carport', 'kiosk', 'greenhouse', 'cabin', 'container']);

export function isZone1(origin: { lat: number; lng: number }): boolean {
  return haversine(origin, CHARING_CROSS) < 4000;
}

/** Height in metres from tags, else typical for the kind. */
export function buildingHeight(b: Pick<OsmBuilding, 'h' | 'levels' | 'kind'>, zone1: boolean, seed: number): number {
  if (b.h && b.h > 1) return b.h;
  if (b.levels && b.levels > 0) return b.levels * 3.2 + 1;
  const r = hash2(seed, 7);
  const k = b.kind;
  let storeys: number;
  if (SMALL.has(k)) storeys = 1;
  else if (k === 'house' || k === 'detached' || k === 'semidetached_house' || k === 'semi' || k === 'bungalow') storeys = k === 'bungalow' ? 1 : 2;
  else if (k === 'terrace') storeys = 3;
  else if (k === 'apartments' || k === 'residential') storeys = 4 + Math.floor(r * 3);
  else if (k === 'office' || k === 'commercial' || k === 'hotel') storeys = zone1 ? 5 + Math.floor(r * 4) : 2 + Math.floor(r * 3);
  else if (k === 'church' || k === 'cathedral') return 14;
  else if (k === 'industrial' || k === 'warehouse' || k === 'retail' || k === 'supermarket') storeys = 2;
  else storeys = zone1 ? 4 + Math.floor(r * 3) : 2 + Math.floor(r * 2);
  return storeys * 3.2 + 1;
}

function styleFromTags(b: OsmBuilding, storeys: number, seed: number): Style | null {
  const m = (b.mat ?? '').toLowerCase();
  const r = hash2(seed, 3);
  if (m.includes('glass')) return 'office-glass';
  if (m.includes('stone') || m.includes('sandstone') || m.includes('limestone')) return 'portland-stone';
  if (m.includes('plaster') || m.includes('stucco') || m.includes('render')) return 'stucco-white';
  if (m.includes('concrete')) return 'modern-flats';
  if (m.includes('brick')) return r < 0.5 ? 'georgian-brick' : 'victorian-red';
  const k = b.kind;
  if (k === 'office' && storeys >= 8) return 'office-glass';
  if (k === 'office' || k === 'commercial') return r < 0.5 ? 'portland-stone' : 'modern-flats';
  if (DOMESTIC.has(k)) return r < 0.45 ? 'victorian-red' : r < 0.8 ? 'georgian-brick' : 'stucco-white';
  if (k === 'apartments') return r < 0.6 ? 'modern-flats' : 'victorian-red';
  if (k === 'warehouse' || k === 'industrial') return 'warehouse-brick';
  if (k === 'church' || k === 'government' || k === 'civic' || k === 'public' || k === 'museum') return 'portland-stone';
  return null;
}

function centroid(pts: XZ[]): XZ {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return [x / pts.length, z / pts.length];
}

export function layoutBuildings(ex: Pick<OsmExtract, 'buildings' | 'origin'>): PlacedBuilding[] {
  const zone1 = isZone1(ex.origin);
  const pre = ex.buildings.map((b, i) => {
    const [cx, cz] = centroid(b.pts);
    const seed = Math.floor(cx * 7 + cz * 13) ^ i;
    const h = buildingHeight(b, zone1, seed);
    const storeys = Math.max(1, Math.round((h - 1) / 3.2));
    return { b, cx, cz, h, storeys, tagged: styleFromTags(b, storeys, seed) };
  });
  // Neighbour lookup on a 60 m grid.
  const grid = new Map<string, number[]>();
  pre.forEach((p, i) => {
    if (!p.tagged) return;
    const k = `${Math.floor(p.cx / 60)},${Math.floor(p.cz / 60)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  return pre.map((p) => {
    let style = p.tagged;
    if (!style) {
      const counts = new Map<Style, number>();
      const gx = Math.floor(p.cx / 60);
      const gz = Math.floor(p.cz / 60);
      for (let a = -1; a <= 1; a++)
        for (let c = -1; c <= 1; c++)
          for (const j of grid.get(`${gx + a},${gz + c}`) ?? []) {
            const q = pre[j];
            if (Math.hypot(q.cx - p.cx, q.cz - p.cz) <= 60) counts.set(q.tagged!, (counts.get(q.tagged!) ?? 0) + 1);
          }
      let best = 0;
      for (const [s, n] of counts) if (n > best) {
        best = n;
        style = s;
      }
      if (style === 'office-glass' && p.storeys < 8) style = 'portland-stone';
    }
    if (!style) {
      // Seeded pick shared by the whole 40 m block, so terraces match.
      const r = hash2(Math.floor(p.cx / 40), Math.floor(p.cz / 40), 11);
      const pool: Style[] = zone1 ? ['portland-stone', 'stucco-white', 'georgian-brick', 'victorian-red', 'modern-flats'] : ['victorian-red', 'georgian-brick', 'stucco-white', 'modern-flats'];
      style = pool[Math.floor(r * pool.length)];
    }
    const house = DOMESTIC.has(p.b.kind) && p.storeys <= 3;
    return {
      pts: p.b.pts,
      h: p.h,
      storeys: p.storeys,
      style,
      shopfront: p.b.shop || p.b.kind === 'retail',
      roof: house ? 'slate' : 'flat',
      tint: 0.88 + hash2(p.cx, p.cz, 5) * 0.24,
    };
  });
}

// ---------------- House infill ----------------

const INFILL_CLASSES = new Set(['residential', 'unclassified', 'living_street', 'tertiary']);

export interface InfillResult {
  houses: PlacedBuilding[];
  gardens: XZ[][];
  runs: number;
}

/** Fill plots along residential roads where OSM has no buildings mapped. */
export function infillHouses(net: RoadNetwork, mapped: XZ[][], land: LandCover | null, maxRuns = 6000, seed = 1): InfillResult {
  const houses: PlacedBuilding[] = [];
  const gardens: XZ[][] = [];
  // Mapped buildings on a 25 m grid (by vertices and centroids).
  const mappedCells = new Set<string>();
  for (const b of mapped) {
    for (const [x, z] of [...b, centroid(b)]) mappedCells.add(`${Math.floor(x / 25)},${Math.floor(z / 25)}`);
  }
  const nearMapped = (x: number, z: number) => {
    const cx = Math.floor(x / 25);
    const cz = Math.floor(z / 25);
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) if (mappedCells.has(`${cx + a},${cz + c}`)) return true;
    return false;
  };
  const occupied = new Set<string>();
  const cellsOf = (pts: XZ[]) => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) {
      minX = Math.min(minX, x);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxZ = Math.max(maxZ, z);
    }
    const out: string[] = [];
    for (let x = Math.floor(minX / 2); x <= Math.floor(maxX / 2); x++) for (let z = Math.floor(minZ / 2); z <= Math.floor(maxZ / 2); z++) out.push(`${x},${z}`);
    return out;
  };
  let runs = 0;
  const done = new Set<number>();
  for (const road of net.roads) {
    if (!INFILL_CLASSES.has(road.highway) || done.has(road.idx)) continue;
    done.add(road.idx);
    const h = hash2(road.osm.id, 17, seed);
    const semis = h < 0.55;
    const rendered = hash2(road.osm.id, 29, seed) < 0.25;
    const style: Style = rendered ? 'stucco-white' : hash2(road.osm.id, 31, seed) < 0.5 ? 'victorian-red' : 'georgian-brick';
    const unitW = semis ? 7.4 : 5.4;
    const perRun = semis ? 2 : 6;
    const gap = semis ? 3.4 : 1.6;
    const runLen = unitW * perRun;
    const rand = rng(road.osm.id ^ seed);
    for (const seg of road.segs) {
      if (seg.len < 12 || runs >= maxRuns) continue;
      for (const side of [-1, 1] as const) {
        const half = side < 0 ? seg.halfLeft : seg.halfRight;
        const garden = 3.5 + rand() * 2.5;
        const front = half + 2.2 + garden;
        const depth = 8.5;
        const nx = -seg.dz * side;
        const nz = seg.dx * side;
        for (let s = 4; s + runLen <= seg.len - 4; s += runLen + gap) {
          if (runs >= maxRuns) break;
          const ax = seg.ax + seg.dx * s;
          const az = seg.az + seg.dz * s;
          const bx = ax + seg.dx * runLen;
          const bz = az + seg.dz * runLen;
          const corners: XZ[] = [
            [ax + nx * front, az + nz * front],
            [bx + nx * front, bz + nz * front],
            [bx + nx * (front + depth), bz + nz * (front + depth)],
            [ax + nx * (front + depth), az + nz * (front + depth)],
          ];
          if (!plotClear(corners, seg, net, nearMapped, land)) continue;
          const cells = cellsOf(corners);
          if (cells.some((c) => occupied.has(c))) continue;
          cells.forEach((c) => occupied.add(c));
          runs++;
          for (let u = 0; u < perRun; u++) {
            const u0 = u * unitW;
            const u1 = u0 + unitW;
            const p = (t: number, d: number): XZ => [ax + seg.dx * t + nx * d, az + seg.dz * t + nz * d];
            houses.push({
              pts: [p(u0, front), p(u1, front), p(u1, front + depth), p(u0, front + depth)],
              h: 6.4,
              storeys: 2,
              style,
              shopfront: false,
              roof: 'gable',
              ridge: [seg.dx, seg.dz],
              tint: 0.9 + rand() * 0.2,
              infill: true,
            });
          }
          // Front garden and a 14 m back garden become grass.
          gardens.push([
            [ax + nx * (half + 2.2), az + nz * (half + 2.2)],
            [bx + nx * (half + 2.2), bz + nz * (half + 2.2)],
            [bx + nx * (front + depth + 14), bz + nz * (front + depth + 14)],
            [ax + nx * (front + depth + 14), az + nz * (front + depth + 14)],
          ]);
        }
      }
    }
  }
  return { houses, gardens, runs };
}

function plotClear(corners: XZ[], own: Segment, net: RoadNetwork, nearMapped: (x: number, z: number) => boolean, land: LandCover | null): boolean {
  const [cx, cz] = centroid(corners);
  if (nearMapped(cx, cz) || corners.some(([x, z]) => nearMapped(x, z))) return false;
  for (const [x, z] of [...corners, [cx, cz] as XZ]) {
    if (net.inJunction(x, z, 9)) return false;
    if (land) {
      const k = land.kindAt(x, z);
      if (k === 'water' || k === 'wood') return false;
    }
    for (const seg of net.segmentsNear(x, z, 30)) {
      if (seg.road === own.road) continue;
      const c = closestOnSegment(x, z, seg.ax, seg.az, seg.bx, seg.bz);
      const half = Math.max(seg.halfLeft, seg.halfRight);
      if (c.dist < half + 2.2 + 0.5) return false;
    }
    // And clear of our own road's other segments (bends).
    for (const seg of own.road.segs) {
      if (seg === own) continue;
      const c = closestOnSegment(x, z, seg.ax, seg.az, seg.bx, seg.bz);
      if (c.dist < Math.max(seg.halfLeft, seg.halfRight) + 2.2 + 0.5) return false;
    }
  }
  return true;
}

// ---------------- Parked cars ----------------

export interface ParkedCar {
  x: number;
  z: number;
  heading: number;
  colour: number;
}

export const CAR_COLOURS = [0x1b1d22, 0xf2f2f0, 0x8a8f96, 0x2a3b5c, 0x5e1a1a, 0xb9bcc0, 0x1f3d2b, 0x3a3f47, 0xc9c3b4, 0x0f2a52, 0x7a2222, 0x444444];

export function placeParkedCars(net: RoadNetwork, signals: Signals | null, spawn: { x: number; z: number } | null, seed = 7): ParkedCar[] {
  const out: ParkedCar[] = [];
  const rand = rng(seed);
  const blockers: { x: number; z: number; r: number }[] = [];
  if (signals) {
    for (const l of signals.lines) blockers.push({ x: l.x, z: l.z, r: 18 });
    for (const z of signals.zebras) blockers.push({ x: z.x, z: z.z, r: 20 });
  }
  if (spawn) blockers.push({ x: spawn.x, z: spawn.z, r: 14 });
  for (const road of net.roads) {
    for (const seg of road.segs) {
      for (const side of [-1, 1] as const) {
        if (side < 0 ? !road.parkLeft : !road.parkRight) continue;
        const half = side < 0 ? seg.halfLeft : seg.halfRight;
        const room = half - road.driveWidth / 2;
        if (room < 1.9) continue;
        const off = side * (half - 1.0);
        const nx = -seg.dz;
        const nz = seg.dx;
        for (let s = 3.1; s + 3.1 <= seg.len; s += 6.2) {
          const keep = rand() >= 0.3;
          if (!keep) continue;
          const x = seg.ax + seg.dx * s + nx * off;
          const z = seg.az + seg.dz * s + nz * off;
          if (net.inJunction(x, z, 10)) continue;
          if (blockers.some((b) => Math.hypot(b.x - x, b.z - z) < b.r)) continue;
          // UK: on the left of a two-way road, cars face the way traffic in that lane goes.
          let forward = side < 0;
          if (road.oneway === 1) forward = true;
          if (road.oneway === -1) forward = false;
          const heading = (Math.atan2(forward ? seg.dx : -seg.dx, forward ? -seg.dz : seg.dz) * 180) / Math.PI;
          out.push({ x, z, heading: (heading + 360) % 360, colour: CAR_COLOURS[Math.floor(rand() * CAR_COLOURS.length)] });
        }
      }
    }
  }
  return out;
}

// ---------------- Trees ----------------

export interface Tree {
  x: number;
  z: number;
  h: number;
  shape: 0 | 1 | 2;
}

export function placeTrees(ex: Pick<OsmExtract, 'trees' | 'areas'>, grid: AreaGrid, max = 4000): Tree[] {
  const out: Tree[] = [];
  const add = (x: number, z: number, h: number | null) => {
    if (out.length >= max) return;
    if (grid.isCarriageway(x, z) || grid.isBuilding(x, z)) return;
    const r = hash2(x * 10, z * 10, 3);
    out.push({ x, z, h: h && h > 2 ? Math.min(h, 25) : 8 + r * 8, shape: Math.floor(r * 3) as 0 | 1 | 2 });
  };
  for (const t of ex.trees) add(t.x, t.z, t.h);
  for (const a of ex.areas) {
    if (a.kind !== 'wood' || out.length >= max) continue;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of a.pts) {
      minX = Math.min(minX, x);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxZ = Math.max(maxZ, z);
    }
    const area = (maxX - minX) * (maxZ - minZ);
    const n = Math.min(max - out.length, Math.floor(area / 12));
    const rand = rng(Math.floor(minX * 31 + minZ));
    for (let i = 0; i < n; i++) {
      const x = minX + rand() * (maxX - minX);
      const z = minZ + rand() * (maxZ - minZ);
      if (pointInPoly(x, z, a.pts)) add(x, z, null);
    }
  }
  return out;
}

export function pointInPoly(x: number, z: number, pts: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------- Streetlights ----------------

export interface Lamp {
  x: number;
  z: number;
  /** Compass heading the lamp head faces (back across the road). */
  heading: number;
}

export function placeStreetlights(net: RoadNetwork, grid: AreaGrid): Lamp[] {
  const out: Lamp[] = [];
  for (const road of net.roads) {
    if (road.highway === 'service' || road.highway === 'busway' || road.osm.tunnel) continue;
    let s = 0;
    let k = 0;
    for (const seg of road.segs) {
      let pos = (17 - (s % 17)) % 17;
      for (; pos < seg.len; pos += 17) {
        const side = road.oneway !== 0 ? -1 : k % 2 === 0 ? -1 : 1;
        k++;
        const half = side < 0 ? seg.halfLeft : seg.halfRight;
        const off = side * (half + 0.6);
        const x = seg.ax + seg.dx * pos - seg.dz * off;
        const z = seg.az + seg.dz * pos + seg.dx * off;
        if (net.inJunction(x, z) || grid.isBuilding(x, z) || grid.isCarriageway(x, z)) continue;
        // Face back across the road: toward −side normal.
        const fx = seg.dz * side;
        const fz = -seg.dx * side;
        const heading = ((Math.atan2(fx, -fz) * 180) / Math.PI + 360) % 360;
        out.push({ x, z, heading });
      }
      s += seg.len;
    }
  }
  return out;
}

/** 2 m single-channel light map: each lamp adds (1 − d/18)² within 18 m, × 220. */
export function bakeLightMap(lamps: Lamp[], radius: number, cell = 2): { n: number; cell: number; data: Uint8Array } {
  const n = Math.ceil((2 * radius) / cell);
  const acc = new Float32Array(n * n);
  const R = 18;
  for (const l of lamps) {
    const c0 = Math.max(0, Math.floor((l.x - R + radius) / cell));
    const c1 = Math.min(n - 1, Math.ceil((l.x + R + radius) / cell));
    const r0 = Math.max(0, Math.floor((l.z - R + radius) / cell));
    const r1 = Math.min(n - 1, Math.ceil((l.z + R + radius) / cell));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const x = (c + 0.5) * cell - radius;
        const z = (r + 0.5) * cell - radius;
        const d = Math.hypot(x - l.x, z - l.z);
        if (d < R) acc[r * n + c] += (1 - d / R) ** 2 * 220;
      }
  }
  const data = new Uint8Array(n * n);
  for (let i = 0; i < acc.length; i++) data[i] = Math.min(255, acc[i]);
  return { n, cell, data };
}
