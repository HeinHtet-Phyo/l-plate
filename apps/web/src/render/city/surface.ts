// The ground: carriageway (asphalt), pavement (paving slabs), pale kerbs, and the land cover beneath
// (grass, wood, water, plain urban ground), all in ONE shader over a few chunked planes, so nothing z-fights.
//
// Data: s.grid (R carriageway, G pavement, B building coverage) and s.land (R grass, G water, B wood),
// both uploaded as DataTextures with uv = (xz + radius) / (n·cell). Edge decisions (road edge, kerb band)
// read LOD 0 for crisp lines near the camera; far away they switch to the mipmapped coverage so nothing shimmers.
import * as THREE from 'three';
import type { Session } from '../../sim/session.ts';
import type { TextureSet } from '../textures.ts';
import { CITY_FRAG_END, CITY_FRAG_PARS, CITY_VERT_PARS, cityShaderMaterial, disposeTree, type CityPiece } from './common.ts';

const VERT = /* glsl */ `
${CITY_VERT_PARS}
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
${CITY_FRAG_PARS}
uniform sampler2D uGrid;    // R carriageway, G pavement, B building (0..1 coverage)
uniform sampler2D uLand;    // R grass, G water, B wood
uniform sampler2D uAsphalt;
uniform sampler2D uPaving;
uniform sampler2D uGrass;
uniform vec4 uGridMap;      // uv = xz·x + y;  z = n·cell (m);  w = cell (m)
uniform vec2 uLandMap;      // uv = xz·x + y
uniform vec3 uUrbanA;
uniform vec3 uUrbanB;
uniform vec3 uKerb;
uniform float uAsphaltGain;
uniform float uPavingGain;

float sHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float sNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float sFbm(vec2 p) {
  return 0.5 * sNoise(p) + 0.3 * sNoise(p * 2.03 + 17.1) + 0.2 * sNoise(p * 4.07 + 31.7);
}
// 1 inside [a, b] (metres), antialiased over w.
float sBand(float d, float a, float b, float w) {
  return smoothstep(a - w, a + w, d) * (1.0 - smoothstep(b - w, b + w, d));
}
// Mean colour of a detail texture: its 1×1 mip.
vec3 sMean(sampler2D t) { return textureLod(t, vec2(0.5), 16.0).rgb; }

void main() {
  vec2 xz = vWorld.xz;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);
  vec2 dX = dFdx(xz);
  vec2 dY = dFdy(xz);
  float foot = max(abs(dX.x) + abs(dY.x), abs(dX.y) + abs(dY.y)); // pixel footprint on the ground (m)
  float cell = uGridMap.w;

  // ---- Coverage --------------------------------------------------------------------------------
  vec2 guv = xz * uGridMap.x + uGridMap.y;
  float edgeM = min(min(guv.x, guv.y), min(1.0 - guv.x, 1.0 - guv.y)) * uGridMap.z;
  float inside = smoothstep(0.0, 30.0, edgeM);
  vec4 g0 = textureLod(uGrid, guv, 0.0);
  vec4 gm = texture2D(uGrid, guv);
  float farMix = smoothstep(1.0, 3.0, foot / cell);
  vec2 cp = mix(g0.rg, gm.rg, farMix) * inside;
  float c = cp.x;
  float p = cp.y;
  float bNear = textureLod(uGrid, guv, 2.0).b * inside;

  float aa = max(0.08, fwidth(c) * 0.75);
  float road = smoothstep(0.5 - aa, 0.5 + aa, c);
  float paveM = smoothstep(0.3, 0.6, p);

  // ---- Kerb: a pale band just outside the c = 0.5 line, only where pavement is next to it ----------
  float kerb = 0.0;
  float face = 0.0;
  float gutter = 0.0;
  float c1 = textureLod(uGrid, guv, 1.0).r;
  if (c1 > 0.002 && c1 < 0.998 && inside > 0.0) {
    // 3×3 bilinear taps one cell apart: a [1 2 1] blur irons out the raster's stair steps, Sobel gives the normal.
    float su = cell * uGridMap.x;
    float a00 = textureLod(uGrid, guv + vec2(-su, -su), 0.0).r;
    float a10 = textureLod(uGrid, guv + vec2(0.0, -su), 0.0).r;
    float a20 = textureLod(uGrid, guv + vec2(su, -su), 0.0).r;
    float a01 = textureLod(uGrid, guv + vec2(-su, 0.0), 0.0).r;
    float a21 = textureLod(uGrid, guv + vec2(su, 0.0), 0.0).r;
    float a02 = textureLod(uGrid, guv + vec2(-su, su), 0.0).r;
    float a12 = textureLod(uGrid, guv + vec2(0.0, su), 0.0).r;
    float a22 = textureLod(uGrid, guv + vec2(su, su), 0.0).r;
    float cs = (4.0 * g0.r + 2.0 * (a10 + a01 + a21 + a12) + a00 + a20 + a02 + a22) / 16.0;
    vec2 grad = vec2((a20 + 2.0 * a21 + a22) - (a00 + 2.0 * a01 + a02), (a02 + 2.0 * a12 + a22) - (a00 + 2.0 * a10 + a20)) / (8.0 * cell);
    float gl = length(grad);
    if (gl > 0.05) {
      vec2 n = grad / gl;                                    // points into the carriageway
      float d = (cs - 0.5) / gl;                             // signed metres, > 0 on the carriageway
      float footN = abs(dot(dX, n)) + abs(dot(dY, n));       // pixel footprint across the kerb
      float w = max(0.012, footN * 0.5);
      float vis = (1.0 - smoothstep(0.8 * cell, 2.5 * cell, footN)) * inside;
      float pOut = textureLod(uGrid, guv - n * (0.9 * uGridMap.x), 0.0).g;
      float side = smoothstep(0.15, 0.45, max(g0.g, pOut)) * vis;
      road = mix(road, smoothstep(-w, w, d), vis);
      kerb = sBand(d, -0.3, -0.04, w) * side;
      face = sBand(d, -0.04, 0.03, w) * side;
      gutter = sBand(d, 0.03, 0.5, w) * side;
    }
  }

  // ---- Albedo layers ---------------------------------------------------------------------------
  float keepNear = 1.0 - smoothstep(35.0, 150.0, dist);   // fine detail fades to its mean colour
  float keepFar = 1.0 - smoothstep(80.0, 320.0, dist);
  float big = sFbm(xz / 40.0);
  float mid = sNoise(xz / 7.0);

  vec3 asMean = sMean(uAsphalt);
  vec3 asTex = mix(asMean, texture2D(uAsphalt, xz / 6.0).rgb, 0.55 * keepFar);
  float grit = dot(asTex, vec3(0.333)) / max(1e-4, dot(asMean, vec3(0.333)));

  // Plain urban ground (yards, car parks, verges): muted grey-brown, low contrast.
  vec3 urban = mix(uUrbanA, uUrbanB, smoothstep(0.25, 0.75, big));
  urban *= mix(1.0, grit, 0.45 * keepNear) * (0.94 + 0.12 * mid);

  // Grass and wood.
  vec3 grass = mix(sMean(uGrass), texture2D(uGrass, xz / 4.0).rgb, keepFar);
  grass = mix(vec3(dot(grass, vec3(0.3, 0.59, 0.11))), grass, 0.7);
  grass *= mix(vec3(1.2, 1.1, 0.75), vec3(0.8, 0.92, 0.95), big);
  vec3 wood = mix(grass * vec3(0.5, 0.6, 0.48), vec3(0.07, 0.055, 0.032), smoothstep(0.3, 0.8, mid) * 0.55);
  vec4 lc = texture2D(uLand, xz * uLandMap.x + uLandMap.y) * inside;
  float wobble = (mid - 0.5) * 0.35;
  float grassM = smoothstep(0.35, 0.65, lc.r + wobble);
  float woodM = smoothstep(0.35, 0.65, lc.b + wobble);
  float waterM = smoothstep(0.4, 0.6, lc.g);

  // Pavement: grey concrete slabs.
  vec3 pave = mix(sMean(uPaving), texture2D(uPaving, xz / 3.6).rgb, keepNear);
  pave = mix(vec3(dot(pave, vec3(0.3, 0.59, 0.11))), pave, 0.55) * uPavingGain * (0.92 + 0.16 * big);

  // Asphalt: large-scale wear, a few darker repairs, a darker gutter by the kerb.
  vec3 asph = asTex * uAsphaltGain * (0.8 + 0.4 * big);
  asph *= 1.0 - 0.12 * smoothstep(0.62, 0.7, sNoise(xz / 11.0 + 37.0));
  asph *= 1.0 - 0.22 * gutter;

  vec3 kerbC = uKerb * (0.9 + 0.2 * sHash(floor(xz / 0.9)));

  vec3 alb = urban;
  alb = mix(alb, grass, grassM);
  alb = mix(alb, wood, woodM);
  float waterW = waterM * (1.0 - paveM) * (1.0 - road);
  alb = mix(alb, vec3(0.018, 0.03, 0.035), waterW);
  alb = mix(alb, pave, paveM);
  alb = mix(alb, asph, road);
  alb = mix(alb, kerbC, kerb);
  alb = mix(alb, kerbC * 0.45, face);
  // Soft contact shade near building walls.
  alb *= 1.0 - 0.28 * smoothstep(0.05, 0.6, bNear) * (1.0 - road);
  // Beyond the data: patchy grey/green ground that fades into the fog.
  alb = mix(alb, grass * 0.85, (1.0 - inside) * smoothstep(0.45, 0.65, sFbm(xz / 160.0)));

  // ---- Rain ------------------------------------------------------------------------------------
  float puddle = smoothstep(0.66, 0.8, sNoise(xz / 4.0 + 5.0) * 0.7 + mid * 0.3 + gutter * 0.3) * uRain * road;
  float hard = max(road, max(kerb, paveM));
  float wetDark = uRain * (0.4 * road + 0.3 * (1.0 - road) * max(paveM, kerb) + 0.15 * (1.0 - hard));
  alb *= 1.0 - wetDark - 0.2 * puddle;

  // ---- Light -----------------------------------------------------------------------------------
  vec3 colour = alb * cityLight(vWorld);
  float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
  float gloss = road + 0.45 * (1.0 - road) * max(paveM, kerb);
  float refl = fres * uRain * 0.7 * gloss;
  refl = mix(refl, 0.25 + 0.65 * fres, puddle);
  colour = mix(colour, uSkyColour, refl);
  float lamp = cityLampAt(xz) * cityNight();
  colour += CITY_LAMP * lamp * uRain * 0.5 * (gloss + puddle);
  // Water: always a little reflective.
  colour = mix(colour, uSkyColour, waterW * (0.2 + 0.7 * fres));
  colour += CITY_LAMP * lamp * waterW * 0.3;

  gl_FragColor = vec4(colour, 1.0);
  ${CITY_FRAG_END}
}
`;

