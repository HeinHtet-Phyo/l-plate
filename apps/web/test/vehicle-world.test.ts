import { describe, expect, it } from 'vitest';
import { Vehicle, VEHICLE } from '../src/sim/vehicle.ts';
import { RoadWorld, obbOverlap, type WorldEvent } from '../src/sim/world.ts';
import { junctionAspect } from '../src/sim/signals.ts';
import { box, crossroads } from './fixtures.ts';

const idle = { steer: 0, throttle: 0, brake: 0 };
const go = { steer: 0, throttle: 1, brake: 0 };

function drive(v: Vehicle, c: typeof idle, seconds: number, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) Object.assign(v, v.propose(c, dt));
}

describe('Vehicle', () => {
  it('holds still on the handbrake and creeps without it', () => {
    const v = new Vehicle();
    drive(v, go, 2);
    expect(v.speed).toBe(0);
    v.handbrake = false;
    drive(v, idle, 5);
    expect(v.speed).toBeGreaterThan(1);
    expect(v.speed).toBeLessThanOrEqual(VEHICLE.creepSpeed + 0.05);
  });

  it('accelerates, brakes to a stop, and never reverses', () => {
    const v = new Vehicle();
    v.handbrake = false;
    drive(v, go, 5);
    expect(v.speed).toBeGreaterThan(8);
    expect(v.z).toBeLessThan(-15); // heading 0 is north (−z)
    drive(v, { steer: 0, throttle: 0, brake: 1 }, 5);
    expect(v.speed).toBe(0);
  });

  it('steering right turns clockwise', () => {
    const v = new Vehicle();
    v.handbrake = false;
    v.speed = 8;
    v.updateSteer(0.5, true, 0.1);
    expect(v.steeringWheelAngle()).toBeCloseTo(0.5 * 35 * 13.5);
    drive(v, { steer: 0.5, throttle: 0.3, brake: 0 }, 1);
    expect(v.heading).toBeGreaterThan(10);
    expect(v.heading).toBeLessThan(180);
  });

  it('keyboard steering ramps and recentres', () => {
    const v = new Vehicle();
    v.updateSteer(1, false, 0.1);
    expect(v.steer).toBeCloseTo(0.15);
    v.updateSteer(0, false, 0.01);
    expect(v.steer).toBeCloseTo(0.12);
  });

  it('footprint and wheels are where the eye says', () => {
    const fp = Vehicle.footprint(0, 0, 0);
    expect(fp[0][1]).toBeCloseTo(-VEHICLE.front);
    expect(fp[0][0]).toBeCloseTo(-VEHICLE.left);
    expect(Vehicle.wheels(0, 0, 0)).toHaveLength(4);
  });
});

describe('Vehicle realism', () => {
  const dt = 1 / 60;
  const step = (v: Vehicle, c: typeof idle) => Object.assign(v, v.propose(c, dt));

  it('accelerates like a small hatchback: 0–30 mph in ~4–6 s, 0–60 mph in ~10–14 s, tops out around 80–95 mph', () => {
    const v = new Vehicle();
    v.handbrake = false;
    let t = 0;
    let t30 = 0;
    let t60 = 0;
    while (t < 60) {
      step(v, go);
      t += dt;
      if (!t30 && v.speed > 13.41) t30 = t;
      if (!t60 && v.speed > 26.82) t60 = t;
    }
    expect(t30).toBeGreaterThan(4);
    expect(t30).toBeLessThan(6);
    expect(t60).toBeGreaterThan(10);
    expect(t60).toBeLessThan(14);
    expect(v.speed * 2.237).toBeGreaterThan(80);
    expect(v.speed * 2.237).toBeLessThan(95);
  });

  it('pedals respond with a short lag, not instantly', () => {
    const v = new Vehicle();
    v.handbrake = false;
    v.speed = 5;
    v.propose(go, dt);
    expect(v.throttleIn).toBeLessThan(0.1);
    for (let i = 0; i < 60; i++) step(v, go);
    expect(v.throttleIn).toBeGreaterThan(0.9);
  });

  it('stops from 30 mph within the Highway Code braking distance (14 m)', () => {
    const v = new Vehicle();
    v.handbrake = false;
    v.speed = 13.41;
    let d = 0;
    while (v.speed > 0) {
      const p = v.propose({ steer: 0, throttle: 0, brake: 1 }, dt);
      d += Math.hypot(p.x - v.x, p.z - v.z);
      Object.assign(v, p);
    }
    expect(d).toBeGreaterThan(8);
    expect(d).toBeLessThan(14);
  });

  it('a light brake press slows gently', () => {
    const v = new Vehicle();
    v.handbrake = false;
    v.speed = 13.41;
    for (let i = 0; i < 60; i++) step(v, { steer: 0, throttle: 0, brake: 0.3 });
    expect(v.speed).toBeGreaterThan(10);
  });

  it('cannot corner harder than the tyres allow (~0.85 g)', () => {
    for (const mph of [30, 50]) {
      const v = new Vehicle();
      v.handbrake = false;
      v.speed = mph / 2.237;
      v.steer = 1;
      const h0 = v.heading;
      Object.assign(v, v.propose({ steer: 1, throttle: 0.3, brake: 0 }, 0.1));
      const yaw = (((v.heading - h0) / 0.1) * Math.PI) / 180;
      expect((yaw * v.speed) / 9.81).toBeLessThanOrEqual(0.86);
    }
  });

  it('keyboard steering uses less lock and turns slower at speed', () => {
    const parked = new Vehicle();
    const moving = new Vehicle();
    moving.speed = 13.4;
    for (let i = 0; i < 120; i++) {
      parked.updateSteer(1, false, dt);
      moving.updateSteer(1, false, dt);
    }
    expect(parked.steer).toBe(1);
    expect(moving.steer).toBeLessThan(0.5);
    expect(moving.steer).toBeGreaterThan(0.25);
  });
});

