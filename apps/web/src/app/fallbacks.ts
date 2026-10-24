// Simple stand-ins for the render parts, used until the team's modules land (see parts.ts).
import * as THREE from 'three';
import { headingVec } from '../sim/geo.ts';
import type { Session } from '../sim/session.ts';
import type { AtmospherePart, CabinPart, RenderPart } from '../render/types.ts';
import type { TextureSet } from '../render/textures.ts';
import type { Style } from '../sim/city.ts';

const DEG = Math.PI / 180;

function roadSurface(s: Session, tex: TextureSet): THREE.Mesh {
  const g = s.grid;
  const mask = new THREE.DataTexture(g.rgba(), g.n, g.n, THREE.RGBAFormat);
  mask.magFilter = THREE.LinearFilter;
  mask.minFilter = THREE.LinearMipmapLinearFilter;
  mask.generateMipmaps = true;
  mask.needsUpdate = true;
  const size = 2 * g.radius;
  const segs = Math.min(320, Math.ceil(size / 12));
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uMask: { value: mask },
      uAsphalt: { value: tex.asphalt },
      uPaving: { value: tex.paving },
      uRadius: { value: g.radius },
      uLight: { value: 1 },
    },
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vXZ;
      void main() {
        vXZ = position.xz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform sampler2D uMask, uAsphalt, uPaving;
      uniform float uRadius, uLight;
      varying vec2 vXZ;
      void main() {
        vec2 uv = (vXZ + uRadius) / (2.0 * uRadius);
        vec4 hard = textureLod(uMask, uv, 0.0);
        if (hard.r < 0.5 && hard.g < 0.5) discard;
        vec4 m = texture2D(uMask, uv);
        vec3 asphalt = texture2D(uAsphalt, vXZ / 4.0).rgb * 0.55;
        vec3 paving = texture2D(uPaving, vXZ / 3.6).rgb * 0.85;
        vec3 col = mix(paving, asphalt, smoothstep(0.35, 0.65, m.r));
        float kerb = smoothstep(0.25, 0.5, m.r) * (1.0 - smoothstep(0.5, 0.75, m.r)) * step(0.05, m.g);
        col = mix(col, vec3(0.62, 0.6, 0.56), kerb);
        gl_FragColor = vec4(col * uLight, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.02;
  mesh.renderOrder = 1;
  return mesh;
}

function buildingsMesh(s: Session, tex: TextureSet): THREE.Group {
  const group = new THREE.Group();
  const byStyle = new Map<Style, { pos: number[]; uv: number[]; nrm: number[]; col: number[] }>();
  const roof = { pos: [] as number[], nrm: [] as number[], col: [] as number[] };
  for (const b of s.buildings) {
    let pts = b.pts;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      area += x1 * z2 - x2 * z1;
    }
    if (area > 0) pts = [...pts].reverse(); // right-of-edge is outward
    const bucket = byStyle.get(b.style) ?? { pos: [], uv: [], nrm: [], col: [] };
    byStyle.set(b.style, bucket);
    let u = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      const u0 = u / 9;
      const u1 = (u + len) / 9;
      const v1 = b.h / 9;
      const quad = [
        [ax, 0, az, u0, 0],
        [bx, 0, bz, u1, 0],
        [bx, b.h, bz, u1, v1],
        [ax, 0, az, u0, 0],
        [bx, b.h, bz, u1, v1],
        [ax, b.h, az, u0, v1],
      ];
      for (const [x, y, z, uu, vv] of quad) {
        bucket.pos.push(x, y, z);
        bucket.uv.push(uu, vv);
        bucket.nrm.push(nx, 0, nz);
        bucket.col.push(b.tint, b.tint, b.tint);
      }
      u += len;
    }
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    let tris: number[][] = [];
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      tris = [];
    }
    const rc = b.roof === 'flat' ? 0.42 : 0.3;
    for (const t of tris) {
      const p = t.map((i) => pts[i]);
      const cross = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
      const order = cross > 0 ? [0, 2, 1] : [0, 1, 2];
      for (const k of order) {
        roof.pos.push(p[k][0], b.h, p[k][1]);
        roof.nrm.push(0, 1, 0);
        roof.col.push(rc, rc, rc * 1.05);
      }
    }
  }
  for (const [style, d] of byStyle) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(d.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
    group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex.upper[style], vertexColors: true })));
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(roof.pos, 3));
  rg.setAttribute('normal', new THREE.Float32BufferAttribute(roof.nrm, 3));
  rg.setAttribute('color', new THREE.Float32BufferAttribute(roof.col, 3));
  group.add(new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ vertexColors: true })));
  return group;
}

