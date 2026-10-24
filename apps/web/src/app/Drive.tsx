// The drive screen: builds the session, runs the two-pass render loop, shows the HUD.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { TestRoute } from '@lplate/shared';
import { loadExtract } from '../sim/osm.ts';
import { Session } from '../sim/session.ts';
import { defaultConditions, fetchOpenMeteo, liveSun, presetConditions, type Conditions, type PresetId } from '../sim/conditions.ts';
import { AdaptiveDpr, type GpuInfo } from '../sim/gpu.ts';
import { makeTextures } from '../render/textures.ts';
import type { HostLink } from '../net/pairing.ts';
import { createAtmosphere, createCabin, createCity, createTraffic, partSources } from './parts.ts';
import { Hud } from './Hud.tsx';
import { loadTextureOverrides, mergeTextures, type TextureOverrides } from './textureImages.ts';
import { createPostFx } from './postfx.ts';
import { createGoogleTiles } from './googleTiles.ts';
import { drapeObject } from './terrain.ts';
import { createSplat, wantsSplat } from './splat.ts';

const QUERY = new URLSearchParams(location.search);
const GOOGLE_KEY = (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined)?.trim() || '';
import routesJson from '../routes/test-routes.json';
import startsJson from '../routes/free-starts.json';

const ROUTES = routesJson as unknown as TestRoute[];
const STARTS = startsJson as { id: string; name: string; lat: number; lng: number; heading: number }[];
const DEG = Math.PI / 180;

export interface DriveProps {
  kind: 'route' | 'free';
  id: string;
  weather: 'live' | PresetId;
  voice: boolean;
  instructor: boolean;
  instructorAvailable: boolean;
  mirrors: boolean;
  host: HostLink | null;
  gpu: GpuInfo;
  onExit: () => void;
  onRestart: () => void;
}

