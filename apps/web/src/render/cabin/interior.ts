// Procedural right-hand-drive interior: dash, binnacle hood, A-pillars, roof, visor, doors, bonnet
// and a steering wheel that turns with the car. Geometry is merged per material to keep draw calls low.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Session } from '../../sim/session.ts';
import { BONNET, CABIN, CENTRE_X, COLOURS, DASH, WHEEL, WINDSCREEN, type CabinModule } from './layout.ts';

type V3 = [number, number, number];

/** A quad from four corners (any winding: materials are double-sided). */
function quad(a: V3, b: V3, c: V3, d: V3): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/** A thin strip along a line from p to q, offset sideways by `w` in x and back by `d` in z. */
function pillar(x0: number, x1: number, back: number): THREE.BufferGeometry[] {
  const b = WINDSCREEN.bottom;
  const t = WINDSCREEN.top;
  const xi = Math.abs(x0) < Math.abs(x1) ? x0 : x1; // inner edge, next to the glass
  return [
    // face towards the driver
    quad([x0, b.y, b.z], [x1, b.y, b.z], [x1, t.y, t.z], [x0, t.y, t.z]),
    // inner side, wrapping back towards the eye
    quad([xi, b.y, b.z], [xi, b.y, b.z + back], [xi, t.y, t.z + back], [xi, t.y, t.z]),
  ];
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

/** The bonnet: a crowned surface sloping down and away, darker towards its edges. */
function bonnet(): THREE.BufferGeometry {
  const nx = 16;
  const nz = 8;
  const g = new THREE.PlaneGeometry(1, 1, nx, nz);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col: number[] = [];
  const half = (BONNET.right - BONNET.left) / 2;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5; // 0 left … 1 right
    const v = pos.getY(i) + 0.5; // 0 near … 1 far
    const x = BONNET.left + u * (BONNET.right - BONNET.left);
    const k = (x - CENTRE_X) / half;
    const crown = 0.05 * (1 - k * k);
    const y = BONNET.near.y + v * (BONNET.far.y - BONNET.near.y) + crown - 0.03 * v * v;
    const z = BONNET.near.z + v * (BONNET.far.z - BONNET.near.z);
    pos.setXYZ(i, x, y, z);
    const shade = 0.55 + 0.45 * (1 - k * k * k * k);
    col.push(shade, shade, shade);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function staticParts() {
  const dash: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const roof: THREE.BufferGeometry[] = [];
  const pillars: THREE.BufferGeometry[] = [];
  const { left, right, floor } = CABIN;
  const top = DASH.top;

  // Binnacle recess behind the wheel, so the cluster sits below the dash line.
  const bx = 0.21;
  const rb = -0.72; // recess back wall
  const rf = -0.33; // recess floor

  // Dash top: full width at the front; split around the binnacle nearer the driver.
  dash.push(quad([left, top, DASH.front], [right, top, DASH.front], [right, top, rb], [left, top, rb]));
  dash.push(quad([left, top, rb], [-bx, top, rb], [-bx, top, DASH.back], [left, top, DASH.back]));
  dash.push(quad([bx, top, rb], [right, top, rb], [right, top, DASH.back], [bx, top, DASH.back]));
  // Rounded lip, then the lower face down towards the knees.
  for (const [x0, x1, yTop] of [
    [left, -bx, top],
    [bx, right, top],
  ] as const) {
    dash.push(quad([x0, yTop, DASH.back], [x1, yTop, DASH.back], [x1, DASH.lip, DASH.back + 0.03], [x0, DASH.lip, DASH.back + 0.03]));
  }
  dash.push(quad([left, DASH.lip, DASH.back + 0.03], [right, DASH.lip, DASH.back + 0.03], [right, floor + 0.15, DASH.back - 0.12], [left, floor + 0.15, DASH.back - 0.12]));
  // Binnacle recess: back wall, floor and sides (the cluster sits inside).
  trim.push(quad([-bx, top, rb], [bx, top, rb], [bx, rf, rb], [-bx, rf, rb]));
  trim.push(quad([-bx, rf, rb], [bx, rf, rb], [bx, rf, DASH.back], [-bx, rf, DASH.back]));
  trim.push(quad([-bx, top, rb], [-bx, rf, rb], [-bx, rf, DASH.back], [-bx, top, DASH.back]));
  trim.push(quad([bx, top, rb], [bx, rf, rb], [bx, rf, DASH.back], [bx, top, DASH.back]));

  // Binnacle hood: an arch over the recess.
  const n = 12;
  const hoodBack = rb - 0.02;
  const hoodFront = -0.58;
  for (let i = 0; i < n; i++) {
    const xa = -bx + (2 * bx * i) / n;
    const xb = -bx + (2 * bx * (i + 1)) / n;
    const ya = top + 0.07 * Math.cos((Math.PI * xa) / (2 * bx));
    const yb = top + 0.07 * Math.cos((Math.PI * xb) / (2 * bx));
    dash.push(quad([xa, ya, hoodBack], [xb, yb, hoodBack], [xb, yb, hoodFront], [xa, ya, hoodFront]));
  }

  // A-pillars on both sides of the windscreen.
  pillars.push(...pillar(WINDSCREEN.right, WINDSCREEN.right + 0.11, 0.06));
  pillars.push(...pillar(WINDSCREEN.left, WINDSCREEN.left - 0.11, 0.06));

  // Roof lining from the windscreen header back over the head, plus the header rail.
  const wt = WINDSCREEN.top;
  roof.push(quad([left - 0.06, wt.y, wt.z], [right + 0.06, wt.y, wt.z], [right + 0.06, CABIN.roof, 0.8], [left - 0.06, CABIN.roof, 0.8]));
  pillars.push(quad([WINDSCREEN.left, wt.y, wt.z], [WINDSCREEN.right, wt.y, wt.z], [WINDSCREEN.right, wt.y - 0.025, wt.z - 0.02], [WINDSCREEN.left, wt.y - 0.025, wt.z - 0.02]));
  // Driver's sun visor, folded up against the roof.
  const roofSlope = Math.atan2(CABIN.roof - wt.y, 0.8 - wt.z);
  roof.push(box(0.5, 0.018, 0.17, -0.03, wt.y + 0.012 + 0.11 * Math.sin(roofSlope), wt.z + 0.13, -roofSlope));

  // Doors: window sill tops and panels below them, from the A-pillar back past the eye.
  for (const x of [left, right]) {
    const out = x > 0 ? 0.06 : -0.06;
    trim.push(quad([x, top, DASH.front], [x + out, top, DASH.front], [x + out, top, 0.6], [x, top, 0.6]));
    trim.push(quad([x, top, DASH.front], [x, top, 0.6], [x, floor, 0.6], [x, floor, DASH.front]));
  }

  return { dash, trim, roof, pillars };
}

function steeringWheel(): { column: THREE.BufferGeometry; spinner: THREE.BufferGeometry } {
  const r = WHEEL.radius;
  const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(r, WHEEL.tube, 10, 48)];
  const hub = new THREE.CylinderGeometry(0.058, 0.064, 0.045, 24);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);
  // Three spokes: 9, 3 and 6 o'clock.
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const len = r - 0.05;
    const g = new THREE.BoxGeometry(len, 0.03, 0.018);
    g.translate(0.05 + len / 2, 0, -0.006);
    g.rotateZ(a);
    parts.push(g);
  }
  const spinner = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  for (const p of parts) p.dispose();
  // Column from the hub into the dash.
  const column = new THREE.CylinderGeometry(0.03, 0.04, 0.28, 12);
  column.rotateX(Math.PI / 2);
  column.translate(0, 0, -0.16);
  return { column, spinner };
}

