// RoadWorld: moves the car through the city — collisions, kerbs, lane position, red lights, junction turns.
import { angleDiff, headingVec, unproject } from './geo.ts';
import { Grid, type RoadNetwork, type Segment } from './roads.ts';
import type { AreaGrid } from './raster.ts';
import type { Signals } from './signals.ts';
import { amberAge } from './signals.ts';
import { Vehicle, VEHICLE, type Controls } from './vehicle.ts';

export type WorldEvent =
  | { type: 'bump'; strength: number }
  | { type: 'collision'; what: 'building' | 'car' | 'tree' }
  | { type: 'kerb'; where: 'left' | 'right' | 'junction'; mounted: true }
  | { type: 'centreLine'; over: boolean }
  | { type: 'redLight' }
  | { type: 'turn'; angle: number };

export interface Obstacle {
  kind: 'car' | 'tree';
  x: number;
  z: number;
  /** Half extents along/across heading (boxes) or radius (trees). */
  hl: number;
  hw: number;
  heading: number;
}

/** Separating-axis test between two oriented rectangles. */
export function obbOverlap(
  ax: number, az: number, ah: number, ahl: number, ahw: number,
  bx: number, bz: number, bh: number, bhl: number, bhw: number,
): boolean {
  const axes: [number, number][] = [];
  for (const h of [ah, bh]) {
    const [dx, dz] = headingVec(h);
    axes.push([dx, dz], [-dz, dx]);
  }
  const corners = (x: number, z: number, h: number, hl: number, hw: number) => {
    const [dx, dz] = headingVec(h);
    const rx = -dz;
    const rz = dx;
    return [
      [x + dx * hl + rx * hw, z + dz * hl + rz * hw],
      [x + dx * hl - rx * hw, z + dz * hl - rz * hw],
      [x - dx * hl - rx * hw, z - dz * hl - rz * hw],
      [x - dx * hl + rx * hw, z - dz * hl + rz * hw],
    ];
  };
  const A = corners(ax, az, ah, ahl, ahw);
  const B = corners(bx, bz, bh, bhl, bhw);
  for (const [px, pz] of axes) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const [x, z] of A) {
      const p = x * px + z * pz;
      amin = Math.min(amin, p);
      amax = Math.max(amax, p);
    }
    for (const [x, z] of B) {
      const p = x * px + z * pz;
      bmin = Math.min(bmin, p);
      bmax = Math.max(bmax, p);
    }
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}

export interface RoadUnder {
  seg: Segment;
  forward: boolean;
  road: string;
  limit: number;
  lateral: number;
  twoWay: boolean;
}

export class RoadWorld {
  net: RoadNetwork;
  grid: AreaGrid;
  signals: Signals | null;
  origin: { lat: number; lng: number };
  car = new Vehicle();
  staticObstacles = new Grid<Obstacle>(10);
  /** Dynamic obstacles (AI cars), refreshed by the traffic system each step. */
  dynamicObstacles: Obstacle[] = [];
  events: WorldEvent[] = [];
  time = 0;
  /** Body rise from wheels on the pavement (m). */
  bodyRise = 0;
  wheelsOff = [false, false, false, false];
  onPavement = false;
  under: RoadUnder | null = null;
  overCentre = false;
  private lastCollision = -Infinity;
  private lastKerbWarn = -Infinity;
  private junctionEntry: { heading: number } | null = null;

  constructor(net: RoadNetwork, grid: AreaGrid, signals: Signals | null, origin: { lat: number; lng: number }) {
    this.net = net;
    this.grid = grid;
    this.signals = signals;
    this.origin = origin;
  }

  addObstacle(o: Obstacle) {
    const r = Math.max(o.hl, o.hw);
    this.staticObstacles.addBox(o.x - r, o.z - r, o.x + r, o.z + r, o);
  }

  place(x: number, z: number, heading: number) {
    this.car.x = x;
    this.car.z = z;
    this.car.heading = heading;
    this.car.speed = 0;
    this.junctionEntry = null;
    this.refreshWheels(true);
    this.refreshRoad();
  }

  recover() {
    const s = this.net.spawnNear(this.car.x, this.car.z, this.car.heading);
    if (s) this.place(s.x, s.z, s.heading);
  }

  get position() {
    return unproject(this.origin, this.car.x, this.car.z);
  }

  private hitsSomething(x: number, z: number, heading: number): 'building' | 'car' | 'tree' | null {
    for (const [px, pz] of Vehicle.footprint(x, z, heading)) {
      if (this.grid.isBuilding(px, pz) && !this.grid.isCarriageway(px, pz)) return 'building';
    }
    const [dx, dz] = headingVec(heading);
    // Box centre from eye: 0.05 m back, 0.37 m left.
    const cx = x - dx * 0.05 + dz * VEHICLE.eyeRight;
    const cz = z - dz * 0.05 - dx * VEHICLE.eyeRight;
    const hl = (VEHICLE.front + VEHICLE.rear) / 2;
    const hw = 0.9;
    const near = this.staticObstacles.query(cx, cz, 4, new Set());
    for (const o of near) {
      if (obbOverlap(cx, cz, heading, hl, hw, o.x, o.z, o.heading, o.hl, o.hw)) return o.kind;
    }
    for (const o of this.dynamicObstacles) {
      if (Math.abs(o.x - cx) > 6 || Math.abs(o.z - cz) > 6) continue;
      if (obbOverlap(cx, cz, heading, hl, hw, o.x, o.z, o.heading, o.hl, o.hw)) return 'car';
    }
    return null;
  }

