// AI traffic: UK-lane following, Intelligent Driver Model, red lights, junction choices, spawning by flow.
import { angleDiff, headingVec, rng, vecHeading } from './geo.ts';
import { rankOf, type RoadNetwork, type Segment } from './roads.ts';
import type { Signals } from './signals.ts';
import { amberAge } from './signals.ts';
import type { Obstacle } from './world.ts';
import { CAR_COLOURS } from './city.ts';

export const HOURLY_WEEKDAY = [0.12, 0.08, 0.06, 0.06, 0.1, 0.25, 0.55, 0.9, 1, 0.8, 0.65, 0.65, 0.7, 0.68, 0.7, 0.8, 0.92, 1, 0.9, 0.7, 0.5, 0.4, 0.3, 0.2];
export const HOURLY_WEEKEND = [0.2, 0.15, 0.1, 0.08, 0.06, 0.08, 0.15, 0.25, 0.4, 0.55, 0.65, 0.72, 0.75, 0.75, 0.72, 0.7, 0.68, 0.62, 0.55, 0.48, 0.4, 0.35, 0.3, 0.25];

export const SHARE: Record<string, number> = {
  motorway: 1, trunk: 1, primary: 1, secondary: 0.85, tertiary: 0.65, unclassified: 0.35, residential: 0.22, living_street: 0.1, service: 0.08, busway: 0.05,
};
export const shareOf = (h: string) => SHARE[h.replace('_link', '')] ?? 0.2;

export type Congestion = 'free' | 'slow' | 'jammed';
export const FLOW: Record<Congestion, { density: number; speed: number }> = {
  free: { density: 9, speed: 0.92 },
  slow: { density: 28, speed: 0.45 },
  jammed: { density: 55, speed: 0.15 },
};

/** London busyness 0–1 for a fractional hour, interpolated between hours. */
export function busyness(hour: number, weekend: boolean): number {
  const t = weekend ? HOURLY_WEEKEND : HOURLY_WEEKDAY;
  const h = ((hour % 24) + 24) % 24;
  const i = Math.floor(h);
  const f = h - i;
  return t[i] * (1 - f) + t[(i + 1) % 24] * f;
}

/** Interpolate the flow table at a level (1 = free, 2 = slow, 3 = jammed). */
export function flowAt(level: number): { density: number; speed: number } {
  const l = Math.max(1, Math.min(3, level));
  const [a, b, f] = l <= 2 ? [FLOW.free, FLOW.slow, l - 1] : [FLOW.slow, FLOW.jammed, l - 2];
  return { density: a.density + (b.density - a.density) * f, speed: a.speed + (b.speed - a.speed) * f };
}

/** Typical flow for a road class: cars per km per lane and fraction of the limit. */
export function typicalFlow(highway: string, busy: number): { density: number; speed: number } {
  const share = shareOf(highway);
  const level = busy * share * 1.6;
  const f = flowAt(level);
  let density = f.density * (0.35 + 0.65 * share);
  if (level < 1) density *= 0.15 + 0.85 * level;
  return { density, speed: f.speed };
}

export interface AiCar {
  id: number;
  seg: Segment;
  forward: boolean;
  s: number;
  v: number;
  factor: number;
  colour: number;
  x: number;
  z: number;
  heading: number;
  braking: boolean;
  next: { seg: Segment; forward: boolean } | null;
  /** Rendered (smoothed) pose. */
  rx: number;
  rz: number;
  rh: number;
}

