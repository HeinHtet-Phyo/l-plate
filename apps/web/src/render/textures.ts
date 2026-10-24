// Procedural canvas textures generated at startup (1024 px): facade styles, roofs, ground surfaces.
import * as THREE from 'three';
import { rng } from '../sim/geo.ts';
import type { Style } from '../sim/city.ts';

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 255) * f));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) * f));
  const b = Math.min(255, Math.max(0, (n & 255) * f));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function noise(ctx: Ctx, w: number, h: number, amount: number, seed: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const r = rng(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** Brick bond: rows of bricks with mortar, wrapping seamlessly. */
function bricks(ctx: Ctx, w: number, h: number, base: string, mortar: string, seed: number, courseH = 9, brickW = 26) {
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, w, h);
  const r = rng(seed);
  const rows = Math.round(h / courseH);
  const ch = h / rows;
  const cols = Math.round(w / brickW);
  const bw = w / cols;
  for (let y = 0; y < rows; y++) {
    const off = (y % 2) * bw * 0.5;
    for (let x = -1; x <= cols; x++) {
      ctx.fillStyle = shade(base, 0.82 + r() * 0.32);
      ctx.fillRect(x * bw + off + 1, y * ch + 1, bw - 2, ch - 2);
    }
  }
}

function plain(ctx: Ctx, w: number, h: number, base: string, seed: number, courses = 0) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  noise(ctx, w, h, 14, seed);
  if (courses) {
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    for (let y = 0; y < h; y += h / courses) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }
}

interface WindowSpec {
  frame: string;
  surround?: string;
  bars: 'sash' | 'casement' | 'none' | 'arched';
  w: number; // fraction of bay
  h: number; // fraction of storey
  sill?: boolean;
}

function windowAt(ctx: Ctx, x: number, y: number, w: number, h: number, spec: WindowSpec, r: () => number) {
  if (spec.surround) {
    ctx.fillStyle = spec.surround;
    ctx.fillRect(x - 8, y - 8, w + 16, h + 14);
  }
  ctx.fillStyle = spec.frame;
  if (spec.bars === 'arched') {
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + w / 2);
    ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
  } else ctx.fillRect(x, y, w, h);
  // Dark glass with a faint sky reflection (the night shader lights "dark glass" pixels).
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  const t = 14 + r() * 10;
  g.addColorStop(0, `rgb(${t + 20},${t + 30},${t + 42})`);
  g.addColorStop(0.6, `rgb(${t},${t + 6},${t + 14})`);
  g.addColorStop(1, `rgb(${t + 8},${t + 14},${t + 24})`);
  ctx.fillStyle = g;
  const p = 6;
  if (spec.bars === 'arched') {
    ctx.beginPath();
    ctx.moveTo(x + p, y + h - p);
    ctx.lineTo(x + p, y + w / 2);
    ctx.arc(x + w / 2, y + w / 2, w / 2 - p, Math.PI, 0);
    ctx.lineTo(x + w - p, y + h - p);
    ctx.closePath();
    ctx.fill();
  } else ctx.fillRect(x + p, y + p, w - 2 * p, h - 2 * p);
  ctx.fillStyle = spec.frame;
  if (spec.bars === 'sash') {
    ctx.fillRect(x, y + h / 2 - 3, w, 6);
    ctx.fillRect(x + w / 2 - 2, y, 4, h);
    ctx.fillRect(x + w / 4 - 1, y, 2, h);
    ctx.fillRect(x + (3 * w) / 4 - 1, y, 2, h);
    ctx.fillRect(x, y + h / 4 - 1, w, 2);
    ctx.fillRect(x, y + (3 * h) / 4 - 1, w, 2);
  } else if (spec.bars === 'casement') {
    ctx.fillRect(x + w / 2 - 3, y, 6, h);
    ctx.fillRect(x, y + h * 0.3 - 3, w, 6);
  } else if (spec.bars === 'arched') {
    ctx.fillRect(x + w / 2 - 2, y + 4, 4, h);
    ctx.fillRect(x, y + h * 0.55, w, 4);
  }
  if (spec.sill) {
    ctx.fillStyle = 'rgba(235,230,215,0.95)';
    ctx.fillRect(x - 10, y + h, w + 20, 10);
  }
}

interface StyleDef {
  wall: (ctx: Ctx, w: number, h: number, seed: number) => void;
  win: WindowSpec;
  ground: 'door' | 'shop' | 'plain' | 'glass';
}

