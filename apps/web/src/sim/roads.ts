// Road network: segments, widths (fitted to mapped kerbs), junction boxes, spatial queries.
import { closestOnSegment, vecHeading, headingVec } from './geo.ts';
import type { OsmExtract, OsmRoad, XZ } from './osm.ts';

export const CLASS_WIDTH: Record<string, number> = {
  motorway: 11,
  motorway_link: 6,
  trunk: 10,
  trunk_link: 6,
  primary: 9,
  primary_link: 6,
  secondary: 8,
  secondary_link: 6,
  tertiary: 7.5,
  tertiary_link: 6,
  unclassified: 6.5,
  residential: 6,
  living_street: 5,
  busway: 4,
  service: 4,
};

export const CLASS_RANK: Record<string, number> = {
  motorway: 9, trunk: 8, primary: 7, secondary: 6, tertiary: 5, unclassified: 3, residential: 3, living_street: 2, busway: 1, service: 1,
};
export const rankOf = (h: string) => CLASS_RANK[h.replace('_link', '')] ?? 1;

/** Default limit in mph when maxspeed isn't mapped (most of central London is 20). */
export function defaultLimit(highway: string): number {
  const h = highway.replace('_link', '');
  if (h === 'motorway') return 70;
  if (h === 'trunk' || h === 'primary' || h === 'secondary') return 30;
  if (h === 'living_street') return 15;
  if (h === 'service' || h === 'busway') return 10;
  return 20;
}

const PARKED_CLASSES = new Set(['residential', 'unclassified', 'living_street']);

export interface Road {
  idx: number;
  osm: OsmRoad;
  highway: string;
  name: string;
  oneway: 1 | -1 | 0;
  /** Driving width (without parking strips), from tags. */
  driveWidth: number;
  lanes: number;
  parkLeft: boolean;
  parkRight: boolean;
  limit: number;
  limitMapped: boolean;
  segs: Segment[];
}

export interface Segment {
  idx: number;
  road: Road;
  i: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  len: number;
  dx: number;
  dz: number;
  /** Carriageway half-widths left and right of a→b (including parking strips). */
  halfLeft: number;
  halfRight: number;
  measuredLeft: boolean;
  measuredRight: boolean;
  nodeA: number;
  nodeB: number;
  /** Distance from the road's start to a. */
  s0: number;
}

export interface Junction {
  id: number;
  x: number;
  z: number;
  r: number;
  roads: Set<number>;
  node: number;
}

export interface NearestHit {
  seg: Segment;
  dist: number;
  t: number;
  offset: number;
  x: number;
  z: number;
}

/** Carriageway width estimate from tags (without parking). */
export function tagWidth(r: OsmRoad): number {
  if (r.width && r.width > 2) return r.width;
  if (r.lanes && r.lanes > 0) return Math.max(r.oneway ? 3.5 : 5.5, r.lanes * 3.1);
  return CLASS_WIDTH[r.highway] ?? 6;
}

export class Grid<T> {
  cells = new Map<number, T[]>();
  size: number;
  constructor(size: number) {
    this.size = size;
  }
  key(cx: number, cz: number) {
    return (cx + 32768) * 65536 + (cz + 32768);
  }
  addBox(minX: number, minZ: number, maxX: number, maxZ: number, v: T) {
    const s = this.size;
    for (let cx = Math.floor(minX / s); cx <= Math.floor(maxX / s); cx++)
      for (let cz = Math.floor(minZ / s); cz <= Math.floor(maxZ / s); cz++) {
        const k = this.key(cx, cz);
        const c = this.cells.get(k);
        if (c) c.push(v);
        else this.cells.set(k, [v]);
      }
  }
  query(x: number, z: number, r: number, out: Set<T>) {
    const s = this.size;
    for (let cx = Math.floor((x - r) / s); cx <= Math.floor((x + r) / s); cx++)
      for (let cz = Math.floor((z - r) / s); cz <= Math.floor((z + r) / s); cz++) {
        const c = this.cells.get(this.key(cx, cz));
        if (c) for (const v of c) out.add(v);
      }
    return out;
  }
}

