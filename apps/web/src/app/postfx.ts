// Post-processing for the world pass: god rays from the sun, bloom and filmic tone mapping.
// The cabin is drawn afterwards with a plain render, so it stays crisp. ?fx=0 turns this off.
import * as THREE from 'three';
import { BloomEffect, EffectComposer, EffectPass, GodRaysEffect, KernelSize, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { headingVec } from '../sim/geo.ts';
import type { Session } from '../sim/session.ts';

const DEG = Math.PI / 180;

export interface PostFx {
  render(dt: number): void;
  update(s: Session, camera: THREE.PerspectiveCamera): void;
  setSize(w: number, h: number): void;
  dispose(): void;
}

export function createPostFx(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): PostFx {
  const composer = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));

  // The god rays need a visible light source in the scene: a bright sun disc far away.
  const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.92, 0.78), fog: false, toneMapped: false });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 12), sunMat);
  sun.name = 'postfx-sun';
  sun.frustumCulled = false;
  scene.add(sun);

  const godRays = new GodRaysEffect(camera, sun, {
    height: 360,
    kernelSize: KernelSize.SMALL,
    density: 0.97,
    decay: 0.93,
    weight: 0.55,
    exposure: 0.6,
    samples: 60,
    clampMax: 1.0,
    blur: true,
  });
  const bloom = new BloomEffect({ intensity: 0.9, luminanceThreshold: 0.82, luminanceSmoothing: 0.2, mipmapBlur: true });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  composer.addPass(new EffectPass(camera, godRays, bloom, tone, new SMAAEffect()));

  return {
    update(s, cam) {
      const c = s.conditions;
      const [dx, dz] = headingVec(c.sunAzimuth);
      const el = Math.max(-5, c.sunElevation) * DEG;
      sun.position.set(cam.position.x + dx * Math.cos(el) * 3000, cam.position.y + Math.sin(el) * 3000, cam.position.z + dz * Math.cos(el) * 3000);
      const clear = (1 - c.cloud * 0.85) * (1 - c.fog) * (1 - c.rain * 0.8);
      const up = c.sunElevation > -1;
      sun.visible = up;
      // Warmer and stronger when the sun is low (golden hour), gone when it's overcast or night.
      const low = THREE.MathUtils.clamp(1 - c.sunElevation / 25, 0, 1);
      sunMat.color.setRGB(1.0 * 4, (0.92 - 0.25 * low) * 4, (0.78 - 0.45 * low) * 4).multiplyScalar(0.25 + 0.75 * clear);
      godRays.godRaysMaterial.weight = up ? 0.25 + 0.45 * clear * (0.5 + 0.5 * low) : 0;
      bloom.intensity = 0.55 + 0.6 * (1 - c.daylight);
    },
    render(dt) {
      composer.render(dt);
    },
    setSize(w, h) {
      composer.setSize(w, h);
    },
    dispose() {
      scene.remove(sun);
      composer.dispose();
    },
  };
}
