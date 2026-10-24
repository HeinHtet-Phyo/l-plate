// Windscreen rain: procedural drops on the glass plus two wipers that clear them (TEAM-PLAN §3, §8).
// Everything lives in a group whose local frame is the glass: x along the bottom edge from the left
// pillar, y up the rake, z out of the glass towards the driver. Units are metres.
import * as THREE from 'three';
import type { Session } from '../../sim/session.ts';
import { WINDSCREEN, WIPERS, type CabinModule } from './layout.ts';

const TAU = Math.PI * 2;
/** Height of the wiper pivots above the glass's bottom edge. */
const PIVOT_V = 0.035;

const vertex = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragment = /* glsl */ `
uniform float uTime, uRain, uWipeClock, uIdle, uPeriod, uSweep, uLen, uPivotV;
uniform vec2 uPivots;
varying vec2 vP;
const float TAU = 6.2831853;

float h12(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

// Seconds since a blade last crossed this point (wipe time + idle time), or -1 outside its sector.
// The blade angle is sweep * (1 - cos(TAU t / period)) / 2, so each angle is crossed at t1 and period - t1.
float sinceWipe(vec2 p, float px) {
  vec2 d = p - vec2(px, uPivotV);
  float a = atan(d.y, d.x);
  if (length(d) > uLen || a < -0.03 || a > uSweep + 0.03) return -1.0;
  float t1 = uPeriod * acos(1.0 - 2.0 * clamp(a / uSweep, 0.0, 1.0)) / TAU;
  float t2 = uPeriod - t1;
  float tc = uWipeClock;
  float last = tc >= t2 ? tc - t2 : tc >= t1 ? tc - t1 : tc + uPeriod - t2;
  return last + uIdle;
}

// One layer of drops on a grid of cells (metres). slide > 0 makes columns creep down the glass.
vec4 drops(vec2 p, float cell, float age, float slide, float seed) {
  vec2 g = p / cell;
  float col = floor(g.x);
  float fall = slide * (0.3 + h12(vec2(col, seed)));
  g.y += uTime * fall;
  vec2 id = floor(g) + seed;
  if (h12(id + 7.7) > 0.2 + 0.55 * uRain) return vec4(0.0);
  vec2 c = 0.25 + 0.5 * vec2(h12(id), h12(id + 1.9));
  float r = mix(0.12, 0.3, h12(id + 3.3));
  vec2 q = (fract(g) - c) / vec2(r, r * (1.0 + 0.6 * step(0.001, fall)));
  float d = length(q);
  if (d > 1.0) return vec4(0.0);

  float vis;
  if (age < 0.0) {
    // Outside the wiped area drops come and go on their own cycle.
    float life = 6.0 + 6.0 * h12(id + 5.5);
    float t = fract(uTime / life + h12(id + 9.9));
    vis = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.85, 1.0, t));
  } else {
    // Inside it they land one by one after the blade passes; heavier rain lands them sooner.
    float delay = h12(id + 11.1) * 2.2 / (0.25 + uRain);
    vis = smoothstep(delay, delay + 0.2, age);
  }

  // A bead: darker core, bright rim, a specular glint top-left.
  float rim = smoothstep(0.6, 0.92, d) * (1.0 - smoothstep(0.92, 1.0, d));
  float spec = smoothstep(0.3, 0.0, length(q - vec2(-0.35, 0.4)));
  vec3 rgb = mix(vec3(0.03, 0.04, 0.05), vec3(0.85, 0.9, 0.95), max(rim * 0.7, spec));
  float a = (0.16 + 0.3 * rim + 0.55 * spec) * (1.0 - smoothstep(0.92, 1.0, d));
  return vec4(rgb, a * vis);
}

void main() {
  float s0 = sinceWipe(vP, uPivots.x);
  float s1 = sinceWipe(vP, uPivots.y);
  float age = s0 < 0.0 ? s1 : s1 < 0.0 ? s0 : min(s0, s1);

  vec3 rgb = vec3(0.6, 0.63, 0.66);
  float a = 0.035 * uRain;
  vec4 l = drops(vP, 0.034, age, 0.0, 0.0);
  rgb = mix(rgb, l.rgb, l.a); a += l.a * (1.0 - a);
  l = drops(vP, 0.017, age, 0.0, 31.0);
  rgb = mix(rgb, l.rgb, l.a); a += l.a * (1.0 - a);
  l = drops(vP + vec2(0.011, 0.0), 0.05, age, 0.12, 57.0);
  rgb = mix(rgb, l.rgb, l.a * 0.8); a += l.a * 0.8 * (1.0 - a);

  gl_FragColor = vec4(rgb, a * smoothstep(0.0, 0.12, uRain));
}`;

