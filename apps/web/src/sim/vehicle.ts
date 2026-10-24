// Automatic hatchback: kinematic bicycle model with pedal lag, a power-limited engine, real resistances,
// understeer and a grip limit. Pose is the driver's eye point.
import { DEG, clamp, headingVec } from './geo.ts';

export const VEHICLE = {
  wheelbase: 2.6,
  maxWheelAngle: 35,
  steeringRatio: 13.5,
  /** Traction-limited launch (m/s²); above ~28 mph power runs out: a = power / v. */
  maxAccel: 3.2,
  /** Wheel power per kg (W/kg) after losses: ~100 hp hatchback, 0–60 mph in about 12 s. */
  power: 46,
  maxBrake: 8.5,
  /** Brake pedal curve: light presses slow gently, full press stops hard. */
  brakeCurve: 1.4,
  handbrake: 4,
  /** Rolling resistance (Crr 0.012 × g) and aero drag (½ρCdA/m) in m/s². */
  rolling: 0.12,
  drag: 0.0007,
  /** Off-throttle engine braking in D: base + per m/s. */
  engineBraking: 0.2,
  engineBrakingPerMs: 0.025,
  /** Pedal response time constants (s): engines spool, brakes bite quickly. */
  throttleUp: 0.35,
  throttleDown: 0.15,
  brakeUp: 0.12,
  brakeDown: 0.1,
  /** Understeer gradient (s²/m²): the turn widens a little as speed rises. */
  understeer: 0.0006,
  /** Tyre grip: lateral acceleration can't exceed ~0.85 g on dry tarmac. */
  maxLateral: 8.3,
  creepSpeed: 1.6,
  creepAccel: 0.9,
  /** Reverse gear: gentle, capped around 11 mph. */
  maxReverseSpeed: 5,
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
  /** Reverse gear engaged (speed is negative while reversing). */
  reverse = false;
  /** Smoothed steering −1…1. */
  steer = 0;
  accel = 0;
  /** Pedal positions after actuator lag (0…1). */
  throttleIn = 0;
  brakeIn = 0;

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
    // Work in the gear's direction of travel: v ≥ 0 means moving the way the gear drives.
    const dir = this.reverse ? -1 : 1;
    return dir * this.alongGear(c, this.speed * dir);
  }

  /** Select reverse/drive; only when (nearly) stopped. Returns whether it changed. */
  toggleReverse(): boolean {
    if (Math.abs(this.speed) > 0.5) return false;
    this.reverse = !this.reverse;
    this.speed = 0;
    return true;
  }

  private alongGear(c: Controls, v: number): number {
    let a = 0;
    if (!this.handbrake && c.throttle > 0) {
      // Traction-limited at low speed, power-limited above; reverse is a short, gentle gear.
      const drive = Math.min(VEHICLE.maxAccel, VEHICLE.power / Math.max(0.1, v));
      const cap = this.reverse ? Math.max(0, 1 - v / VEHICLE.maxReverseSpeed) : 1;
      a += drive * (this.reverse ? 0.5 : 1) * c.throttle * cap;
    }
    let resist = VEHICLE.rolling + VEHICLE.drag * v * v + c.brake ** VEHICLE.brakeCurve * VEHICLE.maxBrake;
    if (c.throttle <= 0) resist += VEHICLE.engineBraking + VEHICLE.engineBrakingPerMs * v;
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
    // Pedals don't act instantly: ease toward the driver's input.
    const ease = (cur: number, target: number, up: number, down: number) =>
      cur + (target - cur) * Math.min(1, dt / (target > cur ? up : down));
    this.throttleIn = ease(this.throttleIn, c.throttle, VEHICLE.throttleUp, VEHICLE.throttleDown);
    this.brakeIn = ease(this.brakeIn, c.brake, VEHICLE.brakeUp, VEHICLE.brakeDown);
    // Snap tiny residues to zero so idle creep and engine braking still kick in.
    const pedals: Controls = { steer: c.steer, throttle: this.throttleIn < 0.01 ? 0 : this.throttleIn, brake: this.brakeIn < 0.01 ? 0 : this.brakeIn };
    const a = this.longitudinal(pedals);
    let v = this.speed + a * dt;
    // Resistance never pushes the car against its gear.
    if (!this.reverse && v < 0) v = 0;
    if (this.reverse && v > 0) v = 0;
    this.accel = (v - this.speed) / dt;
    const vm = (this.speed + v) / 2;
    const delta = this.wheelAngle() * DEG;
    // Understeer widens the turn with speed; tyre grip caps lateral acceleration (yaw × speed).
    let yawRate = ((vm / VEHICLE.wheelbase) * Math.tan(delta)) / (1 + VEHICLE.understeer * vm * vm);
    const maxYaw = VEHICLE.maxLateral / Math.max(0.5, Math.abs(vm));
    yawRate = clamp(yawRate, -maxYaw, maxYaw);
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

  /**
   * Smooth steering toward the target. Phone is absolute. Keyboard ramps ~1.5/s when parked, slower and with
   * less lock at speed (like a real driver at 30 mph), and recentres faster as speed adds self-aligning torque.
   */
  updateSteer(target: number, absolute: boolean, dt: number) {
    if (absolute) {
      this.steer = clamp(target, -1, 1);
      return;
    }
    const v = Math.abs(this.speed);
    if (target === 0) {
      const d = Math.min(Math.abs(this.steer), (3 + 0.2 * v) * dt);
      this.steer -= Math.sign(this.steer) * d;
    } else {
      const lock = 1 / (1 + (v / 12) ** 2);
      const goal = clamp(target, -1, 1) * Math.max(0.25, lock);
      const rate = 1.5 / (1 + v / 15);
      this.steer = clamp(this.steer + Math.sign(goal - this.steer) * Math.min(Math.abs(goal - this.steer), rate * dt), -1, 1);
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
