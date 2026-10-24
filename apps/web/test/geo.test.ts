import { describe, expect, it } from 'vitest';
import {
  angleDiff,
  applyMatrix3d,
  closestOnSegment,
  cumulative,
  haversine,
  hash2,
  headingVec,
  project,
  quadMatrix3d,
  rng,
  unproject,
  vecHeading,
} from '../src/sim/geo.ts';

const O = { lat: 51.5, lng: -0.1 };

describe('projection', () => {
  it('round-trips and puts north at −z, east at +x', () => {
    const [x, z] = project(O, 51.501, -0.098);
    expect(x).toBeGreaterThan(0);
    expect(z).toBeLessThan(0);
    const back = unproject(O, x, z);
    expect(back.lat).toBeCloseTo(51.501, 9);
    expect(back.lng).toBeCloseTo(-0.098, 9);
  });

  it('agrees with haversine to within a metre over 2 km', () => {
    const p = { lat: 51.512, lng: -0.085 };
    const [x, z] = project(O, p.lat, p.lng);
    expect(Math.abs(Math.hypot(x, z) - haversine(O, p))).toBeLessThan(1);
  });

  it('haversine: one degree of latitude ≈ 111.2 km', () => {
    expect(haversine({ lat: 51, lng: 0 }, { lat: 52, lng: 0 })).toBeCloseTo(111_195, -2);
  });
});

describe('headings', () => {
  it.each([
    [0, 0, -1],
    [90, 1, 0],
    [180, 0, 1],
    [270, -1, 0],
  ])('heading %i ↔ vector (%i, %i)', (h, dx, dz) => {
    const [x, z] = headingVec(h);
    expect(x).toBeCloseTo(dx);
    expect(z).toBeCloseTo(dz);
    expect(vecHeading(dx, dz)).toBeCloseTo(h);
  });

  it('angleDiff wraps into (−180, 180]', () => {
    expect(angleDiff(10, 350)).toBeCloseTo(20);
    expect(angleDiff(350, 10)).toBeCloseTo(-20);
    expect(angleDiff(90, 90)).toBe(0);
  });
});

describe('closestOnSegment', () => {
  it('clamps t and gives a positive offset on the right of travel', () => {
    // Travelling north (a→b), east is on the right.
    const c = closestOnSegment(3, -5, 0, 0, 0, -10);
    expect(c.t).toBeCloseTo(0.5);
    expect(c.dist).toBeCloseTo(3);
    expect(c.offset).toBeCloseTo(3);
    expect(closestOnSegment(-2, 5, 0, 0, 0, -10)).toMatchObject({ t: 0, offset: -2 });
  });
});

describe('homography (quadMatrix3d)', () => {
  it('maps the element rectangle onto an arbitrary quad', () => {
    const quad: [[number, number], [number, number], [number, number], [number, number]] = [
      [100, 50],
      [420, 80],
      [380, 300],
      [90, 260],
    ];
    const m = quadMatrix3d(200, 100, quad);
    const corners: [number, number][] = [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ];
    corners.forEach(([x, y], i) => {
      const [X, Y] = applyMatrix3d(m, x, y);
      expect(X).toBeCloseTo(quad[i][0], 6);
      expect(Y).toBeCloseTo(quad[i][1], 6);
    });
  });

  it('reduces to a plain scale for an axis-aligned rectangle', () => {
    const m = quadMatrix3d(10, 10, [
      [0, 0],
      [20, 0],
      [20, 30],
      [0, 30],
    ]);
    expect(applyMatrix3d(m, 5, 5)).toEqual([10, 15]);
  });
});

describe('randomness and polylines', () => {
  it('rng and hash2 are deterministic and in [0, 1)', () => {
    const a = rng(7);
    const b = rng(7);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(hash2(3, 4, 1)).toBe(hash2(3, 4, 1));
    expect(hash2(3, 4, 1)).not.toBe(hash2(4, 3, 1));
  });

  it('cumulative distances', () => {
    expect(cumulative([[0, 0], [3, 4], [3, 10]])).toEqual([0, 5, 11]);
  });
});
