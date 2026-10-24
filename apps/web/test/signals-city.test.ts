import { describe, expect, it } from 'vitest';
import { CYCLE, amberAge, crossingAspect, junctionAspect } from '../src/sim/signals.ts';
import {
  STYLES,
  bakeLightMap,
  buildingHeight,
  isZone1,
  layoutBuildings,
  placeParkedCars,
  placeStreetlights,
  placeTrees,
  pointInPoly,
} from '../src/sim/city.ts';
import { box, crossroads } from './fixtures.ts';

describe('signal timing', () => {
  it('never shows green to both phase groups at once', () => {
    for (let t = 0; t < CYCLE * 2; t += 0.25) {
      const a = junctionAspect(0, t);
      const b = junctionAspect(1, t);
      expect(a === 'green' && b === 'green', `t=${t}`).toBe(false);
      // At least one group is held on red (or red+amber) at all times.
      expect(['red', 'redAmber'].includes(a) || ['red', 'redAmber'].includes(b), `t=${t}`).toBe(true);
    }
  });

  it('follows the UK sequence green → amber → red → red+amber → green', () => {
    const order = ['green', 'amber', 'red', 'redAmber'];
    for (const group of [0, 1] as const) {
      let prev = junctionAspect(group, 0);
      for (let t = 0.1; t < CYCLE * 2; t += 0.1) {
        const a = junctionAspect(group, t);
        if (a !== prev) expect(order[(order.indexOf(prev) + 1) % 4], `group ${group} t=${t}`).toBe(a);
        prev = a;
      }
    }
  });

  it('crossings and negative times wrap', () => {
    expect(crossingAspect(0)).toBe('green');
    expect(crossingAspect(23)).toBe('amber');
    expect(crossingAspect(-CYCLE + 1)).toBe(crossingAspect(1));
  });

  it('amberAge counts seconds since amber started', () => {
    expect(amberAge('junction', 0, 14)).toBeCloseTo(1);
    expect(amberAge('junction', 0, 5)).toBe(Infinity);
    expect(amberAge('crossing', 0, 22.5)).toBeCloseTo(0.5);
  });
});

describe('Signals placement', () => {
  const { signals } = crossroads();

  it('puts one stop line on each approach to a signalled crossroads', () => {
    expect(signals.sites).toHaveLength(1);
    expect(signals.sites[0].kind).toBe('junction');
    expect(signals.lines).toHaveLength(4);
    const groups = signals.lines.map((l) => l.group).sort();
    expect(groups).toEqual([0, 0, 1, 1]);
  });

  it('stop lines face the junction and sit before it', () => {
    for (const l of signals.lines) {
      const toCentre = -l.x * l.dx + -l.z * l.dz;
      expect(toCentre).toBeGreaterThan(0);
      expect(Math.hypot(l.x, l.z)).toBeLessThan(20);
    }
    expect(signals.linesNear(0, 0, 30)).toHaveLength(4);
    expect(signals.linesNear(150, 0, 30)).toHaveLength(0);
  });
});

describe('city layout', () => {
  it('pointInPoly', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(pointInPoly(5, 5, sq)).toBe(true);
    expect(pointInPoly(15, 5, sq)).toBe(false);
  });

  it('building heights prefer tags, then sensible defaults', () => {
    expect(buildingHeight({ h: 30, levels: null, kind: 'yes' }, false, 1)).toBe(30);
    expect(buildingHeight({ h: null, levels: 3, kind: 'yes' }, false, 1)).toBeCloseTo(10.6);
    expect(buildingHeight({ h: null, levels: null, kind: 'house' }, false, 1)).toBeCloseTo(7.4);
    expect(buildingHeight({ h: null, levels: null, kind: 'church' }, false, 1)).toBe(14);
  });

  it('knows zone 1 from the origin', () => {
    expect(isZone1({ lat: 51.5007, lng: -0.1246 })).toBe(true); // Westminster
    expect(isZone1({ lat: 51.5663, lng: 0.0844 })).toBe(false); // Goodmayes
  });

  it('layoutBuildings is deterministic and uses known styles', () => {
    const ex = { origin: { lat: 51.56, lng: 0.08 }, buildings: [box(40, 30, 6), box(60, 30, 6), { ...box(-40, 30, 8), kind: 'office' }] };
    const a = layoutBuildings(ex);
    expect(a).toEqual(layoutBuildings(ex));
    for (const b of a) {
      expect(STYLES).toContain(b.style);
      expect(b.h).toBeGreaterThan(2);
    }
    expect(a[0].roof).toBe('slate');
  });

  it('parks cars beside the kerb, away from junctions and lights', () => {
    const { net, signals } = crossroads();
    const cars = placeParkedCars(net, signals, null);
    expect(cars.length).toBeGreaterThan(20);
    for (const c of cars) {
      expect(net.inJunction(c.x, c.z, 10)).toBe(false);
      expect(Math.hypot(c.x, c.z)).toBeGreaterThan(18);
      // On the parking strip, not in the running lanes (drive half-width is 3 m).
      const lateral = Math.min(Math.abs(c.x), Math.abs(c.z));
      expect(lateral).toBeGreaterThan(3);
      expect(lateral).toBeLessThan(5.1);
    }
    expect(placeParkedCars(net, signals, null)).toEqual(cars);
  });

  it('places streetlights off the carriageway and bakes a light map', () => {
    const { net, grid } = crossroads();
    const lamps = placeStreetlights(net, grid);
    expect(lamps.length).toBeGreaterThan(10);
    for (const l of lamps) expect(grid.isCarriageway(l.x, l.z)).toBe(false);
    const map = bakeLightMap([{ x: 0, z: 0, heading: 0 }], 50);
    const at = (x: number, z: number) => map.data[Math.floor((z + 50) / map.cell) * map.n + Math.floor((x + 50) / map.cell)];
    expect(at(0.5, 0.5)).toBeGreaterThan(180);
    expect(at(30, 30)).toBe(0);
  });

  it('keeps trees off roads and buildings', () => {
    const { grid } = crossroads({ buildings: [box(40, 30, 6)] });
    const trees = placeTrees({ trees: [{ x: 50, z: 0, h: null }, { x: 40, z: 30, h: null }, { x: 40, z: 60, h: 40 }], areas: [] }, grid);
    expect(trees).toHaveLength(1);
    expect(trees[0].h).toBe(25);
  });
});