export class RoadNetwork {
  roads: Road[] = [];
  segs: Segment[] = [];
  junctions: Junction[] = [];
  /** OSM node id → junction. */
  junctionByNode = new Map<number, Junction>();
  /** OSM node id → segment ends touching it. */
  nodeSegs = new Map<number, { seg: Segment; end: 'a' | 'b' }[]>();
  private segGrid = new Grid<Segment>(25);
  private jGrid = new Grid<Junction>(25);

  constructor(ex: Pick<OsmExtract, 'roads' | 'kerbs' | 'sidewalks'>) {
    for (const o of ex.roads) {
      if (o.pts.length < 2) continue;
      const lanes = o.lanes ?? 0;
      const driveWidth = tagWidth(o);
      const parkDefault = PARKED_CLASSES.has(o.highway) && !o.bridge && !o.tunnel;
      const parkLeft = !o.bridge && !o.tunnel && (o.parking.left ?? parkDefault);
      const parkRight = !o.bridge && !o.tunnel && (o.parking.right ?? parkDefault);
      const road: Road = {
        idx: this.roads.length,
        osm: o,
        highway: o.highway,
        name: o.name,
        oneway: o.oneway,
        driveWidth,
        lanes: lanes > 0 ? lanes : Math.max(o.oneway ? 1 : 2, Math.round(driveWidth / 3.1)),
        parkLeft,
        parkRight,
        limit: o.maxspeed ?? defaultLimit(o.highway),
        limitMapped: o.maxspeed != null,
        segs: [],
      };
      this.roads.push(road);
      let s0 = 0;
      for (let i = 0; i < o.pts.length - 1; i++) {
        const [ax, az] = o.pts[i];
        const [bx, bz] = o.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const seg: Segment = {
          idx: this.segs.length,
          road,
          i,
          ax,
          az,
          bx,
          bz,
          len,
          dx: (bx - ax) / len,
          dz: (bz - az) / len,
          halfLeft: driveWidth / 2 + (parkLeft ? 2.1 : 0),
          halfRight: driveWidth / 2 + (parkRight ? 2.1 : 0),
          measuredLeft: false,
          measuredRight: false,
          nodeA: o.nodes[i],
          nodeB: o.nodes[i + 1],
          s0,
        };
        s0 += len;
        road.segs.push(seg);
        this.segs.push(seg);
      }
    }
    this.fitKerbs(ex.kerbs, ex.sidewalks);
    for (const s of this.segs) {
      const pad = Math.max(s.halfLeft, s.halfRight) + 1;
      this.segGrid.addBox(Math.min(s.ax, s.bx) - pad, Math.min(s.az, s.bz) - pad, Math.max(s.ax, s.bx) + pad, Math.max(s.az, s.bz) + pad, s);
      for (const [node, end] of [
        [s.nodeA, 'a'],
        [s.nodeB, 'b'],
      ] as const) {
        const l = this.nodeSegs.get(node);
        if (l) l.push({ seg: s, end });
        else this.nodeSegs.set(node, [{ seg: s, end }]);
      }
    }
    this.buildJunctions();
  }

