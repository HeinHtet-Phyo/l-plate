// Rear-view and door mirrors: each has its own camera rendering the world into a half-float target,
// shown flipped on a glass plane in the cabin. Only one mirror re-renders per frame (round robin).
import * as THREE from 'three';
import type { Session } from '../../sim/session.ts';
import { CABIN, COLOURS, MIRRORS, type MirrorModule } from './layout.ts';

const TARGET_WIDTH = 512;

interface Mirror {
  camera: THREE.PerspectiveCamera;
  target: THREE.WebGLRenderTarget | null;
  /** Mirror camera pose in the eye frame: position, then yaw to look backwards. */
  local: THREE.Matrix4;
}

export function createMirrors(_s: Session): MirrorModule {
  const enabled = new URLSearchParams(location.search).get('mirrors') !== '0';
  const object = new THREE.Group();
  object.name = 'mirrors';

  const housingMat = new THREE.MeshStandardMaterial({ color: COLOURS.trim, roughness: 0.6 });
  const darkGlass = new THREE.MeshBasicMaterial({ color: 0x0c0e11 });
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [housingMat, darkGlass];
  const mirrors: Mirror[] = [];

  for (const m of [MIRRORS.rear, MIRRORS.right, MIRRORS.left]) {
    const { glass, cam, look, fov } = m;
    const aspect = glass.w / glass.h;

    let target: THREE.WebGLRenderTarget | null = null;
    let glassMat: THREE.Material = darkGlass;
    if (enabled) {
      target = new THREE.WebGLRenderTarget(TARGET_WIDTH, Math.round(TARGET_WIDTH / aspect), {
        type: THREE.HalfFloatType,
        samples: 4,
        depthBuffer: true,
      });
      const tex = target.texture;
      // Mirror flip: u' = 1 − u.
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.repeat.set(-1, 1);
      tex.offset.set(1, 0);
      // The world goes into the half-float target untone-mapped (three only tone maps the screen
      // pass), so let the cabin pass tone map the glass to match the windscreen view.
      glassMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: true });
      materials.push(glassMat);
    }

    // Glass faces the eye; the housing is a shallow box behind it.
    const unit = new THREE.Group();
    unit.position.set(glass.x, glass.y, glass.z);
    unit.lookAt(0, 0, 0);
    const glassGeo = new THREE.PlaneGeometry(glass.w, glass.h);
    const housingGeo = new THREE.BoxGeometry(glass.w + 0.02, glass.h + 0.02, 0.04);
    geometries.push(glassGeo, housingGeo);
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.position.z = 0.002;
    const housing = new THREE.Mesh(housingGeo, housingMat);
    housing.position.z = -0.021;
    unit.add(housing, glassMesh);
    object.add(unit);

    if (m === MIRRORS.rear) {
      // Stem up to the roof lining.
      const len = Math.max(0.02, CABIN.roof - glass.y);
      const stemGeo = new THREE.CylinderGeometry(0.008, 0.008, len, 8);
      geometries.push(stemGeo);
      const stem = new THREE.Mesh(stemGeo, housingMat);
      stem.position.set(glass.x, glass.y + len / 2, glass.z - 0.02);
      object.add(stem);
    }

    const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1500);
    // Yaw π looks backwards; positive `look` turns towards +x.
    const local = new THREE.Matrix4()
      .makeTranslation(cam.x, cam.y, cam.z)
      .multiply(new THREE.Matrix4().makeRotationY(Math.PI + look));
    mirrors.push({ camera, target, local });
  }

  const world = new THREE.Matrix4();
  const scale = new THREE.Vector3();

  return {
    object,
    update(_s, _dt, worldCam) {
      if (!enabled) return;
      worldCam.updateMatrixWorld();
      const far = worldCam instanceof THREE.PerspectiveCamera ? worldCam.far : 1500;
      for (const m of mirrors) {
        world.multiplyMatrices(worldCam.matrixWorld, m.local);
        world.decompose(m.camera.position, m.camera.quaternion, scale);
        if (m.camera.far !== far) {
          m.camera.far = far;
          m.camera.updateProjectionMatrix();
        }
      }
    },
    render(gl, scene, frame) {
      if (!enabled) return;
      const m = mirrors[((frame % mirrors.length) + mirrors.length) % mirrors.length];
      if (!m.target) return;
      const prevTarget = gl.getRenderTarget();
      const prevAutoClear = gl.autoClear;
      const prevXr = gl.xr.enabled;
      gl.xr.enabled = false;
      gl.autoClear = false;
      gl.setRenderTarget(m.target);
      gl.clear();
      gl.render(scene, m.camera);
      gl.setRenderTarget(prevTarget);
      gl.autoClear = prevAutoClear;
      gl.xr.enabled = prevXr;
    },
    dispose() {
      for (const m of mirrors) m.target?.dispose();
      for (const g of geometries) g.dispose();
      for (const mat of materials) mat.dispose();
    },
  };
}
