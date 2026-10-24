// Buildings: extruded walls with facade bands, flat/slate/gable roofs, lit windows at night.
//
// Every building is merged into one geometry per material: a ground band (one storey with a door or shop,
// tex.ground) and an upper band (tex.upper, whole storeys) per style, plus one slate and one flat roof mesh.
// UVs are snapped so each wall holds whole 3 m bays and whole storeys, so corners never cut a window in half.
// Shared party walls (terraces) are dropped. At night, the dark-glass texels of a seeded share of windows glow.
import * as THREE from 'three';
import type { Session } from '../../sim/session.ts';
import type { PlacedBuilding, Style } from '../../sim/city.ts';
import type { XZ } from '../../sim/osm.ts';
import { ALL_STYLES, type TextureSet } from '../textures.ts';
import { disposeTree, withCityLight, type CityPiece } from './common.ts';

const GROUND_H = 3.9; // tex.ground covers 9 m × 3.9 m
const TILE = 9; // tex.upper covers 9 m × 9 m (3 bays × 3 storeys)
const BAY = 3;
const STOREY = 3;
const PITCH = Math.tan((35 * Math.PI) / 180);
const MAX_RISE = 3.6;
const PARAPET = 0.5;
const SLATE_M = 5; // slate texture repeat (m)
const FLAT_M = 8; // flat roof texture repeat (m)
const EAVE = 0.3; // roof overhang (m)

/** Growable vertex buffer: position, normal, uv, colour (tint), aSeed; indexed triangles. */
class Buf {
  n = 0;
  ni = 0;
  pos = new Float32Array(3 * 4096);
  nrm = new Float32Array(3 * 4096);
  uv = new Float32Array(2 * 4096);
  col = new Float32Array(3 * 4096);
  seed = new Float32Array(4096);
  idx = new Uint32Array(8192);

  private growV() {
    const cap = this.seed.length * 2;
    const g = <T extends Float32Array>(a: T, k: number) => {
      const b = new Float32Array(cap * k);
      b.set(a);
      return b;
    };
    this.pos = g(this.pos, 3);
    this.nrm = g(this.nrm, 3);
    this.uv = g(this.uv, 2);
    this.col = g(this.col, 3);
    this.seed = g(this.seed, 1);
  }

  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, c: number, s: number): number {
    if (this.n >= this.seed.length) this.growV();
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.nrm[i * 3] = nx;
    this.nrm[i * 3 + 1] = ny;
    this.nrm[i * 3 + 2] = nz;
    this.uv[i * 2] = u;
    this.uv[i * 2 + 1] = w;
    this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = c;
    this.seed[i] = s;
    return i;
  }

  tri(a: number, b: number, c: number) {
    if (this.ni + 3 > this.idx.length) {
      const b2 = new Uint32Array(this.idx.length * 2);
      b2.set(this.idx);
      this.idx = b2;
    }
    this.idx[this.ni++] = a;
    this.idx[this.ni++] = b;
    this.idx[this.ni++] = c;
  }

  quad(a: number, b: number, c: number, d: number) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.ni) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, this.n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.n * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed.slice(0, this.n), 1));
    g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.ni), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Integer hash → [0, 1). */
function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

function signedArea(p: XZ[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i];
    const r = p[(i + 1) % p.length];
    a += q[0] * r[1] - r[0] * q[1];
  }
  return a / 2;
}

/** Clean a footprint: drop the closing duplicate and repeated points, orient so walls face outwards (negative xz area). */
function prepFootprint(pts: XZ[]): XZ[] | null {
  const p: XZ[] = [];
  for (const q of pts) {
    const last = p[p.length - 1];
    if (!last || Math.abs(last[0] - q[0]) > 0.02 || Math.abs(last[1] - q[1]) > 0.02) p.push(q);
  }
  while (p.length > 1 && Math.abs(p[0][0] - p[p.length - 1][0]) <= 0.02 && Math.abs(p[0][1] - p[p.length - 1][1]) <= 0.02) p.pop();
  if (p.length < 3) return null;
  const a = signedArea(p);
  if (!Number.isFinite(a) || Math.abs(a) < 2) return null;
  if (a > 0) p.reverse();
  return p;
}

