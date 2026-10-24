// Instrument cluster: a canvas texture with speedo, rev counter, digital mph, indicator arrows
// and the handbrake light. Redrawn only when a shown value changes, at most 20 times a second.
import * as THREE from 'three';
import type { Session } from '../../sim/session.ts';
import { CLUSTER, type CabinModule } from './layout.ts';

const MS_TO_MPH = 2.23694;
const MAX_MPH = 140;
const MAX_RPM = 7000;
const IDLE_RPM = 800;
/** rpm per mph in each gear of the (fake) automatic gearbox; upshift above SHIFT_RPM. */
const RATIOS = [115, 68, 47, 36, 29, 24];
const SHIFT_RPM = 2700;

const DIAL_START = (135 * Math.PI) / 180;
const DIAL_SWEEP = (270 * Math.PI) / 180;

function gearFor(mph: number): number {
  for (let g = 0; g < RATIOS.length; g++) if (IDLE_RPM + mph * RATIOS[g] <= SHIFT_RPM) return g;
  return RATIOS.length - 1;
}

function dial(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, frac: number, max: number, step: number, label: string, redFrom?: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#2a2f37';
  ctx.beginPath();
  ctx.arc(0, 0, r, DIAL_START, DIAL_START + DIAL_SWEEP);
  ctx.stroke();
  if (redFrom !== undefined) {
    ctx.strokeStyle = '#c92a2a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, r - 3, DIAL_START + DIAL_SWEEP * (redFrom / max), DIAL_START + DIAL_SWEEP);
    ctx.stroke();
  }
  // Ticks and numbers.
  ctx.fillStyle = '#c9d1db';
  ctx.strokeStyle = '#c9d1db';
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= max + 1e-6; v += step / 2) {
    const a = DIAL_START + DIAL_SWEEP * (v / max);
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.lineWidth = major ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(c * (r - (major ? 12 : 7)), s * (r - (major ? 12 : 7)));
    ctx.lineTo(c * r, s * r);
    ctx.stroke();
    if (major) ctx.fillText(String(max > 100 ? v : v / 1000), c * (r - 24), s * (r - 24));
  }
  ctx.fillStyle = '#7b8594';
  ctx.font = '500 11px system-ui, sans-serif';
  ctx.fillText(label, 0, r * 0.55);
  // Needle.
  const a = DIAL_START + DIAL_SWEEP * Math.min(1, Math.max(0, frac));
  ctx.strokeStyle = '#ff6b2c';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-Math.cos(a) * 10, -Math.sin(a) * 10);
  ctx.lineTo(Math.cos(a) * (r - 8), Math.sin(a) * (r - 8));
  ctx.stroke();
  ctx.fillStyle = '#3a3f47';
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: -1 | 1, lit: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.fillStyle = lit ? '#40e060' : '#0e1a10';
  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.lineTo(0, -14);
  ctx.lineTo(0, -6);
  ctx.lineTo(14, -6);
  ctx.lineTo(14, 6);
  ctx.lineTo(0, 6);
  ctx.lineTo(0, 14);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function handbrakeLight(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean) {
  ctx.save();
  ctx.translate(x, y);
  const c = on ? '#ff3b3b' : '#1e0b0b';
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.stroke();
  // Brackets either side of the circle, like the real symbol.
  for (const d of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(0, 0, 19, d > 0 ? -0.8 : Math.PI - 0.8, d > 0 ? 0.8 : Math.PI + 0.8);
    ctx.stroke();
  }
  ctx.font = '800 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', 0, 1);
  ctx.restore();
}

export function createCluster(_s: Session): CabinModule {
  const [cw, ch] = CLUSTER.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const geometry = new THREE.PlaneGeometry(CLUSTER.w, CLUSTER.h);
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'cabin-cluster';
  mesh.position.set(CLUSTER.x, CLUSTER.y, CLUSTER.z);
  mesh.rotation.x = -CLUSTER.tilt; // top leans away, face looks up at the driver

  let rpm = IDLE_RPM;
  let lastKey = '';
  let sinceDraw = Infinity;

  function draw(mph: number, rpmShown: number, gear: number, indicator: string, lit: boolean, handbrake: boolean) {
    ctx.fillStyle = '#06070a';
    ctx.fillRect(0, 0, cw, ch);
    const r = 80;
    dial(ctx, 96, 100, r, mph / MAX_MPH, MAX_MPH, 20, 'MPH');
    dial(ctx, cw - 96, 100, r, rpmShown / MAX_RPM, MAX_RPM, 1000, 'x1000 r/min', 6000);

    // Centre: digital speed, gear, warning lights.
    const cx = cw / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#eef1f5';
    ctx.font = '700 58px system-ui, sans-serif';
    ctx.fillText(String(Math.round(mph)), cx, 112);
    ctx.fillStyle = '#7b8594';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText('mph', cx, 130);
    ctx.fillStyle = '#c9d1db';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.fillText(handbrake && mph < 0.5 ? 'P' : `D${gear + 1}`, cx, 160);

    arrow(ctx, cx - 44, 30, -1, indicator === 'left' && lit);
    arrow(ctx, cx + 44, 30, 1, indicator === 'right' && lit);
    handbrakeLight(ctx, cx, 30, handbrake);
    texture.needsUpdate = true;
  }

  return {
    object: mesh,
    update(s, dt) {
      const car = s.world.car;
      const mph = Math.abs(car.speed) * MS_TO_MPH;
      const gear = gearFor(mph);
      const target = Math.min(MAX_RPM, IDLE_RPM + mph * RATIOS[gear]);
      rpm += (target - rpm) * Math.min(1, dt * 6);
      sinceDraw += dt;

      const key = `${Math.round(mph * 2)}|${Math.round(rpm / 50)}|${gear}|${s.indicator}|${s.indicatorLit}|${car.handbrake}`;
      if (key === lastKey || sinceDraw < 0.05) return;
      lastKey = key;
      sinceDraw = 0;
      draw(mph, rpm, gear, s.indicator, s.indicatorLit, car.handbrake);
    },
    dispose() {
      texture.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