export interface Learner {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

export const IDM = { a: 1.6, b: 2.6, s0: 2.2, T: 1.3, maxDecel: 9 };

export function idmAccel(v: number, v0: number, gap: number | null, dv: number): number {
  const free = 1 - Math.pow(v / Math.max(0.1, v0), 4);
  if (gap == null) return Math.max(-IDM.maxDecel, IDM.a * free);
  const sStar = IDM.s0 + Math.max(0, v * IDM.T + (v * dv) / (2 * Math.sqrt(IDM.a * IDM.b)));
  const acc = IDM.a * (free - (sStar / Math.max(0.1, gap)) ** 2);
  return Math.max(-IDM.maxDecel, acc);
}

export class Traffic {
  cars: AiCar[] = [];
  net: RoadNetwork;
  signals: Signals | null;
  max = 130;
  time = 0;
  busy = 0.7;
  /** Per-road congestion override from live speed bands (road idx → band). */
  live = new Map<number, Congestion>();
  liveSource: 'typical' | 'live' = 'typical';
  underway = false;
  private rand = rng(42);
  private nextId = 1;
  private nearSegs: Segment[] = [];
  private nearAt = -Infinity;
  private start: Learner | null = null;

  constructor(net: RoadNetwork, signals: Signals | null) {
    this.net = net;
    this.signals = signals;
  }

  flowFor(seg: Segment): { density: number; speed: number } {
    const band = this.live.get(seg.road.idx);
    if (band) {
      const f = FLOW[band];
      return band === 'free' ? { density: f.density * (0.2 + 0.8 * this.busy), speed: f.speed } : f;
    }
    return typicalFlow(seg.road.highway, this.busy);
  }

  private pose(c: AiCar) {
    const lane = this.net.laneInfo(c.seg, c.forward);
    const sg = c.seg;
    const dirx = c.forward ? sg.dx : -sg.dx;
    const dirz = c.forward ? sg.dz : -sg.dz;
    const sx = c.forward ? sg.ax : sg.bx;
    const sz = c.forward ? sg.az : sg.bz;
    c.x = sx + dirx * c.s - sg.dz * lane.leftLaneOffset;
    c.z = sz + dirz * c.s + sg.dx * lane.leftLaneOffset;
    c.heading = vecHeading(dirx, dirz);
  }

  private canTravel(seg: Segment, forward: boolean) {
    if (seg.road.highway === 'busway') return false;
    if (seg.road.oneway === 1 && !forward) return false;
    if (seg.road.oneway === -1 && forward) return false;
    return true;
  }

  private chooseNext(c: AiCar): { seg: Segment; forward: boolean } | null {
    const node = c.forward ? c.seg.nodeB : c.seg.nodeA;
    const opts = this.net.nodeSegs.get(node) ?? [];
    const hIn = c.forward ? vecHeading(c.seg.dx, c.seg.dz) : vecHeading(-c.seg.dx, -c.seg.dz);
    const choices: { seg: Segment; forward: boolean; w: number }[] = [];
    for (const o of opts) {
      if (o.seg === c.seg) continue;
      const forward = o.end === 'a';
      if (!this.canTravel(o.seg, forward)) continue;
      const hOut = forward ? vecHeading(o.seg.dx, o.seg.dz) : vecHeading(-o.seg.dx, -o.seg.dz);
      const turn = Math.abs(angleDiff(hOut, hIn));
      if (turn > 165) continue; // no U-turns
      let w = turn < 30 ? 1 : turn < 120 ? 0.35 : 0.05;
      if (rankOf(o.seg.road.highway) < rankOf(c.seg.road.highway)) w *= 0.5;
      if (o.seg.road.highway === 'service') w *= 0.2;
      choices.push({ seg: o.seg, forward, w });
    }
    if (!choices.length) return null;
    let r = this.rand() * choices.reduce((s, ch) => s + ch.w, 0);
    for (const ch of choices) {
      r -= ch.w;
      if (r <= 0) return { seg: ch.seg, forward: ch.forward };
    }
    return choices[choices.length - 1];
  }

