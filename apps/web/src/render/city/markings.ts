// Road markings: centre and lane lines, stop lines, give-way lines, zebras with zig-zags.
// PLACEHOLDER: being written on feat/city.
import * as THREE from 'three';
import type { Session } from '../../sim/session.ts';
import type { TextureSet } from '../textures.ts';
import { disposeTree, type CityPiece } from './common.ts';

export function buildMarkings(_s: Session, _tex: TextureSet): CityPiece {
  const object = new THREE.Group();
  return { object, dispose: () => disposeTree(object) };
}
