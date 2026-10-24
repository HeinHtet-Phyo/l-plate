import { describe, expect, it } from 'vitest';
import { defaultLimit, Grid, tagWidth } from '../src/sim/roads.ts';
import { testRoad } from '../src/sim/osm.ts';
import { FineRaster, fillSpan } from '../src/sim/raster.ts';
import { box, crossroads } from './fixtures.ts';

describe('road tags', () => {
  it('estimates width from width, lanes, then class', () => {
    expect(tagWidth(testRoad([[0, 0], [1, 0]], { width: 9 }))).toBe(9);
    expect(tagWidth(testRoad([[0, 0], [1, 0]], { lanes: 4 }))).toBeCloseTo(12.4);
    expect(tagWidth(testRoad([[0, 0], [1, 0]], { lanes: 1, oneway: 1 }))).toBe(3.5);
    expect(tagWidth(testRoad([[0, 0], [1, 0]], { highway: 'primary' }))).toBe(9);
  });

  it('defaults UK speed limits by class', () => {
    expect(defaultLimit('residential')).toBe(20);
    expect(defaultLimit('primary_link')).toBe(30);
    expect(defaultLimit('motorway')).toBe(70);
  });

  it('Grid returns items whose boxes overlap the query', () => {
    const g = new Grid<string>(10);
    g.addBox(0, 0, 5, 5, 'a');
    g.addBox(100, 100, 105, 105, 'b');
    expect([...g.query(2, 2, 1, new Set())]).toEqual(['a']);
    expect(g.query(50, 50, 1, new Set()).size).toBe(0);
  });
});

describe('RoadNetwork', () => {
  const { net } = crossroads({ lights: false });

  it('splits roads into segments and finds the crossroads junction', () => {
    expect(net.roads).toHaveLength(2);
    expect(net.segs).toHaveLength(4);
    expect(net.junctions).toHaveLength(1);
    expect(net.inJunction(0, 0)).toBe(true);
    expect(net.inJunction(60, 0)).toBe(false);
  });

  it('applies residential defaults (20 mph, parking both sides)', () => {
    const r = net.roads[0];
    expect(r.limit).toBe(20);
    expect(r.limitMapped).toBe(false);
    expect(r.parkLeft && r.parkRight).toBe(true);
    expect(r.segs[0].halfLeft).toBeCloseTo(3 + 2.1);
  });

  it('nearest / nearestAlong pick the right road and direction', () => {
    expect(net.nearest(50, 2)?.seg.road.name).toBe('East Road');
    const west = net.nearestAlong(50, 2, 270);
    expect(west?.seg.road.name).toBe('East Road');
    expect(west?.forward).toBe(false);
    const north = net.nearestAlong(1, 80, 0);
    expect(north?.seg.road.name).toBe('North Road');
    expect(north?.forward).toBe(false);
  });

  it('spawns in the left-hand (UK) lane', () => {
    // Heading north on North Road: the left lane is west of the centre line.
    const north = net.spawnNear(0, 80, 0)!;
    expect(north.heading).toBeCloseTo(0);
    expect(north.x).toBeLessThan(-0.5);
    // Heading east on East Road: the left lane is north (−z).
    const east = net.spawnNear(-80, 0, 90)!;
    expect(east.heading).toBeCloseTo(90);
    expect(east.z).toBeLessThan(-0.5);
  });

  it('respects one-way roads when spawning', () => {
    const { net: n2 } = crossroads({ lights: false });
    n2.roads[0].oneway = 1;
    const s = n2.spawnNear(80, 0, 270)!;
    expect(s.heading).toBeCloseTo(90);
  });
});

describe('rasters', () => {
  it('fillSpan ignores reversed and out-of-range spans', () => {
    const a = new Uint8Array(10);
    fillSpan(a, 0, 10, 6, 3, 1);
    fillSpan(a, 0, 10, -5, -1, 1);
    expect(a.every((v) => v === 0)).toBe(true);
    fillSpan(a, 0, 10, 8, 50, 1);
    expect([...a]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it('FineRaster fills polygons and circles with roughly the right area', () => {
    const r = new FineRaster(100, 1, 50);
    r.polygon([[-10, -10], [10, -10], [10, 10], [-10, 10]]);
    expect(r.data.reduce((s, v) => s + v, 0)).toBe(400);
    r.clear();
    r.circle(0, 0, 10);
    expect(Math.abs(r.data.reduce((s, v) => s + v, 0) - Math.PI * 100)).toBeLessThan(15);
  });

  it('AreaGrid marks carriageway, pavement and buildings', () => {
    const { grid } = crossroads({ lights: false, buildings: [box(40, 30, 6)] });
    expect(grid.isCarriageway(50, 0)).toBe(true);
    expect(grid.isCarriageway(0, -100)).toBe(true);
    expect(grid.isCarriageway(50, 30)).toBe(false);
    expect(grid.isPavement(50, 6.5)).toBe(true);
    expect(grid.isPavement(50, 0)).toBe(false);
    expect(grid.isBuilding(40, 30)).toBe(true);
    expect(grid.isBuilding(40, 50)).toBe(false);
    expect(grid.idx(1000, 0)).toBe(-1);
    const rgba = grid.rgba();
    expect(rgba.length).toBe(grid.n * grid.n * 4);
    expect(rgba[grid.idx(50, 0) * 4]).toBe(255);
  });
});
