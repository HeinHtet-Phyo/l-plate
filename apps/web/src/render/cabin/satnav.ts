// Sat nav screen on the dash: a canvas texture redrawn ~10×/s from the session's nav state.
// Left panel: manoeuvre icon + distance. Right: heading-up route map. Bottom bar: instruction, ETA, miles left.
import * as THREE from 'three';
import type { RouteStep } from '@lplate/shared';
import type { Session } from '../../sim/session.ts';
import { SATNAV, type CabinModule } from './layout.ts';

const [W, H] = SATNAV.canvas;
const PANEL = 230;
const BAR = 78;
/** Map view radius in metres (the car sits at the lower centre, so this is roughly the look-ahead). */
const VIEW_M = 250;
const REDRAW = 0.1;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const C = {
  bg: '#0d1520',
  panel: '#14304f',
  amber: '#8a5a00',
  bar: '#0a0f16',
  text: '#f2f5f8',
  dim: '#9aa8b8',
  map: '#1b2633',
  route: '#3d8bff',
  done: '#6b7480',
  car: '#ffffff',
  icon: '#ffffff',
};

export function createSatNavScreen(s: Session): CabinModule {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const group = new THREE.Group();
  group.position.set(SATNAV.x, SATNAV.y, SATNAV.z);
  group.rotation.order = 'YXZ';
  group.rotation.y = SATNAV.yaw; // face the driver, who sits to the right
  group.rotation.x = -SATNAV.tilt; // lean back so it faces up towards the eye

  const screenGeo = new THREE.PlaneGeometry(SATNAV.w, SATNAV.h);
  const screenMat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.z = 0.002;

  const bezelGeo = new THREE.BoxGeometry(SATNAV.w + 0.018, SATNAV.h + 0.018, 0.012);
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.6 });
  const bezel = new THREE.Mesh(bezelGeo, bezelMat);
  bezel.position.z = -0.005;
  group.add(bezel, screen);

  let acc = REDRAW;
  draw(ctx, s);
  texture.needsUpdate = true;

  return {
    object: group,
    update(s, dt) {
      acc += dt;
      if (acc < REDRAW) return;
      acc = 0;
      draw(ctx, s);
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
      screenGeo.dispose();
      screenMat.dispose();
      bezelGeo.dispose();
      bezelMat.dispose();
    },
  };
}

// ---------- Drawing ----------

function draw(ctx: CanvasRenderingContext2D, s: Session) {
  const snap = s.snapshot;
  const nav = snap.nav;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  drawMap(ctx, s);

  if (!nav || !s.nav) {
    drawFreeDrive(ctx, snap.road, snap.limit);
    return;
  }

  const off = nav.status === 'off' || nav.status === 'rerouting';
  ctx.fillStyle = off ? C.amber : C.panel;
  ctx.fillRect(0, 0, PANEL, H - BAR);

  if (nav.status === 'arrived') {
    drawFlag(ctx, PANEL / 2, 112);
    text(ctx, 'Arrived', PANEL / 2, 236, 30, C.text, 'center', '700');
  } else if (off) {
    drawWarning(ctx, PANEL / 2, 108);
    text(ctx, nav.status === 'rerouting' ? 'Rerouting…' : 'Off route', PANEL / 2, 236, 30, C.text, 'center', '700');
  } else {
    if (nav.next) drawManoeuvre(ctx, nav.next, PANEL / 2, 110);
    text(ctx, nav.distanceText, PANEL / 2, 240, 40, C.text, 'center', '800');
  }

  // Bottom bar: instruction (and "then …"), ETA and miles left.
  ctx.fillStyle = C.bar;
  ctx.fillRect(0, H - BAR, W, BAR);
  const right = 190;
  const instr = nav.instruction ?? 'Follow the road';
  fitText(ctx, instr, 16, H - BAR + 34, W - right - 32, 26, C.text, '700');
  if (nav.thenText && nav.status === 'ok') fitText(ctx, `then ${nav.thenText.charAt(0).toLowerCase()}${nav.thenText.slice(1)}`, 16, H - BAR + 62, W - right - 32, 18, C.dim, '500');
  const eta = new Date(Date.now() + nav.etaSeconds * 1000);
  text(ctx, clock(eta), W - 16, H - BAR + 34, 26, C.text, 'right', '700');
  text(ctx, `${nav.milesLeft} mi · ETA`, W - 16, H - BAR + 62, 18, C.dim, 'right', '500');
}

