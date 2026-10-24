// A tiny synthetic world: two residential roads crossing at the origin, with traffic lights.
import { emptyExtract, testRoad, type OsmExtract, type OsmPoint } from '../src/sim/osm.ts';
import { RoadNetwork } from '../src/sim/roads.ts';
import { AreaGrid } from '../src/sim/raster.ts';
import { Signals } from '../src/sim/signals.ts';

export const CROSS_NODE = 999_999;

export function crossroads(opts: { lights?: boolean; buildings?: OsmExtract['buildings'] } = {}) {
  const ex = emptyExtract(250);
  // East–west (a→b travels east) and north–south (a→b travels south), sharing the middle node.
  const ew = testRoad([[-200, 0], [0, 0], [200, 0]], { name: 'East Road' });
  const ns = testRoad([[0, -200], [0, 0], [0, 200]], { name: 'North Road' });
  ew.nodes[1] = CROSS_NODE;
  ns.nodes[1] = CROSS_NODE;
  ex.roads = [ew, ns];
  ex.buildings = opts.buildings ?? [];
  const lights: OsmPoint = { id: 1, kind: 'traffic_signals', crossing: null, zebra: false, direction: null, x: 0, z: 0 };
  ex.points = opts.lights === false ? [] : [lights];
  const net = new RoadNetwork(ex);
  const grid = AreaGrid.build(ex, net, [], 1);
  const signals = new Signals(ex.points, net);
  return { ex, net, grid, signals };
}

/** An axis-aligned square building footprint. */
export function box(cx: number, cz: number, half: number): OsmExtract['buildings'][number] {
  return {
    pts: [
      [cx - half, cz - half],
      [cx + half, cz - half],
      [cx + half, cz + half],
      [cx - half, cz + half],
    ],
    kind: 'house',
    h: null,
    levels: null,
    mat: null,
    colour: null,
    roof: null,
    roofColour: null,
    shop: false,
    name: null,
  };
}
