// Google Photorealistic 3D Tiles for everything but the road (opt-in via VITE_GOOGLE_MAPS_BROWSER_KEY,
// ?tiles=0 turns it off). Our OSM road surface, markings, signals, cars and physics stay on top;
// the city's own buildings, trees and land cover are hidden while the tiles are showing.
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin, ReorientationPlugin, TilesFadePlugin } from '3d-tiles-renderer/plugins';
import type { Session } from '../sim/session.ts';

const DEG = Math.PI / 180;
/** Tiles sit this far below our road plane, so bumpy photogrammetry ground never covers the road. */
const SINK = 0.6;
/** City pieces that the photogrammetry replaces. */
const HIDE = ['city-buildings', 'tree-trunks', 'tree-canopies', 'surface-skirt'];

export interface GoogleTiles {
  object: THREE.Object3D;
  update(s: Session, camera: THREE.PerspectiveCamera, gl: THREE.WebGLRenderer, city: THREE.Object3D): void;
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
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true }));
  tiles.registerPlugin(new ReorientationPlugin({ lat: s.ex.origin.lat * DEG, lon: s.ex.origin.lng * DEG, height: 0, up: '+y', recenter: true }));
  tiles.registerPlugin(new TilesFadePlugin());
  // Lower = sharper. Street level needs the detailed tiles; Goodmayes is small enough to afford it.
  tiles.errorTarget = 6;
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
    update(s, camera, gl, city) {
      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, gl);
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
      tiles.dispose();
    },
  };
}
