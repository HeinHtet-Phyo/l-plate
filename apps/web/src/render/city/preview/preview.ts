// Dev-only city preview: http://localhost:5173/src/render/city/preview/index.html
// Renders createCity() on its own with stand-in lights (the real ones come from the atmosphere part).
//
// Query params:
//   area=goodmayes            OSM extract id (apps/web/public/osm/<id>.json)
//   preset=sunny              sunny | cloudy | rain | fog | night | night-rain
//   cam=eye                   eye (driver's view) | aerial (behind and above) | top (straight down)
//   x=&z=&h=                  override camera position (local metres) and heading (degrees)
//   back=40&up=25             aerial offset;  pitch=-4  eye pitch in degrees;  t=0  sim time (s) for signals
//   fly=1                     WASD/arrow keys move, drag to look (for humans)
//   only=surface,markings     show only these city parts;  animate=1  run the signal clock
import * as THREE from 'three';
import type { TestRoute } from '@lplate/shared';
import { Session } from '../../../sim/session.ts';
import { loadExtract } from '../../../sim/osm.ts';
import { PRESETS, presetConditions, type PresetId } from '../../../sim/conditions.ts';
import { makeTextures } from '../../textures.ts';
import { shared } from '../../atmosphere/uniforms.ts';
import { createCity } from '../index.ts';
import routes from '../../../routes/test-routes.json';
import freeStarts from '../../../routes/free-starts.json';

declare global {
  interface Window {
    __ready?: boolean;
    __error?: string;
    __stats?: Record<string, number | string>;
    __city?: unknown;
  }
}

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const info = document.getElementById('info')!;
const log = (m: string) => {
  info.textContent = m;
  console.info(`[preview] ${m}`);
};

