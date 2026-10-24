// The car interior: a second render pass in eye-relative coordinates (see layout.ts), drawn over
// the world after a depth clear. The windows are left empty so the world shows through.
import * as THREE from 'three';
import type { Session } from '../../sim/session.ts';
import type { CabinPart } from '../types.ts';
import type { CabinModule } from './layout.ts';
import { createInterior } from './interior.ts';
import { createCluster } from './cluster.ts';
import { createSatNavScreen } from './satnav.ts';
import { createMirrors } from './mirrors.ts';
import { createWindscreenRain } from './rain.ts';

export function createCabin(s: Session): CabinPart {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.02, 10);

  // The cabin has its own lighting: soft daylight through the glass, dimming at night.
  const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x2a2622, 1.2);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(0.4, 1, -0.6);
  scene.add(hemi, sun);

  const parts: CabinModule[] = [createInterior(s), createCluster(s), createSatNavScreen(s), createWindscreenRain(s)];
  const mirrors = createMirrors(s);
  for (const p of parts) scene.add(p.object);
  scene.add(mirrors.object);

  return {
    scene,
    camera,
    update(s, dt, worldCam) {
      // Match the world camera's lens so the cabin lines up with the windscreen view.
      if (worldCam instanceof THREE.PerspectiveCamera && (camera.fov !== worldCam.fov || camera.aspect !== worldCam.aspect)) {
        camera.fov = worldCam.fov;
        camera.aspect = worldCam.aspect;
        camera.updateProjectionMatrix();
      }
      // Body pitch under braking and acceleration tilts the view inside the car too.
      camera.rotation.x = s.pitch;

      const day = s.conditions.daylight;
      hemi.intensity = 0.15 + 1.05 * day * (1 - 0.35 * s.conditions.cloud);
      sun.intensity = 0.8 * day * (1 - 0.6 * s.conditions.cloud);

      for (const p of parts) p.update(s, dt);
      mirrors.update(s, dt, worldCam);
    },
    renderMirrors(gl, world, frame) {
      mirrors.render(gl, world, frame);
    },
    dispose() {
      for (const p of parts) p.dispose();
      mirrors.dispose();
      scene.clear();
    },
  };
}