  /** Probe perpendicular to each segment for parallel kerb/sidewalk lines and fit half-widths to them. */
  private fitKerbs(kerbs: XZ[][], sidewalks: { pts: XZ[]; width: number | null }[]) {
    interface Line {
      ax: number;
      az: number;
      bx: number;
      bz: number;
      inset: number;
    }
    const lines: Line[] = [];
    for (const k of kerbs) for (let i = 0; i < k.length - 1; i++) lines.push({ ax: k[i][0], az: k[i][1], bx: k[i + 1][0], bz: k[i + 1][1], inset: 0 });
    for (const sw of sidewalks) {
      const half = sw.width ? sw.width / 2 : 1.2;
      for (let i = 0; i < sw.pts.length - 1; i++) lines.push({ ax: sw.pts[i][0], az: sw.pts[i][1], bx: sw.pts[i + 1][0], bz: sw.pts[i + 1][1], inset: half });
    }
    if (!lines.length) return;
    const grid = new Grid<Line>(25);
    for (const l of lines) grid.addBox(Math.min(l.ax, l.bx), Math.min(l.az, l.bz), Math.max(l.ax, l.bx), Math.max(l.az, l.bz), l);
    const found = new Set<Line>();
    for (const s of this.segs) {
      const hitsL: number[] = [];
      const hitsR: number[] = [];
      const nx = -s.dz;
      const nz = s.dx;
      for (const t of [0.25, 0.5, 0.75]) {
        const px = s.ax + (s.bx - s.ax) * t;
        const pz = s.az + (s.bz - s.az) * t;
        found.clear();
        grid.query(px, pz, 18, found);
        let bestL = Infinity;
        let bestR = Infinity;
        for (const l of found) {
          const lx = l.bx - l.ax;
          const lz = l.bz - l.az;
          const ll = Math.hypot(lx, lz);
          if (ll < 0.01) continue;
          if (Math.abs((lx * s.dx + lz * s.dz) / ll) < 0.9) continue;
          // Ray p + u·n against segment l: solve p + u n = a + v (b − a)
          const den = nx * lz - nz * lx;
          if (Math.abs(den) < 1e-9) continue;
          const qx = l.ax - px;
          const qz = l.az - pz;
          const u = (qx * lz - qz * lx) / den;
          const v = (qx * nz - qz * nx) / den;
          if (v < 0 || v > 1 || Math.abs(u) > 18) continue;
          const edge = Math.abs(u) - l.inset;
          if (edge <= 0) continue;
          if (u > 0) bestR = Math.min(bestR, edge);
          else bestL = Math.min(bestL, edge);
        }
        if (bestL < Infinity) hitsL.push(bestL);
        if (bestR < Infinity) hitsR.push(bestR);
      }
      const median = (a: number[]) => {
        const b = [...a].sort((x, y) => x - y);
        return b[Math.floor(b.length / 2)];
      };
      if (hitsL.length) {
        const m = Math.max(1.5, median(hitsL));
        if (m <= s.halfLeft + 8) {
          s.halfLeft = m;
          s.measuredLeft = true;
        }
      }
      if (hitsR.length) {
        const m = Math.max(1.5, median(hitsR));
        if (m <= s.halfRight + 8) {
          s.halfRight = m;
          s.measuredRight = true;
        }
      }
    }
  }

  private buildJunctions() {
    // Graph degree per node: a way end counts 1, a pass-through counts 2. Degree ≥ 3 is a junction.
    const degree = new Map<number, number>();
    const roadsAt = new Map<number, Set<number>>();
    const pos = new Map<number, XZ>();
    for (const r of this.roads) {
      const n = r.osm.nodes;
      n.forEach((id, i) => {
        const d = i === 0 || i === n.length - 1 ? 1 : 2;
        degree.set(id, (degree.get(id) ?? 0) + d);
        const s = roadsAt.get(id) ?? new Set();
        s.add(r.idx);
        roadsAt.set(id, s);
        pos.set(id, r.osm.pts[i]);
      });
    }
    for (const [node, d] of degree) {
      if (d < 3) continue;
      const roads = roadsAt.get(node)!;
      let widest = 0;
      for (const ri of roads) for (const s of this.roads[ri].segs) widest = Math.max(widest, s.halfLeft, s.halfRight);
      const [x, z] = pos.get(node)!;
      const j: Junction = { id: this.junctions.length, x, z, r: widest + 2.5, roads, node };
      this.junctions.push(j);
      this.junctionByNode.set(node, j);
      this.jGrid.addBox(x - j.r, z - j.r, x + j.r, z + j.r, j);
    }
  }

  junctionAt(x: number, z: number, margin = 0): Junction | null {
    const s = new Set<Junction>();
    this.jGrid.query(x, z, margin + 1, s);
    let best: Junction | null = null;
    let bd = Infinity;
    for (const j of s) {
      const d = Math.hypot(x - j.x, z - j.z) - j.r - margin;
      if (d <= 0 && d < bd) {
        bd = d;
        best = j;
      }
    }
    return best;
  }

