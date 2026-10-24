// Traffic lights (UK three-aspect heads on grey poles, black backing boards with a white border)
// and Belisha beacons at zebras.
//
// Draw calls: 1 merged static mesh (poles, housings, hoods, boards, beacon poles) + 1 instanced lens mesh
// + 1 instanced lens glow + 1 instanced beacon globe + 1 instanced beacon glow = 5.
// Lens colours follow s.signals.aspect(line, s.world.time), the same clock the sim uses for red-light faults.
// Each stop line gets a primary head on its travel-left kerb; where there is an opposite approach, that pole also
// carries a back-to-back secondary head for the opposite traffic (seen across the junction, as in the UK).
import * as THREE from 'three';
import type { Session } from '../../sim/session.ts';
import type { StopLine, Aspect } from '../../sim/signals.ts';
import type { TextureSet } from '../textures.ts';
import { shared } from '../atmosphere/uniforms.ts';
import { cityShaderMaterial, disposeTree, rotY, withCityLight, type CityPiece } from './common.ts';

// ---- Dimensions (metres). Head models are built facing −z with the pole at the origin. ----
const POLE_H = 3.2;
const POLE_R = 0.055;
const HEAD_Y = 2.7; // centre of the head (2.27–3.13)
const LENS_GAP = 0.27; // red / amber / green centres at HEAD_Y + GAP, HEAD_Y, HEAD_Y − GAP
const LENS_R = 0.1;
const HOUSING = { w: 0.3, h: 0.86, d: 0.2, z: -0.19 };
const LENS_Z = HOUSING.z - HOUSING.d / 2 - 0.003;
const HOOD = { r: 0.122, len: 0.18 };

const BEACON_H = 2.9;
const BEACON_R = 0.05;
const BAND = 0.3;
const GLOBE_R = 0.18;
const GLOBE_Y = BEACON_H + 0.07 + GLOBE_R * 0.85;

// Lens colours (linear, mildly HDR). Kept low and nearly pure: ACES' input matrix bleeds a strong red into
// green/blue, so 4× values wash out to peach/white. The glow sprites carry the "bright light" impression.
// Index 0 red, 1 amber, 2 green.
const LIT: readonly [number, number, number][] = [
  [1.7, 0.0, 0.01],
  [1.7, 0.5, 0.0],
  [0.0, 1.5, 0.62],
];
const UNLIT: readonly [number, number, number][] = [
  [0.07, 0.006, 0.004],
  [0.07, 0.035, 0.002],
  [0.004, 0.05, 0.03],
];
const GLOW: readonly [number, number, number][] = [
  [1.3, 0.02, 0.01],
  [1.3, 0.42, 0.0],
  [0.0, 1.15, 0.5],
];
// Beacon globe: an orange diffuse (sunlit, it still reads as an orange ball when off) + emissive when on.
// ACES turns bright orange yellow, so by day the emissive/glow input is nearly pure red (it tone-maps to orange);
// at night, against a dark sky, a warmer input reads right. update() blends the two by shared.uDay.
const BEACON_DIFFUSE: [number, number, number] = [0.45, 0.08, 0.01];
const BEACON_LIT_NIGHT: [number, number, number] = [1.6, 0.5, 0.02];
const BEACON_LIT_DAY: [number, number, number] = [1.3, 0.07, 0.0];
const BEACON_GLOW: [number, number, number] = [1.25, 0.38, 0.0];
const BEACON_GLOW_DAY_G = 0.3; // glow green multiplier in full daylight

// Which lenses are lit per aspect code (0 red, 1 redAmber, 2 green, 3 amber): bits red=1, amber=2, green=4.
const LIT_MASK = [1, 3, 4, 2];
function aspectCode(a: Aspect): number {
  switch (a) {
    case 'red':
      return 0;
    case 'redAmber':
      return 1;
    case 'green':
      return 2;
    default:
      return 3;
  }
}

/** Appends transformed copies of template geometries into one vertex-coloured geometry. */
class Merger {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private v = new THREE.Vector3();
  private nm = new THREE.Matrix3();

