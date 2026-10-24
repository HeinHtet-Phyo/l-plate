// Street props (TEAM-PLAN §2): trees, parked cars and streetlights, all instanced (8 draw calls at most).
//
// Goodmayes alone has 7,382 parked cars and 3,097 lamps, so only instances within PROP_RADIUS of the
// learner's car are drawn. A spatial grid finds them; the instance buffers are refilled each time the car
// has moved REBUILD_STEP metres from the last refill (no per-frame work beyond a distance check).
// Lamp lenses glow and get additive halo billboards at night; their ground pools are baked into the
// road shader's lamp map, so there are no real THREE lights here.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Session } from '../../sim/session.ts';
import type { Lamp, ParkedCar, Tree } from '../../sim/city.ts';
import type { TextureSet } from '../textures.ts';
import { shared } from '../atmosphere/uniforms.ts';
import {
  CITY_FRAG_END,
  CITY_FRAG_PARS,
  CITY_VERT_PARS,
  cityShaderMaterial,
  disposeTree,
  rotY,
  withCityLight,
  type CityPiece,
} from './common.ts';

/** Cars, lamps and trees further than this (m) from the learner's car aren't drawn. */
export const PROP_RADIUS = 350;
/** Wheels are a couple of pixels past this, so they get a shorter radius. */
export const WHEEL_RADIUS = 160;
/** Refill the instance buffers once the car is this far (m) from the last refill point. */
export const REBUILD_STEP = 40;
const GRID_CELL = 64;

type V3 = [number, number, number];
type P2 = [number, number];

/** Deterministic 0…1 hash of a position, so props look the same every session. */
const hash = (x: number, z: number, k: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};
const lerp = THREE.MathUtils.lerp;
const avg = (ps: V3[]): V3 => {
  const o: V3 = [0, 0, 0];
  for (const p of ps) for (let i = 0; i < 3; i++) o[i] += p[i] / ps.length;
  return o;
};

// ---------------------------------------------------------------- geometry builder