export function carPieces(): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const body = new THREE.BoxGeometry(1.8, 0.7, 4.2);
  body.translate(0, 0.55, 0);
  const glass = new THREE.BoxGeometry(1.6, 0.55, 2.2);
  glass.translate(0, 1.15, 0.2);
  return { body, glass };
}

function placeInstance(m: THREE.InstancedMesh, i: number, x: number, z: number, heading: number, dummy: THREE.Object3D) {
  dummy.position.set(x, 0, z);
  dummy.rotation.set(0, -heading * DEG, 0); // local −z faces the heading
  dummy.updateMatrix();
  m.setMatrixAt(i, dummy.matrix);
}

export function createCityFallback(s: Session, tex: TextureSet): RenderPart {
  const group = new THREE.Group();
  const r = s.ex.radius;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2 * r + 2000, 2 * r + 2000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5d6450 }));
  group.add(ground);
  const road = roadSurface(s, tex);
  group.add(road);
  group.add(buildingsMesh(s, tex));
  const dummy = new THREE.Object3D();
  const { body, glass } = carPieces();
  const pb = new THREE.InstancedMesh(body, new THREE.MeshLambertMaterial(), Math.max(1, s.parked.length));
  const pg = new THREE.InstancedMesh(glass, new THREE.MeshLambertMaterial({ color: 0x1a1f26 }), Math.max(1, s.parked.length));
  s.parked.forEach((p, i) => {
    placeInstance(pb, i, p.x, p.z, p.heading, dummy);
    placeInstance(pg, i, p.x, p.z, p.heading, dummy);
    pb.setColorAt(i, new THREE.Color(p.colour));
  });
  pb.count = pg.count = s.parked.length;
  group.add(pb, pg);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.22, 1, 6).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0x4a3b2c }), Math.max(1, s.trees.length));
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0x3f5a2a }), Math.max(1, s.trees.length));
  s.trees.forEach((t, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(t.x, 0, t.z);
    dummy.scale.set(1, t.h * 0.45, 1);
    dummy.updateMatrix();
    trunk.setMatrixAt(i, dummy.matrix);
    dummy.position.set(t.x, t.h * 0.62, t.z);
    dummy.scale.set(t.h * 0.3, t.h * 0.33, t.h * 0.3);
    dummy.updateMatrix();
    crown.setMatrixAt(i, dummy.matrix);
  });
  trunk.count = crown.count = s.trees.length;
  dummy.scale.set(1, 1, 1);
  group.add(trunk, crown);
  // Traffic light heads as simple boxes with a lamp that changes colour.
  const lines = s.signals.lines;
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 1.0, 0.3).translate(0, 2.6, 0), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }), Math.max(1, lines.length));
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6).translate(0, 2.6, -0.18), new THREE.MeshBasicMaterial(), Math.max(1, lines.length));
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6).translate(0, 1.3, 0), new THREE.MeshLambertMaterial({ color: 0x222222 }), Math.max(1, lines.length));
  lines.forEach((l, i) => {
    for (const m of [heads, lamps, poles]) placeInstance(m, i, l.head.x, l.head.z, l.head.heading, dummy);
  });
  heads.count = lamps.count = poles.count = lines.length;
  group.add(heads, lamps, poles);
  const colours = { red: new THREE.Color(3, 0.1, 0.05), amber: new THREE.Color(3, 1.4, 0), redAmber: new THREE.Color(3, 0.8, 0), green: new THREE.Color(0.1, 3, 0.6) };
  return {
    object: group,
    update(sess) {
      const day = sess.conditions.daylight;
      (road.material as THREE.ShaderMaterial).uniforms.uLight.value = 0.25 + 0.75 * day * (1 - 0.35 * sess.conditions.cloud);
      lines.forEach((l, i) => lamps.setColorAt(i, colours[sess.signals.aspect(l, sess.world.time)]));
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
    },
  };
}