  private spawn(learner: Learner, minDist: number): boolean {
    const segs = this.nearSegs;
    if (!segs.length) return false;
    let total = 0;
    const w = segs.map((s) => {
      const f = this.flowFor(s);
      const v = s.len * f.density * Math.max(1, s.road.lanes / (s.road.oneway ? 1 : 2));
      total += v;
      return v;
    });
    for (let attempt = 0; attempt < 6; attempt++) {
      let r = this.rand() * total;
      let i = 0;
      for (; i < w.length - 1; i++) {
        r -= w[i];
        if (r <= 0) break;
      }
      const seg = segs[i];
      let forward = this.rand() < 0.5;
      if (seg.road.oneway === 1) forward = true;
      if (seg.road.oneway === -1) forward = false;
      if (!this.canTravel(seg, forward)) continue;
      const car: AiCar = {
        id: this.nextId++,
        seg,
        forward,
        s: this.rand() * seg.len,
        v: 0,
        factor: 0.88 + this.rand() * 0.18,
        colour: CAR_COLOURS[Math.floor(this.rand() * CAR_COLOURS.length)],
        x: 0,
        z: 0,
        heading: 0,
        braking: false,
        next: null,
        rx: 0,
        rz: 0,
        rh: 0,
      };
      this.pose(car);
      const d = Math.hypot(car.x - learner.x, car.z - learner.z);
      if (d < minDist || d > 300) continue;
      if (this.cars.some((o) => Math.hypot(o.x - car.x, o.z - car.z) < 9)) continue;
      if (this.net.inJunction(car.x, car.z, 2)) continue;
      car.v = (seg.road.limit * 0.447) * this.flowFor(seg).speed * car.factor;
      car.next = this.chooseNext(car);
      car.rx = car.x;
      car.rz = car.z;
      car.rh = car.heading;
      this.cars.push(car);
      return true;
    }
    return false;
  }

  /** Target car count around the learner from flow density. */
  target(): number {
    let n = 0;
    for (const s of this.nearSegs) {
      const f = this.flowFor(s);
      const lanes = s.road.oneway ? Math.max(1, s.road.lanes) : Math.max(2, s.road.lanes);
      n += (s.len / 1000) * f.density * lanes;
    }
    return Math.min(this.max, Math.round(n));
  }