/** Flat-shaded triangle soup with optional vertex colours. Every face is wound to point along a hint. */
class MeshBuilder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  private readonly c = new THREE.Color(1, 1, 1);

  colour(hex: number): this {
    this.c.setHex(hex);
    return this;
  }

  tri(a: V3, b: V3, c: V3, out: V3, cols?: [THREE.Color, THREE.Color, THREE.Color]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * out[0] + (uz * vx - ux * vz) * out[1] + (ux * vy - uy * vx) * out[2] < 0;
    const vs = flip ? [a, c, b] : [a, b, c];
    const cs = cols ? (flip ? [cols[0], cols[2], cols[1]] : cols) : null;
    for (let i = 0; i < 3; i++) {
      const v = vs[i];
      const k = cs ? cs[i] : this.c;
      this.pos.push(v[0], v[1], v[2]);
      this.col.push(k.r, k.g, k.b);
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, out: V3) {
    this.tri(a, b, c, out);
    this.tri(a, c, d, out);
  }

  /** A convex hexahedron from corners p(i, j, k), i/j/k ∈ {0, 1}. */
  hexa(p: (i: number, j: number, k: number) => V3) {
    const all: V3[] = [];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) all.push(p(i, j, k));
    const ctr = avg(all);
    const cyc = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let axis = 0; axis < 3; axis++)
      for (let s = 0; s < 2; s++) {
        const q = cyc.map(([u, v]) => (axis === 0 ? p(s, u, v) : axis === 1 ? p(u, s, v) : p(u, v, s)));
        const fc = avg(q);
        this.quad(q[0], q[1], q[2], q[3], [fc[0] - ctr[0], fc[1] - ctr[1], fc[2] - ctr[2]]);
      }
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) {
    this.hexa((i, j, k) => [cx + (i - 0.5) * sx, cy + (j - 0.5) * sy, cz + (k - 0.5) * sz]);
  }

  /** Open tapered tube around a vertical axis (optionally capped on top). */
  tube(x: number, z: number, y0: number, y1: number, r0: number, r1: number, seg: number, capTop = false) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const p = (a: number, y: number, r: number): V3 => [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
      this.quad(p(a0, y0, r0), p(a1, y0, r0), p(a1, y1, r1), p(a0, y1, r1), [Math.cos(am), 0, Math.sin(am)]);
      if (capTop) this.tri(p(a0, y1, r1), p(a1, y1, r1), [x, y1, z], [0, 1, 0]);
    }
  }

  geometry(colours: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (colours) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Box along the segment a → c (in the y/z plane), w wide (x) and h thick. */
function beam(a: V3, c: V3, w: number, h: number) {
  const dy = c[1] - a[1];
  const dz = c[2] - a[2];
  const len = Math.hypot(dy, dz);
  let ny = -dz / len;
  let nz = dy / len;
  if (ny < 0) {
    ny = -ny;
    nz = -nz;
  }
  return (i: number, j: number, k: number): V3 => {
    const e = k ? c : a;
    return [e[0] + (i - 0.5) * w, e[1] + (j - 0.5) * h * ny, e[2] + (j - 0.5) * h * nz];
  };
}

// ---------------------------------------------------------------- parked car (UK hatchback, faces −z)

const CAR_HW = 0.9; // half width
const WHEEL_R = 0.31;
const WHEEL_X = 0.8;
const WHEEL_Z = [-1.3, 1.32];
const SILL = 0.27;
// Cabin frustum: base on the body top, narrower raked roof.
const CAB = { y0: 0.87, y1: 1.43, zf0: -0.98, zr0: 1.86, zf1: -0.12, zr1: 1.56, w0: 0.8, w1: 0.66 };

/** Side profile (z, y) of the lower body: bumper, bonnet, rear deck, tail, then the sill with wheel arches. */
function bodyProfile(): P2[] {
  const pts: P2[] = [
    [-2.06, SILL], [-2.12, 0.46], [-2.09, 0.68], [-1.92, 0.77], [-1.0, 0.89],
    [1.92, 0.93], [2.09, 0.84], [2.12, 0.46], [2.05, SILL],
  ];
  const ar = 0.37;
  for (const zc of [WHEEL_Z[1], WHEEL_Z[0]]) {
    pts.push([zc + ar, SILL]);
    for (const deg of [12, 45, 90, 135, 168]) {
      const a = (deg * Math.PI) / 180;
      pts.push([zc + Math.cos(a) * ar, WHEEL_R + Math.sin(a) * ar]);
    }
    pts.push([zc - ar, SILL]);
  }
  return pts;
}

const leftNormal = (a: P2, b: P2): P2 => {
  const ez = b[0] - a[0];
  const ey = b[1] - a[1];
  const l = Math.hypot(ez, ey) || 1;
  return [-ey / l, ez / l];
};
/** +1 if the 2D polygon is counter-clockwise (interior on the left of each edge). */
const orientation = (pts: P2[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [z0, y0] = pts[i];
    const [z1, y1] = pts[(i + 1) % pts.length];
    a += z0 * y1 - z1 * y0;
  }
  return a > 0 ? 1 : -1;
};
/** Shrink a polygon by d along the averaged vertex normals (for the chamfer ring). */
function inset(pts: P2[], d: number): P2[] {
  const s = orientation(pts);
  const n = pts.length;
  return pts.map((p, i) => {
    const n1 = leftNormal(pts[(i - 1 + n) % n], p);
    const n2 = leftNormal(p, pts[(i + 1) % n]);
    const nz = (n1[0] + n2[0]) * s;
    const ny = (n1[1] + n2[1]) * s;
    const l = Math.hypot(nz, ny) || 1;
    return [p[0] + (nz / l) * d, p[1] + (ny / l) * d];
  });
}

function carBody(b: MeshBuilder) {
  const full = bodyProfile();
  const cham = inset(full, 0.05);
  const s = orientation(full);
  const rings: { x: number; pts: P2[] }[] = [
    { x: -CAR_HW, pts: cham },
    { x: -CAR_HW + 0.05, pts: full },
    { x: CAR_HW - 0.05, pts: full },
    { x: CAR_HW, pts: cham },
  ];
  const n = full.length;
  const P = (x: number, p: P2): V3 => [x, p[1], p[0]];
  for (let r = 0; r < 3; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    const xs = r === 0 ? -1 : r === 2 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ln = leftNormal(full[i], full[j]);
      b.quad(P(A.x, A.pts[i]), P(A.x, A.pts[j]), P(B.x, B.pts[j]), P(B.x, B.pts[i]), [xs, -s * ln[1], -s * ln[0]]);
    }
  }
  const tris = THREE.ShapeUtils.triangulateShape(cham.map(([z, y]) => new THREE.Vector2(z, y)), []);
  for (const side of [-1, 1])
    for (const [i, j, k] of tris) b.tri(P(side * CAR_HW, cham[i]), P(side * CAR_HW, cham[j]), P(side * CAR_HW, cham[k]), [side, 0, 0]);

  // Cabin (pillars and roof in body colour; the glass sits just outside it in the trim mesh).
  const { y0, y1, zf0, zr0, zf1, zr1, w0, w1 } = CAB;
  const FBL: V3 = [-w0, y0, zf0], FBR: V3 = [w0, y0, zf0], RBL: V3 = [-w0, y0, zr0], RBR: V3 = [w0, y0, zr0];
  const FTL: V3 = [-w1, y1, zf1], FTR: V3 = [w1, y1, zf1], RTL: V3 = [-w1, y1, zr1], RTR: V3 = [w1, y1, zr1];
  b.quad(FBL, FBR, FTR, FTL, [0, 0.75, -1]);
  b.quad(RBL, RBR, RTR, RTL, [0, 0.6, 1]);
  b.quad(FBL, RBL, RTL, FTL, [-1, 0.25, 0]);
  b.quad(FBR, RBR, RTR, FTR, [1, 0.25, 0]);
  b.quad(FTL, FTR, RTR, RTL, [0, 1, 0]);
  // Door mirrors.
  for (const side of [-1, 1]) b.box(side * 0.93, 0.93, -0.8, 0.12, 0.1, 0.13);
}