  add(g: THREE.BufferGeometry, m: THREE.Matrix4, c: THREE.Color) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const base = this.pos.length / 3;
    this.nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      this.v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(n, i).applyMatrix3(this.nm).normalize();
      this.nor.push(this.v.x, this.v.y, this.v.z);
      this.col.push(c.r, c.g, c.b);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  get empty() {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const n = this.pos.length / 3;
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Camera-facing additive glow quads, one per instance (centre and facing from instanceMatrix, colour from instanceColor). */
function glowMaterial(size: number, dayGain: number, nightGain: number, directional: boolean): THREE.ShaderMaterial {
  return cityShaderMaterial({
    uniforms: {
      uSize: { value: size },
      uGains: { value: new THREE.Vector2(dayGain, nightGain) },
      uFlash: { value: 1 },
      uTint: { value: new THREE.Color(1, 1, 1) },
    },
    defines: directional ? { DIRECTIONAL: '' } : {},
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uDay;
      uniform float uSize;
      varying vec2 vUv;
      varying vec3 vCol;
      #include <fog_pars_vertex>
      void main() {
        mat4 m = modelMatrix * instanceMatrix;
        vec3 c = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 toCam = cameraPosition - c;
        float dist = max(length(toCam), 1e-3);
        toCam /= dist;
        float k = 1.0;
      #ifdef DIRECTIONAL
        vec3 fwd = normalize((m * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
        k = smoothstep(0.0, 0.45, dot(fwd, toCam));
      #endif
        vCol = instanceColor * k;
        float night = 1.0 - smoothstep(0.12, 0.6, uDay);
        // Grow a little with distance so far-off lights still read as points of light.
        float size = uSize * mix(0.6, 1.0, night) * (1.0 + dist * 0.012);
        vec4 mvPosition = viewMatrix * vec4(c + toCam * 0.32, 1.0);
        mvPosition.xy += position.xy * size;
        gl_Position = projectionMatrix * mvPosition;
        if (dot(vCol, vCol) < 1e-6) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
        vUv = uv;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uDay;
      uniform vec2 uGains;
      uniform float uFlash;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying vec3 vCol;
      #include <fog_pars_fragment>
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 >= 1.0) discard;
        float night = 1.0 - smoothstep(0.12, 0.6, uDay);
        float g = exp(-r2 * 16.0) + exp(-r2 * 3.5) * 0.35 * (1.0 - r2);
        vec3 col = vCol * g * mix(uGains.x, uGains.y, night) * uFlash * uTint;
      #ifdef USE_FOG
        #ifdef FOG_EXP2
          float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
        #else
          float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
        #endif
        col *= 1.0 - 0.75 * fogFactor;
      #endif
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

interface Head {
  line: StopLine;
  /** Pole frame (position + facing) times the local flip for back-to-back heads. */
  m: THREE.Matrix4;
}

export function buildSignals(s: Session, _tex: TextureSet): CityPiece {
  const object = new THREE.Group();
  const lines = s.signals?.lines ?? [];
  const zebras = s.signals?.zebras ?? [];

  // ---- Poles: one per stop line (deduped: the sim can emit the same approach twice). ----
  const poles: { line: StopLine; m: THREE.Matrix4 }[] = [];
  for (const l of lines) {
    const dup = poles.some(
      (p) =>
        Math.hypot(p.line.head.x - l.head.x, p.line.head.z - l.head.z) < 0.5 &&
        Math.abs(((p.line.head.heading - l.head.heading + 540) % 360) - 180) < 10,
    );
    if (dup) continue;
    const m = new THREE.Matrix4().makeRotationY(rotY(l.head.heading));
    m.setPosition(l.head.x, 0, l.head.z);
    poles.push({ line: l, m });
  }

  // ---- Heads: a primary per pole, plus a back-to-back secondary for the opposite approach. ----
  const heads: Head[] = [];
  const flip = new THREE.Matrix4().makeRotationY(Math.PI);
  for (const p of poles) {
    const l = p.line;
    heads.push({ line: l, m: p.m });
    let best: StopLine | null = null;
    let bestD = 40;
    for (const o of lines) {
      if (o === l || o.kind !== l.kind) continue;
      if (o.dx * l.dx + o.dz * l.dz > -0.8) continue; // must be the opposite direction
      const ex = o.x - l.x;
      const ez = o.z - l.z;
      if (ex * l.dx + ez * l.dz < 1) continue; // and beyond this stop line
      const d = Math.hypot(ex, ez);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (best) heads.push({ line: best, m: p.m.clone().multiply(flip) });
  }

  const tmp = new THREE.Matrix4();
  const at = (base: THREE.Matrix4, x: number, y: number, z: number) => tmp.copy(base).multiply(new THREE.Matrix4().makeTranslation(x, y, z));

  // ---- Static geometry: everything that never changes colour, merged into one mesh. ----
  const merger = new Merger();
  const C = {
    pole: new THREE.Color(0x45494d),
    black: new THREE.Color(0x121314),
    board: new THREE.Color(0x0d0d0e),
    white: new THREE.Color(0xf2f2f2),
    button: new THREE.Color(0xd9b53a),
    bandWhite: new THREE.Color(0xeeeeee),
    bandBlack: new THREE.Color(0x111111),
  };
  const gPole = new THREE.CylinderGeometry(POLE_R, POLE_R, POLE_H, 10, 1, true);
  const gRoot = new THREE.CylinderGeometry(0.075, 0.085, 0.35, 10, 1, true);
  const gCap = new THREE.CylinderGeometry(0.068, 0.068, 0.05, 10);
  const gWhite = new THREE.BoxGeometry(0.56, 1.06, 0.016);
  const gBoard = new THREE.BoxGeometry(0.47, 0.97, 0.012);
  const gHousing = new THREE.BoxGeometry(HOUSING.w, HOUSING.h, HOUSING.d);
  const hoodArc = (Math.PI * 4) / 3;
  const gHood = new THREE.CylinderGeometry(HOOD.r, HOOD.r, HOOD.len, 14, 1, true, Math.PI - hoodArc / 2, hoodArc).rotateX(Math.PI / 2);
  const gButton = new THREE.BoxGeometry(0.13, 0.22, 0.09);
  const gBand = new THREE.CylinderGeometry(BEACON_R, BEACON_R, BAND, 12, 1, true);
  const gBandTop = new THREE.CylinderGeometry(BEACON_R, BEACON_R, BEACON_H % BAND || BAND, 12, 1, true);
  const gCollar = new THREE.CylinderGeometry(0.07, 0.06, 0.07, 12);

  for (const p of poles) {
    merger.add(gPole, at(p.m, 0, POLE_H / 2, 0), C.pole);
    merger.add(gRoot, at(p.m, 0, 0.175, 0), C.pole);
    merger.add(gCap, at(p.m, 0, POLE_H + 0.025, 0), C.pole);
    // Push-button unit on stand-alone crossing poles, on the footway side (local +x is away from the road).
    if (p.line.kind === 'crossing') merger.add(gButton, at(p.m, POLE_R + 0.05, 1.1, 0), C.button);
  }
  for (const h of heads) {
    merger.add(gWhite, at(h.m, 0, HEAD_Y, -0.072), C.white);
    merger.add(gBoard, at(h.m, 0, HEAD_Y, -0.084), C.board);
    merger.add(gHousing, at(h.m, 0, HEAD_Y, HOUSING.z), C.black);
    for (let k = 0; k < 3; k++) merger.add(gHood, at(h.m, 0, HEAD_Y + (1 - k) * LENS_GAP, LENS_Z - HOOD.len / 2 + 0.002), C.black);
  }

  // ---- Belisha beacons: a pole on each kerb, black-and-white bands, amber globe. ----
  const beacons: THREE.Vector3[] = [];
  for (const zb of zebras) {
    const rx = -zb.dz;
    const rz = zb.dx;
    const offs = [zb.seg.halfRight + 0.4, -(zb.seg.halfLeft + 0.4)];
    for (const o of offs) {
      const x = zb.x + rx * o;
      const z = zb.z + rz * o;
      const base = new THREE.Matrix4().makeTranslation(x, 0, z);
      let i = 0;
      for (let y = 0; y < BEACON_H - 1e-3; y += BAND, i++) {
        const h = Math.min(BAND, BEACON_H - y);
        merger.add(h < BAND ? gBandTop : gBand, at(base, 0, y + h / 2, 0), i % 2 === 0 ? C.bandBlack : C.bandWhite);
      }
      merger.add(gCollar, at(base, 0, BEACON_H + 0.035, 0), C.bandBlack);
      beacons.push(new THREE.Vector3(x, GLOBE_Y, z));
    }
  }

  if (!merger.empty) {
    const mat = withCityLight(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { key: 'signals' });
    const mesh = new THREE.Mesh(merger.build(), mat);
    mesh.name = 'signals-static';
    object.add(mesh);
  }
  for (const g of [gPole, gRoot, gCap, gWhite, gBoard, gHousing, gHood, gButton, gBand, gBandTop, gCollar]) g.dispose();

  // ---- Lenses + their glow: 3 instances per head (red, amber, green), colour written on aspect change. ----
  const nLens = heads.length * 3;
  const glowGeo = new THREE.PlaneGeometry(2, 2);
  let lensColour: THREE.InstancedBufferAttribute | null = null;
  let glowColour: THREE.InstancedBufferAttribute | null = null;
  if (nLens) {
    const lensGeo = new THREE.CircleGeometry(LENS_R, 22).rotateY(Math.PI);
    const lenses = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), nLens);
    const glows = new THREE.InstancedMesh(glowGeo, glowMaterial(0.42, 0.6, 1.0, true), nLens);
    lensColour = new THREE.InstancedBufferAttribute(new Float32Array(nLens * 3), 3);
    glowColour = new THREE.InstancedBufferAttribute(new Float32Array(nLens * 3), 3);
    lenses.instanceColor = lensColour;
    glows.instanceColor = glowColour;
    heads.forEach((h, i) => {
      for (let k = 0; k < 3; k++) {
        const m = at(h.m, 0, HEAD_Y + (1 - k) * LENS_GAP, LENS_Z);
        lenses.setMatrixAt(i * 3 + k, m);
        glows.setMatrixAt(i * 3 + k, m);
      }
    });
    lenses.name = 'signals-lenses';
    glows.name = 'signals-glow';
    glows.renderOrder = 2;
    object.add(lenses, glows);
  }

  // ---- Beacon globes + glow. All beacons flash together, so one material colour / uniform drives them. ----
  let globeMat: THREE.MeshLambertMaterial | null = null;
  let beaconGlowMat: THREE.ShaderMaterial | null = null;
  if (beacons.length) {
    globeMat = withCityLight(new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(...BEACON_DIFFUSE) }), { key: 'beacon' });
    const globes = new THREE.InstancedMesh(new THREE.SphereGeometry(GLOBE_R, 20, 14), globeMat, beacons.length);
    beaconGlowMat = glowMaterial(0.75, 0.6, 1.25, false);
    const bGlows = new THREE.InstancedMesh(glowGeo, beaconGlowMat, beacons.length);
    const bc = new THREE.InstancedBufferAttribute(new Float32Array(beacons.length * 3), 3);
    bGlows.instanceColor = bc;
    beacons.forEach((b, i) => {
      tmp.makeTranslation(b.x, b.y, b.z);
      globes.setMatrixAt(i, tmp);
      bGlows.setMatrixAt(i, tmp);
      bc.setXYZ(i, BEACON_GLOW[0], BEACON_GLOW[1], BEACON_GLOW[2]);
    });
    globes.name = 'signals-beacons';
    bGlows.name = 'signals-beacon-glow';
    bGlows.renderOrder = 2;
    object.add(globes, bGlows);
  }

  // ---- Per-frame state (no allocations in update). ----
  const headAspect = new Int8Array(heads.length).fill(-1);
  const writeHead = (i: number, code: number) => {
    const mask = LIT_MASK[code];
    const la = lensColour!.array as Float32Array;
    const ga = glowColour!.array as Float32Array;
    for (let k = 0; k < 3; k++) {
      const on = (mask >> k) & 1;
      const c = on ? LIT[k] : UNLIT[k];
      const g = GLOW[k];
      const o = (i * 3 + k) * 3;
      for (let j = 0; j < 3; j++) {
        la[o + j] = c[j];
        ga[o + j] = on ? g[j] : 0;
      }
    }
  };
  let lastFlash = -1;
  let lastDay = -1;

  const update = (s: Session) => {
    const t = s.world?.time ?? 0;
    if (lensColour && glowColour) {
      let dirty = false;
      for (let i = 0; i < heads.length; i++) {
        const code = aspectCode(s.signals.aspect(heads[i].line, t));
        if (code !== headAspect[i]) {
          headAspect[i] = code;
          writeHead(i, code);
          dirty = true;
        }
      }
      if (dirty) {
        lensColour.needsUpdate = true;
        glowColour.needsUpdate = true;
      }
    }
    if (globeMat && beaconGlowMat) {
      // ~1.4 Hz: on 0.35 s, off 0.35 s, with a short fade so it reads like a real lamp.
      const ph = ((t % 0.7) + 0.7) % 0.7;
      const f = ph < 0.35 ? Math.min(1, (0.35 - ph) / 0.04) : Math.max(0, (ph - 0.66) / 0.04);
      const day = THREE.MathUtils.clamp(shared.uDay.value, 0, 1);
      if (f !== lastFlash || day !== lastDay) {
        lastFlash = f;
        lastDay = day;
        const n = 1 - day;
        globeMat.emissive.setRGB(
          (BEACON_LIT_DAY[0] * day + BEACON_LIT_NIGHT[0] * n) * f,
          (BEACON_LIT_DAY[1] * day + BEACON_LIT_NIGHT[1] * n) * f,
          (BEACON_LIT_DAY[2] * day + BEACON_LIT_NIGHT[2] * n) * f,
        );
        const u = beaconGlowMat.uniforms;
        u.uFlash.value = f;
        (u.uTint.value as THREE.Color).setRGB(1, BEACON_GLOW_DAY_G * day + n, 1);
      }
    }
  };
  update(s);

  return {
    object,
    update: (s) => update(s),
    dispose: () => disposeTree(object),
  };
}
