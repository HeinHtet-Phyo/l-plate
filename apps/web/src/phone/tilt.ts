// Tilt steering: read the wheel angle from gravity in the phone's own frame,
// so it works however far back the phone is tilted.
const DEG = Math.PI / 180;

/** Gravity in the phone frame from deviceorientation beta, gamma (degrees). */
export function gravity(beta: number, gamma: number): [number, number, number] {
  const b = beta * DEG;
  const g = gamma * DEG;
  return [Math.cos(b) * Math.sin(g), -Math.sin(b), -Math.cos(b) * Math.cos(g)];
}

/** Wheel angle (degrees) and how upright the phone is (0 flat … 1 upright). */
export function wheelAngle(beta: number, gamma: number): { angle: number; upright: number; flat: boolean } {
  const [gx, gy] = gravity(beta, gamma);
  const upright = Math.hypot(gx, gy);
  const angle = Math.atan2(gx, -gy) / DEG;
  return { angle, upright, flat: upright < 0.35 };
}

/** Steering −1…1 from the angle relative to the calibrated centre. */
export function steerFromAngle(angle: number, centre: number): number {
  let d = angle - centre;
  d = ((d + 540) % 360) - 180;
  const mag = Math.min(1, Math.max(0, (Math.abs(d) - 1.5) / (60 - 1.5))) ** 1.3;
  return Math.sign(d) * mag;
}