const GLASS = 0x161c22;

function carTrim(b: MeshBuilder) {
  const { y0, y1, zf0, zr0, zf1, zr1, w0, w1 } = CAB;
  // Windscreen and rear window: inset panels on the cabin faces, pushed 2 cm out along the face normal.
  const panel = (p00: V3, p10: V3, p11: V3, p01: V3, u0: number, u1: number, v0: number, v1: number, hint: V3) => {
    const e1 = new THREE.Vector3(p10[0] - p00[0], p10[1] - p00[1], p10[2] - p00[2]);
    const e2 = new THREE.Vector3(p01[0] - p00[0], p01[1] - p00[1], p01[2] - p00[2]);
    const nrm = e1.cross(e2).normalize();
    if (nrm.x * hint[0] + nrm.y * hint[1] + nrm.z * hint[2] < 0) nrm.negate();
    const at = (u: number, v: number): V3 => {
      const o: V3 = [0, 0, 0];
      for (let i = 0; i < 3; i++) o[i] = lerp(lerp(p00[i], p10[i], u), lerp(p01[i], p11[i], u), v);
      return [o[0] + nrm.x * 0.02, o[1] + nrm.y * 0.02, o[2] + nrm.z * 0.02];
    };
    b.quad(at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), hint);
  };
  b.colour(GLASS);
  panel([-w0, y0, zf0], [w0, y0, zf0], [w1, y1, zf1], [-w1, y1, zf1], 0.05, 0.95, 0.06, 0.94, [0, 0.75, -1]);
  panel([-w0, y0, zr0], [w0, y0, zr0], [w1, y1, zr1], [-w1, y1, zr1], 0.1, 0.9, 0.14, 0.92, [0, 0.6, 1]);
  // Side windows with a vertical B-pillar and a thick hatchback C-pillar.
  const zb = 0.45;
  const side = (sx: number, v: number, z: number): V3 => [sx * (lerp(w0, w1, v) + 0.02), lerp(y0, y1, v), z];
  const zf = (v: number) => lerp(zf0, zf1, v);
  const zr = (v: number) => lerp(zr0, zr1, v);
  for (const sx of [-1, 1]) {
    const out: V3 = [sx, 0.25, 0];
    const v0 = 0.1, v1 = 0.9;
    b.quad(side(sx, v0, zf(v0) + 0.08), side(sx, v0, zb - 0.05), side(sx, v1, zb - 0.05), side(sx, v1, zf(v1) + 0.08), out);
    b.quad(side(sx, v0, zb + 0.05), side(sx, v0, zr(v0) - 0.3), side(sx, v1, zr(v1) - 0.3), side(sx, v1, zb + 0.05), out);
  }
  // Front: headlights, grille, white plate. Rear: tail lights, yellow plate. Each sits 2 cm proud of the body.
  const zFrontHi = (y: number) => lerp(-2.12, -2.09, (y - 0.46) / 0.22) - 0.02;
  const zFrontLo = (y: number) => lerp(-2.06, -2.12, (y - SILL) / (0.46 - SILL)) - 0.02;
  const zRear = (y: number) => lerp(2.12, 2.09, (y - 0.46) / 0.38) + 0.02;
  const face = (x0: number, x1: number, ya: number, yb: number, zAt: (y: number) => number, out: V3) =>
    b.quad([x0, ya, zAt(ya)], [x1, ya, zAt(ya)], [x1, yb, zAt(yb)], [x0, yb, zAt(yb)], out);
  b.colour(0xd9dde0);
  face(-0.8, -0.5, 0.56, 0.67, zFrontHi, [0, 0.1, -1]);
  face(0.5, 0.8, 0.56, 0.67, zFrontHi, [0, 0.1, -1]);
  b.colour(0x121416);
  face(-0.4, 0.4, 0.5, 0.62, zFrontHi, [0, 0.1, -1]);
  b.colour(0xe6e6df);
  face(-0.26, 0.26, 0.33, 0.44, zFrontLo, [0, -0.2, -1]);
  b.colour(0x8e1212);
  face(-0.82, -0.55, 0.62, 0.8, zRear, [0, 0.05, 1]);
  face(0.55, 0.82, 0.62, 0.8, zRear, [0, 0.05, 1]);
  b.colour(0xe0b818);
  face(-0.26, 0.26, 0.5, 0.61, zRear, [0, 0.05, 1]);
  // Dark underbody so the road doesn't show through under the sills.
  b.colour(0x050505);
  b.quad([-0.86, 0.035, -1.95], [0.86, 0.035, -1.95], [0.86, 0.035, 1.95], [-0.86, 0.035, 1.95], [0, 1, 0]);
}