/** Indices of the corners left after removing near-collinear points and very short edges. */
function simplify(p: XZ[]): number[] {
  let idx = p.map((_, i) => i);
  for (let pass = 0; pass < 4 && idx.length > 3; pass++) {
    let changed = false;
    for (let k = 0; k < idx.length && idx.length > 3; k++) {
      const a = p[idx[(k + idx.length - 1) % idx.length]];
      const b = p[idx[k]];
      const c = p[idx[(k + 1) % idx.length]];
      const ux = b[0] - a[0];
      const uz = b[1] - a[1];
      const vx = c[0] - b[0];
      const vz = c[1] - b[1];
      const lu = Math.hypot(ux, uz);
      const lv = Math.hypot(vx, vz);
      const cos = lu > 1e-6 && lv > 1e-6 ? (ux * vx + uz * vz) / (lu * lv) : 1;
      if (cos > 0.966 || lv < 0.4) {
        idx = idx.filter((_, j) => j !== k);
        changed = true;
        k--;
      }
    }
    if (!changed) break;
  }
  return idx;
}

const qk = (v: number) => Math.round(v * 10);
const edgeKey = (a: XZ, b: XZ) => `${qk(a[0])},${qk(a[1])},${qk(b[0])},${qk(b[1])}`;

interface Prepped {
  b: PlacedBuilding;
  pts: XZ[];
  pitched: boolean;
  /** Per raw edge: index of the building across a shared wall, or −1. */
  nb: Int32Array;
}

type Band = 'upper' | 'ground' | 'shop';

