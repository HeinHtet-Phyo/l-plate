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

  /** Ground height of the photogrammetry under a few points along the road near the car. */
  function probe(s: Session): number | null {
    const car = s.world.car;
    const hs: number[] = [];
    for (const d of [0, 6, 12, -6]) {
      const h = car.heading * DEG;
      const x = car.x + Math.sin(h) * d;
      const z = car.z - Math.cos(h) * d;
      ray.set(new THREE.Vector3(x, 2000, z), down);
      ray.far = 4000;
      const hit = ray.intersectObject(tiles.group, true)[0];
      if (hit) hs.push(hit.point.y);
    }
    if (hs.length < 2) return null;
    hs.sort((a, b) => a - b);
    return hs[Math.floor(hs.length / 2)];
  }

  return {
    object: root,
    update(s, camera, gl, city) {
      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, gl);
      camera.updateMatrixWorld();
      root.updateMatrixWorld(true);
      tiles.update();
      // Align the tiles' ground to our road plane (y = 0) once tiles under the car have loaded,
      // then refine slowly as the car moves (the photogrammetry ground isn't perfectly flat).
      if (s.time - lastProbe > (aligned ? 3 : 0.5) && loaded > 0) {
        lastProbe = s.time;
        const g = probe(s);
        if (g != null) {
          const target = offset - g - SINK;
          offset = aligned ? offset + (target - offset) * 0.3 : target;
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
      return a.length ? `Google · ${a.join('; ')}` : 'Google';
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