describe('obbOverlap', () => {
  it('detects overlap of rotated boxes', () => {
    expect(obbOverlap(0, 0, 0, 2, 1, 0, 3, 0, 2, 1)).toBe(true);
    expect(obbOverlap(0, 0, 0, 2, 1, 0, 5, 0, 2, 1)).toBe(false);
    expect(obbOverlap(0, 0, 0, 2, 1, 2.5, 0, 45, 2, 1)).toBe(true);
    expect(obbOverlap(0, 0, 0, 2, 1, 4, 0, 90, 2, 1)).toBe(false);
  });
});

function worldOn(opts: Parameters<typeof crossroads>[0] = {}) {
  const { net, grid, signals } = crossroads(opts);
  const w = new RoadWorld(net, grid, signals, { lat: 51.5, lng: -0.1 });
  return w;
}

function run(w: RoadWorld, c: typeof idle, seconds: number, dt = 1 / 30): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let t = 0; t < seconds; t += dt) {
    w.step(c, dt);
    out.push(...w.drain());
  }
  return out;
}

describe('RoadWorld', () => {
  it('drives along the left lane cleanly and reports the road', () => {
    const w = worldOn({ lights: false });
    const s = w.net.spawnNear(-150, 0, 90)!;
    w.place(s.x, s.z, s.heading);
    w.car.handbrake = false;
    const ev = run(w, { steer: 0, throttle: 0.4, brake: 0 }, 4);
    expect(ev.filter((e) => e.type === 'collision' || e.type === 'kerb')).toEqual([]);
    expect(w.under?.road).toBe('East Road');
    expect(w.under?.limit).toBe(20);
    expect(w.car.x).toBeGreaterThan(s.x + 5);
    expect(Math.abs(w.car.z - s.z)).toBeLessThan(0.01);
  });

  it('flags crossing the centre line', () => {
    const w = worldOn({ lights: false });
    w.place(-150, 1.5, 90); // travelling east on the right-hand (wrong) side
    w.car.handbrake = false;
    const ev = run(w, { steer: 0, throttle: 0.3, brake: 0 }, 0.5);
    expect(ev).toContainEqual({ type: 'centreLine', over: true });
  });

  it('collides with a building off the road and stops short of it', () => {
    const w = worldOn({ lights: false, buildings: [box(70, 40, 6)] });
    w.place(40, 40, 90);
    w.car.handbrake = false;
    const ev = run(w, go, 6);
    expect(ev).toContainEqual({ type: 'collision', what: 'building' });
    expect(w.car.x + VEHICLE.front).toBeLessThan(64 + 1);
  });

  it('ignores mapped buildings that overlap the carriageway', () => {
    const w = worldOn({ lights: false, buildings: [box(-120, 0, 6)] });
    w.place(-150, -1.5, 90);
    w.car.handbrake = false;
    expect(run(w, go, 6).filter((e) => e.type === 'collision')).toEqual([]);
  });

  it('collides with an AI car', () => {
    const w = worldOn({ lights: false });
    w.place(-150, -1.5, 90);
    w.car.handbrake = false;
    w.dynamicObstacles = [{ kind: 'car', x: -140, z: -1.9, hl: 2.1, hw: 0.9, heading: 90 }];
    expect(run(w, go, 3)).toContainEqual({ type: 'collision', what: 'car' });
  });

  it('reports running a red light', () => {
    const w = worldOn();
    const line = w.signals!.lines.find((l) => l.dx > 0.9)!; // eastbound approach
    // Start the clock where this approach is red for the whole run.
    let t0 = 0;
    while (junctionAspect(line.group, t0) !== 'red' || junctionAspect(line.group, t0 + 8) !== 'red') t0 += 0.5;
    w.time = t0;
    const s = w.net.spawnNear(line.x - 25, line.z, 90)!;
    w.place(s.x, s.z, s.heading);
    w.car.handbrake = false;
    w.car.speed = 8;
    const ev = run(w, { steer: 0, throttle: 0.3, brake: 0 }, 5);
    expect(ev).toContainEqual({ type: 'redLight' });
  });

  it('reports a turn through the junction', () => {
    const w = worldOn({ lights: false });
    const s = w.net.spawnNear(-40, 0, 90)!;
    w.place(s.x, s.z, s.heading);
    w.car.handbrake = false;
    w.car.speed = 5;
    const ev: WorldEvent[] = [];
    for (let t = 0; t < 8; t += 1 / 30) {
      // Steer left as the car enters the junction box.
      const steer = w.car.x > -5 && Math.abs(((w.car.heading - 0 + 540) % 360) - 180) > 8 ? -0.7 : 0;
      w.car.updateSteer(steer, true, 1 / 30); // the session applies steering before stepping
      w.step({ steer, throttle: 0.15, brake: 0 }, 1 / 30);
      ev.push(...w.drain());
    }
    const turn = ev.find((e) => e.type === 'turn');
    expect(turn).toBeDefined();
    expect((turn as { angle: number }).angle).toBeLessThan(-45);
  });
});
