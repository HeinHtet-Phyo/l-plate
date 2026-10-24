// GPU detection (software rendering warning) and adaptive resolution.

export const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i;

/** Friendly GPU name from an (ANGLE) renderer string. */
export function friendlyGpuName(renderer: string): string {
  let s = renderer.trim();
  const angle = s.match(/^ANGLE \((.*)\)$/);
  if (angle) {
    const parts = angle[1].split(',').map((p) => p.trim());
    // "Vendor, Device (0x…) Direct3D11 vs_5_0 ps_5_0, D3D11" or "AMD, AMD Radeon Graphics (radeonsi, renoir, …), OpenGL 4.6"
    s = parts.length > 1 ? parts[1] : parts[0];
  }
  s = s.replace(/\s*\(0x[0-9a-f]+\)/gi, '');
  s = s.replace(/\s+Direct3D.*$/i, '').replace(/\s+vs_\d.*$/i, '');
  s = s.replace(/\s*\((radeonsi|LLVM)[^)]*\)/gi, '').replace(/\s*\([^)]*DRM[^)]*\)/g, '');
  s = s.replace(/\s+OpenGL.*$/i, '').replace(/\s+Vulkan.*$/i, '');
  return s.trim() || renderer;
}

export function isSoftwareRenderer(renderer: string): boolean {
  return SOFTWARE_RE.test(renderer);
}

export interface GpuInfo {
  renderer: string;
  name: string;
  software: boolean;
  webgl2: boolean;
}

export function detectGpu(): GpuInfo {
  let renderer = 'unknown';
  let webgl2 = false;
  let caveat = false;
  try {
    const c = document.createElement('canvas');
    const strict = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true, powerPreference: 'high-performance' });
    caveat = !strict;
    const gl = strict ?? document.createElement('canvas').getContext('webgl2', { powerPreference: 'high-performance' });
    webgl2 = !!gl;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    /* no WebGL */
  }
  return { renderer, name: friendlyGpuName(renderer), software: caveat || isSoftwareRenderer(renderer), webgl2 };
}

/**
 * Adaptive pixel ratio: measure fps in 1.5 s windows (ignoring a 5 s warm-up and windows with a
 * frame over 250 ms). Drop 0.25 (min 0.6) after 2 windows under 40 fps; raise 0.25 after 3 windows
 * over 55 fps (6 after a drop), up to min(2, devicePixelRatio).
 */
export class AdaptiveDpr {
  dpr: number;
  max: number;
  fps = 0;
  private t = 0;
  private frames = 0;
  private windowStart = 0;
  private longFrame = false;
  private low = 0;
  private high = 0;
  private dropped = false;

  constructor(initial: number, max: number) {
    this.dpr = initial;
    this.max = max;
  }

  /** Feed one frame's dt (seconds); returns the new dpr when it changes. */
  frame(dt: number): number | null {
    this.t += dt;
    if (this.t < 5) {
      this.windowStart = this.t;
      return null;
    }
    this.frames++;
    if (dt > 0.25) this.longFrame = true;
    const span = this.t - this.windowStart;
    if (span < 1.5) return null;
    const fps = this.frames / span;
    this.fps = fps;
    const skip = this.longFrame;
    this.frames = 0;
    this.windowStart = this.t;
    this.longFrame = false;
    if (skip) return null;
    if (fps < 40) {
      this.low++;
      this.high = 0;
    } else if (fps > 55) {
      this.high++;
      this.low = 0;
    } else {
      this.low = 0;
      this.high = 0;
    }
    if (this.low >= 2 && this.dpr > 0.6) {
      this.dpr = Math.max(0.6, Math.round((this.dpr - 0.25) * 100) / 100);
      this.low = 0;
      this.dropped = true;
      return this.dpr;
    }
    if (this.high >= (this.dropped ? 6 : 3) && this.dpr < this.max) {
      this.dpr = Math.min(this.max, Math.round((this.dpr + 0.25) * 100) / 100);
      this.high = 0;
      return this.dpr;
    }
    return null;
  }
}
