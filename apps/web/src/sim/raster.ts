// AreaGrid: square coverage rasters (carriageway, pavement, building) over ±radius,
// rasterised at 2× supersampling through one reusable fine scratch buffer.
import type { RoadNetwork } from './roads.ts';
import type { OsmExtract, XZ } from './osm.ts';

const ROAD_SURFACES = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk', 'service', 'living_street', 'busway', 'motorway']);
const PED_SURFACES = new Set(['footway', 'pedestrian', 'sidewalk', 'footpath', 'cycleway']);

/** Fill [from, to) of a typed array row, guarding against reversed or negative spans. */
export function fillSpan(arr: Uint8Array, rowStart: number, rowLen: number, from: number, to: number, v: number) {
  const a = Math.max(0, Math.min(rowLen, from));
  const b = Math.max(0, Math.min(rowLen, to));
  if (b <= a) return; // a negative end index would fill from the end of the array
  arr.fill(v, rowStart + a, rowStart + b);
}

/** A binary raster with polygon/quad/circle fills (even-odd scanline). */
export class FineRaster {
  n: number;
  cell: number;
  radius: number;
  data: Uint8Array;
  constructor(n: number, cell: number, radius: number) {
    this.n = n;
    this.cell = cell;
    this.radius = radius;
    this.data = new Uint8Array(n * n);
  }
  clear() {
    this.data.fill(0);
  }
  /** World x → continuous column. */
  col(x: number) {
    return (x + this.radius) / this.cell;
  }
  row(z: number) {
    return (z + this.radius) / this.cell;
  }
  polygon(pts: XZ[], v = 1) {
    if (pts.length < 3) return;
    const n = this.n;
    let minR = Infinity;
    let maxR = -Infinity;
    const cols: number[] = [];
    const rows: number[] = [];
    for (const [x, z] of pts) {
      const c = this.col(x);
      const r = this.row(z);
      cols.push(c);
      rows.push(r);
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
    const r0 = Math.max(0, Math.floor(minR));
    const r1 = Math.min(n - 1, Math.ceil(maxR));
    const xs: number[] = [];
    for (let r = r0; r <= r1; r++) {
      const y = r + 0.5;
      xs.length = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const yi = rows[i];
        const yj = rows[j];
        if (yi > y !== yj > y) xs.push(cols[i] + ((y - yi) / (yj - yi)) * (cols[j] - cols[i]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        fillSpan(this.data, r * n, n, Math.round(xs[k]), Math.round(xs[k + 1]), v);
      }
    }
  }
  circle(x: number, z: number, rad: number, v = 1) {
    const n = this.n;
    const cc = this.col(x);
    const cr = this.row(z);
    const rr = rad / this.cell;
    const r0 = Math.max(0, Math.floor(cr - rr));
    const r1 = Math.min(n - 1, Math.ceil(cr + rr));
    for (let r = r0; r <= r1; r++) {
      const dy = r + 0.5 - cr;
      const w = rr * rr - dy * dy;
      if (w <= 0) continue;
      const half = Math.sqrt(w);
      fillSpan(this.data, r * n, n, Math.round(cc - half), Math.round(cc + half), v);
    }
  }
  /** Quad along a→b from −left to +right (right of a→b). */
  strip(ax: number, az: number, bx: number, bz: number, left: number, right: number, v = 1) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) return;
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    this.polygon(
      [
        [ax - nx * left, az - nz * left],
        [bx - nx * left, bz - nz * left],
        [bx + nx * right, bz + nz * right],
        [ax + nx * right, az + nz * right],
      ],
      v,
    );
  }
  /** Average 2×2 fine cells into a coarse 0–255 layer. */
  downsample(out: Uint8Array) {
    const n = this.n;
    const m = n >> 1;
    const d = this.data;
    for (let r = 0; r < m; r++) {
      const a = 2 * r * n;
      const b = a + n;
      for (let c = 0; c < m; c++) {
        const s = d[a + 2 * c] + d[a + 2 * c + 1] + d[b + 2 * c] + d[b + 2 * c + 1];
        out[r * m + c] = (s * 255) >> 2;
      }
    }
  }
}

export class AreaGrid {
  n: number;
  cell: number;
  radius: number;
  carriageway: Uint8Array;
  pavement: Uint8Array;
  building: Uint8Array;

  constructor(radius: number, cellOverride?: number) {
    this.radius = radius;
    this.cell = cellOverride ?? Math.max(0.5, (2 * radius) / 4096);
    this.n = Math.ceil((2 * radius) / this.cell);
    this.carriageway = new Uint8Array(this.n * this.n);
    this.pavement = new Uint8Array(this.n * this.n);
    this.building = new Uint8Array(this.n * this.n);
  }

