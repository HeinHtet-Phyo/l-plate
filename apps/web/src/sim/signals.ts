// Traffic lights and crossings: placement from OSM points + UK phase timing.
import { closestOnSegment, vecHeading } from './geo.ts';
import type { OsmPoint } from './osm.ts';
import type { RoadNetwork, Segment } from './roads.ts';

export type Aspect = 'red' | 'redAmber' | 'green' | 'amber';
export const CYCLE = 34;

/** Junction lights: group 0 and group 1 are the two perpendicular phase groups. */
export function junctionAspect(group: 0 | 1, t: number): Aspect {
  const c = ((t % CYCLE) + CYCLE) % CYCLE;
  if (group === 0) {
    if (c < 13) return 'green';
    if (c < 16) return 'amber';
    if (c < 32) return 'red';
    return 'redAmber';
  }
  if (c < 15) return 'red';
  if (c < 17) return 'redAmber';
  if (c < 30) return 'green';
  if (c < 33) return 'amber';
  return 'red';
}

/** Signal-controlled crossings away from junctions. */
export function crossingAspect(t: number): Aspect {
  const c = ((t % CYCLE) + CYCLE) % CYCLE;
  if (c < 22) return 'green';
  if (c < 25) return 'amber';
  if (c < 32) return 'red';
  return 'redAmber';
}

/** Seconds since this head last turned amber (Infinity if it isn't amber). */
export function amberAge(kind: 'junction' | 'crossing', group: 0 | 1, t: number): number {
  const c = ((t % CYCLE) + CYCLE) % CYCLE;
  if (kind === 'crossing') return c >= 22 && c < 25 ? c - 22 : Infinity;
  if (group === 0) return c >= 13 && c < 16 ? c - 13 : Infinity;
  return c >= 30 && c < 33 ? c - 30 : Infinity;
}

export interface StopLine {
  id: number;
  kind: 'junction' | 'crossing';
  group: 0 | 1;
  /** Centre of the stop line across the approach lane(s). */
  x: number;
  z: number;
  /** Unit direction of travel for this approach. */
  dx: number;
  dz: number;
  /** Half-length of the line across the approach. */
  halfWidth: number;
  /** Offset (right of travel) of the line centre from the road centre line. */
  head: { x: number; z: number; heading: number };
  seg: Segment;
}

export interface SignalSite {
  kind: 'junction' | 'crossing';
  x: number;
  z: number;
  lines: StopLine[];
}

export interface Zebra {
  x: number;
  z: number;
  dx: number;
  dz: number;
  halfWidth: number;
  seg: Segment;
}

export class Signals {
  sites: SignalSite[] = [];
  lines: StopLine[] = [];
  zebras: Zebra[] = [];