function drawFreeDrive(ctx: CanvasRenderingContext2D, road: string, limit: number | null) {
  ctx.fillStyle = C.panel;
  ctx.fillRect(0, 0, PANEL, H - BAR);
  if (limit != null) drawLimit(ctx, PANEL / 2, 110, limit);
  else text(ctx, 'Free drive', PANEL / 2, 120, 28, C.text, 'center', '700');
  text(ctx, clock(new Date()), PANEL / 2, 240, 38, C.text, 'center', '800');

  ctx.fillStyle = C.bar;
  ctx.fillRect(0, H - BAR, W, BAR);
  fitText(ctx, road || 'Unnamed road', 16, H - BAR + 48, W - 32, 30, C.text, '700');
}

/** Heading-up map of the route polyline around the car, drawn in the area right of the panel. */
function drawMap(ctx: CanvasRenderingContext2D, s: Session) {
  const x0 = PANEL;
  const mw = W - PANEL;
  const mh = H - BAR;
  ctx.fillStyle = C.map;
  ctx.fillRect(x0, 0, mw, mh);

  const car = s.world?.car;
  if (!car) return;
  const cx = x0 + mw / 2;
  const cy = mh * 0.72;
  const scale = (mh * 0.68) / VIEW_M;
  const h = (car.heading * Math.PI) / 180;
  // Forward and right unit vectors in world x/z (north = −z).
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = Math.sin(h);
  const toScreen = (px: number, pz: number): [number, number] => {
    const dx = px - car.x;
    const dz = pz - car.z;
    return [cx + (dx * rx + dz * rz) * scale, cy - (dx * fx + dz * fz) * scale];
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, 0, mw, mh);
  ctx.clip();

  const tr = s.nav?.tracker;
  if (tr && tr.pts.length > 1) {
    // Split the route at the car's progress: travelled part in grey, the rest in blue.
    const done: [number, number][] = [];
    const ahead: [number, number][] = [];
    for (let i = 0; i < tr.pts.length; i++) {
      if (tr.cum[i] <= tr.s) done.push(tr.pts[i]);
      else {
        if (!ahead.length && i > 0) {
          const [ax, az] = tr.pts[i - 1];
          const [bx, bz] = tr.pts[i];
          const t = (tr.s - tr.cum[i - 1]) / Math.max(1e-6, tr.cum[i] - tr.cum[i - 1]);
          const split: [number, number] = [ax + (bx - ax) * t, az + (bz - az) * t];
          done.push(split);
          ahead.push(split);
        }
        ahead.push(tr.pts[i]);
      }
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    stroke(ctx, done, toScreen, car.x, car.z, C.done, 9);
    stroke(ctx, ahead, toScreen, car.x, car.z, C.route, 12);
  }
  ctx.restore();

  // The car: a chevron pointing up.
  ctx.beginPath();
  ctx.moveTo(cx, cy - 18);
  ctx.lineTo(cx + 13, cy + 13);
  ctx.lineTo(cx, cy + 5);
  ctx.lineTo(cx - 13, cy + 13);
  ctx.closePath();
  ctx.fillStyle = C.car;
  ctx.strokeStyle = '#0b2a52';
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();
}

/** Stroke a polyline, skipping points far outside the view to keep it cheap. */
function stroke(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  toScreen: (x: number, z: number) => [number, number],
  carX: number,
  carZ: number,
  colour: string,
  width: number,
) {
  const reach = VIEW_M * 2;
  ctx.beginPath();
  let pen = false;
  for (const [px, pz] of pts) {
    if (Math.abs(px - carX) > reach || Math.abs(pz - carZ) > reach) {
      pen = false;
      continue;
    }
    const [sx, sy] = toScreen(px, pz);
    if (pen) ctx.lineTo(sx, sy);
    else ctx.moveTo(sx, sy);
    pen = true;
  }
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.stroke();
}

// ---------- Icons ----------

const TURN: Record<string, number> = {
  straight: 0,
  'slight left': -45,
  'slight right': 45,
  left: -90,
  right: 90,
  'sharp left': -135,
  'sharp right': 135,
};

function drawManoeuvre(ctx: CanvasRenderingContext2D, step: RouteStep, x: number, y: number) {
  if (step.type === 'arrive') return drawFlag(ctx, x, y);
  if (step.type === 'roundabout' || step.type === 'rotary' || step.type === 'roundabout turn') return drawRoundabout(ctx, step.exit ?? 1, x, y);
  if (step.modifier === 'uturn') return drawUturn(ctx, x, y);
  const deg = step.modifier ? (TURN[step.modifier] ?? 0) : 0;
  drawArrow(ctx, x, y, deg);
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  const stemBottom = y + 62;
  const bend = deg === 0 ? y - 10 : y + 6;
  const len = deg === 0 ? 50 : 52;
  const ex = x + Math.sin(a) * len;
  const ey = bend - Math.cos(a) * len;
  ctx.strokeStyle = C.icon;
  ctx.lineWidth = 18;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, stemBottom);
  ctx.lineTo(x, bend);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  arrowHead(ctx, ex, ey, a);
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, a: number) {
  const fx = Math.sin(a);
  const fy = -Math.cos(a);
  const s = 26;
  ctx.fillStyle = C.icon;
  ctx.beginPath();
  ctx.moveTo(x + fx * s, y + fy * s);
  ctx.lineTo(x - fy * s, y + fx * s);
  ctx.lineTo(x + fy * s, y - fx * s);
  ctx.closePath();
  ctx.fill();
}