export function createWindscreenRain(_s: Session): CabinModule {
  const W = WINDSCREEN.right - WINDSCREEN.left;
  const rise = WINDSCREEN.top.y - WINDSCREEN.bottom.y;
  const run = WINDSCREEN.top.z - WINDSCREEN.bottom.z;
  const H = Math.hypot(rise, run);

  // Glass frame: x across, y up the rake, z = normal towards the driver.
  const object = new THREE.Group();
  const x = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3(0, rise, run).normalize();
  const n = new THREE.Vector3().crossVectors(x, up).normalize();
  object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, n));
  object.position.set(WINDSCREEN.left, WINDSCREEN.bottom.y, WINDSCREEN.bottom.z);

  const uniforms = {
    uTime: { value: 0 },
    uRain: { value: 0 },
    uWipeClock: { value: 0 },
    uIdle: { value: 1e3 },
    uPeriod: { value: WIPERS.period },
    uSweep: { value: WIPERS.sweep },
    uLen: { value: WIPERS.length },
    uPivotV: { value: PIVOT_V },
    uPivots: { value: new THREE.Vector2(WIPERS.pivots[0] - WINDSCREEN.left, WIPERS.pivots[1] - WINDSCREEN.left) },
  };
  const glassGeo = new THREE.PlaneGeometry(W, H).translate(W / 2, H / 2, 0);
  const glassMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.renderOrder = 10;
  glass.visible = false;
  object.add(glass);

  // Wipers: arm along +x when parked, rotating about the glass normal up the screen.
  const L = WIPERS.length;
  const armGeo = new THREE.BoxGeometry(L, 0.012, 0.008).translate(L / 2, 0, 0.006);
  const bladeGeo = new THREE.BoxGeometry(L * 0.85, 0.02, 0.012).translate(L * 0.55, 0.012, 0.008);
  const wiperMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6, metalness: 0.2 });
  const wipers = WIPERS.pivots.map((px) => {
    const pivot = new THREE.Group();
    pivot.position.set(px - WINDSCREEN.left, PIVOT_V, 0);
    pivot.add(new THREE.Mesh(armGeo, wiperMat), new THREE.Mesh(bladeGeo, wiperMat));
    object.add(pivot);
    return pivot;
  });

  let time = 0;
  let clock = 0; // position in the current wipe cycle, seconds
  let wiping = false;
  let idle = 1e3; // seconds parked; the glass starts fully beaded

  return {
    object,
    update(s, dt) {
      time += dt;
      const rain = s.conditions.rain;
      const want = rain > 0.05;
      if (want) wiping = true;
      if (wiping) {
        idle = 0;
        clock += dt;
        if (clock >= WIPERS.period) {
          clock -= WIPERS.period;
          // Rain stopped: finish the sweep and park at the bottom of the cycle.
          if (!want) {
            wiping = false;
            clock = 0;
          }
        }
      } else idle += dt;

      const angle = (WIPERS.sweep * (1 - Math.cos((TAU * clock) / WIPERS.period))) / 2;
      for (const w of wipers) w.rotation.z = angle;

      uniforms.uTime.value = time;
      uniforms.uRain.value = rain;
      uniforms.uWipeClock.value = clock;
      uniforms.uIdle.value = idle;
      glass.visible = rain >= 0.02 || wiping;
    },
    dispose() {
      glassGeo.dispose();
      glassMat.dispose();
      armGeo.dispose();
      bladeGeo.dispose();
      wiperMat.dispose();
    },
  };
}
