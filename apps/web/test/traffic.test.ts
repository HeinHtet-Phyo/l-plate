import { describe, expect, it } from 'vitest';
import { FLOW, Traffic, busyness, flowAt, idmAccel, typicalFlow } from '../src/sim/traffic.ts';
import { crossroads } from './fixtures.ts';

describe('traffic models', () => {
  it('busyness interpolates and wraps the hour', () => {
    expect(busyness(8, false)).toBe(1);
    expect(busyness(8.5, false)).toBeCloseTo(0.9);
    expect(busyness(32, false)).toBe(busyness(8, false));
    expect(busyness(3, true)).toBeLessThan(busyness(13, true));
  });

  it('flowAt clamps and interpolates the table', () => {
    expect(flowAt(0)).toEqual(FLOW.free);
    expect(flowAt(3.5).density).toBe(FLOW.jammed.density);
    expect(flowAt(3.5).speed).toBeCloseTo(FLOW.jammed.speed);
    expect(flowAt(1.5).density).toBeCloseTo((FLOW.free.density + FLOW.slow.density) / 2);
  });

  it('main roads carry more traffic than side streets', () => {
    expect(typicalFlow('primary', 0.8).density).toBeGreaterThan(typicalFlow('residential', 0.8).density);
  });

  it('IDM accelerates on a free road and brakes hard behind a stopped car', () => {
    expect(idmAccel(0, 10, null, 0)).toBeCloseTo(1.6);
    expect(idmAccel(10, 10, null, 0)).toBeCloseTo(0);
    expect(idmAccel(10, 10, 5, 10)).toBe(-9);
    expect(idmAccel(5, 10, 100, 0)).toBeGreaterThan(0);
  });
});

describe('Traffic', () => {
  const learner = { x: 0, z: 60, heading: 0, speed: 0 };

  it('spawns cars on the roads, in a legal lane, near but not on the learner', () => {
    const { net, grid, signals } = crossroads();
    const t = new Traffic(net, signals);
    t.busy = 1;
    for (let i = 0; i < 30; i++) t.step(1 / 30, learner);
    expect(t.cars.length).toBeGreaterThan(0);
    for (const c of t.cars) {
      expect(grid.isCarriageway(c.x, c.z)).toBe(true);
      expect(Math.hypot(c.x - learner.x, c.z - learner.z)).toBeGreaterThan(20);
      const travel = c.forward ? 1 : -1;
      // UK: left-hand lane, i.e. negative offset relative to the direction of travel.
      const off = (c.x - c.seg.ax) * -c.seg.dz + (c.z - c.seg.az) * c.seg.dx;
      expect(off * travel).toBeLessThan(0);
    }
    expect(t.obstacles()).toHaveLength(t.cars.length);
  });

  it('never drives into the learner', () => {
    const { net, signals } = crossroads({ lights: false });
    const t = new Traffic(net, null);
    t.busy = 1;
    // A learner parked in the northbound lane; any car behind must queue.
    const stopped = { ...learner, x: -1.5, z: -20, heading: 0, speed: 0 };
    for (let i = 0; i < 30 * 40; i++) t.step(1 / 30, stopped);
    for (const c of t.cars) {
      const sameLane = Math.abs(c.x - stopped.x) < 1.2 && Math.abs(c.heading - 0) < 10;
      if (sameLane && c.z > stopped.z) expect(c.z - stopped.z).toBeGreaterThan(3.5);
    }
    void signals;
  });

  it('maps live speed bands onto roads', () => {
    const { net } = crossroads({ lights: false });
    const t = new Traffic(net, null);
    t.applySpeedBands([{ pts: [[-100, -1], [-50, -1]], bands: [{ from: 0, to: 1, speed: 'TRAFFIC_JAM' }] }]);
    expect(t.liveSource).toBe('live');
    expect(t.flowFor(net.roads[0].segs[0])).toEqual(FLOW.jammed);
  });
});
