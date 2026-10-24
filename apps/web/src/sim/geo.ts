// Local frame: metres, x = east, z = south, y = up. North is −z.
// Equirectangular projection around an origin; accurate to well under a metre within ~3 km.

export const EARTH_R = 6_371_000;
export const K = (Math.PI / 180) * EARTH_R;
export const DEG = Math.PI / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Origin {
  lat: number;
  lng: number;
}

export function project(o: Origin, lat: number, lng: number): [number, number] {
  const x = (lng - o.lng) * K * Math.cos(o.lat * DEG);
  const z = -(lat - o.lat) * K;
  return [x, z];
}

export function unproject(o: Origin, x: number, z: number): LatLng {
  return { lat: o.lat - z / K, lng: o.lng + x / (K * Math.cos(o.lat * DEG)) };
}

/** Compass heading (0 = north, 90 = east) → unit direction in (x, z). */
export function headingVec(h: number): [number, number] {
  const r = h * DEG;
  return [Math.sin(r), -Math.cos(r)];
}

/** Direction (dx, dz) → compass heading in [0, 360). */
export function vecHeading(dx: number, dz: number): number {
  const h = Math.atan2(dx, -dz) / DEG;
  return (h + 360) % 360;
}

/** Right of a direction (dx, dz). */
export function rightOf(dx: number, dz: number): [number, number] {
  return [-dz, dx];
}

/** Signed angle difference a − b in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  return ((((a - b + 540) % 360) + 360) % 360) - 180;
}

/** Haversine distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Closest point on segment a→b to p: returns t in [0,1], distance, signed offset right of a→b. */
export function closestOnSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { t: number; dist: number; offset: number; x: number; z: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const x = ax + dx * t;
  const z = az + dz * t;
  const len = Math.sqrt(len2) || 1;
  // right of (dx, dz) is (−dz, dx)
  const offset = ((px - ax) * -dz + (pz - az) * dx) / len;
  return { t, dist: Math.hypot(px - x, pz - z), offset, x, z };
}

/** Seeded hash → [0, 1). */
export function hash2(a: number, b: number, seed = 0): number {
  let h = Math.imul(Math.floor(a) | 0, 374761393) ^ Math.imul(Math.floor(b) | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Mulberry32 seeded PRNG. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * CSS matrix3d that maps an element's own rectangle (w × h, transform-origin top-left)
 * onto the quad p0..p3 (top-left, top-right, bottom-right, bottom-left), in page pixels.
 */
export function quadMatrix3d(
  w: number,
  h: number,
  p: [[number, number], [number, number], [number, number], [number, number]],
): number[] {
  const [x0, y0] = p[0];
  const [x1, y1] = p[1];
  const [x2, y2] = p[2];
  const [x3, y3] = p[3];
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = det === 0 ? 0 : (dx3 * dy2 - dx2 * dy3) / det;
  const hh = det === 0 ? 0 : (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + hh * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + hh * y3;
  return [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, x0, y0, 0, 1];
}

/** Apply a column-major matrix3d to a 2D point (z = 0). */
export function applyMatrix3d(m: number[], x: number, y: number): [number, number] {
  const X = m[0] * x + m[4] * y + m[12];
  const Y = m[1] * x + m[5] * y + m[13];
  const W = m[3] * x + m[7] * y + m[15];
  return [X / W, Y / W];
}

/** Polyline cumulative distances. */
export function cumulative(pts: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) {
    out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return out;
}
