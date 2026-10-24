// OSRM routing → UK sat nav steps. Used by scripts/build-routes.ts and GET /api/route.
import type { Modifier, RoutedPath, RouteStep, StepType } from '@lplate/shared';

export const USER_AGENT = 'L-Plate/0.1 (London driving-lesson simulator; Noetic x Nebius hackathon)';

interface OsrmManeuver {
  type: string;
  modifier?: string;
  exit?: number;
  location: [number, number];
}
interface OsrmStep {
  distance: number;
  name?: string;
  ref?: string;
  maneuver: OsrmManeuver;
}
interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs: { steps: OsrmStep[] }[];
}

export function osrmBase(): string {
  return (process.env.OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
}

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
export function ordinal(n: number): string {
  return ORD[n - 1] ?? `${n}th`;
}

function onto(road: string): string {
  return road ? ` onto ${road}` : '';
}

const CARDINALS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** UK English instruction for a step. */
export function instructionFor(type: StepType, modifier: Modifier | undefined, road: string, exit?: number, bearing?: number): string {
  const m = modifier ?? 'straight';
  const side = m.includes('left') ? 'left' : m.includes('right') ? 'right' : '';
  switch (type) {
    case 'depart': {
      const dir = bearing != null ? CARDINALS[Math.round(bearing / 45) % 8] : '';
      return `Head ${dir}${road ? ` on ${road}` : ''}`.replace('Head  on', 'Head on').trim();
    }
    case 'arrive':
      return 'You have reached the end of the route';
    case 'roundabout':
    case 'rotary':
      return exit ? `At the roundabout, take the ${ordinal(exit)} exit${onto(road)}` : `At the roundabout, continue${onto(road)}`;
    case 'roundabout turn':
      if (m === 'straight') return `At the mini-roundabout, go straight on${onto(road)}`;
      return `At the mini-roundabout, turn ${side}${onto(road)}`;
    case 'end of road':
      return `At the end of the road, turn ${side || 'left'}${onto(road)}`;
    case 'fork':
      return `At the fork, keep ${side || 'straight on'}${onto(road)}`;
    case 'merge':
      return `Merge${side ? ` ${side}` : ''}${onto(road)}`;
    case 'new name':
    case 'continue':
      if (side && !m.startsWith('slight')) return `Turn ${side}${onto(road)}`;
      if (side) return `Keep ${side}${onto(road)}`;
      return `Continue${onto(road)}`;
    case 'turn':
    default:
      if (m === 'uturn') return `Make a U-turn${road ? ` on ${road}` : ''}`;
      if (m === 'straight') return `Go straight on${onto(road)}`;
      if (m.startsWith('slight')) return `Bear ${side}${onto(road)}`;
      if (m.startsWith('sharp')) return `Turn sharp ${side}${onto(road)}`;
      return `Turn ${side}${onto(road)}`;
  }
}

const KNOWN_TYPES = new Set<StepType>([
  'depart', 'turn', 'new name', 'continue', 'end of road', 'fork', 'merge', 'roundabout', 'rotary', 'roundabout turn', 'arrive',
]);

function mapType(t: string): StepType | null {
  if (t === 'exit roundabout' || t === 'exit rotary' || t === 'notification') return null;
  if (t === 'on ramp' || t === 'off ramp') return 'turn';
  return KNOWN_TYPES.has(t as StepType) ? (t as StepType) : 'turn';
}

/** Convert an OSRM route (steps=true, geometries=geojson) into our RoutedPath. */
export function convertOsrmRoute(route: OsrmRoute): RoutedPath {
  const path = route.geometry.coordinates.map(([lng, lat]) => ({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) }));
  const steps: RouteStep[] = [];
  let at = 0;
  const nLegs = route.legs.length;
  route.legs.forEach((leg, li) => {
    leg.steps.forEach((s) => {
      const raw = s.maneuver.type;
      const type = mapType(raw);
      const skip =
        type === null ||
        (type === 'depart' && li > 0) ||
        (type === 'arrive' && li < nLegs - 1);
      if (!skip && type) {
        const modifier = s.maneuver.modifier as Modifier | undefined;
        const road = (s.name || s.ref || '').trim();
        const bearing = (s.maneuver as { bearing_after?: number }).bearing_after;
        steps.push({
          type,
          modifier,
          exit: s.maneuver.exit,
          road,
          location: { lat: s.maneuver.location[1], lng: s.maneuver.location[0] },
          at: Math.round(at * 10) / 10,
          instruction: instructionFor(type, modifier, road, s.maneuver.exit, bearing),
        });
      }
      at += s.distance;
    });
  });
  // A 'new name' straight on just after a turn is noise; keep only real manoeuvres plus name changes > 30 m apart.
  const cleaned = steps.filter((s, i) => {
    if (s.type !== 'new name' || (s.modifier && s.modifier !== 'straight')) return true;
    const prev = steps[i - 1];
    return !prev || s.at - prev.at > 30;
  });
  return { path, distance: Math.round(route.distance), duration: Math.round(route.duration), steps: cleaned };
}

/** Route through coordinates [lat, lng]. heading (compass) constrains the start bearing. */
export async function routeVia(points: [number, number][], heading?: number, fetchImpl: typeof fetch = fetch): Promise<RoutedPath> {
  if (points.length < 2) throw new Error('need at least two points');
  const coords = points.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const params = new URLSearchParams({ overview: 'full', geometries: 'geojson', steps: 'true' });
  if (heading != null && Number.isFinite(heading)) {
    params.set('bearings', [`${Math.round(((heading % 360) + 360) % 360)},60`, ...points.slice(1).map(() => '')].join(';'));
  }
  const url = `${osrmBase()}/route/v1/driving/${coords}?${params}`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const body = (await res.json()) as { code: string; message?: string; routes?: OsrmRoute[] };
  if (body.code !== 'Ok' || !body.routes?.length) throw new Error(`OSRM ${body.code}: ${body.message ?? 'no route'}`);
  return convertOsrmRoute(body.routes[0]);
}
