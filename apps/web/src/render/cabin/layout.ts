// Shared cabin layout. Every cabin module builds against these numbers so the pieces line up.
//
// Frame: eye-relative metres. The driver's eye is the origin, +x is right, +y is up, −z is forward
// (the way the car points). It's a right-hand-drive car, so the eye sits 0.37 m right of the car's
// centre line (VEHICLE.eyeRight): the centre line is x = −0.37. The cabin is drawn in a second pass
// with near = 0.02 after the world, and the windows are left empty so the world shows through.
import type * as THREE from 'three';
import type { Session } from '../../sim/session.ts';

/** One piece of the cabin: geometry added to the cabin scene, updated every frame. */
export interface CabinModule {
  object: THREE.Object3D;
  update(s: Session, dt: number): void;
  dispose(): void;
}

/** The mirrors also need the world camera, to place their own cameras, and their own render pass. */
export interface MirrorModule {
  object: THREE.Object3D;
  update(s: Session, dt: number, worldCam: THREE.Camera): void;
  /** Render at most one mirror per call (round robin on `frame`) into its target. */
  render(gl: THREE.WebGLRenderer, world: THREE.Scene, frame: number): void;
  dispose(): void;
}

export const CENTRE_X = -0.37;

/** Inner cabin width runs from the passenger door to the driver's door. */
export const CABIN = { left: -1.07, right: 0.33, floor: -0.75, roof: 0.42 };

/** Windscreen glass: a raked quad. Bottom edge at the dashboard, top edge at the roof. */
export const WINDSCREEN = {
  bottom: { y: -0.2, z: -0.88 },
  top: { y: 0.36, z: -0.42 },
  left: -1.02,
  right: 0.28,
};

/** Dashboard top surface, from the windscreen base back towards the driver. */
export const DASH = { front: -0.88, back: -0.5, top: -0.2, lip: -0.26 };

/** Bonnet seen through the lower windscreen: slopes down and away. */
export const BONNET = { near: { y: -0.3, z: -0.92 }, far: { y: -0.42, z: -2.3 }, left: -1.2, right: 0.46 };

/** Steering wheel: centre, rim radius, and tilt back from vertical (radians). */
export const WHEEL = { x: 0, y: -0.36, z: -0.46, radius: 0.185, tube: 0.016, tilt: 0.42 };

/** Instrument cluster behind the wheel, under a binnacle hood. Canvas 512 × 192. */
export const CLUSTER = { x: 0, y: -0.25, z: -0.66, w: 0.32, h: 0.12, tilt: 0.25, canvas: [512, 192] as const };

/** Sat nav screen, centre of the dash, angled slightly towards the driver. Canvas 768 × 360. */
export const SATNAV = { x: -0.5, y: -0.14, z: -0.66, w: 0.29, h: 0.136, tilt: 0.12, yaw: 0.22, canvas: [768, 360] as const };

/**
 * Mirrors: glass position and size in the cabin, plus where their camera sits and looks.
 * `look` is the yaw of the mirror camera from straight back (positive turns towards +x), and
 * `fov` is the camera's vertical FOV in degrees.
 */
export const MIRRORS = {
  rear: { glass: { x: CENTRE_X, y: 0.24, z: -0.5, w: 0.25, h: 0.075 }, cam: { x: CENTRE_X, y: 0.05, z: 0.3 }, look: 0, fov: 18 },
  right: { glass: { x: 0.6, y: -0.13, z: -0.74, w: 0.17, h: 0.105 }, cam: { x: 0.6, y: -0.13, z: -0.74 }, look: 0.18, fov: 22 },
  left: { glass: { x: -1.38, y: -0.12, z: -0.62, w: 0.17, h: 0.105 }, cam: { x: -1.38, y: -0.12, z: -0.62 }, look: -0.18, fov: 22 },
};

/** Two wipers, pivots under the windscreen base, sweeping every 1.4 s while it rains. */
export const WIPERS = { pivots: [-0.95, -0.35] as const, length: 0.55, period: 1.4, sweep: 1.75 };

/** Palette for the interior: dark plastics, so the world stays the focus. */
export const COLOURS = { dash: 0x1b1d21, trim: 0x25282d, roof: 0x8a8780, pillar: 0x2a2c30, wheel: 0x151618, bonnet: 0x8e1b1b };
