// Loads generated textures from /textures/manifest.json (pnpm textures:generate) when present.
// Seams get a 6% cross-fade so tiles repeat without a visible join. Missing files fall back to procedural.
import * as THREE from 'three';
import type { TextureSet } from '../render/textures.ts';

interface Entry {
  file: string;
  aspect: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/** Cross-fade the outer `frac` of each edge with the opposite edge so the image tiles. */
function seamless(img: HTMLImageElement, wrapY: boolean, frac = 0.06): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const band = Math.max(1, Math.round(w * frac));
  // Blend the right band into the left edge (and vice versa) with a linear ramp.
  for (let i = 0; i < band; i++) {
    const a = 0.5 * (1 - i / band);
    ctx.globalAlpha = a;
    ctx.drawImage(img, w - 1 - i, 0, 1, h, i, 0, 1, h);
    ctx.drawImage(img, i, 0, 1, h, w - 1 - i, 0, 1, h);
  }
  if (wrapY) {
    const bandY = Math.max(1, Math.round(h * frac));
    const snap = document.createElement('canvas');
    snap.width = w;
    snap.height = h;
    snap.getContext('2d')!.drawImage(c, 0, 0);
    for (let i = 0; i < bandY; i++) {
      ctx.globalAlpha = 0.5 * (1 - i / bandY);
      ctx.drawImage(snap, 0, h - 1 - i, w, 1, 0, i, w, 1);
      ctx.drawImage(snap, 0, i, w, 1, 0, h - 1 - i, w, 1);
    }
  }
  ctx.globalAlpha = 1;
  return c;
}

export type TextureOverrides = {
  upper: Partial<TextureSet['upper']>;
  ground: Partial<TextureSet['ground']>;
} & Partial<Pick<TextureSet, 'slate' | 'flat' | 'asphalt' | 'paving'>>;

export async function loadTextureOverrides(maxAniso = 8): Promise<{ overrides: TextureOverrides; count: number }> {
  const overrides: TextureOverrides = { upper: {}, ground: {} };
  let manifest: Record<string, Entry>;
  try {
    const res = await fetch('/textures/manifest.json');
    if (!res.ok) return { overrides, count: 0 };
    manifest = await res.json();
  } catch {
    return { overrides, count: 0 };
  }
  let count = 0;
  await Promise.all(
    Object.entries(manifest).map(async ([id, e]) => {
      try {
        const img = await loadImage(`/textures/${e.file}`);
        const tex = new THREE.CanvasTexture(seamless(img, e.aspect === '1:1'));
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAniso;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        if (id.startsWith('upper-')) (overrides.upper as Record<string, THREE.Texture>)[id.slice(6)] = tex;
        else if (id.startsWith('ground-')) (overrides.ground as Record<string, THREE.Texture>)[id.slice(7)] = tex;
        else if (id === 'slate' || id === 'flat' || id === 'asphalt' || id === 'paving') overrides[id] = tex;
        else return;
        count++;
      } catch {
        /* keep the procedural texture */
      }
    }),
  );
  return { overrides, count };
}

export function mergeTextures(base: TextureSet, o: TextureOverrides): TextureSet {
  return {
    ...base,
    upper: { ...base.upper, ...o.upper } as TextureSet['upper'],
    ground: { ...base.ground, ...o.ground } as TextureSet['ground'],
    slate: o.slate ?? base.slate,
    flat: o.flat ?? base.flat,
    asphalt: o.asphalt ?? base.asphalt,
    paving: o.paving ?? base.paving,
  };
}