export function createTrafficFallback(s: Session): RenderPart {
  const max = 130;
  const { body, glass } = carPieces();
  const bodies = new THREE.InstancedMesh(body, new THREE.MeshLambertMaterial(), max);
  const glasses = new THREE.InstancedMesh(glass, new THREE.MeshLambertMaterial({ color: 0x1a1f26 }), max);
  const brakes = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.15, 0.05).translate(0, 0.75, 2.12), new THREE.MeshBasicMaterial(), max);
  const group = new THREE.Group();
  group.add(bodies, glasses, brakes);
  const dummy = new THREE.Object3D();
  const on = new THREE.Color(3, 0.1, 0.1);
  const off = new THREE.Color(0.25, 0.02, 0.02);
  const c = new THREE.Color();
  return {
    object: group,
    update(sess) {
      const cars = sess.traffic.cars;
      const n = Math.min(max, cars.length);
      for (let i = 0; i < n; i++) {
        const car = cars[i];
        for (const m of [bodies, glasses, brakes]) placeInstance(m, i, car.rx, car.rz, car.rh, dummy);
        bodies.setColorAt(i, c.set(car.colour));
        brakes.setColorAt(i, car.braking ? on : off);
      }
      bodies.count = glasses.count = brakes.count = n;
      for (const m of [bodies, glasses, brakes]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    },
    dispose() {
      body.dispose();
      glass.dispose();
    },
  };
}

export function createAtmosphereFallback(s: Session): AtmospherePart {
  const group = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a4436, 1);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2);
  group.add(hemi, sun, sun.target);
  const fog = new THREE.FogExp2(0xaabbcc, 0.002);
  const sky = new THREE.Color();
  return {
    object: group,
    update(sess) {
      const c = sess.conditions;
      const day = c.daylight;
      hemi.intensity = 0.16 + 1.15 * day * (1 - 0.25 * c.cloud);
      sun.intensity = day * (1 - 0.8 * c.cloud) * 2.2;
      const el = Math.max(5, c.sunElevation) * DEG;
      const [dx, dz] = headingVec(c.sunAzimuth);
      const car = sess.world.car;
      sun.position.set(car.x + dx * Math.cos(el) * 300, Math.sin(el) * 300, car.z + dz * Math.cos(el) * 300);
      sun.target.position.set(car.x, 0, car.z);
      const clear = new THREE.Color(0x6fa3d8);
      const grey = new THREE.Color(0xa7adb3);
      const night = new THREE.Color(0x05070c);
      sky.copy(clear).lerp(grey, c.cloud).lerp(night, 1 - day);
      const vis = 2000 * (1 - c.fog) ** 2 + 60;
      fog.color.copy(sky);
      fog.density = 1.7 / (vis * (1 - 0.35 * c.rain) * (1 - 0.25 * (1 - day)));
    },
    apply(scene, gl) {
      scene.fog = fog;
      scene.background = sky;
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 0.85 + 0.2 * s.conditions.daylight;
    },
    dispose() {},
  };
}

export function createCabinFallback(s: Session): CabinPart {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.02, 10);
  scene.add(new THREE.AmbientLight(0xffffff, 1.6), camera);
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3d44 });
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 0.5), dark);
  dash.position.set(-0.37, -0.55, -0.95);
  const bonnet = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 1.0), new THREE.MeshLambertMaterial({ color: 0x8b1e1e }));
  bonnet.position.set(-0.37, -0.62, -1.6);
  bonnet.rotation.x = 0.08;
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 10, 32), dark);
  wheel.position.set(0, -0.42, -0.55);
  wheel.rotation.x = -0.35;
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.02), dark);
  wheel.add(spoke);
  const pillarL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), dark);
  pillarL.position.set(-1.28, 0.0, -0.85);
  pillarL.rotation.x = -0.6;
  const pillarR = pillarL.clone();
  pillarR.position.x = 0.56;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 0.9), new THREE.MeshLambertMaterial({ color: 0x3a3a3c }));
  roof.position.set(-0.37, 0.33, -0.1);
  scene.add(dash, bonnet, wheel, pillarL, pillarR, roof);
  return {
    scene,
    camera,
    update(sess, _dt, worldCam) {
      const wc = worldCam as THREE.PerspectiveCamera;
      camera.fov = wc.fov;
      camera.aspect = wc.aspect;
      camera.updateProjectionMatrix();
      wheel.rotation.z = -sess.world.car.steeringWheelAngle() * DEG;
    },
    renderMirrors() {},
    dispose() {},
  };
}
