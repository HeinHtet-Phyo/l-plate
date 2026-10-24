import { describe, expect, it, vi } from 'vitest';
import {
  daylightFrom,
  dateAtLondonHour,
  fogFromVisibility,
  fromOpenMeteo,
  fromWmo,
  londonTime,
  presetConditions,
  sunPosition,
  visibilityFromFog,
} from '../src/sim/conditions.ts';
import { Navigator, RouteTracker, announceDistance, formatScreenDistance, formatSpokenDistance } from '../src/sim/satnav.ts';
import { project, unproject } from '../src/sim/geo.ts';
import type { RoutedPath, RouteStep } from '@lplate/shared';

describe('conditions', () => {
  it('handles British Summer Time', () => {
    expect(londonTime(new Date('2026-07-01T12:00:00Z'))).toMatchObject({ hour: 13, offsetMin: 60, weekday: 3 });
    expect(londonTime(new Date('2026-01-15T12:00:00Z'))).toMatchObject({ hour: 12, offsetMin: 0 });
  });

  it('sun is high at midsummer noon and below the horizon at midnight', () => {
    const noon = sunPosition(new Date('2026-06-21T12:00:00Z'));
    expect(noon.elevation).toBeGreaterThan(60);
    expect(noon.elevation).toBeLessThan(63);
    expect(Math.abs(noon.azimuth - 180)).toBeLessThan(5);
    expect(sunPosition(new Date('2026-06-21T00:00:00Z')).elevation).toBeLessThan(0);
    const sunset = sunPosition(new Date('2026-06-21T19:30:00Z'));
    expect(sunset.azimuth).toBeGreaterThan(270);
  });

  it('daylight ramps over civil twilight', () => {
    expect(daylightFrom(-10)).toBe(0);
    expect(daylightFrom(0)).toBeCloseTo(0.5);
    expect(daylightFrom(10)).toBe(1);
  });

  it('maps WMO codes to rain, fog and descriptions', () => {
    expect(fromWmo(0)).toMatchObject({ rain: 0, fog: 0, description: 'Clear' });
    expect(fromWmo(61)).toMatchObject({ rain: 0.35, description: 'Light rain' });
    expect(fromWmo(65).rain).toBe(0.95);
    expect(fromWmo(45).fog).toBe(0.85);
    expect(fromWmo(95)).toMatchObject({ thunder: true, description: 'Thunderstorm' });
  });

  it('fog and visibility are inverses in range', () => {
    for (const f of [0, 0.3, 0.6, 0.9]) expect(fogFromVisibility(visibilityFromFog(f))).toBeCloseTo(f);
  });

  it('presets set the hour in London and night is dark', () => {
    const now = new Date('2026-10-24T10:00:00Z');
    expect(dateAtLondonHour(23, now).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(presetConditions('night', now).daylight).toBe(0);
    expect(presetConditions('sunny', now).daylight).toBe(1);
    expect(presetConditions('rain', now)).toMatchObject({ rain: 0.75, source: 'preset', weekend: true });
  });

  it('builds conditions from an Open-Meteo reading', () => {
    const c = fromOpenMeteo({ temperature_2m: 11, is_day: 1, precipitation: 1, cloud_cover: 120, weather_code: 63, visibility: 24000 }, new Date('2026-10-21T12:00:00Z'));
    expect(c).toMatchObject({ cloud: 1, rain: 0.6, fog: 0, temperature: 11, source: 'live, Open-Meteo', weekend: false });
  });
});

describe('sat nav distances', () => {
  it('formats screen distances in yards then miles', () => {
    expect(formatScreenDistance(5)).toBe('10 yd');
    expect(formatScreenDistance(80)).toBe('90 yd');
    expect(formatScreenDistance(300)).toBe('350 yd');
    expect(formatScreenDistance(1609.344)).toBe('1.0 mi');
    expect(formatScreenDistance(1609.344 * 12.4)).toBe('12 mi');
  });

  it('formats spoken distances', () => {
    expect(formatSpokenDistance(10)).toBe('just ahead');
    expect(formatSpokenDistance(180)).toBe('in about 200 yards');
    expect(formatSpokenDistance(450)).toBe('in a quarter of a mile');
    expect(formatSpokenDistance(800)).toBe('in half a mile');
    expect(formatSpokenDistance(1609)).toBe('in a mile');
    expect(formatSpokenDistance(1609 * 2.6)).toBe('in 2.5 miles');
  });

  it('announces earlier at speed, within limits', () => {
    expect(announceDistance(0)).toBe(60);
    expect(announceDistance(10)).toBe(130);
    expect(announceDistance(50)).toBe(250);
  });
});

// A straight 600 m route heading east from the origin, with a left turn at 400 m.
const O = { lat: 51.5, lng: -0.1 };
const at = (x: number) => unproject(O, x, 0);
const step = (type: RouteStep['type'], x: number, instruction: string): RouteStep => ({ type, road: 'East Road', location: at(x), at: x, instruction, modifier: type === 'turn' ? 'left' : undefined });
const route: RoutedPath = {
  path: [at(0), at(200), at(400), at(600)],
  distance: 600,
  duration: 120,
  steps: [step('depart', 0, 'Head east'), step('turn', 400, 'Turn left'), step('arrive', 600, 'Arrive')],
};

describe('RouteTracker', () => {
  it('tracks progress along the path', () => {
    const t = new RouteTracker(route.path, O);
    expect(t.total).toBeCloseTo(600, 0);
    t.update(150, 3, 90, 8, 0);
    expect(t.s).toBeCloseTo(150, 0);
    expect(t.off).toBe(false);
  });

  it('goes off route after 1.5 s more than 35 m away, or at once beyond 70 m', () => {
    const t = new RouteTracker(route.path, O);
    t.update(100, 50, 90, 8, 0);
    expect(t.off).toBe(false);
    t.update(100, 50, 90, 8, 1.6);
    expect(t.off).toBe(true);
    const t2 = new RouteTracker(route.path, O);
    t2.update(100, 80, 90, 8, 0);
    expect(t2.off).toBe(true);
  });

  it('detects driving the wrong way', () => {
    const t = new RouteTracker(route.path, O);
    t.update(200, 0, 90, 8, 0);
    t.update(150, 0, 270, 8, 1);
    expect(t.wrongWay).toBe(true);
  });
});

describe('Navigator', () => {
  function driveTo(n: Navigator, x: number, time: number) {
    n.update(x, 0, 90, 10, time, unproject(O, x, 0));
    return n.drain();
  }

  it('announces the turn once, then arrives', () => {
    const n = new Navigator(route, O, null);
    expect(driveTo(n, 100, 1)).toEqual([]);
    expect(n.state.next?.instruction).toBe('Turn left');
    const ev = driveTo(n, 300, 2);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'announce', spoken: 'in about 100 yards' });
    expect(driveTo(n, 320, 3)).toEqual([]);
    expect(driveTo(n, 595, 4)).toContainEqual({ type: 'arrived' });
    expect(n.state.status).toBe('arrived');
  });

  it('reroutes when off route', async () => {
    const reroute = vi.fn(async () => ({ ...route, path: [at(0), at(600)], steps: [step('arrive', 600, 'Arrive')] }));
    const n = new Navigator({ ...route, waypoints: [[O.lat, O.lng], [at(600).lat, at(600).lng]] }, O, reroute);
    n.update(100, 90, 90, 8, 0, unproject(O, 100, 90));
    n.update(100, 90, 90, 8, 1.2, unproject(O, 100, 90));
    expect(n.drain()).toContainEqual({ type: 'offRoute' });
    expect(reroute).toHaveBeenCalledOnce();
    await new Promise((r) => setTimeout(r, 0));
    expect(n.drain()).toContainEqual({ type: 'rerouted' });
    expect(n.replaced).toBe(true);
    expect(n.limitAt(10)).toBeNull();
  });

  it('reads speed limits from spans', () => {
    const n = new Navigator({ ...route, speedLimits: [{ from: 0, to: 300, mph: 20 }, { from: 300, to: 600, mph: 30 }] }, O, null);
    expect(n.limitAt(100)).toBe(20);
    expect(n.limitAt(300)).toBe(30);
    expect(n.limitAt(700)).toBeNull();
  });

  it('uses the same projection as the sim', () => {
    expect(project(O, at(250).lat, at(250).lng)[0]).toBeCloseTo(250, 6);
  });
});