  step(dt: number, learner: Learner) {
    this.time += dt;
    if (!this.start) this.start = { ...learner };
    if (!this.underway && (Math.hypot(learner.x - this.start.x, learner.z - this.start.z) > 30 || this.time > 20)) this.underway = true;
    if (this.time - this.nearAt > 1) {
      this.nearAt = this.time;
      this.nearSegs = [...this.net.segmentsNear(learner.x, learner.z, 300)].filter((s) => s.road.highway !== 'busway' && s.len > 3);
    }
    // Despawn far cars.
    this.cars = this.cars.filter((c) => Math.hypot(c.x - learner.x, c.z - learner.z) <= 340);
    const target = this.target();
    for (let k = 0; k < 4 && this.cars.length < target; k++) if (!this.spawn(learner, this.underway ? 120 : 25)) break;

    const [lhx, lhz] = headingVec(learner.heading);
    for (const c of this.cars) {
      const [dx, dz] = headingVec(c.heading);
      const rx = -dz;
      const rz = dx;
      let gap: number | null = null;
      let leadV = 0;
      const consider = (ox: number, oz: number, oh: number, ov: number, isLearner: boolean) => {
        const relx = ox - c.x;
        const relz = oz - c.z;
        const along = relx * dx + relz * dz;
        if (along <= 0 || along > 60) return;
        const lat = Math.abs(relx * rx + relz * rz);
        if (lat > (isLearner ? 1.7 : 1.6)) return;
        if (!isLearner && Math.abs(angleDiff(oh, c.heading)) > 75) return;
        const g = along - 4.3;
        if (gap == null || g < gap) {
          gap = g;
          leadV = ov;
        }
      };
      for (const o of this.cars) if (o !== c && Math.abs(o.x - c.x) < 60 && Math.abs(o.z - c.z) < 60) consider(o.x, o.z, o.heading, o.v, false);
      // The learner counts as a leader (queue behind them, never drive through them).
      consider(learner.x - lhx * 0.05, learner.z - lhz * 0.05, learner.heading, learner.speed, true);
      // Red and late-amber lights: a virtual stopped car at the stop line.
      if (this.signals) {
        for (const l of this.signals.linesNear(c.x, c.z, 60)) {
          if (l.dx * dx + l.dz * dz < 0.8) continue;
          const along = (l.x - c.x) * dx + (l.z - c.z) * dz;
          if (along <= 0.5 || along > 60) continue;
          const lat = Math.abs((l.x - c.x) * rx + (l.z - c.z) * rz);
          if (lat > l.halfWidth + 2) continue;
          const a = this.signals.aspect(l, this.time);
          const late = a === 'amber' && (amberAge(l.kind, l.group, this.time) > 0.5 || along > (c.v * c.v) / (2 * 3) + 2);
          if (a === 'red' || a === 'redAmber' || late) {
            const g = along - 2.3;
            if (gap == null || g < gap) {
              gap = g;
              leadV = 0;
            }
          }
        }
      }
      const desired = Math.max(2, c.seg.road.limit * 0.44704 * this.flowFor(c.seg).speed * c.factor);
      // Slow down for corners at the end of the segment.
      let v0 = desired;
      if (c.next) {
        const hOut = c.next.forward ? vecHeading(c.next.seg.dx, c.next.seg.dz) : vecHeading(-c.next.seg.dx, -c.next.seg.dz);
        const turn = Math.abs(angleDiff(hOut, c.heading));
        const toEnd = c.seg.len - c.s;
        if (turn > 30 && toEnd < 25) v0 = Math.min(v0, 4 + toEnd * 0.25);
      }
      const acc = idmAccel(c.v, v0, gap, c.v - leadV);
      c.braking = acc < -0.5;
      c.v = Math.max(0, c.v + acc * dt);
      c.s += c.v * dt;
      while (c.s >= c.seg.len) {
        const nx = c.next ?? this.chooseNext(c);
        if (!nx) {
          c.v = -1; // mark for removal (dead end)
          break;
        }
        c.s -= c.seg.len;
        c.seg = nx.seg;
        c.forward = nx.forward;
        c.next = this.chooseNext(c);
      }
      if (c.v >= 0) this.pose(c);
      // Ease the rendered pose round corners.
      const k = 1 - Math.exp(-dt * 6);
      c.rx += (c.x - c.rx) * k;
      c.rz += (c.z - c.rz) * k;
      c.rh = (c.rh + angleDiff(c.heading, c.rh) * k + 360) % 360;
    }
    this.cars = this.cars.filter((c) => c.v >= 0);
  }

  obstacles(): Obstacle[] {
    return this.cars.map((c) => ({ kind: 'car', x: c.rx, z: c.rz, hl: 2.1, hw: 0.9, heading: c.rh }));
  }

  /** Map Google speed-reading intervals onto the OSM roads under them. */
  applySpeedBands(polylines: { pts: [number, number][]; bands: { from: number; to: number; speed: 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM' }[] }[]) {
    this.live.clear();
    const map = { NORMAL: 'free', SLOW: 'slow', TRAFFIC_JAM: 'jammed' } as const;
    for (const p of polylines) {
      for (const b of p.bands) {
        for (let i = b.from; i < Math.min(b.to, p.pts.length - 1); i++) {
          const [ax, az] = p.pts[i];
          const [bx, bz] = p.pts[i + 1];
          const mx = (ax + bx) / 2;
          const mz = (az + bz) / 2;
          const h = this.net.nearestAlong(mx, mz, vecHeading(bx - ax, bz - az), 15);
          if (h) this.live.set(h.seg.road.idx, map[b.speed]);
        }
      }
    }
    this.liveSource = this.live.size ? 'live' : 'typical';
  }
}
