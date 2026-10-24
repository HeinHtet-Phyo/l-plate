// Road markings, simplified from the UK Traffic Signs Manual (ch. 3 and 5):
//   centre lines (hazard-warning style near junctions), lane lines, stop lines at signals,
//   give-way lines (+ triangles) at minor-road mouths, zebras with zig-zags, zig-zags at signal crossings,
//   double yellows, mini-roundabout discs.
// Everything is one merged mesh (one draw call). Thin lines are widened in the vertex shader to at least
// about a pixel and faded by the same factor, so distant lines stay steady instead of shimmering.
import * as THREE from 'three';
import type { Session } from '../../sim/session.ts';
import type { TextureSet } from '../textures.ts';
import { rankOf, type Junction, type Road, type Segment } from '../../sim/roads.ts';
import { CITY_FRAG_END, CITY_FRAG_PARS, CITY_VERT_PARS, cityShaderMaterial, disposeTree, type CityPiece } from './common.ts';

type Paint = readonly [number, number, number];
const WHITE: Paint = [0.85, 0.85, 0.82];
const YELLOW: Paint = [0.9, 0.7, 0.1];
const Y = 0.02;

/** Roads that never get centre or lane lines. */
const NO_LINES = new Set(['service', 'living_street', 'footway', 'track', 'busway', 'path', 'pedestrian', 'cycleway', 'steps', 'bridleway', 'road']);
/** Roads that get double yellows along their whole length (where nobody parks). */
const MAIN = new Set(['trunk', 'primary', 'secondary']);

const CENTRE_W = 0.11;
const LANE_W = 0.1;
const ZIG_LEN = 16; // 8 zigs of 2 m

type Span = [number, number];
type Role = 'major' | 'minor' | 'signal' | 'box';

interface Arm {
  seg: Segment;
  road: Road;
  /** Unit direction out of the junction along this arm. */
  ox: number;
  oz: number;
  /** Road distance of the junction node, and +1 if the arm runs toward increasing s. */
  sNode: number;
  dir: 1 | -1;
  rank: number;
  through: boolean;
  role: Role;
  /** Give-way line distance from the junction centre (minor arms). */
  D: number;
}

interface RoadMarks {
  len: number;
  /** No centre or lane lines here (minor arm mouths, signal boxes, zig-zag zones). */
  clip: Span[];
  /** Hazard-warning centre line here. */
  hazard: Span[];
  /** Double yellows near junctions, and where they must stop. */
  yellowNear: Span[];
  yellowClip: Span[];
}

/** Merged quad soup: position, per-corner half-extent vectors (for the pixel-width floor) and paint. */
class Marks {
  readonly pos: number[] = [];
  readonly ex: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  private n = 0;

  /** Rectangle: centre, unit axis (ax, az) with half-extent ha, the perpendicular axis with half-extent hb. */
  rect(cx: number, cz: number, ax: number, az: number, ha: number, hb: number, c: Paint, a = 1) {
    const bx = -az;
    const bz = ax;
    const v = this.n;
    for (let k = 0; k < 4; k++) {
      const sa = k === 0 || k === 3 ? -1 : 1;
      const sb = k < 2 ? -1 : 1;
      const eax = ax * ha * sa;
      const eaz = az * ha * sa;
      const ebx = bx * hb * sb;
      const ebz = bz * hb * sb;
      this.pos.push(cx + eax + ebx, Y, cz + eaz + ebz);
      this.ex.push(eax, eaz, ebx, ebz);
      this.col.push(c[0], c[1], c[2], a);
    }
    this.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.n += 4;
  }