function carWheels(b: MeshBuilder) {
  const seg = 8;
  const hw = 0.095;
  const tyre = new THREE.Color(0x1b1b1c);
  const hub = new THREE.Color(0xa3a7ab);
  for (const zc of WHEEL_Z)
    for (const sx of [-1, 1]) {
      const xo = sx * (WHEEL_X + hw);
      const xi = sx * (WHEEL_X - hw);
      const P = (a: number, x: number): V3 => [x, WHEEL_R + Math.sin(a) * WHEEL_R, zc + Math.cos(a) * WHEEL_R];
      for (let i = 0; i < seg; i++) {
        const a0 = ((i + 0.5) / seg) * Math.PI * 2;
        const a1 = ((i + 1.5) / seg) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        b.colour(0x1b1b1c).quad(P(a0, xo), P(a1, xo), P(a1, xi), P(a0, xi), [0, Math.sin(am), Math.cos(am)]);
        b.tri(P(a0, xo), P(a1, xo), [xo + sx * 0.01, WHEEL_R, zc], [sx, 0, 0], [tyre, tyre, hub]);
      }
    }
}

/**
 * Low-poly UK hatchback, 4.2 × 1.8 × 1.45 m, facing −z with its centre at the origin and wheels on y = 0.
 * body: paint (multiply by instanceColor), trim: glass, lights, plates, underbody (vertex colours), wheels (vertex colours).
 * Shared so traffic can reuse it: rotation.y = rotY(heading).
 */
export function carGeometries(): { body: THREE.BufferGeometry; trim: THREE.BufferGeometry; wheels: THREE.BufferGeometry } {
  const body = new MeshBuilder();
  carBody(body);
  const trim = new MeshBuilder();
  carTrim(trim);
  const wheels = new MeshBuilder();
  carWheels(wheels);
  return { body: body.geometry(false), trim: trim.geometry(true), wheels: wheels.geometry(true) };
}

/** Matching materials, lit by streetlights and headlights at night. Give the body mesh an instanceColor. */
export function carMaterials(): { body: THREE.Material; trim: THREE.Material; wheels: THREE.Material } {
  return {
    body: withCityLight(new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0x3a3a3a, shininess: 40 }), { key: 'car-body' }),
    trim: withCityLight(new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x8a8a8a, shininess: 90 }), { key: 'car-trim', strength: 0.4 }),
    wheels: withCityLight(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'car-wheels', strength: 0.4 }),
  };
}