  static build(ex: Pick<OsmExtract, 'buildings' | 'sidewalks' | 'surfaces' | 'radius'>, net: RoadNetwork, extraBuildings: XZ[][] = [], cellOverride?: number): AreaGrid {
    const g = new AreaGrid(ex.radius, cellOverride);
    const fine = new FineRaster(g.n * 2, g.cell / 2, ex.radius);

    // Building
    for (const b of ex.buildings) fine.polygon(b.pts);
    for (const b of extraBuildings) fine.polygon(b);
    fine.downsample(g.building);

    // Carriageway
    fine.clear();
    for (const s of net.segs) {
      fine.strip(s.ax, s.az, s.bx, s.bz, s.halfLeft, s.halfRight);
      const jr = (s.halfLeft + s.halfRight) / 2;
      fine.circle(s.ax, s.az, jr);
      fine.circle(s.bx, s.bz, jr);
    }
    for (const sf of ex.surfaces) if (ROAD_SURFACES.has(sf.kind)) fine.polygon(sf.pts, 1);
    for (const sf of ex.surfaces) if (sf.kind === 'traffic_island') fine.polygon(sf.pts, 0);
    fine.downsample(g.carriageway);

    // Pavement: a 2.5 m strip beyond each kerb, mapped sidewalks and pedestrian surfaces.
    fine.clear();
    for (const s of net.segs) {
      if (s.road.highway === 'service' && !s.measuredLeft && !s.measuredRight) continue;
      fine.strip(s.ax, s.az, s.bx, s.bz, s.halfLeft + 2.5, -s.halfLeft);
      fine.strip(s.ax, s.az, s.bx, s.bz, -s.halfRight, s.halfRight + 2.5);
    }
    for (const sw of ex.sidewalks) {
      const half = (sw.width ?? 2) / 2;
      for (let i = 0; i < sw.pts.length - 1; i++) {
        const [ax, az] = sw.pts[i];
        const [bx, bz] = sw.pts[i + 1];
        fine.strip(ax, az, bx, bz, half, half);
        fine.circle(ax, az, half);
      }
    }
    for (const sf of ex.surfaces) if (PED_SURFACES.has(sf.kind) || sf.kind === 'traffic_island') fine.polygon(sf.pts, 1);
    fine.downsample(g.pavement);
    const P = g.pavement;
    const C = g.carriageway;
    const B = g.building;
    for (let i = 0; i < P.length; i++) {
      // Never on carriageway, never inside buildings.
      const v = (P[i] * (255 - C[i]) * (255 - B[i])) / (255 * 255);
      P[i] = v | 0;
    }
    return g;
  }

  idx(x: number, z: number): number {
    const c = Math.floor((x + this.radius) / this.cell);
    const r = Math.floor((z + this.radius) / this.cell);
    if (c < 0 || r < 0 || c >= this.n || r >= this.n) return -1;
    return r * this.n + c;
  }
  isCarriageway(x: number, z: number) {
    const i = this.idx(x, z);
    return i >= 0 && this.carriageway[i] >= 128;
  }
  isPavement(x: number, z: number) {
    const i = this.idx(x, z);
    return i >= 0 && this.pavement[i] >= 128;
  }
  isBuilding(x: number, z: number) {
    const i = this.idx(x, z);
    return i >= 0 && this.building[i] >= 128;
  }

  /** RGBA bytes: R carriageway, G pavement, B building, A 255. */
  rgba(): Uint8Array {
    const out = new Uint8Array(this.n * this.n * 4);
    for (let i = 0; i < this.carriageway.length; i++) {
      out[i * 4] = this.carriageway[i];
      out[i * 4 + 1] = this.pavement[i];
      out[i * 4 + 2] = this.building[i];
      out[i * 4 + 3] = 255;
    }
    return out;
  }
}

/** Land cover raster (grass, water, wood) with a cell of max(1, 2r/2048) m. */
export class LandCover {
  n: number;
  cell: number;
  radius: number;
  data: Uint8Array;
  constructor(radius: number) {
    this.radius = radius;
    this.cell = Math.max(1, (2 * radius) / 2048);
    this.n = Math.ceil((2 * radius) / this.cell);
    this.data = new Uint8Array(this.n * this.n * 4);
  }
  static build(ex: Pick<OsmExtract, 'areas' | 'radius'>, extraGrass: XZ[][] = []): LandCover {
    const lc = new LandCover(ex.radius);
    const fine = new FineRaster(lc.n, lc.cell, ex.radius);
    const channel = (kind: string) => (kind === 'grass' ? 0 : kind === 'water' ? 1 : 2);
    for (const ch of [0, 1, 2]) {
      fine.clear();
      for (const a of ex.areas) if (channel(a.kind) === ch) fine.polygon(a.pts);
      if (ch === 0) for (const p of extraGrass) fine.polygon(p);
      for (let i = 0; i < fine.data.length; i++) if (fine.data[i]) lc.data[i * 4 + ch] = 255;
    }
    for (let i = 0; i < lc.n * lc.n; i++) lc.data[i * 4 + 3] = 255;
    return lc;
  }
  kindAt(x: number, z: number): 'grass' | 'water' | 'wood' | null {
    const c = Math.floor((x + this.radius) / this.cell);
    const r = Math.floor((z + this.radius) / this.cell);
    if (c < 0 || r < 0 || c >= this.n || r >= this.n) return null;
    const i = (r * this.n + c) * 4;
    if (this.data[i + 1]) return 'water';
    if (this.data[i + 2]) return 'wood';
    if (this.data[i]) return 'grass';
    return null;
  }
}