  /** A straight line of width w from (x0, z0) to (x1, z1). */
  line(x0: number, z0: number, x1: number, z1: number, w: number, c: Paint, a = 1) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const L = Math.hypot(dx, dz);
    if (L < 0.02) return;
    this.rect((x0 + x1) / 2, (z0 + z1) / 2, dx / L, dz / L, L / 2, w / 2, c, a);
  }

  /** Filled disc (no pixel-width floor; it's big). */
  disc(cx: number, cz: number, r: number, c: Paint, segs = 32) {
    const v = this.n;
    this.pos.push(cx, Y, cz);
    this.ex.push(0, 0, 0, 0);
    this.col.push(c[0], c[1], c[2], 1);
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      this.pos.push(cx + Math.cos(t) * r, Y, cz + Math.sin(t) * r);
      this.ex.push(0, 0, 0, 0);
      this.col.push(c[0], c[1], c[2], 1);
    }
    for (let i = 0; i < segs; i++) this.idx.push(v, v + 1 + ((i + 1) % segs), v + 1 + i);
    this.n += segs + 1;
  }

  get count() {
    return this.n;
  }
}

const roadLen = (r: Road) => {
  const l = r.segs[r.segs.length - 1];
  return l ? l.s0 + l.len : 0;
};

function segAt(r: Road, s: number): Segment {
  const segs = r.segs;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].s0 <= s) lo = mid;
    else hi = mid - 1;
  }
  return segs[lo];
}

/** Road distance of the point on seg nearest (x, z). */
const sOn = (g: Segment, x: number, z: number) => g.s0 + Math.min(g.len, Math.max(0, (x - g.ax) * g.dx + (z - g.az) * g.dz));

/** Directed span from a junction node: [a, b] metres out along the arm. */
const armSpan = (sNode: number, dir: 1 | -1, a: number, b: number): Span => (dir > 0 ? [sNode + a, sNode + b] : [sNode - b, sNode - a]);

/** Union of spans sorted by start. */
function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a, b] of spans) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const inAny = (spans: Span[], s: number) => {
  for (const [a, b] of spans) if (s >= a && s <= b) return true;
  return false;
};

