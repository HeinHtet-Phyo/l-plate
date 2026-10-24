// Gaussian-splat street capture (splat.md): Elephant & Castle trained from Panoramax photos, drawn with Spark.
// While it's loaded it is the whole map: the OSM city (buildings, road, markings, lamps, signals) and the AI
// traffic are hidden, and Google 3D Tiles stay off. The cabin, sky and physics stay. If the files are missing
// we log and keep the normal city.
import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { Session } from '../sim/session.ts';

/** Starts that have a splat capture in public/splats/<id>/. */
const SPLAT_STARTS = new Set(['elephant-splat']);

interface Transform {
  /** Column-major 4×4, COLMAP world → local metres (x east, y up, z south). */
  matrix: number[];
  credit?: string;
}

export interface Splat {
  object: THREE.Object3D;
  /** Once the splat has loaded, hides the old map layers it replaces (call every frame). */
  update(s: Session, replaced: THREE.Object3D[]): void;
  status(): string;
  dispose(): void;
}

export function wantsSplat(s: Session): boolean {
  return SPLAT_STARTS.has(s.setup.id);
}

export function createSplat(s: Session, gl: THREE.WebGLRenderer): Splat {
  const base = `/splats/${s.setup.id}`;
  const root = new THREE.Group();
  root.name = 'gaussian-splat';
  let mesh: SplatMesh | null = null;
  let spark: SparkRenderer | null = null;
  let loaded = false;
  let credit: string | null = null;
  let state = 'loading';
  let disposed = false;

  (async () => {
    const t = await fetch(`${base}/transform.json`).then((r) => (r.ok ? (r.json() as Promise<Transform>) : null)).catch(() => null);
    if (!t?.matrix) throw new Error(`${base}/transform.json missing`);
    let file: string | null = null;
    for (const name of ['scene.spz', 'scene.ply']) {
      const r = await fetch(`${base}/${name}`, { method: 'HEAD' }).catch(() => null);
      // Vite's SPA fallback answers missing files with index.html, so check the type too.
      if (r?.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) {
        file = name;
        break;
      }
    }
    if (!file) throw new Error(`no scene.spz or scene.ply in ${base}`);
    if (disposed) return;
    spark = new SparkRenderer({ renderer: gl });
    mesh = new SplatMesh({ url: `${base}/${file}` });
    // The matrix already holds the full placement; Spark must add no rotation of its own.
    mesh.matrixAutoUpdate = false;
    mesh.matrix.fromArray(t.matrix);
    mesh.matrixWorldNeedsUpdate = true;
    root.add(spark, mesh);
    await mesh.initialized;
    if (disposed) return;
    credit = t.credit ?? null;
    loaded = true;
    state = `ok ${file}`;
  })().catch((e) => {
    state = `off (${(e as Error).message})`;
    console.warn('[splat]', state);
  });

  return {
    object: root,
    update(sess, replaced) {
      if (!loaded) return;
      sess.mapCredit = credit;
      for (const o of replaced) o.visible = false;
    },
    status: () => state,
    dispose() {
      disposed = true;
      mesh?.dispose();
      spark?.dispose?.();
      root.clear();
    },
  };
}
