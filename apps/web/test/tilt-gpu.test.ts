import { describe, expect, it } from 'vitest';
import { gravity, steerFromAngle, wheelAngle } from '../src/phone/tilt.ts';
import { AdaptiveDpr, friendlyGpuName, isSoftwareRenderer } from '../src/sim/gpu.ts';

describe('tilt steering', () => {
  it('gravity is a unit vector', () => {
    for (const [b, g] of [[0, 0], [30, 60], [-80, 10], [170, -45]]) expect(Math.hypot(...gravity(b, g))).toBeCloseTo(1);
  });

  it('a flat phone is flagged, an upright one is not', () => {
    expect(wheelAngle(0, 0).flat).toBe(true);
    const up = wheelAngle(0, 90);
    expect(up.flat).toBe(false);
    expect(up.upright).toBeCloseTo(1);
  });

  it('rotating the phone like a wheel changes the angle by the same amount', () => {
    // Landscape, tilted back 30°: rolling the phone moves beta.
    const a = wheelAngle(0, 60).angle;
    const b = wheelAngle(20, 60).angle;
    expect(Math.abs(b - a)).toBeGreaterThan(10);
  });

  it('steer has a dead zone, saturates at 60°, and wraps round ±180', () => {
    expect(steerFromAngle(1, 0)).toBe(0);
    expect(steerFromAngle(60, 0)).toBe(1);
    expect(steerFromAngle(-90, 0)).toBe(-1);
    expect(steerFromAngle(30, 0)).toBeGreaterThan(0);
    expect(steerFromAngle(30, 0)).toBeLessThan(0.5);
    expect(steerFromAngle(-170, 170)).toBeCloseTo(steerFromAngle(20, 0));
  });
});

describe('GPU', () => {
  it.each([
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA GeForce RTX 3060'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'ANGLE Metal Renderer: Apple M2'],
    ['Mali-G78', 'Mali-G78'],
  ])('friendlyGpuName(%s)', (raw, name) => {
    expect(friendlyGpuName(raw)).toBe(name);
  });

  // Known bug: the ANGLE string is split on every comma, including those inside "(radeonsi, renoir, …)",
  // so this returns "AMD Radeon Graphics (radeonsi". Reported to the sim/gpu.ts owner; drop `.fails` once fixed.
  it.fails('friendlyGpuName handles commas inside the device name (Linux AMD)', () => {
    expect(friendlyGpuName('ANGLE (AMD, AMD Radeon Graphics (radeonsi, renoir, LLVM 15.0.7, DRM 3.49), OpenGL 4.6)')).toBe('AMD Radeon Graphics');
  });

  it('spots software renderers', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('NVIDIA GeForce RTX 3060')).toBe(false);
  });

  it('AdaptiveDpr drops after two slow windows and recovers more cautiously', () => {
    const d = new AdaptiveDpr(1.5, 2);
    const changes: number[] = [];
    const feed = (fps: number, seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / fps) {
        const c = d.frame(1 / fps);
        if (c != null) changes.push(c);
      }
    };
    feed(30, 5); // warm-up is ignored
    expect(changes).toEqual([]);
    feed(30, 3.2);
    expect(changes).toEqual([1.25]);
    feed(60, 1.5 * 5.5);
    expect(changes).toEqual([1.25]);
    feed(60, 1.5 * 2);
    expect(changes).toEqual([1.25, 1.5]);
  });

  it('AdaptiveDpr ignores windows with a long frame', () => {
    const d = new AdaptiveDpr(1, 2);
    for (let t = 0; t < 5; t += 0.1) d.frame(0.1);
    let changed = false;
    for (let i = 0; i < 4; i++) {
      d.frame(0.3);
      for (let t = 0; t < 1.5; t += 1 / 30) if (d.frame(1 / 30) != null) changed = true;
    }
    expect(changed).toBe(false);
  });
});