export function buildMarkings(s: Session, _tex: TextureSet): CityPiece {
  const net = s.net;
  const m = new Marks();

  const laneCache = new Map<Segment, ReturnType<typeof net.laneInfo>>();
  const lane = (g: Segment) => {
    let l = laneCache.get(g);
    if (!l) laneCache.set(g, (l = net.laneInfo(g, true)));
    return l;
  };

  const info = new Map<Road, RoadMarks>();
  const R = (r: Road): RoadMarks => {
    let v = info.get(r);
    if (!v) info.set(r, (v = { len: roadLen(r), clip: [], hazard: [], yellowNear: [], yellowClip: [] }));
    return v;
  };

  // ---- Road-following primitives ----------------------------------------------------------------

  /** A solid run [s1, s2] along road r at lateral offset off(seg) (null skips that segment), in ≤ 10 m pieces. */
  const run = (r: Road, s1: number, s2: number, off: (g: Segment) => number | null, w: number, c: Paint, minLen = 0.3) => {
    if (s2 - s1 < minLen) return;
    for (const g of r.segs) {
      const e = g.s0 + g.len;
      if (e <= s1 || g.s0 >= s2) continue;
      const a = Math.max(s1, g.s0) - g.s0;
      const b = Math.min(s2, e) - g.s0;
      if (b - a < minLen) continue;
      const o = off(g);
      if (o == null) continue;
      const nx = -g.dz;
      const nz = g.dx;
      const k = Math.ceil((b - a) / 10);
      for (let i = 0; i < k; i++) {
        const p = a + ((b - a) * i) / k;
        const q = a + ((b - a) * (i + 1)) / k;
        m.line(g.ax + g.dx * p + nx * o, g.az + g.dz * p + nz * o, g.ax + g.dx * q + nx * o, g.az + g.dz * q + nz * o, w, c);
      }
    }
  };

  /** run() minus the sorted-by-start exclusion spans. */
  const runClipped = (r: Road, s1: number, s2: number, excl: Span[], off: (g: Segment) => number | null, w: number, c: Paint, minLen = 0.3) => {
    let a = s1;
    for (const [e1, e2] of excl) {
      if (e2 <= a) continue;
      if (e1 >= s2) break;
      if (e1 > a) run(r, a, Math.min(e1, s2), off, w, c, minLen);
      a = Math.max(a, e2);
      if (a >= s2) return;
    }
    if (a < s2) run(r, a, s2, off, w, c, minLen);
  };

  /** Dashes along a road; the phase comes from the road distance, so it runs on across segment joins. */
  const dashed = (r: Road, rm: RoadMarks, off: (g: Segment) => number | null, w: number, mark: number, gap: number, hazard: boolean) => {
    let s0 = 0;
    while (s0 < rm.len) {
      const hz = hazard && inAny(rm.hazard, s0 + 1);
      const mk = hz ? 6 : mark;
      const gp = hz ? 2 : gap;
      runClipped(r, s0, Math.min(s0 + mk, rm.len), rm.clip, off, w, WHITE, 0.6);
      s0 += mk + gp;
    }
  };

  /** A broken line across road r at distance s, between offsets o1 and o2 (right of a→b). */
  const crossDashes = (r: Road, s0: number, o1: number, o2: number, depth: number, mark: number, gap: number) => {
    const g = segAt(r, s0);
    const t = Math.min(g.len, Math.max(0, s0 - g.s0));
    const bx = g.ax + g.dx * t;
    const bz = g.az + g.dz * t;
    const nx = -g.dz;
    const nz = g.dx;
    const span = o2 - o1;
    if (span < mark) return;
    const n = Math.max(1, Math.floor((span + gap) / (mark + gap)));
    const total = n * mark + (n - 1) * gap;
    let o = (o1 + o2) / 2 - total / 2 + mark / 2;
    for (let i = 0; i < n; i++, o += mark + gap) m.rect(bx + nx * o, bz + nz * o, nx, nz, mark / 2, depth / 2, WHITE);
  };

  const P = { x: 0, z: 0 };
  /** Point on road r at distance s and offset o (right of a→b); writes P. */
  const at = (r: Road, s0: number, o: number | ((g: Segment) => number)) => {
    const g = segAt(r, s0);
    const t = Math.min(g.len, Math.max(0, s0 - g.s0));
    const off = typeof o === 'number' ? o : o(g);
    P.x = g.ax + g.dx * t - g.dz * off;
    P.z = g.az + g.dz * t + g.dx * off;
    return P;
  };

  /**
   * Zig-zags both sides of a crossing centred at road distance sC on r, starting `start` m out from it.
   * Walks the network with nearestAlong(), so they carry on across way splits and bends, and clips the
   * centre/lane lines and yellows of every road they cover.
   */
  const zigzags = (r: Road, sC: number, start: number) => {
    const c = at(r, sC, 0);
    const g0 = segAt(r, sC);
    const cx = c.x;
    const cz = c.z;
    const two = r.oneway === 0;
    for (const side of [-1, 1]) {
      let bx = cx;
      let bz = cz;
      let dx = g0.dx * side;
      let dz = g0.dz * side;
      const prev: [number, number][] = [];
      const covered = new Map<Road, Span>();
      for (let k = 0, dist = 0; k <= ZIG_LEN / 2; k++) {
        const step = k === 0 ? start : 2;
        dist += step;
        const hit = net.nearestAlong(bx + dx * step, bz + dz * step, (Math.atan2(dx, -dz) * 180) / Math.PI, 8);
        if (!hit) break;
        const g = hit.seg;
        const f = g.dx * dx + g.dz * dz >= 0;
        dx = f ? g.dx : -g.dx;
        dz = f ? g.dz : -g.dz;
        bx = hit.x;
        bz = hit.z;
        const sh = sOn(g, hit.x, hit.z);
        const span = covered.get(g.road);
        if (span) {
          span[0] = Math.min(span[0], sh);
          span[1] = Math.max(span[1], sh);
        } else covered.set(g.road, [sh, sh]);
        // Lateral positions relative to this walk direction: left kerb, right kerb, centre line.
        const nx = -dz;
        const nz = dx;
        const leftKerb = f ? g.halfLeft : g.halfRight;
        const rightKerb = f ? g.halfRight : g.halfLeft;
        const cl = lane(g).centreLine;
        const lats = [-leftKerb + 0.6, rightKerb - 0.6];
        if (two && cl != null) lats.push(f ? cl : -cl);
        const amp = k % 2 ? 0.3 : -0.3;
        lats.forEach((o, i) => {
          const px = bx + nx * (o + amp);
          const pz = bz + nz * (o + amp);
          const p = prev[i];
          if (p && k > 0) m.line(p[0], p[1], px, pz, 0.1, WHITE);
          prev[i] = [px, pz];
        });
      }
      for (const [road, [a, b]] of covered) {
        const rm = R(road);
        const lo = road === r ? Math.min(a, sC) : a;
        const hi = road === r ? Math.max(b, sC) : b;
        rm.clip.push([lo - 1, hi + 1]);
        rm.yellowClip.push([lo - 1, hi + 1]);
      }
    }
  };

  // ---- Mini-roundabouts ---------------------------------------------------------------------------
  const mini = new Set<Junction>();
  for (const p of s.ex.points) {
    if (p.kind !== 'mini_roundabout') continue;
    const j = net.junctionByNode.get(p.id) ?? net.junctionAt(p.x, p.z, 12);
    if (j) {
      if (mini.has(j)) continue;
      mini.add(j);
      m.disc(j.x, j.z, Math.min(2, j.r * 0.35), WHITE);
    } else m.disc(p.x, p.z, 1.8, WHITE);
  }

  // ---- Give-way points mapped in OSM force their arm to be minor ----------------------------------
  const forced = new Map<Junction, { x: number; z: number }[]>();
  for (const p of s.ex.points) {
    if (p.kind !== 'give_way') continue;
    const j = net.junctionAt(p.x, p.z, 20);
    if (!j || Math.hypot(p.x - j.x, p.z - j.z) < 1) continue;
    const l = forced.get(j);
    if (l) l.push(p);
    else forced.set(j, [{ x: p.x, z: p.z }]);
  }

  // ---- Junction arms: who gives way, where lines stop ---------------------------------------------
  for (const j of net.junctions) {
    const ends = net.nodeSegs.get(j.node);
    if (!ends || ends.length < 2) continue;
    const arms: Arm[] = ends.map(({ seg, end }) => {
      const nodes = seg.road.osm.nodes;
      const closed = nodes[0] === nodes[nodes.length - 1];
      const through = closed || (nodes[0] !== j.node && nodes[nodes.length - 1] !== j.node);
      return {
        seg,
        road: seg.road,
        ox: end === 'a' ? seg.dx : -seg.dx,
        oz: end === 'a' ? seg.dz : -seg.dz,
        sNode: end === 'a' ? seg.s0 : seg.s0 + seg.len,
        dir: end === 'a' ? 1 : -1,
        rank: rankOf(seg.road.highway),
        through,
        role: 'box',
        D: j.r,
      };
    });
    const signalled = s.signals.linesNear(j.x, j.z, j.r + 15).length > 0;
    if (signalled) {
      for (const a of arms) a.role = 'signal';
    } else if (mini.has(j)) {
      for (const a of arms) {
        a.role = 'minor';
        a.D = Math.max(4.5, j.r - 1.5);
      }
    } else {
      const maxRank = Math.max(...arms.map((a) => a.rank));
      const top = arms.filter((a) => a.rank === maxRank);
      // The through pair: the road passing through, else the two most opposite top-rank arms.
      let pair: Arm[] = [];
      let best = -0.5;
      for (let i = 0; i < top.length; i++)
        for (let k = i + 1; k < top.length; k++) {
          const p = top[i];
          const q = top[k];
          const same = p.road === q.road && p.through;
          const score = p.ox * q.ox + p.oz * q.oz - (same ? 1 : 0);
          if (score < best) {
            best = score;
            pair = [p, q];
          }
        }
      const major = pair.length ? pair : top;
      const definite = pair.length > 0 || top.length === 1;
      const pts = forced.get(j);
      for (const a of arms) {
        const isForced = !!pts?.some((p) => {
          const dx = p.x - j.x;
          const dz = p.z - j.z;
          return (a.ox * dx + a.oz * dz) / Math.hypot(dx, dz) > 0.8;
        });
        const inMajor = major.includes(a);
        a.role = isForced ? 'minor' : inMajor && definite ? 'major' : inMajor ? 'box' : 'minor';
      }
      // Give-way distance: the major road's near kerb, measured along the (possibly oblique) minor arm.
      const ref = arms.find((a) => a.role === 'major');
      for (const a of arms) {
        if (a.role !== 'minor') continue;
        if (!ref) {
          a.D = j.r - 1;
          continue;
        }
        const side = a.ox * -ref.oz + a.oz * ref.ox; // > 0: minor arm is right of the major arm's out direction
        const aEnd = ref.dir > 0; // node at the major seg's a end, so out = a→b
        const half = side > 0 === aEnd ? ref.seg.halfRight : ref.seg.halfLeft;
        a.D = Math.min(j.r + 2, Math.max(2.5, half / Math.max(Math.abs(side), 0.5) + 0.6));
      }
    }

    for (const a of arms) {
      const rm = R(a.road);
      const isMini = mini.has(j);
      const C = a.role === 'major' ? 0 : a.role === 'minor' ? a.D + (isMini ? 0.4 : 0.75) : j.r;
      if (C > 0) {
        rm.clip.push(armSpan(a.sNode, a.dir, -0.5, C));
        rm.hazard.push(armSpan(a.sNode, a.dir, 0, C + 30));
      }
      const yc = a.role === 'major' ? j.r : C;
      rm.yellowClip.push(armSpan(a.sNode, a.dir, -0.5, yc));
      rm.yellowNear.push(armSpan(a.sNode, a.dir, 0, yc + 15));

      // Give-way lines across the approach half of the minor arm.
      if (a.role !== 'minor' || NO_LINES.has(a.road.highway) || a.road.osm.tunnel) continue;
      const fwd = a.dir < 0; // approaching traffic travels toward the node
      if ((a.road.oneway === 1 && !fwd) || (a.road.oneway === -1 && fwd)) continue;
      const sG = a.sNode + a.dir * a.D;
      if (sG < 0.3 || sG > rm.len - 0.3) continue;
      const g = segAt(a.road, sG);
      const li = net.laneInfo(g, fwd);
      let o1: number;
      let o2: number;
      if (li.centreLine == null) {
        o1 = -g.halfLeft + 0.3;
        o2 = g.halfRight - 0.3;
      } else if (fwd) {
        o1 = -g.halfLeft + 0.3;
        o2 = li.centreLine - 0.1;
      } else {
        o1 = li.centreLine + 0.1;
        o2 = g.halfRight - 0.3;
      }
      if (o2 - o1 < 1) continue;
      crossDashes(a.road, sG, o1, o2, 0.2, 0.6, 0.3);
      if (!isMini) crossDashes(a.road, sG + a.dir * 0.5, o1, o2, 0.2, 0.6, 0.3);
      // Give-way triangle in the approach lane, apex toward the driver.
      const sB = sG + a.dir * 3;
      const sA = sB + a.dir * 2.8;
      if (!isMini && li.laneWidth >= 2.4 && sA > 0 && sA < rm.len) {
        const lo = li.leftLaneOffset;
        const b1 = at(a.road, sB, lo - 0.45);
        const b1x = b1.x;
        const b1z = b1.z;
        const b2 = at(a.road, sB, lo + 0.45);
        const b2x = b2.x;
        const b2z = b2.z;
        const ap = at(a.road, sA, lo);
        m.line(b1x, b1z, b2x, b2z, 0.14, WHITE);
        m.line(b1x, b1z, ap.x, ap.z, 0.12, WHITE);
        m.line(b2x, b2z, ap.x, ap.z, 0.12, WHITE);
      }
    }
  }

  // ---- Stop lines at signals ----------------------------------------------------------------------
  for (const l of s.signals.lines) {
    m.rect(l.x, l.z, l.dx, l.dz, 0.15, Math.max(0.5, l.halfWidth - 0.15), WHITE);
    const g = l.seg;
    const sL = sOn(g, l.x, l.z);
    const tdir = l.dx * g.dx + l.dz * g.dz > 0 ? 1 : -1;
    const ahead = l.kind === 'crossing' ? 6 : 3.5;
    R(g.road).clip.push(tdir > 0 ? [sL - 0.2, sL + ahead] : [sL - ahead, sL + 0.2]);
  }

  // ---- Signal-controlled crossings: studs and zig-zags --------------------------------------------
  for (const site of s.signals.sites) {
    if (site.kind !== 'crossing' || !site.lines.length) continue;
    const l = site.lines[0];
    const g = l.seg;
    const tdir = l.dx * g.dx + l.dz * g.dz > 0 ? 1 : -1;
    const sC = sOn(g, l.x, l.z) + tdir * 3;
    const o1 = -g.halfLeft + 0.3;
    const o2 = g.halfRight - 0.3;
    crossDashes(g.road, sC - 1.25, o1, o2, 0.1, 0.25, 0.35);
    crossDashes(g.road, sC + 1.25, o1, o2, 0.1, 0.25, 0.35);
    zigzags(g.road, sC, 3.6);
  }

  // ---- Zebras ---------------------------------------------------------------------------------------
  for (const zb of s.signals.zebras) {
    const g = zb.seg;
    const r = g.road;
    const sZ = sOn(g, zb.x, zb.z);
    const o1 = -g.halfLeft + 0.3;
    const o2 = g.halfRight - 0.3;
    const n = Math.max(1, Math.floor((o2 - o1 + 0.6) / 1.2));
    let o = (o1 + o2) / 2 - (n * 1.2 - 0.6) / 2 + 0.3;
    const nx = -g.dz;
    const nz = g.dx;
    for (let i = 0; i < n; i++, o += 1.2) m.rect(zb.x + nx * o, zb.z + nz * o, g.dx, g.dz, 1.5, 0.3, WHITE);
    crossDashes(r, sZ - 2.6, o1, o2, 0.2, 0.6, 0.3);
    crossDashes(r, sZ + 2.6, o1, o2, 0.2, 0.6, 0.3);
    zigzags(r, sZ, 3.2);
  }

  // ---- Centre lines, lane lines and double yellows, road by road ---------------------------------
  for (const r of net.roads) {
    if (!r.segs.length || r.osm.tunnel) continue;
    const rm = R(r);
    const byStart = (a: Span, b: Span) => a[0] - b[0];
    rm.clip.sort(byStart);
    rm.yellowClip.sort(byStart);
    const lined = !NO_LINES.has(r.highway) && r.osm.junction !== 'roundabout' && r.osm.junction !== 'circular';

    if (lined && r.oneway === 0) {
      dashed(r, rm, (g) => {
        const l = lane(g);
        return l.right - l.left >= 5.5 ? l.centreLine : null;
      }, CENTRE_W, 4, 5, true);
    }

    // Lane lines between same-direction lanes.
    // One-way: boundaries from the left kerb. Two-way: also from the right kerb for the other direction.
    if (lined) {
      const probe = lane(r.segs[0]);
      for (let k = 1; k < probe.lanes; k++) {
        dashed(r, rm, (g) => {
          const l = lane(g);
          return l.lanes > k ? l.left + k * l.laneWidth : null;
        }, LANE_W, 3, 6, false);
        if (r.oneway === 0)
          dashed(r, rm, (g) => {
            const l = lane(g);
            return l.lanes > k ? l.right - k * l.laneWidth : null;
          }, LANE_W, 3, 6, false);
      }
    }

    // Double yellows: whole length on main roads without parking, else near junctions.
    if (!NO_LINES.has(r.highway)) {
      const main = MAIN.has(r.highway.replace('_link', ''));
      const near = merge(rm.yellowNear.sort(byStart));
      for (const side of [-1, 1] as const) {
        const parked = side < 0 ? r.parkLeft : r.parkRight;
        const spans: Span[] = main && !parked ? [[0, rm.len]] : near;
        for (const inset of [0.4, 0.6]) {
          const off = side < 0 ? (g: Segment) => -g.halfLeft + inset : (g: Segment) => g.halfRight - inset;
          for (const [a, b] of spans) runClipped(r, Math.max(0, a), Math.min(rm.len, b), rm.yellowClip, off, 0.1, YELLOW, 0.5);
        }
      }
    }
  }

  // ---- Mesh -----------------------------------------------------------------------------------------
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
  geo.setAttribute('aEx', new THREE.Float32BufferAttribute(m.ex, 4));
  geo.setAttribute('aPaint', new THREE.Float32BufferAttribute(m.col, 4));
  geo.setIndex(m.count > 65535 ? new THREE.Uint32BufferAttribute(m.idx, 1) : new THREE.Uint16BufferAttribute(m.idx, 1));
  geo.computeBoundingSphere();

  const uPx = { value: 0.002 };
  const mat = cityShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uPx },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'markings';
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  // World size of one pixel per metre of depth, for the line-width floor.
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const rt = renderer.getRenderTarget();
    const h = rt ? rt.height : renderer.getContext().drawingBufferHeight;
    const p11 = camera.projectionMatrix.elements[5];
    uPx.value = p11 > 0 && h > 0 ? 2 / (p11 * h) : 0;
  };

  const object = new THREE.Group();
  object.add(mesh);
  return { object, dispose: () => disposeTree(object) };
}

