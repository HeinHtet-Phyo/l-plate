// Shared bits for every city part: the piece shape, heading → rotation, the lamp map texture,
// and the GLSL that lights city surfaces (day ambient + baked streetlights + the learner's headlights).
import * as THREE from 'three';
import { shared } from '../atmosphere/uniforms.ts';
import type { Session } from '../../sim/session.ts';

/** One part of the city (surface, markings, buildings, props, signals). index.ts adds them to one group. */
export interface CityPiece {
  object: THREE.Object3D;
  update?(s: Session, dt: number): void;
  dispose(): void;
}

/** Compass heading in degrees (0 = north = −z, 90 = east = +x) → three.js rotation.y for a model facing −z. */
export const rotY = (heading: number) => (-heading * Math.PI) / 180;

/** Warm LED/sodium streetlight colour. */
export const LAMP_COLOUR = new THREE.Color(1.0, 0.8, 0.55);

/**
 * Lamp map convention (agreed for uniforms.ts): uv = xz · uLampScale.x + uLampScale.y,
 * with x = 1 / (n·cell) and y = radius / (n·cell). Row r of the data is z, column c is x.
 * The atmosphere owns these uniforms; if it hasn't set them yet, the city does, so it renders on its own.
 */
export function ensureLampMap(s: Session): THREE.DataTexture | null {
  if (shared.uLampMap.value || !s.lightMap) return null;
  const { n, cell, data } = s.lightMap;
  const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  t.unpackAlignment = 1;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  shared.uLampMap.value = t;
  const size = n * cell;
  shared.uLampScale.value.set(1 / size, s.ex.radius / size);
  return t;
}

const SKY_CLEAR = new THREE.Color(0x6fa3d8);
const SKY_GREY = new THREE.Color(0xa7adb3);
const SKY_NIGHT = new THREE.Color(0x05070c);

/**
 * Sets the shared uniforms from the session every frame: day/overcast/rain from s.conditions, the clock,
 * a sky colour, and the headlights on the learner's car. The app calls city.update before atmosphere.update,
 * so the real atmosphere (when merged) overrides these with its own values; until then the city still
 * gets night, rain and headlights right.
 */
export function syncShared(s: Session) {
  const c = s.conditions;
  if (c) {
    shared.uDay.value = c.daylight;
    shared.uOvercast.value = c.cloud;
    shared.uRain.value = c.rain;
    shared.uSkyColour.value.copy(SKY_CLEAR).lerp(SKY_GREY, c.cloud).lerp(SKY_NIGHT, 1 - c.daylight);
  }
  shared.uTime.value = s.time;
  const car = s.world?.car;
  if (!car) return;
  shared.uCarPos.value.set(car.x, 1.2, car.z);
  const h = (car.heading * Math.PI) / 180;
  shared.uCarDir.value.set(Math.sin(h), -Math.cos(h));
}

/** GLSL declarations + helpers. Include once in a fragment (or vertex) shader that has vWorld (world position). */
export const CITY_LIGHT_PARS = /* glsl */ `
uniform float uDay;
uniform float uOvercast;
uniform float uRain;
uniform float uTime;
uniform sampler2D uLampMap;
uniform vec2 uLampScale;
uniform vec3 uCarPos;
uniform vec2 uCarDir;
uniform vec3 uSkyColour;
const vec3 CITY_LAMP = vec3(${LAMP_COLOUR.r.toFixed(3)}, ${LAMP_COLOUR.g.toFixed(3)}, ${LAMP_COLOUR.b.toFixed(3)});

// 0 by day, 1 at night.
float cityNight() { return 1.0 - smoothstep(0.12, 0.6, uDay); }

// Daylight ambient from the spec: 0.1 + 0.9·day·(1 − 0.35·overcast).
float cityAmbient() { return 0.1 + 0.9 * uDay * (1.0 - 0.35 * uOvercast); }

// Baked streetlight intensity 0…1 at a ground position.
float cityLampAt(vec2 xz) {
  vec2 uv = xz * uLampScale.x + uLampScale.y;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture2D(uLampMap, uv).r;
}

// The learner's dipped headlights: a cone along uCarDir that lights low surfaces.
float cityHeadlight(vec3 p) {
  vec2 d = p.xz - uCarPos.xz;
  float along = dot(d, uCarDir);
  if (along < 0.3) return 0.0;
  float lat = abs(d.x * uCarDir.y - d.y * uCarDir.x);
  float spread = 1.0 + along * 0.3;
  float beam = exp(-(lat * lat) / (spread * spread));
  float fall = smoothstep(0.5, 4.0, along) * (1.0 - smoothstep(10.0, 60.0, along));
  float low = 1.0 - smoothstep(0.5, 2.5 + along * 0.04, p.y);
  return beam * fall * low * 1.4;
}

// Total light for a surface at world position p (multiply albedo by this).
vec3 cityLight(vec3 p) {
  float night = cityNight();
  vec3 lamps = CITY_LAMP * cityLampAt(p.xz) * 2.0 * night;
  vec3 head = vec3(1.0, 0.96, 0.88) * cityHeadlight(p) * night;
  return vec3(cityAmbient()) + lamps + head;
}
`;

/** Uniform objects for city shaders. The shared ones are the same objects as in uniforms.ts, so the atmosphere drives them. */
export function cityUniforms(extra: Record<string, THREE.IUniform> = {}): Record<string, THREE.IUniform> {
  return { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared, ...extra };
}

/**
 * A ShaderMaterial wired for the city: scene fog, tone mapping and colour space apply.
 * Vertex shader must set vWorld (vec3) and mvPosition (vec4) and include <fog_vertex>.
 * Fragment shader must end with the CITY_FRAG_END chunk after writing gl_FragColor.
 */
export function cityShaderMaterial(p: THREE.ShaderMaterialParameters & { uniforms?: Record<string, THREE.IUniform> }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ ...p, uniforms: cityUniforms(p.uniforms), fog: true });
}

export const CITY_VERT_PARS = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
`;
export const CITY_FRAG_PARS = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_fragment>
${CITY_LIGHT_PARS}
`;
export const CITY_FRAG_END = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
`;

/**
 * Adds streetlight + headlight light to a built-in lit material (Lambert/Standard) as emissive,
 * so walls, trees and parked cars brighten under lamps at night. Day lighting still comes from the
 * atmosphere's hemisphere/sun lights. `extraFragment` runs after (can read vCityWorld, diffuseColor, vUv).
 */
export function withCityLight<T extends THREE.Material>(mat: T, opts: { strength?: number; extraPars?: string; extraFragment?: string; key?: string } = {}): T {
  const strength = (opts.strength ?? 0.6).toFixed(3);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCityWorld;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
  {
    vec4 cw = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      cw = instanceMatrix * cw;
    #endif
    vCityWorld = (modelMatrix * cw).xyz;
  }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCityWorld;\n${CITY_LIGHT_PARS}\n${opts.extraPars ?? ''}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  {
    float night = cityNight();
    totalEmissiveRadiance += diffuseColor.rgb * (CITY_LAMP * cityLampAt(vCityWorld.xz) * night + vec3(cityHeadlight(vCityWorld)) * night) * ${strength};
  }
  ${opts.extraFragment ?? ''}`,
      );
  };
  // Different patches must not share a compiled program.
  mat.customProgramCacheKey = () => `city-light-${strength}-${opts.key ?? ''}`;
  return mat;
}

/** Dispose every geometry and material under an object. Textures from the TextureSet are shared, so they're left alone. */
export function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) mat.dispose();
  });
}
