// AI-traffic meshes (TEAM-PLAN.md §4): instanced bodies, glass and wheels for up to 130 cars
// from s.traffic.cars. Brake lights on when braking; headlights/tail lights glow at night.
import * as THREE from 'three';
import type { Session } from '../../sim/session.ts';
import type { RenderPart } from '../types.ts';
import { headingVec, rightOf } from '../../sim/geo.ts';

const MAX_CARS = 130;
const BODY_W = 1.8;
const BODY_H = 1.1;
const BODY_LEN = 4.2;
const BODY_Y = 0.62;
const GLASS_W = 1.5;
const GLASS_H = 0.5;
const GLASS_LEN = 2.0;
const GLASS_Y = 1.22;
const WHEEL_R = 0.33;
const WHEEL_W = 0.22;
const WHEEL_Y = WHEEL_R;
const WHEEL_OFFSETS: Array<[number, number]> = [
  [1.35, 0.78],
  [1.35, -0.78],
  [-1.35, 0.78],
  [-1.35, -0.78],
];
const HEAD_FWD = 2.05;
const HEAD_SIDE = 0.6;
const HEAD_Y = 0.6;
const TAIL_FWD = -2.05;

export function createTraffic(s: Session): RenderPart {
  const group = new THREE.Group();
  group.name = 'traffic';

  const bodyGeom = new THREE.BoxGeometry(BODY_W, BODY_H, BODY_LEN);
  const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.35 });
  const body = new THREE.InstancedMesh(bodyGeom, bodyMat, MAX_CARS);
  body.frustumCulled = false;
  group.add(body);

  const glassGeom = new THREE.BoxGeometry(GLASS_W, GLASS_H, GLASS_LEN);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0b1520, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.75 });
  const glass = new THREE.InstancedMesh(glassGeom, glassMat, MAX_CARS);
  glass.frustumCulled = false;
  group.add(glass);

  const wheelGeom = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 12);
  wheelGeom.rotateZ(Math.PI / 2); // roll axis along local X (= the car's right vector)
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 });
  const wheels = new THREE.InstancedMesh(wheelGeom, wheelMat, MAX_CARS * 4);
  wheels.frustumCulled = false;
  group.add(wheels);

  const headGeom = new THREE.BoxGeometry(0.22, 0.14, 0.08);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const headlights = new THREE.InstancedMesh(headGeom, headMat, MAX_CARS * 2);
  headlights.frustumCulled = false;
  group.add(headlights);

  const tailGeom = new THREE.BoxGeometry(0.22, 0.14, 0.08);
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const taillights = new THREE.InstancedMesh(tailGeom, tailMat, MAX_CARS * 2);
  taillights.frustumCulled = false;
  group.add(taillights);

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const right3 = new THREE.Vector3();
  const fwd3 = new THREE.Vector3();
  const up3 = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();

  function setBasis(mat: THREE.Matrix4, cx: number, cz: number, dx: number, dz: number, rx: number, rz: number, fOff: number, sOff: number, yOff: number) {
    pos.set(cx + rx * sOff + dx * fOff, yOff, cz + rz * sOff + dz * fOff);
    right3.set(rx, 0, rz);
    fwd3.set(dx, 0, dz);
    mat.makeBasis(right3, up3, fwd3);
    mat.setPosition(pos);
  }

  function update(session: Session) {
    const cars = session.traffic.cars;
    const night = THREE.MathUtils.clamp(1 - session.conditions.daylight, 0, 1);
    const n = Math.min(cars.length, MAX_CARS);
    body.count = n;
    glass.count = n;
    wheels.count = n * 4;
    headlights.count = n * 2;
    taillights.count = n * 2;

    const headBrightness = 0.1 + 0.9 * night;
    const tailIdle = 0.15 + 0.6 * night;

    for (let i = 0; i < n; i++) {
      const c = cars[i];
      const [dx, dz] = headingVec(c.rh);
      const [rx, rz] = rightOf(dx, dz);

      setBasis(m, c.rx, c.rz, dx, dz, rx, rz, 0, 0, BODY_Y);
      body.setMatrixAt(i, m);
      colour.setHex(c.colour);
      body.setColorAt(i, colour);

      setBasis(m, c.rx, c.rz, dx, dz, rx, rz, 0.15, 0, GLASS_Y);
      glass.setMatrixAt(i, m);

      for (let w = 0; w < 4; w++) {
        const [fOff, sOff] = WHEEL_OFFSETS[w];
        setBasis(m, c.rx, c.rz, dx, dz, rx, rz, fOff, sOff, WHEEL_Y);
        wheels.setMatrixAt(i * 4 + w, m);
      }

      setBasis(m, c.rx, c.rz, dx, dz, rx, rz, HEAD_FWD, HEAD_SIDE, HEAD_Y);
      headlights.setMatrixAt(i * 2, m);
      setBasis(m, c.rx, c.rz, dx, dz, rx, rz, HEAD_FWD, -HEAD_SIDE, HEAD_Y);
      headlights.setMatrixAt(i * 2 + 1, m);
      colour.setScalar(headBrightness);
      headlights.setColorAt(i * 2, colour);
      headlights.setColorAt(i * 2 + 1, colour);

      const tailBrightness = c.braking ? 1 : tailIdle;
      colour.setRGB(tailBrightness, tailBrightness * 0.08, tailBrightness * 0.08);
      setBasis(m, c.rx, c.rz, dx, dz, rx, rz, TAIL_FWD, HEAD_SIDE, HEAD_Y);
      taillights.setMatrixAt(i * 2, m);
      taillights.setColorAt(i * 2, colour);
      setBasis(m, c.rx, c.rz, dx, dz, rx, rz, TAIL_FWD, -HEAD_SIDE, HEAD_Y);
      taillights.setMatrixAt(i * 2 + 1, m);
      taillights.setColorAt(i * 2 + 1, colour);
    }

    body.instanceMatrix.needsUpdate = true;
    glass.instanceMatrix.needsUpdate = true;
    wheels.instanceMatrix.needsUpdate = true;
    headlights.instanceMatrix.needsUpdate = true;
    taillights.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    if (headlights.instanceColor) headlights.instanceColor.needsUpdate = true;
    if (taillights.instanceColor) taillights.instanceColor.needsUpdate = true;
  }

  function dispose() {
    bodyGeom.dispose();
    bodyMat.dispose();
    glassGeom.dispose();
    glassMat.dispose();
    wheelGeom.dispose();
    wheelMat.dispose();
    headGeom.dispose();
    headMat.dispose();
    tailGeom.dispose();
    tailMat.dispose();
  }

  return { object: group, update, dispose };
}