export function Drive(props: DriveProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [texOverrides, setTexOverrides] = useState<TextureOverrides>({ upper: {}, ground: {} });
  const [progress, setProgress] = useState('Loading map data…');
  const [error, setError] = useState<string | null>(null);
  const maxDpr = Math.min(2, window.devicePixelRatio || 1);
  // Max quality by default (full device pixel ratio, no adaptive drops); ?quality=low restores adaptive resolution.
  const lowQuality = QUERY.get('quality') === 'low';
  const [dpr, setDpr] = useState(props.gpu.software ? Math.min(1, maxDpr) : lowQuality ? Math.min(1.5, maxDpr) : maxDpr);
  const started = useRef(false);
  const route = props.kind === 'route' ? ROUTES.find((r) => r.id === props.id) : undefined;
  const start = props.kind === 'route' ? route?.start : STARTS.find((s) => s.id === props.id);
  const place = props.kind === 'route' ? route?.centre.name ?? props.id : STARTS.find((s) => s.id === props.id)?.name ?? props.id;

  useEffect(() => {
    if (started.current) return; // one session per mount (no StrictMode double-runs)
    started.current = true;
    let cancelled = false;
    let built: Session | null = null;
    (async () => {
      if (!start) throw new Error(`Unknown ${props.kind} "${props.id}"`);
      setProgress(`Building ${place} in 3D…`);
      const extract = await loadExtract(props.id);
      if (!extract.roads.length) throw new Error(`No map data for ${props.id} yet (the OSM extract is empty).`);
      let conditions: Conditions;
      if (props.weather === 'live') {
        conditions = await fetchOpenMeteo(start.lat, start.lng).catch(() => defaultConditions());
      } else conditions = presetConditions(props.weather);
      const s = new Session({
        kind: props.kind,
        id: props.id,
        name: place,
        extract,
        route,
        start: { lat: start.lat, lng: start.lng, heading: start.heading },
        conditions,
        voice: props.voice,
        instructor: props.instructor,
        instructorAvailable: props.instructorAvailable,
        host: props.host,
      });
      built = s;
      await s.build((m) => setProgress(`Building ${place} in 3D… ${m}`));
      setProgress(`Building ${place} in 3D… Loading textures…`);
      const loaded = await loadTextureOverrides();
      s.debugExtra.textures = loaded.count ? `${loaded.count} generated` : 'procedural';
      if (cancelled) return;
      setTexOverrides(loaded.overrides);
      setSession(s);
    })().catch((e) => setError((e as Error).message));
    return () => {
      cancelled = true;
      built?.dispose();
    };
  }, []);

  // Live weather refresh every 10 minutes; sun position every minute.
  useEffect(() => {
    if (!session || props.weather !== 'live' || !start) return;
    const sun = setInterval(() => {
      const s = liveSun();
      Object.assign(session.conditions, { daylight: s.daylight, sunElevation: s.elevation, sunAzimuth: s.azimuth, hour: s.hour, weekend: s.weekend });
    }, 60_000);
    const wx = setInterval(() => {
      fetchOpenMeteo(start.lat, start.lng).then((c) => (session.conditions = c)).catch(() => {});
    }, 600_000);
    return () => {
      clearInterval(sun);
      clearInterval(wx);
    };
  }, [session]);

  if (error) {
    return (
      <div className="loading">
        <div>
          <h2>Couldn't start the drive</h2>
          <p>{error}</p>
          <button onClick={props.onExit}>Back to menu</button>
        </div>
      </div>
    );
  }

  return (
    <div className="drive">
      {session && (
        <Canvas
          dpr={dpr}
          gl={{ powerPreference: 'high-performance', antialias: !props.gpu.software }}
          camera={{ near: 0.1, far: 6000, fov: 60 }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
        >
          <DriveScene session={session} texOverrides={texOverrides} mirrors={props.mirrors} dpr={dpr} setDpr={lowQuality || props.gpu.software ? setDpr : () => {}} maxDpr={props.gpu.software ? 1 : maxDpr} />
        </Canvas>
      )}
      {session ? (
        <Hud session={session} gpu={props.gpu} host={props.host} onExit={props.onExit} onRestart={props.onRestart} attribution={session.ex.attribution} infill={session.infillCount > 0} />
      ) : (
        <div className="loading">
          <div>
            <div className="spinner" />
            <p>{progress}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function DriveScene({ session, texOverrides, mirrors, dpr, setDpr, maxDpr }: { session: Session; texOverrides: TextureOverrides; mirrors: boolean; dpr: number; setDpr: (n: number) => void; maxDpr: number }) {
  const { gl, scene, camera, size } = useThree();
  const parts = useMemo(() => {
    const tex = mergeTextures(makeTextures(gl.capabilities.getMaxAnisotropy()), texOverrides);
    return {
      city: createCity(session, tex),
      traffic: createTraffic(session),
      atmosphere: createAtmosphere(session),
      cabin: createCabin(session),
    };
  }, [session, gl]);
  const adaptive = useMemo(() => new AdaptiveDpr(dpr, maxDpr), []);
  const fx = useMemo(() => (QUERY.get('fx') === '0' ? null : createPostFx(gl, scene, camera as THREE.PerspectiveCamera)), [gl, scene, camera]);
  // Google 3D Tiles are on for Goodmayes (the demo route) to keep Map Tiles costs down; ?tiles=1 forces them elsewhere.
  // A Gaussian-splat start is the whole map, so no Google tiles there.
  const tilesWanted = !wantsSplat(session) && (QUERY.get('tiles') === '1' || (QUERY.get('tiles') !== '0' && session.setup.id === 'goodmayes'));
  const tiles = useMemo(() => (GOOGLE_KEY && tilesWanted ? createGoogleTiles(session, GOOGLE_KEY) : null), [session]);
  useEffect(() => {
    fx?.setSize(size.width, size.height);
  }, [fx, size.width, size.height, dpr]);
  useEffect(() => {
    if (!tiles) return;
    scene.add(tiles.object);
    // Our road, markings, cars and props follow the Google terrain instead of a flat plane.
    drapeObject(parts.city.object);
    drapeObject(parts.traffic.object);
    return () => {
      scene.remove(tiles.object);
      tiles.dispose();
    };
  }, [tiles]);
  // Gaussian-splat street capture for starts that have one (splat.ts); once loaded it replaces the OSM city and AI traffic.
  const splat = useMemo(() => (wantsSplat(session) && QUERY.get('splat') !== '0' ? createSplat(session, gl) : null), [session, gl]);
  useEffect(() => {
    if (!splat) return;
    scene.add(splat.object);
    return () => {
      scene.remove(splat.object);
      splat.dispose();
    };
  }, [splat]);
  useEffect(() => () => fx?.dispose(), [fx]);
  const frame = useRef(0);

  useEffect(() => {
    scene.add(parts.city.object, parts.traffic.object, parts.atmosphere.object);
    session.debugExtra.parts = Object.entries(partSources).map(([k, v]) => `${k}:${v}`).join(' ');
    session.start();
    return () => {
      scene.remove(parts.city.object, parts.traffic.object, parts.atmosphere.object);
      parts.city.dispose();
      parts.traffic.dispose();
      parts.atmosphere.dispose();
      parts.cabin.dispose();
    };
  }, [parts]);

  useFrame((_state, delta) => {
    // Fixed sim steps of ≤ 50 ms; on slow frames take several, so driving runs at real speed
    // even when max-quality graphics bring the frame rate down.
    const dt = Math.min(0.05, delta);
    let rem = Math.min(0.25, delta);
    while (rem > 1e-4) {
      const step = Math.min(0.05, rem);
      session.step(step);
      rem -= step;
    }
    const cam = camera as THREE.PerspectiveCamera;
    const car = session.world.car;
    // Horizontal FOV ≈ 100°; vertical from the aspect ratio.
    const aspect = size.width / Math.max(1, size.height);
    const vfov = (2 * Math.atan(Math.tan(50 * DEG) / aspect)) / DEG;
    if (Math.abs(cam.fov - vfov) > 0.01 || Math.abs(cam.aspect - aspect) > 0.001) {
      cam.fov = vfov;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    const rumble = Math.min(1, car.speed / 20) * 0.004 * Math.sin(session.time * 37) ;
    cam.position.set(car.x, 1.2 + (tiles?.ground() ?? 0) + session.world.bodyRise + session.spring.y * 0.08 + rumble, car.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(session.pitch, -car.heading * DEG, 0);
    cam.updateMatrixWorld();

    parts.city.update(session, dt);
    parts.traffic.update(session, dt);
    parts.atmosphere.update(session, dt);
    parts.atmosphere.apply(scene, gl);
    parts.cabin.update(session, dt, cam);
    if (tiles) {
      tiles.update(session, cam, gl, parts.city.object, scene);
      session.mapCredit = tiles.credits() || null;
      session.debugExtra.tiles = tiles.status();
    }
    if (splat) {
      splat.update(session, [parts.city.object, parts.traffic.object]);
      session.debugExtra.splat = splat.status();
    }
    if (fx) fx.update(session, cam);
    if (mirrors) parts.cabin.renderMirrors(gl, scene, frame.current++);

    gl.setRenderTarget(null);
    if (fx) {
      fx.render(dt); // world pass with god rays, bloom and tone mapping
    } else {
      gl.autoClear = false;
      gl.clear();
      gl.render(scene, cam);
    }
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(parts.cabin.scene, parts.cabin.camera);

    const next = adaptive.frame(delta);
    session.debugExtra.fps = adaptive.fps.toFixed(0);
    session.debugExtra.dpr = dpr.toFixed(2);
    if (next != null) setDpr(next);
  }, 1);

  return null;
}
