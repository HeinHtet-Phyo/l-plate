// Google Photorealistic 3D Tiles for everything but the road (opt-in via VITE_GOOGLE_MAPS_BROWSER_KEY,
// ?tiles=0 turns it off). Our OSM road surface, markings, signals, cars and physics stay on top;
// the city's own buildings, trees and land cover are hidden while the tiles are showing.
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin, ReorientationPlugin } from '3d-tiles-renderer/plugins';
import type { Session } from '../sim/session.ts';
import { createHeightMap } from './terrain.ts';

const DEG = Math.PI / 180;
/** Our world is draped onto the tiles' terrain (terrain.ts), so the tiles' ground near the car sits at y = 0. */
const SINK = 0;
/** City pieces that the photogrammetry replaces. */
const HIDE = ['city-buildings', 'tree-trunks', 'tree-canopies', 'surface-skirt'];

export interface GoogleTiles {
  object: THREE.Object3D;
  update(s: Session, camera: THREE.PerspectiveCamera, gl: THREE.WebGLRenderer, city: THREE.Object3D, scene: THREE.Scene): void;
  /** Smoothed ground height under the car (for the camera). */
  ground(): number;
  credits(): string;
  status(): string;
  dispose(): void;
}

export function createGoogleTiles(s: Session, key: string): GoogleTiles {
  // Their frame has X west and Z north; ours has x east and z south: a half turn about Y.
  const root = new THREE.Group();
  root.name = 'google-3d-tiles';
  root.rotation.y = Math.PI;
  const tiles = new TilesRenderer();
  // Recommended settings would force errorTarget = 20 (coarse); we choose our own detail below.
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true, useRecommendedSettings: false }));
  tiles.registerPlugin(new ReorientationPlugin({ lat: s.ex.origin.lat * DEG, lon: s.ex.origin.lng * DEG, height: 0, up: '+y', recenter: true }));
  // No fade plugin: its dithered fade shows as static in the mirrors.
  // Max quality: lower errorTarget = sharper (2 ≈ the finest tiles Google serves at street level).
  // ?tilesError=N overrides it; big cache and parallel downloads so detail isn't evicted or slow.
  tiles.errorTarget = Number(new URLSearchParams(location.search).get('tilesError') ?? 2);
  tiles.lruCache.minSize = 4000;
  tiles.lruCache.maxSize = 10000;
  tiles.lruCache.maxBytesSize = 1.5e9;
  tiles.downloadQueue.maxJobsPerOrigin = 32;
  tiles.parseQueue.maxJobs = 8;
  root.add(tiles.group);

  let aligned = false;
  let offset = 0;
  let lastProbe = -Infinity;
  let error = '';
  let loaded = 0;
  tiles.addEventListener('load-error', (e: { error?: Error }) => {
    error = e.error?.message ?? 'load error';
  });
  tiles.addEventListener('load-model', () => {
    loaded++;
  });

  const heights = createHeightMap();
  // A coarse rear-facing camera so the street behind the car is loaded for the mirrors.
  const rearCam = new THREE.PerspectiveCamera(100, 16 / 9, 0.5, 3000);
  let rearRegistered = false;
  let lastHeights = -Infinity;
  let ground = 0;
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);

  /**
   * Ground height of the photogrammetry around the car: a 3×3 grid on the road, taking the LOWEST
   * hit, because rays from above often land on tree canopies or Google's baked-in parked cars.
   */
  function probe(s: Session): number | null {
    const car = s.world.car;
    const [cx, cz] = car.centre();
    const h = car.heading * DEG;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    let low = Infinity;
    let hits = 0;
    for (const d of [-4, 0, 4]) {
      for (const l of [-1.5, 0, 1.5]) {
        ray.set(new THREE.Vector3(cx + fx * d - fz * l, 2000, cz + fz * d + fx * l), down);
        ray.far = 4000;
        const hit = ray.intersectObject(tiles.group, true)[0];
        if (hit) {
          hits++;
          low = Math.min(low, hit.point.y);
        }
      }
    }
    return hits >= 3 ? low : null;
  }

  return {
    object: root,
    update(s, camera, gl, city, scene) {
      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, gl);
      rearCam.position.copy(camera.position);
      rearCam.rotation.set(0, camera.rotation.y + Math.PI, 0, 'YXZ');
      rearCam.updateMatrixWorld();
      if (!rearRegistered) {
        tiles.setCamera(rearCam);
        tiles.setResolution(rearCam, 960, 540);
        rearRegistered = true;
      }
      camera.updateMatrixWorld();
      root.updateMatrixWorld(true);
      tiles.update();
      // Align the tiles' ground to our road plane (y = 0) once detailed tiles under the car have
      // loaded, then allow only small corrections (≤ 0.3 m each, ignoring readings > 3 m off).
      const ready = loaded > 60 || s.time > 8;
      if (ready && s.time - lastProbe > (aligned ? 2 : 0.5)) {
        lastProbe = s.time;
        const g = probe(s);
        if (g != null) {
          const target = offset - g - SINK;
          if (!aligned) offset = target;
          else if (Math.abs(target - offset) <= 3) offset += THREE.MathUtils.clamp(target - offset, -0.3, 0.3);
          root.position.y = offset;
          aligned = true;
        }
      }
      root.visible = aligned;
      heights.setEnabled(aligned);
      if (aligned && s.time - lastHeights > 0.6) {
        lastHeights = s.time;
        const [cx, cz] = s.world.car.centre();
        heights.update(gl, scene, root, cx, cz);
        const g = heights.groundAt(gl, cx, cz);
        ground += (g - ground) * 0.5;
      }
      // Hide what the photogrammetry replaces (city updates may toggle visibility, so do it every frame).
      for (const name of HIDE) {
        const o = city.getObjectByName(name);
        if (o) o.visible = !aligned;
      }
      city.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (m && m.name === 'city-surface' && m.uniforms?.uRoadOnly) m.uniforms.uRoadOnly.value = aligned ? 1 : 0;
      });
    },
    ground() {
      return aligned ? ground : 0;
    },
    credits() {
      if (!aligned) return '';
      const a = tiles.getAttributions().filter((x) => x.type === 'string').map((x) => String(x.value));
      const rest = [...new Set(a.flatMap((x) => x.split(/[;,]\s*/)))].filter((x) => x && x !== 'Google');
      return rest.length ? `Google · ${rest.join(', ')}` : 'Google';
    },
    status() {
      if (error) return `error: ${error.slice(0, 80)}`;
      return aligned ? `on (${loaded} tiles)` : `loading (${loaded} tiles)`;
    },
    dispose() {
      heights.dispose();
      tiles.dispose();
    },
  };
}