const VERT = /* glsl */ `
${CITY_VERT_PARS}
uniform float uPx;
attribute vec4 aEx;
attribute vec4 aPaint;
varying vec4 vPaint;
varying float vCover;

// Widen a corner along one axis so the mark is at least ~1 px across on screen, and return the coverage
// (true / widened size) so the total ink stays the same. e is the corner's half-extent vector on that axis.
float mkGrow(inout vec3 p, vec2 e, vec3 ray, float px) {
  float h = length(e);
  if (h < 1e-5) return 1.0;
  vec2 t = e / h;
  float c = dot(vec3(t.x, 0.0, t.y), ray);
  float foreshort = sqrt(max(1.0 - c * c, 0.0004));
  float hn = max(h, min(0.6 * px / foreshort, 4.0));
  p.xz += t * (hn - h);
  return h / hn;
}

void main() {
  vec3 p = position;
  vec4 w0 = modelMatrix * vec4(p, 1.0);
  vec3 toP = w0.xyz - cameraPosition;
  vec3 ray = toP / max(length(toP), 1e-4);
  float depth = max(-(viewMatrix * w0).z, 0.05);
  float px = uPx * depth;
  float cover = mkGrow(p, aEx.xy, ray, px);
  cover *= mkGrow(p, aEx.zw, ray, px);
  vPaint = aPaint;
  vCover = cover;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
${CITY_FRAG_PARS}
varying vec4 vPaint;
varying float vCover;

float mkHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float mkNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mkHash(i), mkHash(i + vec2(1.0, 0.0)), f.x), mix(mkHash(i + vec2(0.0, 1.0)), mkHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  // Worn paint: broad patches plus fine grit, the grit fading out before it can alias.
  float fw = length(fwidth(vWorld.xz));
  float patches = mkNoise(vWorld.xz * 0.4);
  float grit = mix(mkNoise(vWorld.xz * 9.0), 0.5, smoothstep(0.015, 0.08, fw));
  float wet = clamp(uRain, 0.0, 1.0);
  vec3 paint = vPaint.rgb * (0.9 + 0.1 * patches) * (1.0 - 0.28 * wet);

  // Glass beads in the paint throw headlight back at the driver.
  vec3 light = cityLight(vWorld) + vec3(1.0, 0.96, 0.88) * cityHeadlight(vWorld) * cityNight() * 1.1;
  vec3 col = paint * light;

  // Wet paint is glossier: a Fresnel sky sheen at grazing angles.
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
  col += uSkyColour * wet * (0.04 + 0.3 * fres) * cityAmbient();

  float a = vCover * vPaint.a * clamp(0.9 + 0.1 * patches + (grit - 0.5) * 0.25, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  ${CITY_FRAG_END}
}
`;