  constructor(points: OsmPoint[], net: RoadNetwork) {
    const sig = points.filter((p) => p.kind === 'traffic_signals' || (p.kind === 'crossing' && p.crossing === 'traffic_signals'));
    // Cluster within 40 m.
    const clusters: OsmPoint[][] = [];
    for (const p of sig) {
      const c = clusters.find((cl) => cl.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 40));
      if (c) c.push(p);
      else clusters.push([p]);
    }
    let id = 0;
    for (const cl of clusters) {
      const cx = cl.reduce((s, p) => s + p.x, 0) / cl.length;
      const cz = cl.reduce((s, p) => s + p.z, 0) / cl.length;
      const j = net.junctionAt(cx, cz, 20);
      const kind: 'junction' | 'crossing' = j || cl.length > 2 ? 'junction' : 'crossing';
      const centre = j ? { x: j.x, z: j.z, r: j.r } : { x: cx, z: cz, r: 0 };
      const site: SignalSite = { kind, x: centre.x, z: centre.z, lines: [] };
      // Approaches: segments with an end near the centre, oriented toward it.
      const arms: { seg: Segment; dx: number; dz: number; px: number; pz: number; rank: number }[] = [];
      for (const seg of net.segmentsNear(centre.x, centre.z, 45)) {
        if (seg.road.highway === 'service' || seg.road.highway === 'busway') continue;
        const da = Math.hypot(seg.ax - centre.x, seg.az - centre.z);
        const db = Math.hypot(seg.bx - centre.x, seg.bz - centre.z);
        const c = closestOnSegment(centre.x, centre.z, seg.ax, seg.az, seg.bx, seg.bz);
        if (c.dist > Math.max(seg.halfLeft, seg.halfRight) + 4) continue;
        const stopDist = kind === 'junction' ? centre.r + 3 : 3;
        // Two approach directions per segment through the centre; one per segment ending there.
        const dirs: [number, number][] = [];
        if (kind === 'crossing' || Math.min(da, db) > stopDist + 2) {
          dirs.push([seg.dx, seg.dz], [-seg.dx, -seg.dz]);
        } else {
          dirs.push(db < da ? [seg.dx, seg.dz] : [-seg.dx, -seg.dz]);
        }
        for (const [dx, dz] of dirs) {
          const fwd = dx * seg.dx + dz * seg.dz > 0;
          if (seg.road.oneway === 1 && !fwd) continue;
          if (seg.road.oneway === -1 && fwd) continue;
          const px = centre.x - dx * stopDist;
          const pz = centre.z - dz * stopDist;
          // Only keep if the stop point lies on this segment (roughly).
          const cs = closestOnSegment(px, pz, seg.ax, seg.az, seg.bx, seg.bz);
          if (cs.dist > 6) continue;
          if (arms.some((a) => a.dx * dx + a.dz * dz > 0.9 && Math.hypot(a.px - px, a.pz - pz) < 10)) continue;
          arms.push({ seg, dx, dz, px: cs.x, pz: cs.z, rank: seg.road.lanes });
        }
      }
      if (!arms.length) continue;
      const axis = arms[0];
      for (const a of arms) {
        const lane = net.laneInfo(a.seg, a.dx * a.seg.dx + a.dz * a.seg.dz > 0);
        const nx = -a.seg.dz;
        const nz = a.seg.dx;
        const forward = a.dx * a.seg.dx + a.dz * a.seg.dz > 0;
        // Stop line spans the travel-left half (two-way) or the full width (one-way).
        const from = lane.leftLaneOffset - lane.laneWidth / 2 * (forward ? 1 : -1);
        const to = lane.centreLine ?? (forward ? lane.right : lane.left);
        const mid = (from + to) / 2;
        const halfWidth = Math.max(1.5, Math.abs(to - from) / 2);
        const lx = a.px + nx * mid;
        const lz = a.pz + nz * mid;
        // Head on the travel-left kerb.
        const kerbOff = forward ? -a.seg.halfLeft - 0.6 : a.seg.halfRight + 0.6;
        const group: 0 | 1 = kind === 'crossing' ? 0 : Math.abs(a.dx * axis.dx + a.dz * axis.dz) > 0.6 ? 0 : 1;
        const line: StopLine = {
          id: id++,
          kind,
          group,
          x: lx,
          z: lz,
          dx: a.dx,
          dz: a.dz,
          halfWidth,
          head: { x: a.px + nx * kerbOff, z: a.pz + nz * kerbOff, heading: vecHeading(-a.dx, -a.dz) },
          seg: a.seg,
        };
        site.lines.push(line);
        this.lines.push(line);
      }
      this.sites.push(site);
    }
    for (const p of points) {
      if (!p.zebra) continue;
      const hit = net.nearest(p.x, p.z, 8);
      if (!hit || hit.seg.road.highway === 'service') continue;
      this.zebras.push({ x: hit.x, z: hit.z, dx: hit.seg.dx, dz: hit.seg.dz, halfWidth: (hit.seg.halfLeft + hit.seg.halfRight) / 2, seg: hit.seg });
    }
  }

  aspect(line: StopLine, t: number): Aspect {
    return line.kind === 'crossing' ? crossingAspect(t) : junctionAspect(line.group, t);
  }

  linesNear(x: number, z: number, r: number): StopLine[] {
    return this.lines.filter((l) => Math.abs(l.x - x) < r && Math.abs(l.z - z) < r);
  }
}