// ---------------------------------------------------------------- trees

const LOBES = Array.from({ length: 4 }, (_, i) => wave(i, 1.7 + hash(i, 1, 9) * 1.1, 0.11));
const BUMPS = Array.from({ length: 5 }, (_, i) => wave(i + 10, 5 + hash(i, 2, 9) * 3, 0.035));
function wave(i: number, f: number, a: number) {
  const th = hash(i, 3, 1) * Math.PI * 2;
  const ph = Math.acos(2 * hash(i, 4, 1) - 1);
  return { d: [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)] as V3, f, a, p: hash(i, 5, 1) * 6.283 };
}
const waves = (ws: typeof LOBES, x: number, y: number, z: number) => {
  let s = 0;
  for (const w of ws) s += w.a * Math.sin(w.f * (w.d[0] * x + w.d[1] * y + w.d[2] * z) + w.p);
  return s;
};

/** Unit lumpy canopy blob centred at the origin; darker underneath, with leafy clumps. */
function canopyGeometry(): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const unit: V3[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    unit.push([x, y, z]);
    const bumps = waves(BUMPS, x, y, z);
    const r = 1 + waves(LOBES, x, y, z) + bumps;
    const py = y * r;
    pos.setXYZ(i, x * r, py < 0 ? py * 0.72 : py, z * r);
    const shade = (0.5 + 0.5 * THREE.MathUtils.smoothstep(y, -0.85, 0.9)) * (1 + bumps * 3);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Soften: half displaced normal, half radial, so the blob shades like foliage rather than rock.
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < nrm.count; i++) {
    v.set(nrm.getX(i) * 0.55 + unit[i][0] * 0.45, nrm.getY(i) * 0.55 + unit[i][1] * 0.45, nrm.getZ(i) * 0.55 + unit[i][2] * 0.45).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeBoundingSphere();
  return g;
}

/** Unit tapered trunk (base radius 1, height 1), mottled plane-tree bark. */
function trunkGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.55, 1, 1, 7, 3, true);
  g.translate(0, 0.5, 0);
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const a = new THREE.Color(0x5a5247);
  const b = new THREE.Color(0x8d8873);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    c.copy(a).lerp(b, hash(i, 7, 2) ** 2);
    c.toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const GREENS = [0x56733a, 0x4b6a33, 0x627d3e, 0x55703f, 0x6c8445, 0x4f6638];
const AUTUMN = [0x8f8a3e, 0x9c7b36, 0xa36a2f, 0x7f8a3a];

// ---------------------------------------------------------------- streetlights (model faces −z: the arm reaches along −z)

const LANTERN_Z = -1.15;
const LANTERN_Y = 7.88;
const GLOW_Y = 7.76;
const GLOW_SIZE = 1.5;

function lampGeometry(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  b.colour(0x2b3530);
  b.tube(0, 0, 0, 1.3, 0.13, 0.115, 8, true); // root / door section
  b.tube(0, 0, 1.3, 7.75, 0.085, 0.06, 8, true); // slim tapered shaft
  b.hexa(beam([0, 7.6, 0.03], [0, 7.86, -1.0], 0.06, 0.07)); // up-swept bracket
  b.colour(0x3e4548);
  b.box(0, LANTERN_Y, LANTERN_Z, 0.27, 0.09, 0.62); // flat LED lantern
  return b.geometry(true);
}

function lensGeometry(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const y = LANTERN_Y - 0.045 - 0.008;
  const z0 = LANTERN_Z + 0.28, z1 = LANTERN_Z - 0.28;
  b.quad([-0.115, y, z0], [0.115, y, z0], [0.115, y, z1], [-0.115, y, z1], [0, -1, 0]);
  return b.geometry(false);
}

function lensMaterial(): THREE.ShaderMaterial {
  return cityShaderMaterial({
    vertexShader: /* glsl */ `
      ${CITY_VERT_PARS}
      void main() {
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${CITY_FRAG_PARS}
      void main() {
        vec3 day = vec3(0.58, 0.6, 0.62) * cityAmbient();
        gl_FragColor = vec4(mix(day, CITY_LAMP * 3.2, cityNight()), 1.0);
        ${CITY_FRAG_END}
      }`,
  });
}

