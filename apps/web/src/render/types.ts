// Shared render-module contract (TEAM-PLAN.md). Chris owns this file; created here only because
// nothing had pushed it yet and every render module needs it to compile.
import type * as THREE from 'three';
import type { Session } from '../sim/session.ts';

export interface RenderPart {
  object: THREE.Object3D; // added to the world scene by Chris
  update(s: Session, dt: number): void; // called every frame after session.step(dt)
  dispose(): void;
}