const STYLE_DEFS: Record<Style, StyleDef> = {
  'georgian-brick': {
    wall: (c, w, h, s) => bricks(c, w, h, '#a3895e', '#bdb3a0', s),
    win: { frame: '#f1efe8', bars: 'sash', w: 0.42, h: 0.58, sill: true },
    ground: 'door',
  },
  'victorian-red': {
    wall: (c, w, h, s) => bricks(c, w, h, '#93422e', '#c9bba5', s),
    win: { frame: '#f3f0e6', surround: '#ddd3bd', bars: 'sash', w: 0.4, h: 0.58, sill: true },
    ground: 'door',
  },
  'stucco-white': {
    wall: (c, w, h, s) => plain(c, w, h, '#ece6d8', s, 12),
    win: { frame: '#f7f5ef', surround: '#e2dbc9', bars: 'sash', w: 0.42, h: 0.6, sill: true },
    ground: 'door',
  },
  'portland-stone': {
    wall: (c, w, h, s) => {
      plain(c, w, h, '#d8d0bd', s, 18);
      c.strokeStyle = 'rgba(0,0,0,0.08)';
      for (let x = 0; x < w; x += w / 9) {
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, h);
        c.stroke();
      }
    },
    win: { frame: '#3a3a36', surround: '#cfc6b0', bars: 'casement', w: 0.46, h: 0.62, sill: true },
    ground: 'plain',
  },
  'office-glass': {
    wall: (c, w, h) => {
      const g = c.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#5b6d7c');
      g.addColorStop(1, '#2d3a46');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    },
    win: { frame: '#9aa3aa', bars: 'none', w: 0.96, h: 0.94 },
    ground: 'glass',
  },
  'modern-flats': {
    wall: (c, w, h, s) => {
      bricks(c, w, h, '#b59b72', '#d4c8b0', s, 9, 28);
      c.fillStyle = '#cfcac0';
      for (let y = 0; y < h; y += h / 3) c.fillRect(0, y, w, 16);
    },
    win: { frame: '#3c3f44', bars: 'casement', w: 0.6, h: 0.55 },
    ground: 'plain',
  },
  'warehouse-brick': {
    wall: (c, w, h, s) => bricks(c, w, h, '#6a5444', '#8f8273', s),
    win: { frame: '#2a2c2e', bars: 'arched', w: 0.5, h: 0.62 },
    ground: 'plain',
  },
};

/** Upper band: 3 window bays × 3 storeys (covers 9 m × 9 m). */
function facadeUpper(style: Style, seed: number): HTMLCanvasElement {
  const W = 1024;
  const H = 1024;
  const [c, ctx] = canvas(W, H);
  const def = STYLE_DEFS[style];
  def.wall(ctx, W, H, seed);
  const r = rng(seed + 1);
  const bay = W / 3;
  const storey = H / 3;
  for (let sy = 0; sy < 3; sy++)
    for (let bx = 0; bx < 3; bx++) {
      const ww = bay * def.win.w;
      const wh = storey * def.win.h;
      const x = bx * bay + (bay - ww) / 2;
      const y = sy * storey + (storey - wh) * 0.42;
      windowAt(ctx, x, y, ww, wh, def.win, r);
    }
  if (style === 'office-glass') {
    ctx.fillStyle = '#b6bec4';
    for (let x = 0; x <= W; x += W / 6) ctx.fillRect(x - 3, 0, 6, H);
    for (let y = 0; y <= H; y += H / 3) ctx.fillRect(0, y - 5, W, 10);
  }
  return c;
}