/** Camera-facing additive halo quads at the lamp heads; bigger and softer in rain. */
function glowMaterial(): THREE.ShaderMaterial {
  return cityShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      ${CITY_VERT_PARS}
      uniform float uRain;
      varying vec2 vUv;
      void main() {
        vec4 centre = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vWorld = centre.xyz;
        vec4 mvPosition = viewMatrix * centre;
        float size = length(instanceMatrix[0].xyz) * (1.0 + 0.7 * uRain);
        mvPosition.xy += position.xy * size;
        mvPosition.z += 0.6; // pull towards the camera so the lantern doesn't clip it
        vUv = uv;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${CITY_FRAG_PARS}
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        if (d > 1.0) discard;
        float halo = pow(1.0 - d, 2.6) * (0.38 + 0.3 * uRain);
        float core = pow(max(0.0, 1.0 - d * 3.5), 2.0) * 1.1;
        float a = (halo + core) * cityNight();
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            a *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
          #endif
        #endif
        gl_FragColor = vec4(CITY_LAMP * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- distance culling

/** Items bucketed into GRID_CELL squares (CSR layout: items of cell c are items[start[c] … start[c+1])). */
class SpatialGrid {
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly start: Int32Array;
  readonly items: Int32Array;

  constructor(readonly xs: Float32Array, readonly zs: Float32Array) {
    const n = xs.length;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, xs[i]);
      maxX = Math.max(maxX, xs[i]);
      minZ = Math.min(minZ, zs[i]);
      maxZ = Math.max(maxZ, zs[i]);
    }
    if (!n) minX = minZ = maxX = maxZ = 0;
    this.x0 = minX;
    this.z0 = minZ;
    this.nx = Math.floor((maxX - minX) / GRID_CELL) + 1;
    this.nz = Math.floor((maxZ - minZ) / GRID_CELL) + 1;
    const cellOf = new Int32Array(n);
    const start = new Int32Array(this.nx * this.nz + 1);
    for (let i = 0; i < n; i++) {
      const c = Math.floor((xs[i] - minX) / GRID_CELL) + Math.floor((zs[i] - minZ) / GRID_CELL) * this.nx;
      cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < this.nx * this.nz; c++) start[c + 1] += start[c];
    const fill = start.slice(0, -1);
    const items = new Int32Array(n);
    for (let i = 0; i < n; i++) items[fill[cellOf[i]]++] = i;
    this.start = start;
    this.items = items;
  }
}

interface Layer {
  /** Per-item source data (all items), `size` floats each. */
  src: Float32Array;
  /** GPU attribute that receives the selected items, packed from 0. */
  attr: THREE.InstancedBufferAttribute;
  size: number;
}

function layer(src: Float32Array, size: number): Layer {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(size, src.length)), size);
  attr.setUsage(THREE.DynamicDrawUsage);
  return { src, attr, size };
}

/** Keeps a set of instanced meshes filled with the items within `radius` of a moving centre. */
class CullSet {
  private lastX = NaN;
  private lastZ = NaN;
  count = 0;

  constructor(
    private readonly grid: SpatialGrid,
    private readonly radius: number,
    private readonly layers: Layer[],
    private readonly meshes: THREE.InstancedMesh[],
  ) {}

  update(x: number, z: number) {
    const dx = x - this.lastX;
    const dz = z - this.lastZ;
    if (dx * dx + dz * dz < REBUILD_STEP * REBUILD_STEP) return; // false while lastX is NaN
    this.lastX = x;
    this.lastZ = z;
    const g = this.grid;
    const r = this.radius;
    const r2 = r * r;
    const cx0 = Math.max(0, Math.floor((x - r - g.x0) / GRID_CELL));
    const cx1 = Math.min(g.nx - 1, Math.floor((x + r - g.x0) / GRID_CELL));
    const cz0 = Math.max(0, Math.floor((z - r - g.z0) / GRID_CELL));
    const cz1 = Math.min(g.nz - 1, Math.floor((z + r - g.z0) / GRID_CELL));
    let n = 0;
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cx + cz * g.nx;
        for (let k = g.start[c]; k < g.start[c + 1]; k++) {
          const i = g.items[k];
          const ix = g.xs[i] - x;
          const iz = g.zs[i] - z;
          if (ix * ix + iz * iz > r2) continue;
          for (const L of this.layers) {
            const dst = L.attr.array as Float32Array;
            const o = n * L.size;
            const s = i * L.size;
            for (let e = 0; e < L.size; e++) dst[o + e] = L.src[s + e];
          }
          n++;
        }
      }
    this.count = n;
    if (n > 0)
      for (const L of this.layers) {
        L.attr.clearUpdateRanges();
        L.attr.addUpdateRange(0, n * L.size);
        L.attr.needsUpdate = true;
      }
    for (const m of this.meshes) {
      m.count = n;
      m.visible = n > 0;
    }
  }
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, matrix: Layer, colour?: Layer): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, 1);
  m.instanceMatrix = matrix.attr;
  if (colour) m.instanceColor = colour.attr;
  m.count = 0;
  m.visible = false;
  m.frustumCulled = false; // instances surround the car; the per-mesh bounding sphere would be stale anyway
  return m;
}