function drawUturn(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const r = 26;
  ctx.strokeStyle = C.icon;
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(x + r, y + 62);
  ctx.lineTo(x + r, y - 10);
  ctx.arc(x, y - 10, r, 0, Math.PI, true);
  ctx.lineTo(x - r, y + 22);
  ctx.stroke();
  arrowHead(ctx, x - r, y + 30, Math.PI);
}

/** UK roundabout: enter at the bottom, go clockwise, leave by the highlighted exit. */
function drawRoundabout(ctx: CanvasRenderingContext2D, exit: number, x: number, y: number) {
  const r = 34;
  const n = Math.max(4, exit + 1);
  const entry = Math.PI / 2; // bottom of the circle (canvas y points down)
  const exitAngle = entry + (exit * 2 * Math.PI) / n;

  // Other exits as faint stubs.
  ctx.strokeStyle = '#5d7a9a';
  ctx.lineWidth = 10;
  ctx.lineCap = 'butt';
  for (let k = 1; k < n; k++) {
    if (k === exit) continue;
    const a = entry + (k * 2 * Math.PI) / n;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    ctx.lineTo(x + Math.cos(a) * (r + 28), y + Math.sin(a) * (r + 28));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  // The path: in from the bottom, clockwise round, out of the exit.
  ctx.strokeStyle = C.icon;
  ctx.lineWidth = 14;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + r + 34);
  ctx.lineTo(x + Math.cos(entry) * r, y + Math.sin(entry) * r);
  ctx.arc(x, y, r, entry, exitAngle, false);
  const ox = x + Math.cos(exitAngle) * (r + 22);
  const oy = y + Math.sin(exitAngle) * (r + 22);
  ctx.lineTo(ox, oy);
  ctx.stroke();
  // Arrow head pointing outwards (convert canvas angle to "0 = up" convention).
  arrowHead(ctx, ox, oy, exitAngle + Math.PI / 2);

  text(ctx, String(exit), x, y + 10, 28, C.icon, 'center', '800');
}

function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const w = 84;
  const h = 56;
  const left = x - w / 2 + 8;
  const top = y - 50;
  const cell = 14;
  for (let i = 0; i < w / cell; i++) {
    for (let j = 0; j < h / cell; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
      ctx.fillRect(left + i * cell, top + j * cell, cell, cell);
    }
  }
  ctx.fillStyle = '#d0d4da';
  ctx.fillRect(left - 8, top, 7, 110);
}

function drawWarning(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#ffd43b';
  ctx.beginPath();
  ctx.moveTo(x, y - 58);
  ctx.lineTo(x + 62, y + 50);
  ctx.lineTo(x - 62, y + 50);
  ctx.closePath();
  ctx.fill();
  text(ctx, '!', x, y + 38, 70, '#111', 'center', '900');
}

/** UK speed limit roundel. */
function drawLimit(ctx: CanvasRenderingContext2D, x: number, y: number, mph: number) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d0021b';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(x, y, 55, 0, Math.PI * 2);
  ctx.stroke();
  text(ctx, String(mph), x, y + 20, 58, '#111', 'center', '800');
}

// ---------- Text ----------

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, colour: string, align: CanvasTextAlign, weight = '600') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

/** Left-aligned text, shrunk (down to 60%) and then ellipsised to fit maxW. */
function fitText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, size: number, colour: string, weight: string) {
  let sz = size;
  ctx.font = `${weight} ${sz}px ${FONT}`;
  while (ctx.measureText(s).width > maxW && sz > size * 0.6) {
    sz -= 1;
    ctx.font = `${weight} ${sz}px ${FONT}`;
  }
  let out = s;
  while (ctx.measureText(out).width > maxW && out.length > 1) out = out.slice(0, -2) + '…';
  text(ctx, out, x, y, sz, colour, 'left', weight);
}

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
