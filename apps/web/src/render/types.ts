// Contract between the render sections (see TEAM-PLAN.md). Every world part has this shape.
import type * as THREE from 'three';
import type { Session } from '../sim/session.ts';
import type { TextureSet } from './textures.ts';

export interface RenderPart {
  /** Added to the world scene by the app shell. */
  object: THREE.Object3D;
  /** Called every frame after session.step(dt). */
  update(s: Session, dt: number): void;
  dispose(): void;
}

export interface AtmospherePart extends RenderPart {
  /** Sets scene fog, renderer exposure and tone mapping for this frame. */
  apply(scene: THREE.Scene, gl: THREE.WebGLRenderer): void;
}

export interface CabinPart {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update(s: Session, dt: number, worldCam: THREE.Camera): void;
  renderMirrors(gl: THREE.WebGLRenderer, world: THREE.Scene, frame: number): void;
  dispose(): void;
}

export type CreateCity = (s: Session, tex: TextureSet) => RenderPart;
export type CreateTraffic = (s: Session) => RenderPart;
export type CreateAtmosphere = (s: Session) => AtmospherePart;
export type CreateCabin = (s: Session) => CabinPart;
