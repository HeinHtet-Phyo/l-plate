// Automatic hatchback as a kinematic bicycle model. Pose is the driver's eye point.
import { DEG, clamp, headingVec } from './geo.ts';

export const VEHICLE = {
  wheelbase: 2.6,
  maxWheelAngle: 35,
  steeringRatio: 13.5,
  maxAccel: 3.2,
  maxBrake: 8.5,
  handbrake: 4,
  rolling: 0.25,
  drag: 0.00045,
  engineBraking: 0.6,
  creepSpeed: 1.6,
  creepAccel: 0.9,
  /** Eye is 0.37 m right of the centre line, 1.2 m up. */
  eyeRight: 0.37,
  eyeHeight: 1.2,
  frontAxle: 1.15,
  rearAxle: 1.45,
  halfTrack: 0.75,
  /** Footprint measured from the eye. */
  front: 2.0,
  rear: 2.1,
  left: 0.9 + 0.37,
  right: 0.9 - 0.37,
};

export interface Controls {
  steer: number; // −1…1 (right positive)
  throttle: number; // 0…1
  brake: number; // 0…1
}

export class Vehicle {
  /** Eye position. */
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  handbrake = true;
  /** Smoothed steering −1…1. */
  steer = 0;
  accel = 0;

  /** Car centre from eye. */
  centre(): [number, number] {
    const [dx, dz] = headingVec(this.heading);
    // right of (dx,dz) is (−dz, dx); centre is 0.37 m left of the eye
    return [this.x + dz * VEHICLE.eyeRight, this.z - dx * VEHICLE.eyeRight];
  }

  /** Road-wheel angle in degrees for the current steering. */
  wheelAngle(): number {
    return this.steer * VEHICLE.maxWheelAngle;
  }

  /** Steering-wheel rotation in degrees (≈ 1.3 turns centre to lock). */
  steeringWheelAngle(): number {
    return this.wheelAngle() * VEHICLE.steeringRatio;
  }

  /** Longitudinal acceleration for controls; never pushes the car backwards. */
  longitudinal(c: Controls): number {
    const v = this.speed;
    let a = 0;
    if (!this.handbrake && c.throttle > 0) a += VEHICLE.maxAccel * c.throttle * Math.max(0, 1 - v / 50);
    let resist = VEHICLE.rolling + VEHICLE.drag * v * v + c.brake * VEHICLE.maxBrake;
    if (c.throttle <= 0) resist += VEHICLE.engineBraking;
    if (this.handbrake) resist += VEHICLE.handbrake;
    // Idle creep: forward up to 1.6 m/s when nothing is pressed and the handbrake is off.
    if (!this.handbrake && c.throttle <= 0 && c.brake <= 0 && v < VEHICLE.creepSpeed) {
      return VEHICLE.creepAccel;
    }
    if (v <= 0.001 && a <= resist) return 0;
    return a - resist;
  }

  /** Advance the pose; returns the proposed new eye position and heading (not applied). */
  propose(c: Controls, dt: number): { x: number; z: number; heading: number; speed: number } {
    const a = this.longitudinal(c);
    let v = this.speed + a * dt;
    if (v < 0) v = 0; // no reverse; resistance never pushes backwards
    this.accel = (v - this.speed) / dt;
    const vm = (this.speed + v) / 2;
    const delta = this.wheelAngle() * DEG;
    const yawRate = (vm / VEHICLE.wheelbase) * Math.tan(delta);
    const h = this.heading + (yawRate * dt) / DEG;
    // Integrate the rear axle along the mean heading, then rebuild the eye.
    const [cx, cz] = this.centre();
    const [dx0, dz0] = headingVec(this.heading);
    const rx = cx - dx0 * VEHICLE.rearAxle;
    const rz = cz - dz0 * VEHICLE.rearAxle;
    const hm = (this.heading + h) / 2;
    const [mx, mz] = headingVec(hm);
    const nrx = rx + mx * vm * dt;
    const nrz = rz + mz * vm * dt;
    const [dx1, dz1] = headingVec(h);
    const ncx = nrx + dx1 * VEHICLE.rearAxle;
    const ncz = nrz + dz1 * VEHICLE.rearAxle;
    return { x: ncx - dz1 * VEHICLE.eyeRight, z: ncz + dx1 * VEHICLE.eyeRight, heading: ((h % 360) + 360) % 360, speed: v };
  }

  /** Smooth steering toward the target: keyboard ramps ~1.5/s, recentres ~3/s; phone is absolute. */
  updateSteer(target: number, absolute: boolean, dt: number) {
    if (absolute) {
      this.steer = clamp(target, -1, 1);
      return;
    }
    if (target === 0) {
      const d = Math.min(Math.abs(this.steer), 3 * dt);
      this.steer -= Math.sign(this.steer) * d;
    } else {
      this.steer = clamp(this.steer + Math.sign(target - this.steer) * Math.min(Math.abs(target - this.steer), 1.5 * dt), -1, 1);
    }
  }

  /** Footprint corners and edge midpoints from a pose (eye). */
  static footprint(x: number, z: number, heading: number): [number, number][] {
    const [dx, dz] = headingVec(heading);
    const rx = -dz;
    const rz = dx;
    const pt = (f: number, r: number): [number, number] => [x + dx * f + rx * r, z + dz * f + rz * r];
    const F = VEHICLE.front;
    const B = -VEHICLE.rear;
    const L = -VEHICLE.left;
    const R = VEHICLE.right;
    return [pt(F, L), pt(F, R), pt(B, R), pt(B, L), pt(F, (L + R) / 2), pt(B, (L + R) / 2), pt(0, L), pt(0, R)];
  }

  /** Wheel contact points (FL, FR, RL, RR) from a pose (eye). */
  static wheels(x: number, z: number, heading: number): [number, number][] {
    const [dx, dz] = headingVec(heading);
    const rx = -dz;
    const rz = dx;
    const cxo = -VEHICLE.eyeRight;
    const pt = (f: number, r: number): [number, number] => [x + dx * f + rx * (cxo + r), z + dz * f + rz * (cxo + r)];
    return [pt(VEHICLE.frontAxle, -VEHICLE.halfTrack), pt(VEHICLE.frontAxle, VEHICLE.halfTrack), pt(-VEHICLE.rearAxle, -VEHICLE.halfTrack), pt(-VEHICLE.rearAxle, VEHICLE.halfTrack)];
  }
}
