// Sat nav: route tracking, off-route/rerouting, UK-style announcements and distance formats.
import type { RoutedPath, RouteStep, SpeedLimitSpan } from '@lplate/shared';
import { angleDiff, clamp, closestOnSegment, cumulative, haversine, project, vecHeading } from './geo.ts';

const YARD = 0.9144;
const MILE = 1609.344;

/** Screen format: yards below a quarter mile (10 yd steps under 100, then 50), miles to 1 dp under 10. */
export function formatScreenDistance(m: number): string {
  const yd = m / YARD;
  if (m < MILE / 4) {
    if (yd < 100) return `${Math.max(10, Math.round(yd / 10) * 10)} yd`;
    return `${Math.round(yd / 50) * 50} yd`;
  }
  const mi = m / MILE;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

/** Spoken format. */
export function formatSpokenDistance(m: number): string {
  if (m < 30) return 'just ahead';
  if (m < 300) return `in about ${Math.max(50, Math.round(m / YARD / 50) * 50)} yards`;
  const mi = m / MILE;
  if (mi < 0.375) return 'in a quarter of a mile';
  if (mi < 0.625) return 'in half a mile';
  if (mi < 0.875) return 'in three quarters of a mile';
  const half = Math.round(mi * 2) / 2;
  return `in ${half === 1 ? 'a mile' : `${half} miles`}`;
}

export function announceDistance(speed: number): number {
  return clamp(speed * 9 + 40, 60, 250);
}

export class RouteTracker {
  pts: [number, number][];
  cum: number[];
  total: number;
  s = 0;
  maxS = 0;
  dist = 0;
  offSince: number | null = null;
  off = false;
  wrongWay = false;

  constructor(path: { lat: number; lng: number }[], origin: { lat: number; lng: number }) {
    this.pts = path.map((p) => project(origin, p.lat, p.lng));
    this.cum = cumulative(this.pts);
    this.total = this.cum[this.cum.length - 1] ?? 0;
  }

  private project(x: number, z: number, fromS: number, toS: number) {
    let best = { s: this.s, dist: Infinity, i: 0 };
    for (let i = 0; i < this.pts.length - 1; i++) {
      if (this.cum[i + 1] < fromS || this.cum[i] > toS) continue;
      const [ax, az] = this.pts[i];
      const [bx, bz] = this.pts[i + 1];
      const c = closestOnSegment(x, z, ax, az, bx, bz);
      if (c.dist < best.dist) best = { s: this.cum[i] + c.t * (this.cum[i + 1] - this.cum[i]), dist: c.dist, i };
    }
    return best;
  }

  /** Direction of the path at s (compass). */
  headingAt(s: number): number {
    let i = 0;
    while (i < this.cum.length - 2 && this.cum[i + 1] < s) i++;
    const [ax, az] = this.pts[i];
    const [bx, bz] = this.pts[i + 1] ?? this.pts[i];
    return vecHeading(bx - ax, bz - az);
  }

  update(x: number, z: number, heading: number, speed: number, time: number) {
    let p = this.project(x, z, this.s - 60, this.s + 300);
    if (p.dist > 35) {
      // Watch for the car rejoining further along after a detour.
      const g = this.project(x, z, this.s - 60, Infinity);
      if (g.dist <= 35) p = g;
    }
    this.dist = p.dist;
    this.s = p.s;
    this.maxS = Math.max(this.maxS, this.s);
    const along = Math.abs(angleDiff(heading, this.headingAt(this.s))) > 120 && speed > 1;
    this.wrongWay = along && this.maxS - this.s > 40;
    if (p.dist > 35 || this.wrongWay) {
      if (this.offSince == null) this.offSince = time;
    } else this.offSince = null;
    this.off = this.wrongWay || p.dist > 70 || (this.offSince != null && time - this.offSince >= 1.5);
  }
}

export interface NavState {
  status: 'ok' | 'off' | 'rerouting' | 'arrived';
  next: RouteStep | null;
  then: RouteStep | null;
  distance: number;
  remaining: number;
  etaSeconds: number;
  limit: number | null;
}

export type NavEvent =
  | { type: 'announce'; step: RouteStep; spoken: string; then: RouteStep | null; distance: number }
  | { type: 'offRoute' }
  | { type: 'rerouted' }
  | { type: 'arrived' };

export type RerouteFn = (from: { lat: number; lng: number }, heading: number, via: [number, number][]) => Promise<RoutedPath>;

export class Navigator {
  tracker: RouteTracker;
  steps: RouteStep[];
  speedLimits: SpeedLimitSpan[];
  waypoints: [number, number][];
  visited: boolean[];
  origin: { lat: number; lng: number };
  announced = new Set<number>();
  events: NavEvent[] = [];
  state: NavState;
  arrived = false;
  duration: number;
  private rerouting = false;
  private lastRerouteTry = -Infinity;
  private reroute: RerouteFn | null;
  /** True once the path has been replaced by a reroute (speed limits no longer line up). */
  replaced = false;

  constructor(route: RoutedPath & { speedLimits?: SpeedLimitSpan[]; waypoints?: [number, number][] }, origin: { lat: number; lng: number }, reroute: RerouteFn | null) {
    this.origin = origin;
    this.tracker = new RouteTracker(route.path, origin);
    this.steps = route.steps;
    this.speedLimits = route.speedLimits ?? [];
    this.waypoints = route.waypoints ?? [];
    this.visited = this.waypoints.map((_, i) => i === 0);
    this.reroute = reroute;
    this.duration = route.duration;
    this.state = { status: 'ok', next: null, then: null, distance: 0, remaining: route.distance, etaSeconds: route.duration, limit: null };
  }

  nextIndex(): number {
    const s = this.tracker.s;
    return this.steps.findIndex((st) => st.type !== 'depart' && st.at > s + 3);
  }

  limitAt(s: number): number | null {
    if (this.replaced) return null;
    const span = this.speedLimits.find((l) => s >= l.from && s < l.to);
    return span ? span.mph : null;
  }

  update(x: number, z: number, heading: number, speed: number, time: number, pos: { lat: number; lng: number }) {
    if (this.arrived) return;
    this.tracker.update(x, z, heading, speed, time);
    this.waypoints.forEach(([lat, lng], i) => {
      if (!this.visited[i] && haversine(pos, { lat, lng }) < 40) this.visited[i] = true;
    });
    const t = this.tracker;
    const ni = this.nextIndex();
    const next = ni >= 0 ? this.steps[ni] : null;
    const then = ni >= 0 && this.steps[ni + 1] && this.steps[ni + 1].at - this.steps[ni].at < 70 ? this.steps[ni + 1] : null;
    const distance = next ? next.at - t.s : t.total - t.s;
    const remaining = Math.max(0, t.total - t.s);
    this.state = {
      status: this.rerouting ? 'rerouting' : t.off ? 'off' : 'ok',
      next,
      then,
      distance,
      remaining,
      etaSeconds: (remaining / Math.max(1, t.total)) * this.duration * 1.6,
      limit: this.limitAt(t.s),
    };
    if (t.off) {
      if (t.offSince != null && time - t.offSince >= 1 && !this.rerouting && time - this.lastRerouteTry >= 12) {
        if (this.state.status !== 'rerouting') this.events.push({ type: 'offRoute' });
        this.tryReroute(pos, heading, time);
      }
      return;
    }
    if (next && ni >= 0 && !this.announced.has(ni) && distance < announceDistance(speed)) {
      this.announced.add(ni);
      if (then) this.announced.add(ni + 1);
      this.events.push({ type: 'announce', step: next, spoken: formatSpokenDistance(distance), then, distance });
    }
    if (remaining < 15 && t.s > t.total * 0.5) {
      this.arrived = true;
      this.state.status = 'arrived';
      this.events.push({ type: 'arrived' });
    }
  }

  private tryReroute(pos: { lat: number; lng: number }, heading: number, time: number) {
    if (!this.reroute) return;
    this.lastRerouteTry = time;
    this.rerouting = true;
    const via = this.waypoints.filter((_, i) => !this.visited[i]);
    const remainingVia = via.length ? via : this.waypoints.slice(-1);
    this.reroute(pos, heading, remainingVia)
      .then((r) => {
        this.tracker = new RouteTracker(r.path, this.origin);
        this.steps = r.steps;
        this.duration = r.duration;
        this.announced.clear();
        this.replaced = true;
        this.events.push({ type: 'rerouted' });
      })
      .catch(() => {
        /* retry in 12 s */
      })
      .finally(() => {
        this.rerouting = false;
      });
  }

  drain(): NavEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

export async function fetchReroute(from: { lat: number; lng: number }, heading: number, via: [number, number][]): Promise<RoutedPath> {
  const q = new URLSearchParams({
    from: `${from.lat.toFixed(6)},${from.lng.toFixed(6)}`,
    heading: String(Math.round(heading)),
    via: via.map(([a, b]) => `${a.toFixed(6)},${b.toFixed(6)}`).join(';'),
  });
  const res = await fetch(`/api/route?${q}`);
  if (!res.ok) throw new Error(`reroute HTTP ${res.status}`);
  return (await res.json()) as RoutedPath;
}