/** Pack R carriageway, G pavement, B building into one RGBA texture (A = 255). */
function gridTexture(s: Session, aniso: number): THREE.DataTexture {
  const g = s.grid;
  const n = g.n;
  const out = new Uint8Array(n * n * 4);
  const o32 = new Uint32Array(out.buffer);
  const C = g.carriageway;
  const P = g.pavement;
  const B = g.building;
  for (let i = 0; i < o32.length; i++) o32[i] = C[i] | (P[i] << 8) | (B[i] << 16) | 0xff000000; // little-endian RGBA
  const t = new THREE.DataTexture(out, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.flipY = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function landTexture(s: Session, aniso: number): THREE.DataTexture {
  const l = s.land;
  const t = new THREE.DataTexture(l.data, l.n, l.n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.flipY = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Drop the texture's CPU copy once it's on the GPU (the 4096² grid is 64 MB). */
function releaseAfterUpload(t: THREE.DataTexture) {
  t.onUpdate = () => {
    (t.image as { data: unknown }).data = null;
    t.onUpdate = null;
  };
}

/** A flat ring between ±inner and ±outer (y = 0, facing up). */
function skirtGeometry(inner: number, outer: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const quad = (x0: number, z0: number, x1: number, z1: number) => {
    const b = pos.length / 3;
    pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x1, 0, z0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  quad(-outer, -outer, outer, -inner); // north
  quad(-outer, inner, outer, outer); // south
  quad(-outer, -inner, -inner, inner); // west
  quad(inner, -inner, outer, inner); // east
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

export function buildSurface(s: Session, tex: TextureSet): CityPiece {
  const g = s.grid;
  const R = g.radius;
  const gSize = g.n * g.cell;
  const lSize = s.land.n * s.land.cell;
  const aniso = Math.max(1, tex.asphalt.anisotropy);

  const gridTex = gridTexture(s, aniso);
  const landTex = landTexture(s, aniso);
  releaseAfterUpload(gridTex);
  releaseAfterUpload(landTex);

  const material = cityShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uGrid: { value: gridTex },
      uLand: { value: landTex },
      uAsphalt: { value: tex.asphalt },
      uPaving: { value: tex.paving },
      uGrass: { value: tex.grass },
      uGridMap: { value: new THREE.Vector4(1 / gSize, R / gSize, gSize, g.cell) },
      uLandMap: { value: new THREE.Vector2(1 / lSize, s.land.radius / lSize) },
      uUrbanA: { value: new THREE.Color('#6e6a62') },
      uUrbanB: { value: new THREE.Color('#77705f') },
      uKerb: { value: new THREE.Color('#bdb8ad') },
      uAsphaltGain: { value: 1.75 },
      uPavingGain: { value: 0.72 },
    },
  });
  material.name = 'city-surface';

  const object = new THREE.Group();
  // Chunks of ~500 m so frustum culling drops what's behind the camera without many draw calls
  // (the cost is per pixel, not per vertex); one shared geometry and material.
  const nChunk = THREE.MathUtils.clamp(Math.ceil((2 * R) / 500), 3, 8);
  const cs = (2 * R) / nChunk;
  const segs = Math.max(1, Math.round(cs / 12));
  const chunkGeo = new THREE.PlaneGeometry(cs, cs, segs, segs).rotateX(-Math.PI / 2);
  chunkGeo.deleteAttribute('normal');
  chunkGeo.deleteAttribute('uv');
  chunkGeo.computeBoundingSphere();
  const place = (m: THREE.Mesh, x: number, z: number) => {
    m.position.set(x, 0, z);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    // Drawn after the other opaque city parts, so early-z skips ground hidden behind buildings and cars.
    m.renderOrder = 1;
    object.add(m);
  };
  for (let j = 0; j < nChunk; j++)
    for (let i = 0; i < nChunk; i++) place(new THREE.Mesh(chunkGeo, material), -R + (i + 0.5) * cs, -R + (j + 0.5) * cs);
  const skirt = new THREE.Mesh(skirtGeometry(R, R + 8000), material);
  skirt.name = 'surface-skirt';
  place(skirt, 0, 0);

  return {
    object,
    dispose() {
      disposeTree(object);
      gridTex.dispose();
      landTex.dispose();
    },
  };
}
