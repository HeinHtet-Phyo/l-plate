// Sky, lights, weather, night, rain (TEAM-PLAN.md §4). Drives the `shared` uniforms that Min's
// city shaders read, sets scene fog and tone mapping, and refreshes live weather.
import * as THREE from 'three';
import type { Session } from '../../sim/session.ts';
import type { RenderPart } from '../types.ts';
import { headingVec } from '../../sim/geo.ts';
import { fetchOpenMeteo, visibilityFromFog } from '../../sim/conditions.ts';
import { shared } from './uniforms.ts';

const NIGHT = new THREE.Color(0x030308);
const DAY_ZENITH = new THREE.Color(0x4c86d6);
const DAY_HORIZON = new THREE.Color(0xcfe3f5);
const SUNSET = new THREE.Color(0xff8a4c);
const OVERCAST_SKY = new THREE.Color(0x8c93a0);

const WEATHER_REFRESH_S = 600; // 10 minutes
const RAIN_COUNT = 7000;
const RAIN_RADIUS = 60;
const RAIN_HEIGHT = 30;
const RAIN_FALL_SPEED = 14;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uNight;
uniform vec3 uSunColour;
uniform vec3 uSunDir;
uniform float uDay;
uniform float uStars;
varying vec3 vDir;

float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(h, 0.55));
  sky = mix(uNight, sky, uDay);

  float sunAmt = clamp(dot(dir, uSunDir), 0.0, 1.0);
  sky += uSunColour * pow(sunAmt, 420.0) * 8.0;
  sky += uSunColour * pow(sunAmt, 24.0) * 0.25 * uDay;

  if (dir.y > 0.0) {
    float cell = hash(floor(dir * 400.0));
    float star = step(0.9975, cell) * uStars;
    sky += vec3(star);
  }
  gl_FragColor = vec4(sky, 1.0);
}`;

function sunDirection(elevationDeg: number, azimuthDeg: number): THREE.Vector3 {
  const [dx, dz] = headingVec(azimuthDeg);
  const elev = (elevationDeg * Math.PI) / 180;
  const horiz = Math.cos(elev);
  return new THREE.Vector3(dx * horiz, Math.sin(elev), dz * horiz);
}

export function createAtmosphere(s: Session): RenderPart & { apply(scene: THREE.Scene, gl: THREE.WebGLRenderer): void } {
  const group = new THREE.Group();
  group.name = 'atmosphere';

  // ---- sky dome ----
  const skyUniforms = {
    uZenith: { value: DAY_ZENITH.clone() },
    uHorizon: { value: DAY_HORIZON.clone() },
    uNight: { value: NIGHT.clone() },
    uSunColour: { value: new THREE.Color(0xfff2d8) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uDay: { value: 1 },
    uStars: { value: 0 },
  };
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(1800, 32, 20),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  skyDome.renderOrder = -1000;
  group.add(skyDome);

  // ---- sun disc ----
  const sunMat = new THREE.SpriteMaterial({ color: 0xfff2d8, transparent: true, depthWrite: false, fog: false });
  const sunSprite = new THREE.Sprite(sunMat);
  sunSprite.scale.set(80, 80, 1);
  group.add(sunSprite);

  // ---- lights ----
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  const moon = new THREE.DirectionalLight(0x9fb4d8, 0.3);
  const hemi = new THREE.HemisphereLight(0xbfd4ef, 0x3a3a3a, 1);
  group.add(sun, moon, hemi);

  // ---- rain ----
  const rainPositions = new Float32Array(RAIN_COUNT * 3);
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainPositions[i * 3] = (Math.random() * 2 - 1) * RAIN_RADIUS;
    rainPositions[i * 3 + 1] = Math.random() * RAIN_HEIGHT;
    rainPositions[i * 3 + 2] = (Math.random() * 2 - 1) * RAIN_RADIUS;
  }
  const rainGeom = new THREE.BufferGeometry();
  rainGeom.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rainMat = new THREE.PointsMaterial({
    color: 0xaecbe8,
    size: 0.045,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    sizeAttenuation: true,
  });
  const rain = new THREE.Points(rainGeom, rainMat);
  rain.frustumCulled = false;
  group.add(rain);

  // ---- streetlight map texture (baked once, doesn't change over a session) ----
  const lm = s.lightMap;
  const lampTex = new THREE.DataTexture(lm.data, lm.n, lm.n, THREE.RedFormat, THREE.UnsignedByteType);
  lampTex.unpackAlignment = 1;
  lampTex.wrapS = THREE.ClampToEdgeWrapping;
  lampTex.wrapT = THREE.ClampToEdgeWrapping;
  lampTex.needsUpdate = true;
  shared.uLampMap.value = lampTex;
  const scale = 1 / (lm.n * lm.cell);
  shared.uLampScale.value.set(scale, s.grid.radius * scale);

  // ---- live weather refresh ----
  let weatherTimer = WEATHER_REFRESH_S; // fetch once shortly after start, not on frame 0
  let weatherInFlight = false;
  const { lat, lng } = s.setup.start;
  function refreshWeather() {
    if (weatherInFlight) return;
    weatherInFlight = true;
    fetchOpenMeteo(lat, lng)
      .then((c) => {
        s.conditions.cloud = c.cloud;
        s.conditions.rain = c.rain;
        s.conditions.fog = c.fog;
        s.conditions.temperature = c.temperature;
        s.conditions.description = c.description;
        s.conditions.source = c.source;
        s.conditions.thunder = c.thunder;
      })
      .catch(() => {
        // keep whatever conditions we already had (preset/default); live weather is best-effort
      })
      .finally(() => {
        weatherInFlight = false;
      });
  }

  let clock = 0;

  function update(session: Session, dt: number) {
    clock += dt;
    weatherTimer += dt;
    if (weatherTimer >= WEATHER_REFRESH_S) {
      weatherTimer = 0;
      refreshWeather();
    }

    const c = session.conditions;
    const day = c.daylight;
    const overcast = c.cloud;
    const rainAmt = c.rain;

    const sunDir = sunDirection(c.sunElevation, c.sunAzimuth);
    const sunset = THREE.MathUtils.clamp(1 - Math.abs(c.sunElevation) / 10, 0, 1) * day;

    const zenith = DAY_ZENITH.clone().lerp(OVERCAST_SKY, overcast * 0.7);
    const horizon = DAY_HORIZON.clone().lerp(SUNSET, sunset).lerp(OVERCAST_SKY, overcast * 0.6);
    skyUniforms.uZenith.value.copy(zenith);
    skyUniforms.uHorizon.value.copy(horizon);
    skyUniforms.uDay.value = day;
    skyUniforms.uStars.value = THREE.MathUtils.clamp((1 - day) * (1 - overcast * 0.6), 0, 1);
    const sunColour = new THREE.Color(0xfff2d8).lerp(SUNSET, sunset);
    skyUniforms.uSunColour.value.copy(sunColour);
    skyUniforms.uSunDir.value.copy(sunDir);

    const carX = session.world?.car.x ?? 0;
    const carZ = session.world?.car.z ?? 0;
    group.position.set(carX, 0, carZ);
    sunSprite.position.copy(sunDir).multiplyScalar(1700);
    sunSprite.material.opacity = THREE.MathUtils.clamp(day * 1.5, 0, 1) * (1 - overcast * 0.5);

    sun.position.copy(sunDir).multiplyScalar(400).add(new THREE.Vector3(carX, 0, carZ));
    sun.target.position.set(carX, 0, carZ);
    sun.target.updateMatrixWorld();
    sun.intensity = day * (1 - overcast * 0.7) * 3;
    sun.color.copy(sunColour);

    moon.position.copy(sunDir).multiplyScalar(-400).add(new THREE.Vector3(carX, 0, carZ));
    moon.target.position.set(carX, 0, carZ);
    moon.target.updateMatrixWorld();
    moon.intensity = (1 - day) * 0.35;

    hemi.intensity = 0.5 + 0.5 * day * (1 - overcast * 0.4);
    hemi.color.copy(zenith);

    rain.position.set(carX, 1, carZ);
    rainMat.opacity = THREE.MathUtils.clamp(rainAmt * 1.1, 0, 0.85);
    const pos = rainGeom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < RAIN_COUNT; i++) {
      let y = pos.getY(i) - RAIN_FALL_SPEED * dt;
      if (y < 0) y += RAIN_HEIGHT;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;

    // Shared uniforms Min's city shaders read.
    shared.uDay.value = day;
    shared.uOvercast.value = overcast;
    shared.uRain.value = rainAmt;
    shared.uTime.value = clock;
    shared.uCarPos.value.set(carX, 0, carZ);
    const [dirX, dirZ] = headingVec(session.world?.car.heading ?? 0);
    shared.uCarDir.value.set(dirX, dirZ);
    shared.uSkyColour.value.copy(zenith);
  }

  function apply(scene: THREE.Scene, gl: THREE.WebGLRenderer) {
    const c = s.conditions;
    const visibility = visibilityFromFog(c.fog);
    const fogColour = shared.uSkyColour.value.clone().lerp(new THREE.Color(0xffffff), c.fog * 0.3);
    if (!(scene.fog instanceof THREE.FogExp2)) scene.fog = new THREE.FogExp2(fogColour.getHex(), 1.5 / visibility);
    else {
      scene.fog.color.copy(fogColour);
      (scene.fog as THREE.FogExp2).density = 1.5 / visibility;
    }
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 0.85 + 0.2 * c.daylight;
  }

  function dispose() {
    skyDome.geometry.dispose();
    (skyDome.material as THREE.Material).dispose();
    sunMat.dispose();
    rainGeom.dispose();
    rainMat.dispose();
    lampTex.dispose();
  }

  return { object: group, update, apply, dispose };
}