  private refreshWheels(silent = false) {
    const ws = Vehicle.wheels(this.car.x, this.car.z, this.car.heading);
    const wasAllOn = this.wheelsOff.every((w) => !w);
    let off = 0;
    let firstUp: number | null = null;
    ws.forEach(([x, z], i) => {
      const isOff = !this.grid.isCarriageway(x, z);
      if (isOff !== this.wheelsOff[i]) {
        if (!silent) this.events.push({ type: 'bump', strength: Math.min(1, 0.25 + this.car.speed / 10) });
        if (isOff && firstUp == null) firstUp = i;
      }
      this.wheelsOff[i] = isOff;
      if (isOff) off++;
    });
    this.bodyRise = 0.12 * (off / 4);
    this.onPavement = off > 0 && ws.some(([x, z]) => this.grid.isPavement(x, z) || !this.grid.isCarriageway(x, z));
    if (!silent && firstUp != null && wasAllOn && this.time - this.lastKerbWarn > 3) {
      this.lastKerbWarn = this.time;
      const where = this.net.inJunction(this.car.x, this.car.z, 4) ? 'junction' : firstUp % 2 === 0 ? 'left' : 'right';
      this.events.push({ type: 'kerb', where, mounted: true });
    }
  }

  private refreshRoad() {
    const [cx, cz] = this.car.centre();
    const hit = this.net.nearestAlong(cx, cz, this.car.heading, 25);
    if (!hit) {
      this.under = null;
      return;
    }
    const lane = this.net.laneInfo(hit.seg, hit.forward);
    const twoWay = hit.seg.road.oneway === 0;
    const lateral = hit.offset - lane.leftLaneOffset;
    this.under = {
      seg: hit.seg,
      forward: hit.forward,
      road: hit.seg.road.name,
      limit: hit.seg.road.limit,
      lateral: hit.forward ? lateral : -lateral,
      twoWay,
    };
    // Over the centre line (two-way roads): more than 0.3 m past it, toward oncoming traffic.
    let over = false;
    if (twoWay && lane.centreLine != null && !this.net.inJunction(cx, cz)) {
      const past = hit.forward ? hit.offset - lane.centreLine : lane.centreLine - hit.offset;
      over = past > 0.3 && hit.dist < Math.max(hit.seg.halfLeft, hit.seg.halfRight) + 1;
    }
    if (over !== this.overCentre) {
      this.overCentre = over;
      this.events.push({ type: 'centreLine', over });
    }
  }

  private checkRedLights(px: number, pz: number, nx: number, nz: number) {
    if (!this.signals) return;
    const [dx, dz] = headingVec(this.car.heading);
    const frontOld: [number, number] = [px + dx * VEHICLE.front, pz + dz * VEHICLE.front];
    const frontNew: [number, number] = [nx + dx * VEHICLE.front, nz + dz * VEHICLE.front];
    for (const l of this.signals.linesNear(nx, nz, 30)) {
      if (l.dx * dx + l.dz * dz < 0.7) continue;
      const before = (frontOld[0] - l.x) * l.dx + (frontOld[1] - l.z) * l.dz;
      const after = (frontNew[0] - l.x) * l.dx + (frontNew[1] - l.z) * l.dz;
      if (!(before < 0 && after >= 0)) continue;
      const lat = Math.abs((frontNew[0] - l.x) * -l.dz + (frontNew[1] - l.z) * l.dx);
      if (lat > l.halfWidth + 1) continue;
      const aspect = this.signals.aspect(l, this.time);
      const age = amberAge(l.kind, l.group, this.time);
      // Amber counts when the car could easily have stopped (≈4 m/s² from when it turned amber).
      const couldStop = aspect === 'amber' && age * 1 > this.car.speed / 4 + 0.5;
      if (aspect === 'red' || aspect === 'redAmber' || couldStop) this.events.push({ type: 'redLight' });
    }
  }

  step(c: Controls, dt: number) {
    this.time += dt;
    const car = this.car;
    const p = car.propose(c, dt);
    const hit = p.speed > 0.01 ? this.hitsSomething(p.x, p.z, p.heading) : null;
    if (hit) {
      car.speed *= 0.15;
      if (this.time - this.lastCollision > 1.5) {
        this.lastCollision = this.time;
        this.events.push({ type: 'bump', strength: Math.min(1, 0.3 + p.speed / 8) });
        this.events.push({ type: 'collision', what: hit });
      }
    } else {
      const ox = car.x;
      const oz = car.z;
      car.x = p.x;
      car.z = p.z;
      car.heading = p.heading;
      car.speed = p.speed;
      this.checkRedLights(ox, oz, p.x, p.z);
    }
    this.refreshWheels();
    this.refreshRoad();
    // Junction turns: compare heading leaving the junction box with heading on entry.
    const [cx, cz] = car.centre();
    const inJ = this.net.inJunction(cx, cz);
    if (inJ && !this.junctionEntry) this.junctionEntry = { heading: car.heading };
    if (!inJ && this.junctionEntry) {
      const angle = angleDiff(car.heading, this.junctionEntry.heading);
      if (Math.abs(angle) >= 20) this.events.push({ type: 'turn', angle: Math.round(angle) });
      this.junctionEntry = null;
    }
  }

  drain(): WorldEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
