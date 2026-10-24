// The committed OSM extract format (apps/web/public/osm/<id>.json), in local metres.

export type XZ = [number, number];

export interface OsmRoad {
  id: number;
  highway: string;
  name: string;
  lanes: number | null;
  width: number | null;
  oneway: 1 | -1 | 0;
  maxspeed: number | null;
  lanesForward: number | null;
  lanesBackward: number | null;
  junction: string | null;
  layer: number;
  bridge: boolean;
  tunnel: boolean;
  nodes: number[];
  pts: XZ[];
  parking: { left: boolean | null; right: boolean | null };
}

export interface OsmPoint {
  id: number;
  kind: string;
  crossing: string | null;
  zebra: boolean;
  direction: string | null;
  x: number;
  z: number;
}

export interface OsmBuilding {
  pts: XZ[];
  kind: string;
  h: number | null;
  levels: number | null;
  mat: string | null;
  colour: string | null;
  roof: string | null;
  roofColour: string | null;
  shop: boolean;
  name: string | null;
}

export interface OsmExtract {
  id: string;
  origin: { lat: number; lng: number };
  radius: number;
  fetched: string;
  attribution: string;
  roads: OsmRoad[];
  points: OsmPoint[];
  buildings: OsmBuilding[];
  trees: { x: number; z: number; h: number | null }[];
  areas: { kind: 'grass' | 'water' | 'wood'; pts: XZ[] }[];
  kerbs: XZ[][];
  sidewalks: { pts: XZ[]; width: number | null }[];
  surfaces: { kind: string; pts: XZ[] }[];
}

export async function loadExtract(id: string): Promise<OsmExtract> {
  const res = await fetch(`/osm/${id}.json`);
  if (!res.ok) throw new Error(`Could not load map data for ${id} (HTTP ${res.status})`);
  return (await res.json()) as OsmExtract;
}

/** An empty extract, handy for tests. */
export function emptyExtract(radius = 200): OsmExtract {
  return {
    id: 'test',
    origin: { lat: 51.5, lng: -0.1 },
    radius,
    fetched: '',
    attribution: '',
    roads: [],
    points: [],
    buildings: [],
    trees: [],
    areas: [],
    kerbs: [],
    sidewalks: [],
    surfaces: [],
  };
}

let nextId = 1;
export function testRoad(pts: XZ[], over: Partial<OsmRoad> = {}): OsmRoad {
  const id = nextId++;
  return {
    id,
    highway: 'residential',
    name: `Road ${id}`,
    lanes: null,
    width: null,
    oneway: 0,
    maxspeed: null,
    lanesForward: null,
    lanesBackward: null,
    junction: null,
    layer: 0,
    bridge: false,
    tunnel: false,
    nodes: pts.map((_, i) => id * 1000 + i),
    pts,
    parking: { left: null, right: null },
    ...over,
  };
}