export function createInterior(_s: Session): CabinModule {
  const group = new THREE.Group();
  group.name = 'cabin-interior';
  const matte = (color: number, roughness = 0.92) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, side: THREE.DoubleSide });

  const mats = {
    dash: matte(COLOURS.dash),
    trim: matte(COLOURS.trim),
    roof: matte(COLOURS.roof, 1),
    pillar: matte(COLOURS.pillar),
    wheel: matte(COLOURS.wheel, 0.7),
    bonnet: new THREE.MeshStandardMaterial({ color: COLOURS.bonnet, roughness: 0.4, metalness: 0.25, vertexColors: true, side: THREE.DoubleSide }),
  };

  const geos: THREE.BufferGeometry[] = [];
  const add = (parts: THREE.BufferGeometry[], mat: THREE.Material) => {
    const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
    for (const p of parts) p.dispose();
    geos.push(g);
    group.add(new THREE.Mesh(g, mat));
  };
  const s = staticParts();
  add(s.dash, mats.dash);
  add(s.trim, mats.trim);
  add(s.roof, mats.roof);
  add(s.pillars, mats.pillar);

  const bonnetGeo = bonnet();
  geos.push(bonnetGeo);
  group.add(new THREE.Mesh(bonnetGeo, mats.bonnet));

  // Steering wheel: tilted back so its top leans away; the spinner turns about the column axis.
  const wheel = steeringWheel();
  geos.push(wheel.column, wheel.spinner);
  const mount = new THREE.Group();
  mount.position.set(WHEEL.x, WHEEL.y, WHEEL.z);
  mount.rotation.x = -WHEEL.tilt;
  const spinner = new THREE.Mesh(wheel.spinner, mats.wheel);
  mount.add(new THREE.Mesh(wheel.column, mats.wheel), spinner);
  group.add(mount);

  return {
    object: group,
    update(s) {
      // Positive angle is a right turn: clockwise as the driver sees it, i.e. negative about +z.
      spinner.rotation.z = -s.world.car.steeringWheelAngle() * THREE.MathUtils.DEG2RAD;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of Object.values(mats)) m.dispose();
    },
  };
}