/** Night-window shader bits. `cell` picks one window; `chance` is the share lit. */
function windowShader(band: Band) {
  const chance = band === 'shop' ? '0.85' : '0.45';
  const cell = band === 'upper' ? 'floor(vMapUv * 3.0)' : 'vec2(floor(vMapUv.x * 3.0), 7.0)';
  const pars = /* glsl */ `
varying float vSeed;
float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;
  const frag = /* glsl */ `
#ifdef USE_MAP
  {
    vec3 tx = sampledDiffuseColor.rgb;
    float lum = dot(tx, vec3(0.2126, 0.7152, 0.0722));
    float glass = (1.0 - smoothstep(0.045, 0.075, lum)) * smoothstep(0.0, 0.006, tx.b - tx.r * 1.12);
    vec2 cell = ${cell};
    vec2 key = cell + vec2(vSeed * 613.0, vSeed * 157.0);
    float lit = step(bHash(key), ${chance});
    float h2 = bHash(key.yx + 3.7);
    vec3 warm = mix(vec3(1.0, 0.6, 0.28), vec3(1.0, 0.78, 0.5), h2);
    if (h2 > 0.9) warm = vec3(0.55, 0.65, 0.95); // the odd TV-blue or LED room
    float n = cityNight();
    totalEmissiveRadiance += glass * lit * warm * (0.55 + 0.55 * h2) * n;
    // Daytime: a faint sky reflection so glass reads as glass.
    totalEmissiveRadiance += glass * uSkyColour * 0.12 * (1.0 - n);
  }
#endif
`;
  return { pars, frag };
}

function wallMaterial(map: THREE.Texture, band: Band): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ map, vertexColors: true });
  const { pars, frag } = windowShader(band);
  withCityLight(mat, { strength: 0.6, extraPars: pars, extraFragment: frag, key: `bld-${band}` });
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    base.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeed;\nvarying float vSeed;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSeed = aSeed;');
  };
  return mat;
}

function roofMaterial(map: THREE.Texture, key: string): THREE.MeshLambertMaterial {
  return withCityLight(new THREE.MeshLambertMaterial({ map, vertexColors: true }), { strength: 0.5, key });
}

export function buildBuildings(s: Session, tex: TextureSet): CityPiece {
  const object = new THREE.Group();
  const upper = new Map<Style, Buf>();
  const ground = new Map<Style | 'shopfront', Buf>();
  for (const st of ALL_STYLES) {
    upper.set(st, new Buf());
    ground.set(st, new Buf());
  }
  ground.set('shopfront', new Buf());
  const slate = new Buf();
  const flat = new Buf();

  // Pass 1: clean footprints and index every directed edge, so party walls can be found.
  const preps: Prepped[] = [];
  const edges = new Map<string, number>();
  for (const b of s.buildings) {
    if (!(b.h > 0.5) || !upper.has(b.style)) continue;
    const pts = prepFootprint(b.pts);
    if (!pts) continue;
    const bi = preps.length;
    preps.push({ b, pts, pitched: b.roof !== 'flat', nb: new Int32Array(pts.length).fill(-1) });
    for (let i = 0; i < pts.length; i++) edges.set(edgeKey(pts[i], pts[(i + 1) % pts.length]), bi);
  }
  for (let bi = 0; bi < preps.length; bi++) {
    const { pts, nb } = preps[bi];
    for (let i = 0; i < pts.length; i++) {
      const j = edges.get(edgeKey(pts[(i + 1) % pts.length], pts[i]));
      if (j !== undefined && j !== bi) nb[i] = j;
    }
  }

  let roofsPitched = 0;
  // Pass 2: walls and roofs.
  for (let bi = 0; bi < preps.length; bi++) {
    const P = preps[bi];
    const { b, pts, nb } = P;
    const h = b.h;
    const c = b.tint;
    const gBuf = ground.get(b.shopfront ? 'shopfront' : b.style)!;
    const uBuf = upper.get(b.style)!;
    const tallEnough = h >= GROUND_H + 1.5;
    const gTop = tallEnough ? GROUND_H : h;
    const gV = tallEnough ? 1 / GROUND_H : 1 / h;
    const upperStoreys = Math.max(1, Math.round((h - GROUND_H) / STOREY));
    const uV = tallEnough ? upperStoreys / 3 / (h - GROUND_H) : 0;
    const vTop = tallEnough ? upperStoreys / 3 : 0; // upper-texture v at the eaves (gables continue from here)
    const n = pts.length;

    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const e = pts[(i + 1) % n];
      const dx = e[0] - a[0];
      const dz = e[1] - a[1];
      const L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      const j = nb[i];
      if (j >= 0 && preps[j].b.h >= h - 0.05) continue; // hidden party wall
      const nx = -dz / L;
      const nz = dx / L;
      let u0: number;
      let u1: number;
      if (L < 2) {
        // Too short for a bay: show the brick pier between windows, unstretched.
        u0 = -L / 2 / TILE;
        u1 = L / 2 / TILE;
      } else {
        u0 = 0;
        u1 = Math.max(1, Math.round(L / BAY)) / 3;
      }
      const seed = hash(bi * 131 + i, 977);
      // Ground band.
      {
        const y0 = -0.2;
        const k0 = gBuf.v(a[0], y0, a[1], nx, 0, nz, u0, y0 * gV, c, seed);
        const k1 = gBuf.v(e[0], y0, e[1], nx, 0, nz, u1, y0 * gV, c, seed);
        const k2 = gBuf.v(e[0], gTop, e[1], nx, 0, nz, u1, gTop * gV, c, seed);
        const k3 = gBuf.v(a[0], gTop, a[1], nx, 0, nz, u0, gTop * gV, c, seed);
        gBuf.quad(k0, k1, k2, k3);
      }
      // Upper band: whole storeys.
      if (tallEnough) {
        const k0 = uBuf.v(a[0], GROUND_H, a[1], nx, 0, nz, u0, 0, c, seed);
        const k1 = uBuf.v(e[0], GROUND_H, e[1], nx, 0, nz, u1, 0, c, seed);
        const k2 = uBuf.v(e[0], h, e[1], nx, 0, nz, u1, (h - GROUND_H) * uV, c, seed);
        const k3 = uBuf.v(a[0], h, a[1], nx, 0, nz, u0, (h - GROUND_H) * uV, c, seed);
        uBuf.quad(k0, k1, k2, k3);
      }
    }

    // Roofs.
    let done = false;
    if (P.pitched) {
      const corners = simplify(pts);
      if (corners.length === 4 && isRoughlyRect(pts, corners)) {
        done = pitchedRoof(bi, P, preps, corners, slate, uBuf, vTop);
        if (done) roofsPitched++;
      }
    }
    if (!done) flatRoof(P, b.roof === 'flat' ? flat : slate, b.roof === 'flat');
  }

  // Meshes: one per material.
  const add = (buf: Buf, mat: THREE.Material, name: string) => {
    const g = buf.geometry();
    if (!g) {
      mat.dispose();
      return;
    }
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.matrixAutoUpdate = false;
    object.add(m);
  };
  for (const st of ALL_STYLES) {
    add(ground.get(st)!, wallMaterial(tex.ground[st], 'ground'), `bld-ground-${st}`);
    add(upper.get(st)!, wallMaterial(tex.upper[st], 'upper'), `bld-upper-${st}`);
  }
  add(ground.get('shopfront')!, wallMaterial(tex.ground.shopfront, 'shop'), 'bld-shopfront');
  add(slate, roofMaterial(tex.slate, 'bld-slate'), 'bld-roof-slate');
  add(flat, roofMaterial(tex.flat, 'bld-flat'), 'bld-roof-flat');
  object.userData.stats = { buildings: preps.length, pitched: roofsPitched };

  return { object, dispose: () => disposeTree(object) };

  // ---- helpers that need the buffers ----

  function flatRoof(P: Prepped, buf: Buf, parapet: boolean) {
    const { b, pts } = P;
    const h = b.h;
    const yr = parapet && h > 5 ? h - PARAPET : h;
    const c = b.tint * 0.95;
    let faces: number[][];
    try {
      faces = THREE.ShapeUtils.triangulateShape(
        pts.map((p) => new THREE.Vector2(p[0], p[1])),
        [],
      );
    } catch {
      return;
    }
    const base = buf.n;
    for (const p of pts) buf.v(p[0], yr, p[1], 0, 1, 0, p[0] / FLAT_M, p[1] / FLAT_M, c, 0);
    for (const f of faces) {
      const [i, j, k] = f;
      const A = pts[i];
      const B = pts[j];
      const C = pts[k];
      if (!A || !B || !C) continue;
      // Upward normal needs a negative xz signed area.
      const ar = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (ar < 0) buf.tri(base + i, base + j, base + k);
      else buf.tri(base + i, base + k, base + j);
    }
    // Parapet: inner faces of the wall above the roof.
    if (yr < h) {
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const e = pts[(i + 1) % n];
        const dx = e[0] - a[0];
        const dz = e[1] - a[1];
        const L = Math.hypot(dx, dz);
        if (L < 0.05) continue;
        const j = P.nb[i];
        if (j >= 0 && !preps[j].pitched && Math.abs(preps[j].b.h - h) < 0.3) continue; // continuous parapet across a party wall
        const nx = dz / L;
        const nz = -dx / L;
        const k0 = buf.v(e[0], yr, e[1], nx, 0, nz, 0, 0, c * 0.9, 0);
        const k1 = buf.v(a[0], yr, a[1], nx, 0, nz, L / FLAT_M, 0, c * 0.9, 0);
        const k2 = buf.v(a[0], h, a[1], nx, 0, nz, L / FLAT_M, PARAPET / FLAT_M, c * 0.9, 0);
        const k3 = buf.v(e[0], h, e[1], nx, 0, nz, 0, PARAPET / FLAT_M, c * 0.9, 0);
        buf.quad(k0, k1, k2, k3);
      }
    }
  }
}

function isRoughlyRect(pts: XZ[], idx: number[]): boolean {
  for (let k = 0; k < 4; k++) {
    const a = pts[idx[(k + 3) % 4]];
    const b = pts[idx[k]];
    const c = pts[idx[(k + 1) % 4]];
    const ux = a[0] - b[0];
    const uz = a[1] - b[1];
    const vx = c[0] - b[0];
    const vz = c[1] - b[1];
    const cos = (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz));
    if (Math.abs(cos) > 0.42) return false; // within ~25° of square
  }
  return true;
}

/** Shared length fraction of the raw edges between corners idx[k] and idx[k+1], and the main neighbour. */
function edgeShare(P: Prepped, idx: number[], k: number): { frac: number; nb: number } {
  const n = P.pts.length;
  const from = idx[k];
  const to = idx[(k + 1) % idx.length];
  let tot = 0;
  let sh = 0;
  let nb = -1;
  for (let i = from; i !== to; i = (i + 1) % n) {
    const a = P.pts[i];
    const e = P.pts[(i + 1) % n];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
    tot += L;
    if (P.nb[i] >= 0) {
      sh += L;
      nb = P.nb[i];
    }
  }
  return { frac: tot > 0 ? sh / tot : 0, nb };
}

/** Roof triangle into the slate buffer with a uv frame in the roof plane (v runs up the slope). */
function slateTri(buf: Buf, A: number[], B: number[], C: number[], c: number) {
  const e1x = B[0] - A[0], e1y = B[1] - A[1], e1z = B[2] - A[2];
  const e2x = C[0] - A[0], e2y = C[1] - A[1], e2z = C[2] - A[2];
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-4) return;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  // Tangent: horizontal, along the eave (up × n); bitangent up the slope.
  let tx = nz;
  let tz = -nx;
  const tl = Math.hypot(tx, tz);
  if (tl < 1e-4) {
    tx = 1;
    tz = 0;
  } else {
    tx /= tl;
    tz /= tl;
  }
  // b = n × t (t has no y)
  const bx = ny * tz;
  const by = nz * tx - nx * tz;
  const bz = -ny * tx;
  const uvOf = (p: number[]) => [(p[0] * tx + p[2] * tz) / SLATE_M, (p[0] * bx + p[1] * by + p[2] * bz) / SLATE_M];
  const [ua, va] = uvOf(A);
  const [ub, vb] = uvOf(B);
  const [uc, vc] = uvOf(C);
  const i0 = buf.v(A[0], A[1], A[2], nx, ny, nz, ua, va, c, 0);
  const i1 = buf.v(B[0], B[1], B[2], nx, ny, nz, ub, vb, c, 0);
  const i2 = buf.v(C[0], C[1], C[2], nx, ny, nz, uc, vc, c, 0);
  buf.tri(i0, i1, i2);
}

/**
 * Gabled or hipped roof on a 4-corner footprint. Eaves run along one pair of opposite edges; the
 * other pair are the ends (gable walls in the facade texture, or hips). Shared party-wall ends are
 * always gables, and hidden when the neighbour has a pitched roof of the same height.
 */
function pitchedRoof(bi: number, P: Prepped, preps: Prepped[], idx: number[], slate: Buf, wall: Buf, vTop: number): boolean {
  const { b, pts } = P;
  const C4 = idx.map((i) => pts[i]);
  const len = (k: number) => Math.hypot(C4[(k + 1) % 4][0] - C4[k][0], C4[(k + 1) % 4][1] - C4[k][1]);
  const share = [0, 1, 2, 3].map((k) => edgeShare(P, idx, k));
  const pairA = (len(0) + len(2)) / 2; // edges 0, 2
  const pairB = (len(1) + len(3)) / 2; // edges 1, 3
  // Which pair carries the eaves (k = 0 → edges 0 and 2)?
  let k: number;
  if (b.ridge) {
    const [rx, rz] = b.ridge;
    const d0 = Math.abs(((C4[1][0] - C4[0][0]) * rx + (C4[1][1] - C4[0][1]) * rz) / Math.max(1e-6, len(0)));
    const d1 = Math.abs(((C4[2][0] - C4[1][0]) * rx + (C4[2][1] - C4[1][1]) * rz) / Math.max(1e-6, len(1)));
    k = d0 >= d1 ? 0 : 1;
  } else {
    const shA = Math.max(share[0].frac, share[2].frac) > 0.5;
    const shB = Math.max(share[1].frac, share[3].frac) > 0.5;
    if (shB && !shA) k = 0; // party walls on edges 1/3 → they are the gable ends
    else if (shA && !shB) k = 1;
    else k = pairA >= pairB ? 0 : 1;
  }
  // Rotate so eaves are c0→c1 and c2→c3; ends are c1→c2 (B) and c3→c0 (A).
  const c = [0, 1, 2, 3].map((i) => C4[(i + k) % 4]);
  const shEndB = share[(1 + k) % 4];
  const shEndA = share[(3 + k) % 4];
  const h = b.h;
  const mA = [(c[3][0] + c[0][0]) / 2, (c[3][1] + c[0][1]) / 2];
  const mB = [(c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2];
  const dA = Math.hypot(c[0][0] - c[3][0], c[0][1] - c[3][1]) / 2;
  const dB = Math.hypot(c[2][0] - c[1][0], c[2][1] - c[1][1]) / 2;
  const hd = (dA + dB) / 2;
  const RL = Math.hypot(mB[0] - mA[0], mB[1] - mA[1]);
  if (hd < 0.8 || RL < 1) return false;
  const rise = Math.min(MAX_RISE, hd * PITCH);
  const ax = (mB[0] - mA[0]) / RL;
  const az = (mB[1] - mA[1]) / RL;
  const isParty = (s: { frac: number; nb: number }) => s.frac > 0.5;
  const hipChance = b.infill ? 0 : 0.45;
  const hipA = !isParty(shEndA) && hash(bi, 11) < hipChance;
  const hipB = !isParty(shEndB) && hash(bi, 12) < hipChance;
  let inA = hipA ? hd : 0;
  let inB = hipB ? hd : 0;
  if (inA + inB > RL - 0.2) {
    const f = Math.max(0, RL - 0.2) / Math.max(1e-6, inA + inB);
    inA *= f;
    inB *= f;
  }
  const yR = h + rise;
  const rA = [mA[0] + ax * inA, yR, mA[1] + az * inA];
  const rB = [mB[0] - ax * inB, yR, mB[1] - az * inB];
  // Eave corners pushed out a little (overhang) and dropped to keep the pitch.
  const drop = EAVE * PITCH;
  const out = (p: XZ): number[] => {
    // Push away from the ridge line (perpendicular) and, at hip ends, along the ridge too.
    const cx = (mA[0] + mB[0]) / 2;
    const cz = (mA[1] + mB[1]) / 2;
    const px = p[0] - cx;
    const pz = p[1] - cz;
    const along = px * ax + pz * az;
    const perpx = px - along * ax;
    const perpz = pz - along * az;
    const pl = Math.hypot(perpx, perpz) || 1;
    let x = p[0] + (perpx / pl) * EAVE;
    let z = p[1] + (perpz / pl) * EAVE;
    const sgn = Math.sign(along);
    const hipEnd = sgn < 0 ? hipA : hipB;
    if (hipEnd) {
      x += ax * sgn * EAVE;
      z += az * sgn * EAVE;
    }
    return [x, h - drop, z];
  };
  const e0 = out(c[0]);
  const e1 = out(c[1]);
  const e2 = out(c[2]);
  const e3 = out(c[3]);
  const tint = b.tint;
  // Slopes.
  slateTri(slate, e0, e1, rB, tint);
  slateTri(slate, e0, rB, rA, tint);
  slateTri(slate, e2, e3, rA, tint);
  slateTri(slate, e2, rA, rB, tint);
  // Ends.
  const hiddenEnd = (s: { frac: number; nb: number }) => {
    if (!isParty(s) || s.nb < 0) return false;
    const o = preps[s.nb];
    return (o.pitched && Math.abs(o.b.h - h) < 0.3) || o.b.h > h + rise;
  };
  const end = (p: XZ, q: XZ, eP: number[], eQ: number[], r: number[], hip: boolean, s: { frac: number; nb: number }, seedK: number) => {
    if (hip) {
      slateTri(slate, eP, eQ, r, tint);
      return;
    }
    if (hiddenEnd(s)) return;
    // Gable wall: triangle p, q, ridge end in the upper facade texture, continuing the wall's storeys.
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const L = Math.hypot(dx, dz);
    if (L < 0.5) return;
    const nx = -dz / L;
    const nz = dx / L;
    const uMax = Math.max(1, Math.round(L / BAY)) / 3;
    const along = ((r[0] - p[0]) * dx + (r[2] - p[1]) * dz) / (L * L);
    const seed = hash(bi * 131 + seedK, 977);
    const i0 = wall.v(p[0], h, p[1], nx, 0, nz, 0, vTop, tint, seed);
    const i1 = wall.v(q[0], h, q[1], nx, 0, nz, uMax, vTop, tint, seed);
    const i2 = wall.v(r[0], r[1], r[2], nx, 0, nz, along * uMax, vTop + rise / TILE, tint, seed);
    wall.tri(i0, i1, i2);
    // Barge boards: the slopes overhang the gable a touch.
  };
  end(c[1], c[2], e1, e2, rB, hipB, shEndB, 40 + ((1 + k) % 4));
  end(c[3], c[0], e3, e0, rA, hipA, shEndA, 40 + ((3 + k) % 4));
  // Chimney stack on the ridge at the A end (party wall for terraces), sometimes one at B too.
  if (hd > 2 && !hipA) chimney(wall, rA[0], rA[2], ax, az, yR, tint);
  if (hd > 2 && !hipB && !isParty(shEndB) && hash(bi, 13) < 0.5) chimney(wall, rB[0] - ax * 0.4, rB[2] - az * 0.4, ax, az, yR, tint);
  return true;
}

/** A brick chimney stack straddling the ridge (uses the brick pier between window bays: u ≈ 0). */
function chimney(buf: Buf, cx: number, cz: number, ax: number, az: number, yR: number, tint: number) {
  const ha = 0.35; // half size along the ridge
  const hp = 0.6; // half size across
  const px = -az;
  const pz = ax;
  let P: XZ[] = [
    [cx - ax * ha - px * hp, cz - az * ha - pz * hp],
    [cx + ax * ha - px * hp, cz + az * ha - pz * hp],
    [cx + ax * ha + px * hp, cz + az * ha + pz * hp],
    [cx - ax * ha + px * hp, cz - az * ha + pz * hp],
  ];
  if (signedArea(P) > 0) P = P.reverse();
  const y0 = yR - 1.4;
  const y1 = yR + 0.9;
  const c = tint * 0.92;
  for (let i = 0; i < 4; i++) {
    const a = P[i];
    const e = P[(i + 1) % 4];
    const dx = e[0] - a[0];
    const dz = e[1] - a[1];
    const L = Math.hypot(dx, dz);
    const nx = -dz / L;
    const nz = dx / L;
    const u = L / 2 / TILE;
    const k0 = buf.v(a[0], y0, a[1], nx, 0, nz, -u, 0, c, 0);
    const k1 = buf.v(e[0], y0, e[1], nx, 0, nz, u, 0, c, 0);
    const k2 = buf.v(e[0], y1, e[1], nx, 0, nz, u, (y1 - y0) / TILE, c, 0);
    const k3 = buf.v(a[0], y1, a[1], nx, 0, nz, -u, (y1 - y0) / TILE, c, 0);
    buf.quad(k0, k1, k2, k3);
  }
  const t = P.map((p) => buf.v(p[0], y1, p[1], 0, 1, 0, (p[0] - cx) / TILE, (p[1] - cz) / TILE, c * 0.6, 0));
  // Negative xz area → this order faces up.
  buf.tri(t[0], t[1], t[2]);
  buf.tri(t[0], t[2], t[3]);
}
