// Drapes our flat OSM world onto the Google 3D Tiles terrain.
//
// Height map: an orthographic camera BELOW the tiles looks up, so the first surface it sees at each
// point is the ground (roofs, trees and Google's baked-in cars are above it). A min-filter over ~5 m
// (±2.5 m, wider than a car) replaces the ground only where something car-sized sticks up > 0.8 m
// (the photogrammetry shell drapes over Google's parked cars); elsewhere the real ground is kept.
// Draping: every one of our materials gets its vertices lifted by the ground height (instanced objects
// as a whole, so cars and lamps stay upright), via the `gl_Position = projectionMatrix * mvPosition`
// line that both built-in and our custom shaders end with.
import * as THREE from 'three';

const SIZE = 640; // metres covered around the car
const RES = 512; // pixels (≈ 1.25 m)
// Just above Google's ground so our road never z-fights with it.
const LIFT = 0.1;

export const terrainUniforms = {
  uTerrainMap: { value: null as THREE.Texture | null },
  /** minX, minZ, 1/size, enabled */
  uTerrainRect: { value: new THREE.Vector4(0, 0, 1 / SIZE, 0) },
};

const PARS = /* glsl */ `
uniform sampler2D uTerrainMap;
uniform vec4 uTerrainRect;
float terrainLift(vec2 xz) {
  if (uTerrainRect.w < 0.5) return 0.0;
  vec2 uv = (xz - uTerrainRect.xy) * uTerrainRect.z;
  vec4 t = texture2D(uTerrainMap, clamp(uv, vec2(0.002), vec2(0.998)));
  return t.a > 0.5 ? t.r + ${LIFT.toFixed(3)} : 0.0;
}
vec2 terrainXZ() {
  #ifdef USE_INSTANCING
    return (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
  #else
    return (modelMatrix * vec4(position, 1.0)).xz;
  #endif
}
`;
const APPLY = /* glsl */ `
  mvPosition.xyz += (viewMatrix * vec4(0.0, terrainLift(terrainXZ()), 0.0, 0.0)).xyz;
  gl_Position = projectionMatrix * mvPosition;
`;

function drapeMaterial(mat: THREE.Material) {
  if (mat.userData.draped) return;
  mat.userData.draped = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uTerrainMap = terrainUniforms.uTerrainMap;
    shader.uniforms.uTerrainRect = terrainUniforms.uTerrainRect;
    let vs = shader.vertexShader;
    if (vs.includes('#include <project_vertex>')) {
      vs = vs.replace('#include <project_vertex>', `#include <project_vertex>\n${APPLY}`);
    } else {
      vs = vs.replace(/gl_Position\s*=\s*projectionMatrix\s*\*\s*mvPosition\s*;/, APPLY);
    }
    shader.vertexShader = PARS + vs;
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|drape`;
  mat.needsUpdate = true;
}

/** Drape every material under an object (call again after new meshes are added; already-draped ones are skipped). */
export function drapeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) drapeMaterial(mat);
  });
}

export interface HeightMap {
  /** Re-render around (x, z) from the given tiles root (call every few hundred ms). */
  update(gl: THREE.WebGLRenderer, scene: THREE.Scene, tilesRoot: THREE.Object3D, x: number, z: number): void;
  /** Ground height at (x, z) from the last update (CPU readback), or 0. */
  groundAt(gl: THREE.WebGLRenderer, x: number, z: number): number;
  setEnabled(on: boolean): void;
  dispose(): void;
}

export function createHeightMap(): HeightMap {
  const opts = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true };
  const raw = new THREE.WebGLRenderTarget(RES, RES, opts);
  const eroded = new THREE.WebGLRenderTarget(RES, RES, { ...opts, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  terrainUniforms.uTerrainMap.value = eroded.texture;

  const cam = new THREE.OrthographicCamera(-SIZE / 2, SIZE / 2, SIZE / 2, -SIZE / 2, 1, 3000);
  cam.up.set(0, 0, 1); // screen x → +x, screen up → +z, so uv = (xz − min) / size
  const heightScene = new THREE.Scene();
  heightScene.overrideMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: 'varying float vY; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'varying float vY; void main() { gl_FragColor = vec4(vY, 0.0, 0.0, 1.0); }',
  });

  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const erode = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: raw.texture }, uStep: { value: 1 / RES } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc; uniform float uStep; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tSrc, vUv);
        float m = 1e9; float a = 0.0;
        for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
          vec4 s = texture2D(tSrc, vUv + vec2(float(i), float(j)) * uStep);
          if (s.a > 0.5) { m = min(m, s.r); a = 1.0; }
        }
        // The real ground where it's flat; the local minimum only where something car-sized sticks up.
        float h = (c.a > 0.5 && c.r - m < 0.8) ? c.r : m;
        gl_FragColor = vec4(a > 0.5 ? h : 0.0, 0.0, 0.0, a);
      }`,
  });
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), erode));
  const px = new Float32Array(4);
  let minX = 0;
  let minZ = 0;
  let enabled = false;

  return {
    update(gl, scene, tilesRoot, x, z) {
      const cx = Math.round(x / 16) * 16;
      const cz = Math.round(z / 16) * 16;
      cam.position.set(cx, -1500, cz);
      cam.lookAt(cx, 0, cz);
      cam.updateMatrixWorld();
      const parent = tilesRoot.parent;
      const prevTarget = gl.getRenderTarget();
      const prevClear = gl.getClearColor(new THREE.Color());
      const prevAlpha = gl.getClearAlpha();
      const prevAuto = gl.autoClear;
      heightScene.add(tilesRoot); // render only the tiles
      gl.autoClear = true;
      gl.setClearColor(0x000000, 0);
      gl.setRenderTarget(raw);
      gl.render(heightScene, cam);
      gl.setRenderTarget(eroded);
      gl.render(quadScene, quadCam);
      gl.setRenderTarget(prevTarget);
      gl.setClearColor(prevClear, prevAlpha);
      gl.autoClear = prevAuto;
      if (parent) parent.add(tilesRoot);
      else scene.add(tilesRoot);
      minX = cx - SIZE / 2;
      minZ = cz - SIZE / 2;
      terrainUniforms.uTerrainRect.value.set(minX, minZ, 1 / SIZE, enabled ? 1 : 0);
    },
    groundAt(gl, x, z) {
      const u = Math.floor(((x - minX) / SIZE) * RES);
      const v = Math.floor(((z - minZ) / SIZE) * RES);
      if (u < 0 || v < 0 || u >= RES || v >= RES) return 0;
      gl.readRenderTargetPixels(eroded, u, v, 1, 1, px);
      return px[3] > 0.5 ? px[0] + LIFT : 0;
    },
    setEnabled(on) {
      enabled = on;
      terrainUniforms.uTerrainRect.value.w = on ? 1 : 0;
    },
    dispose() {
      raw.dispose();
      eroded.dispose();
      terrainUniforms.uTerrainRect.value.w = 0;
    },
  };
}