/** Ground band: one storey, 3 bays (covers 9 m × 3.9 m). */
function facadeGround(style: Style | 'shopfront', seed: number): HTMLCanvasElement {
  const W = 1024;
  const H = 444;
  const [c, ctx] = canvas(W, H);
  const r = rng(seed + 5);
  if (style === 'shopfront') {
    ctx.fillStyle = '#2b2b2e';
    ctx.fillRect(0, 0, W, H);
    const bay = W / 3;
    const fascias = ['#1f3b5a', '#5a1f24', '#1f4d36', '#2c2c2c', '#6b4b16', '#3d2b5a'];
    for (let b = 0; b < 3; b++) {
      const x = b * bay;
      ctx.fillStyle = fascias[Math.floor(r() * fascias.length)];
      ctx.fillRect(x + 4, 18, bay - 8, 70);
      ctx.fillStyle = 'rgba(240,235,220,0.85)';
      ctx.fillRect(x + bay * 0.2, 44, bay * 0.6, 14);
      ctx.fillStyle = '#d9d4c8';
      ctx.fillRect(x + 4, 96, bay - 8, H - 96);
      const g = ctx.createLinearGradient(0, 100, 0, H);
      g.addColorStop(0, 'rgb(18,22,28)');
      g.addColorStop(1, 'rgb(30,34,40)');
      ctx.fillStyle = g;
      ctx.fillRect(x + 14, 106, bay * 0.68, H - 140);
      ctx.fillRect(x + bay * 0.74, 106, bay * 0.2, H - 106);
      ctx.fillStyle = '#d9d4c8';
      ctx.fillRect(x + 14, H - 40, bay * 0.68, 40);
    }
    return c;
  }
  const def = STYLE_DEFS[style];
  def.wall(ctx, W, H, seed + 2);
  const bay = W / 3;
  if (def.ground === 'glass') {
    ctx.fillStyle = '#22282e';
    ctx.fillRect(0, 30, W, H - 30);
    ctx.fillStyle = '#9aa3aa';
    for (let x = 0; x <= W; x += W / 6) ctx.fillRect(x - 4, 30, 8, H);
    return c;
  }
  for (let b = 0; b < 3; b++) {
    const x = b * bay;
    if (def.ground === 'door' && b === 1) {
      // Black door with fanlight; railings in front.
      const dw = bay * 0.34;
      const dx = x + (bay - dw) / 2;
      ctx.fillStyle = '#efece4';
      ctx.fillRect(dx - 10, 60, dw + 20, H - 60);
      ctx.fillStyle = '#121214';
      ctx.fillRect(dx, 130, dw, H - 130);
      ctx.fillStyle = 'rgb(24,28,34)';
      ctx.beginPath();
      ctx.arc(dx + dw / 2, 130, dw / 2, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#c9a74a';
      ctx.fillRect(dx + dw * 0.8, 280, 8, 8);
    } else {
      windowAt(ctx, x + bay * 0.29, 90, bay * 0.42, H * 0.55, def.win, r);
    }
  }
  if (def.ground === 'door') {
    ctx.fillStyle = '#0d0d0f';
    for (let x = 0; x < W; x += 16) ctx.fillRect(x, H - 110, 4, 110);
    ctx.fillRect(0, H - 112, W, 6);
  }
  return c;
}

function slate(): HTMLCanvasElement {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#3c4148';
  ctx.fillRect(0, 0, 512, 512);
  const r = rng(9);
  for (let y = 0; y < 512; y += 16)
    for (let x = -32; x < 512; x += 32) {
      ctx.fillStyle = shade('#454b53', 0.8 + r() * 0.35);
      ctx.fillRect(x + ((y / 16) % 2) * 16 + 1, y + 1, 30, 14);
    }
  return c;
}

function flatRoof(): HTMLCanvasElement {
  const [c, ctx] = canvas(512, 512);
  plain(ctx, 512, 512, '#6f6e6a', 4);
  return c;
}

function asphalt(): HTMLCanvasElement {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#3b3c40';
  ctx.fillRect(0, 0, 512, 512);
  noise(ctx, 512, 512, 40, 21);
  return c;
}

function paving(): HTMLCanvasElement {
  // 3.6 m repeat with 0.9 m slabs → 4×4 slabs.
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#6d675d';
  ctx.fillRect(0, 0, 512, 512);
  const r = rng(33);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      ctx.fillStyle = shade('#a39a8b', 0.88 + r() * 0.18);
      ctx.fillRect(x * 128 + 2, y * 128 + 2, 124, 124);
    }
  noise(ctx, 512, 512, 18, 34);
  return c;
}

function grass(): HTMLCanvasElement {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#4a6b2e';
  ctx.fillRect(0, 0, 512, 512);
  const r = rng(77);
  for (let i = 0; i < 6000; i++) {
    ctx.fillStyle = shade('#56783a', 0.7 + r() * 0.6);
    ctx.fillRect(r() * 512, r() * 512, 2, 4);
  }
  return c;
}

function tex(c: HTMLCanvasElement, maxAniso: number, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface TextureSet {
  upper: Record<Style, THREE.Texture>;
  ground: Record<Style | 'shopfront', THREE.Texture>;
  slate: THREE.Texture;
  flat: THREE.Texture;
  asphalt: THREE.Texture;
  paving: THREE.Texture;
  grass: THREE.Texture;
}

export const ALL_STYLES: Style[] = ['georgian-brick', 'victorian-red', 'stucco-white', 'portland-stone', 'office-glass', 'modern-flats', 'warehouse-brick'];

/** Uses textures from /textures/manifest.json when present (Nebius-generated), else procedural. */
export function makeTextures(maxAniso: number): TextureSet {
  const upper = {} as Record<Style, THREE.Texture>;
  const ground = {} as Record<Style | 'shopfront', THREE.Texture>;
  ALL_STYLES.forEach((s, i) => {
    upper[s] = tex(facadeUpper(s, 100 + i), maxAniso);
    ground[s] = tex(facadeGround(s, 200 + i), maxAniso);
  });
  ground.shopfront = tex(facadeGround('shopfront', 300), maxAniso);
  return {
    upper,
    ground,
    slate: tex(slate(), maxAniso),
    flat: tex(flatRoof(), maxAniso),
    asphalt: tex(asphalt(), maxAniso),
    paving: tex(paving(), maxAniso),
    grass: tex(grass(), maxAniso),
  };
}