const positions = (items: { x: number; z: number }[]) => {
  const xs = new Float32Array(items.length);
  const zs = new Float32Array(items.length);
  items.forEach((p, i) => {
    xs[i] = p.x;
    zs[i] = p.z;
  });
  return new SpatialGrid(xs, zs);
};

// ---------------------------------------------------------------- build

export function buildProps(s: Session, _tex: TextureSet): CityPiece {
  const object = new THREE.Group();
  const sets: CullSet[] = [];
  const meshes: THREE.InstancedMesh[] = [];
  const add = (m: THREE.InstancedMesh, name: string) => {
    m.name = name;
    meshes.push(m);
    object.add(m);
    return m;
  };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);

  // Trees ------------------------------------------------------------
  const trees: Tree[] = s.trees ?? [];
  if (trees.length) {
    const trunkM = new Float32Array(trees.length * 16);
    const canopyM = new Float32Array(trees.length * 16);
    const canopyC = new Float32Array(trees.length * 3);
    trees.forEach((t, i) => {
      const r1 = hash(t.x, t.z, 1), r2 = hash(t.x, t.z, 2), r3 = hash(t.x, t.z, 3);
      let h = t.h;
      let cw: number; // canopy width
      let ch: number; // canopy height
      let trunkR: number;
      if (t.shape === 0) {
        cw = 0.66 * h; // London plane: broad, irregular
        ch = 0.6 * h;
        trunkR = 0.09 + 0.014 * h;
      } else if (t.shape === 1) {
        cw = 0.42 * h; // lime: tall oval
        ch = 0.64 * h;
        trunkR = 0.07 + 0.011 * h;
      } else {
        h *= 0.78; // smaller, rounder
        cw = 0.56 * h;
        ch = 0.54 * h;
        trunkR = 0.06 + 0.012 * h;
      }
      cw *= 0.9 + 0.2 * r1;
      ch *= 0.9 + 0.2 * r2;
      const trunkH = h - ch * 0.5;
      q.setFromAxisAngle(UP, r3 * Math.PI * 2);
      m4.compose(pos.set(t.x, 0, t.z), q, scl.set(trunkR, trunkH, trunkR)).toArray(trunkM, i * 16);
      // The blob is ~1.15 in radius after displacement, so scale by a bit less than half the size.
      q.setFromAxisAngle(UP, r1 * 17.0);
      m4.compose(pos.set(t.x, h - ch * 0.47, t.z), q, scl.set(cw * 0.45, ch * 0.45, cw * (0.4 + 0.1 * r3))).toArray(canopyM, i * 16);
      const pal = r2 < 0.22 ? AUTUMN : GREENS;
      col.setHex(pal[Math.floor(hash(t.x, t.z, 4) * pal.length)]).multiplyScalar(0.9 + 0.2 * r3);
      col.toArray(canopyC, i * 3);
    });
    const trunkL = layer(trunkM, 16);
    const canopyL = layer(canopyM, 16);
    const colourL = layer(canopyC, 3);
    const trunkMat = withCityLight(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'tree-trunk', strength: 0.5 });
    const canopyMat = withCityLight(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'tree-canopy', strength: 0.5 });
    // Gentle wind sway (stronger in rain), phase from the tree's position.
    const lit = canopyMat.onBeforeCompile;
    canopyMat.onBeforeCompile = (sh, r) => {
      lit.call(canopyMat, sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uRain;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  #ifdef USE_INSTANCING
  {
    vec2 ph = instanceMatrix[3].xz * 0.21;
    float amp = (0.022 + 0.05 * uRain) * max(0.0, position.y + 0.7);
    transformed.x += sin(uTime * 1.3 + ph.x + position.y * 1.7) * amp;
    transformed.z += sin(uTime * 1.05 + ph.y + position.x * 1.4) * amp * 0.7;
  }
  #endif`,
      );
    };
    const grid = positions(trees);
    const trunk = add(instanced(trunkGeometry(), trunkMat, trunkL), 'tree-trunks');
    const canopy = add(instanced(canopyGeometry(), canopyMat, canopyL, colourL), 'tree-canopies');
    sets.push(new CullSet(grid, PROP_RADIUS, [trunkL, canopyL, colourL], [trunk, canopy]));
  }

  // Parked cars ------------------------------------------------------
  const parked: ParkedCar[] = s.parked ?? [];
  if (parked.length) {
    const carM = new Float32Array(parked.length * 16);
    const carC = new Float32Array(parked.length * 3);
    parked.forEach((p, i) => {
      const yaw = rotY(p.heading) + (hash(p.x, p.z, 5) - 0.5) * 0.04; // not quite square to the kerb
      q.setFromAxisAngle(UP, yaw);
      // Small size variation so a row of identical hatchbacks reads as different cars.
      scl.set(0.97 + 0.06 * hash(p.x, p.z, 6), 0.94 + 0.14 * hash(p.x, p.z, 7), 0.95 + 0.1 * hash(p.x, p.z, 8));
      m4.compose(pos.set(p.x, 0, p.z), q, scl).toArray(carM, i * 16);
      col.setHex(p.colour).toArray(carC, i * 3);
    });
    const geo = carGeometries();
    const mats = carMaterials();
    const grid = positions(parked);
    const matL = layer(carM, 16);
    const colL = layer(carC, 3);
    const wheelL = layer(carM, 16);
    const body = add(instanced(geo.body, mats.body, matL, colL), 'parked-bodies');
    const trim = add(instanced(geo.trim, mats.trim, matL), 'parked-trim');
    const wheels = add(instanced(geo.wheels, mats.wheels, wheelL), 'parked-wheels');
    sets.push(new CullSet(grid, PROP_RADIUS, [matL, colL], [body, trim]));
    sets.push(new CullSet(grid, WHEEL_RADIUS, [wheelL], [wheels]));
  }

  // Streetlights -----------------------------------------------------
  const lamps: Lamp[] = s.lamps ?? [];
  let glow: THREE.InstancedMesh | null = null;
  if (lamps.length) {
    const lampM = new Float32Array(lamps.length * 16);
    const glowM = new Float32Array(lamps.length * 16);
    lamps.forEach((l, i) => {
      q.setFromAxisAngle(UP, rotY(l.heading));
      m4.compose(pos.set(l.x, 0, l.z), q, scl.set(1, 1, 1)).toArray(lampM, i * 16);
      const hr = (l.heading * Math.PI) / 180;
      const d = -LANTERN_Z;
      m4.makeScale(GLOW_SIZE, GLOW_SIZE, GLOW_SIZE).setPosition(l.x + Math.sin(hr) * d, GLOW_Y, l.z - Math.cos(hr) * d).toArray(glowM, i * 16);
    });
    const lampL = layer(lampM, 16);
    const glowL = layer(glowM, 16);
    const column = add(instanced(lampGeometry(), withCityLight(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'lamp-column', strength: 0.4 }), lampL), 'lamp-columns');
    const lens = add(instanced(lensGeometry(), lensMaterial(), lampL), 'lamp-lenses');
    glow = add(instanced(new THREE.PlaneGeometry(2, 2), glowMaterial(), glowL), 'lamp-glow');
    glow.renderOrder = 2;
    sets.push(new CullSet(positions(lamps), PROP_RADIUS, [lampL, glowL], [column, lens, glow]));
  }

  const update = (s: Session) => {
    const car = s.world?.car;
    if (car) for (const c of sets) c.update(car.x, car.z);
    if (glow) glow.visible = glow.count > 0 && shared.uDay.value < 0.6;
  };
  update(s);

  return {
    object,
    update,
    dispose() {
      for (const m of meshes) m.dispose();
      disposeTree(object);
    },
  };
}
