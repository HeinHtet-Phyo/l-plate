// The city (TEAM-PLAN §2): road surface, ground, markings, buildings, trees, parked cars,
// streetlights, traffic lights and Belisha beacons, as one RenderPart.
//
// Each part is built on its own; if one throws, the rest of the city still renders and the error is logged.
import * as THREE from 'three';
import type { Session } from '../../sim/session.ts';
import type { TextureSet } from '../textures.ts';
import type { CreateCity, RenderPart } from '../types.ts';
import { shared } from '../atmosphere/uniforms.ts';
import { ensureLampMap, syncCar, type CityPiece } from './common.ts';
import { buildSurface } from './surface.ts';
import { buildMarkings } from './markings.ts';
import { buildBuildings } from './buildings.ts';
import { buildProps } from './props.ts';
import { buildSignals } from './signals.ts';

const PARTS: [string, (s: Session, tex: TextureSet) => CityPiece][] = [
  ['surface', buildSurface],
  ['markings', buildMarkings],
  ['buildings', buildBuildings],
  ['props', buildProps],
  ['signals', buildSignals],
];

export const createCity: CreateCity = (s: Session, tex: TextureSet): RenderPart => {
  const object = new THREE.Group();
  object.name = 'city';
  const lampMap = ensureLampMap(s);
  const pieces: CityPiece[] = [];
  for (const [name, build] of PARTS) {
    const t0 = performance.now();
    try {
      const p = build(s, tex);
      if (!p.object.name) p.object.name = `city-${name}`;
      object.add(p.object);
      pieces.push(p);
      console.info(`[city] ${name} built in ${(performance.now() - t0).toFixed(0)} ms`);
    } catch (e) {
      console.error(`[city] ${name} failed to build`, e);
    }
  }
  return {
    object,
    update(s: Session, dt: number) {
      syncCar(s);
      for (const p of pieces) p.update?.(s, dt);
    },
    dispose() {
      for (const p of pieces) p.dispose();
      object.clear();
      if (lampMap) {
        if (shared.uLampMap.value === lampMap) shared.uLampMap.value = null;
        lampMap.dispose();
      }
    },
  };
};

export type { CityPiece } from './common.ts';