async function main() {
  const area = q.get('area') ?? 'goodmayes';
  const preset = (q.get('preset') ?? 'sunny') as PresetId;
  if (!(preset in PRESETS)) throw new Error(`unknown preset ${preset}`);
  const conditions = presetConditions(preset);
  log(`loading ${area}…`);
  const extract = await loadExtract(area);
  const route = (routes as unknown as TestRoute[]).find((r) => r.id === area);
  const free = (freeStarts as { id: string; lat: number; lng: number; heading: number }[]).find((f) => f.id === area);
  const start = route?.start ?? (free ? { lat: free.lat, lng: free.lng, heading: free.heading } : { lat: extract.origin.lat, lng: extract.origin.lng, heading: 0 });

  const s = new Session({
    kind: 'free', id: area, name: area, extract, start, conditions,
    voice: false, instructor: false, instructorAvailable: false, host: null,
  });
  const t0 = performance.now();
  await s.build(log);
  const simMs = performance.now() - t0;
  s.world.time = num('t', 0);

  const gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  gl.setPixelRatio(Math.min(2, devicePixelRatio));
  gl.setSize(innerWidth, innerHeight);
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  const day = conditions.daylight;
  gl.toneMappingExposure = 0.85 + 0.2 * day;
  document.body.appendChild(gl.domElement);

  // Stand-in atmosphere: the real one (Aryaan) drives these uniforms, fog and lights.
  shared.uDay.value = day;
  shared.uOvercast.value = conditions.cloud;
  shared.uRain.value = conditions.rain;
  const sky = new THREE.Color(0x0b1020).lerp(new THREE.Color(conditions.cloud > 0.7 ? 0x9aa3ad : 0x8fb8e6), day);
  shared.uSkyColour.value.copy(sky);
  const scene = new THREE.Scene();
  scene.background = sky;
  scene.fog = new THREE.FogExp2(sky.getHex(), 0.0009 + conditions.fog * 0.02);
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x6b6151, 0.25 + 1.1 * day * (1 - 0.35 * conditions.cloud)));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.2 * day * (1 - 0.7 * conditions.cloud));
  const el = Math.max(5, conditions.sunElevation) * THREE.MathUtils.DEG2RAD;
  const az = conditions.sunAzimuth * THREE.MathUtils.DEG2RAD;
  sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(100);
  scene.add(sun);

  log('building city…');
  const tex = makeTextures(gl.capabilities.getMaxAnisotropy());
  const t1 = performance.now();
  const city = createCity(s, tex);
  const cityMs = performance.now() - t1;
  scene.add(city.object);
  const only = q.get('only')?.split(',');
  if (only) for (const c of city.object.children) c.visible = only.some((n) => c.name === `city-${n}`);

  const car = s.world.car;
  const vfov = (h: number) => (2 * Math.atan(Math.tan((h * THREE.MathUtils.DEG2RAD) / 2) / (innerWidth / innerHeight)) * 180) / Math.PI;
  const cam = new THREE.PerspectiveCamera(vfov(100), innerWidth / innerHeight, 0.1, 4000);
  cam.rotation.order = 'YXZ';
  const mode = q.get('cam') ?? 'eye';
  const px = num('x', car.x);
  const pz = num('z', car.z);
  let heading = num('h', car.heading);
  let pitch = num('pitch', -4) * THREE.MathUtils.DEG2RAD;
  const place = () => {
    const hr = heading * THREE.MathUtils.DEG2RAD;
    const fx = Math.sin(hr);
    const fz = -Math.cos(hr);
    if (mode === 'aerial') {
      const back = num('back', 40);
      cam.fov = 60;
      cam.position.set(px - fx * back, num('up', 25), pz - fz * back);
      cam.lookAt(px + fx * 20, 0, pz + fz * 20);
    } else if (mode === 'top') {
      cam.fov = 60;
      cam.position.set(px, num('up', 300), pz);
      cam.rotation.set(-Math.PI / 2, 0, 0);
    } else {
      cam.position.set(cam.position.x || px, 1.2, cam.position.z || pz);
      cam.rotation.set(pitch, -hr, 0);
    }
    cam.updateProjectionMatrix();
  };
  place();

  // Optional fly controls for humans.
  const keys = new Set<string>();
  if (q.get('fly')) {
    addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
    addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
    let drag: [number, number] | null = null;
    addEventListener('pointerdown', (e) => (drag = [e.clientX, e.clientY]));
    addEventListener('pointerup', () => (drag = null));
    addEventListener('pointermove', (e) => {
      if (!drag) return;
      heading += (e.clientX - drag[0]) * 0.2;
      pitch = THREE.MathUtils.clamp(pitch - (e.clientY - drag[1]) * 0.003, -1.4, 1.4);
      drag = [e.clientX, e.clientY];
    });
  }

  addEventListener('resize', () => {
    gl.setSize(innerWidth, innerHeight);
    cam.aspect = innerWidth / innerHeight;
    if (mode === 'eye') cam.fov = vfov(100);
    cam.updateProjectionMatrix();
  });

  let last = performance.now();
  let frames = 0;
  let fpsT = last;
  let fps = 0;
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (keys.size) {
      const sp = (keys.has('shift') ? 40 : 12) * dt;
      const hr = heading * THREE.MathUtils.DEG2RAD;
      const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      const r = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      cam.position.x += (Math.sin(hr) * f + Math.cos(hr) * r) * sp;
      cam.position.z += (-Math.cos(hr) * f + Math.sin(hr) * r) * sp;
    }
    if (mode === 'eye') cam.rotation.set(pitch, -heading * THREE.MathUtils.DEG2RAD, 0);
    if (q.get('animate')) s.world.time += dt;
    shared.uTime.value += dt;
    city.update(s, dt);
    gl.render(scene, cam);
    frames++;
    if (now - fpsT > 1000) {
      fps = (frames * 1000) / (now - fpsT);
      frames = 0;
      fpsT = now;
    }
    const r = gl.info.render;
    window.__stats = {
      area, preset, simBuildMs: Math.round(simMs), cityBuildMs: Math.round(cityMs), calls: r.calls, triangles: r.triangles,
      buildings: s.buildings.length, parked: s.parked.length, trees: s.trees.length, lamps: s.lamps.length,
      stopLines: s.signals.lines.length, zebras: s.signals.zebras.length, fps: Math.round(fps),
      cam: `${cam.position.x.toFixed(1)},${cam.position.z.toFixed(1)} h${heading.toFixed(0)}`,
    };
    info.textContent = Object.entries(window.__stats).map(([k, v]) => `${k}: ${v}`).join('\n');
    if (!window.__ready && frames >= 3) window.__ready = true;
    requestAnimationFrame(loop);
  };
  window.__city = { s, city, scene, cam, gl };
  loop();
}

main().catch((e) => {
  window.__error = String(e?.stack ?? e);
  log(`ERROR: ${e}`);
  console.error(e);
});