  inJunction(x: number, z: number, margin = 0): boolean {
    return this.junctionAt(x, z, margin) != null;
  }

  segmentsNear(x: number, z: number, r: number): Set<Segment> {
    return this.segGrid.query(x, z, r, new Set());
  }

  nearest(x: number, z: number, maxDistance = 30): NearestHit | null {
    let best: NearestHit | null = null;
    for (const seg of this.segGrid.query(x, z, maxDistance, new Set())) {
      const c = closestOnSegment(x, z, seg.ax, seg.az, seg.bx, seg.bz);
      if (c.dist <= maxDistance && (!best || c.dist < best.dist)) best = { seg, dist: c.dist, t: c.t, offset: c.offset, x: c.x, z: c.z };
    }
    return best;
  }

  /** Nearest segment, preferring ones aligned with the heading. forward: travelling a→b. */
  nearestAlong(x: number, z: number, heading: number, maxDistance = 20): (NearestHit & { forward: boolean }) | null {
    const [hx, hz] = headingVec(heading);
    let best: (NearestHit & { forward: boolean }) | null = null;
    let bestScore = Infinity;
    for (const seg of this.segGrid.query(x, z, maxDistance, new Set())) {
      const c = closestOnSegment(x, z, seg.ax, seg.az, seg.bx, seg.bz);
      if (c.dist > maxDistance) continue;
      const cos = seg.dx * hx + seg.dz * hz;
      const inside = c.offset >= -seg.halfLeft && c.offset <= seg.halfRight;
      const score = (inside ? 0 : c.dist) + (1 - Math.abs(cos)) * 12 + c.dist * 0.15;
      if (score < bestScore) {
        bestScore = score;
        best = { seg, dist: c.dist, t: c.t, offset: c.offset, x: c.x, z: c.z, forward: cos >= 0 };
      }
    }
    return best;
  }

  /** Lane geometry for travel along seg (forward = a→b). Offsets are right of a→b. */
  laneInfo(seg: Segment, forward: boolean) {
    const r = seg.road;
    const parkL = r.parkLeft ? 2.1 : 0;
    const parkR = r.parkRight ? 2.1 : 0;
    const left = -seg.halfLeft + parkL;
    const right = seg.halfRight - parkR;
    const width = Math.max(2.6, right - left);
    const centre = (left + right) / 2;
    if (r.oneway !== 0) {
      const n = Math.max(1, r.osm.lanesForward ?? r.lanes);
      const lw = width / n;
      // Travel-left of a→b is the negative-offset side; of b→a, the positive side.
      const leftLaneOffset = forward ? left + lw / 2 : right - lw / 2;
      return { centreLine: null as number | null, laneWidth: lw, lanes: n, leftLaneOffset, left, right };
    }
    const nEach = Math.max(1, Math.floor(r.lanes / 2));
    const lw = Math.min(3.6, width / 2 / nEach);
    // UK: drive on the left. Travelling a→b, the left lane is left of the centre line (negative offset).
    const leftLaneOffset = forward ? centre - (width / 2) + lw / 2 : centre + width / 2 - lw / 2;
    return { centreLine: centre, laneWidth: lw, lanes: nEach, leftLaneOffset, left, right };
  }

  /** Spawn in the left (UK) lane of the nearest road aligned with heading, facing along it. */
  spawnNear(x: number, z: number, heading: number): { x: number; z: number; heading: number; seg: Segment } | null {
    const hit = this.nearestAlong(x, z, heading, 60);
    if (!hit) return null;
    const { seg } = hit;
    let forward = hit.forward;
    if (seg.road.oneway === 1) forward = true;
    if (seg.road.oneway === -1) forward = false;
    const lane = this.laneInfo(seg, forward);
    const nx = -seg.dz;
    const nz = seg.dx;
    const px = hit.x + nx * lane.leftLaneOffset;
    const pz = hit.z + nz * lane.leftLaneOffset;
    const h = forward ? vecHeading(seg.dx, seg.dz) : vecHeading(-seg.dx, -seg.dz);
    return { x: px, z: pz, heading: h, seg };
  }
}
