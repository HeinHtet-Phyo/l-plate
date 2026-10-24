// Live conditions: sun from London time (NOAA low-precision), Open-Meteo weather, demo presets.
import { clamp } from './geo.ts';

export interface Conditions {
  /** 0 night … 1 day. */
  daylight: number;
  sunElevation: number;
  sunAzimuth: number;
  cloud: number;
  rain: number;
  fog: number;
  temperature: number | null;
  description: string;
  source: 'live, Open-Meteo' | 'live, Google Weather' | 'preset' | 'default';
  /** London local hour (fractional), weekday flag. */
  hour: number;
  weekend: boolean;
  thunder: boolean;
}

/** London wall-clock parts for a Date. */
export function londonTime(d: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number; offsetMin: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  let offsetMin = hour * 60 + minute - utcMin;
  if (offsetMin > 720) offsetMin -= 1440;
  if (offsetMin < -720) offsetMin += 1440;
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), hour, minute, weekday: wd, offsetMin };
}

/** NOAA low-precision solar position. Returns elevation and azimuth in degrees. */
export function sunPosition(date: Date, lat = 51.5074, lng = -0.1278): { elevation: number; azimuth: number } {
  const rad = Math.PI / 180;
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - start) / 86_400_000) + 1;
  const hourUtc = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hourUtc - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const timeOffset = eqTime + 4 * lng;
  const tst = hourUtc * 60 + timeOffset;
  const ha = (tst / 4 - 180) * rad;
  const phi = lat * rad;
  const cosZen = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(clamp(cosZen, -1, 1));
  const elevation = 90 - zen / rad;
  let az = Math.acos(clamp((Math.sin(phi) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(phi) * Math.sin(zen) || 1e-9), -1, 1)) / rad;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { elevation, azimuth: az };
}

export function daylightFrom(elevation: number): number {
  return clamp((elevation + 6) / 12, 0, 1);
}

export const visibilityFromFog = (fog: number) => 2000 * (1 - fog) ** 2 + 60;
export const fogFromVisibility = (v: number) => clamp(1 - Math.sqrt(clamp(v - 60, 0, 2000) / 2000), 0, 0.92);

/** WMO weather code → rain intensity, fog, description. */
export function fromWmo(code: number, visibility?: number | null): { rain: number; fog: number; thunder: boolean; description: string } {
  let rain = 0;
  const isRain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  if (isRain) {
    if ([51, 61, 80].includes(code)) rain = 0.35;
    else if ([55, 65, 67, 82].includes(code) || code >= 95) rain = 0.95;
    else rain = 0.6;
  }
  const fog = code === 45 || code === 48 ? 0.85 : visibility != null ? fogFromVisibility(visibility) : 0;
  return { rain, fog, thunder: code >= 95, description: describe(code) };
}

function describe(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return code === 51 ? 'Light drizzle' : 'Drizzle';
  if (code === 61 || code === 80) return 'Light rain';
  if (code === 65 || code === 82) return 'Heavy rain';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Cloudy';
}

export const PRESETS = {
  sunny: { cloud: 0.1, rain: 0, fog: 0, hour: 13, description: 'Sunny' },
  golden: { cloud: 0.15, rain: 0, fog: 0.05, hour: 17.25, description: 'Golden hour' },
  cloudy: { cloud: 0.95, rain: 0, fog: 0.1, hour: 13, description: 'Overcast' },
  rain: { cloud: 1, rain: 0.75, fog: 0.25, hour: 13, description: 'Rain' },
  fog: { cloud: 1, rain: 0, fog: 0.85, hour: 9, description: 'Fog' },
  night: { cloud: 0.2, rain: 0, fog: 0, hour: 23, description: 'Clear night' },
  'night-rain': { cloud: 1, rain: 0.7, fog: 0.2, hour: 23, description: 'Rain at night' },
} as const;
export type PresetId = keyof typeof PRESETS;

/** A Date for today at a London wall-clock hour. */
export function dateAtLondonHour(hour: number, now = new Date()): Date {
  const lt = londonTime(now);
  // Fractional hours (e.g. 17.25) are allowed.
  const utc = Date.UTC(lt.year, lt.month - 1, lt.day) + hour * 3_600_000 - lt.offsetMin * 60_000;
  return new Date(utc);
}

export function presetConditions(id: PresetId, now = new Date()): Conditions {
  const p = PRESETS[id];
  const d = dateAtLondonHour(p.hour, now);
  const sun = sunPosition(d);
  const lt = londonTime(d);
  return {
    daylight: daylightFrom(sun.elevation),
    sunElevation: sun.elevation,
    sunAzimuth: sun.azimuth,
    cloud: p.cloud,
    rain: p.rain,
    fog: p.fog,
    temperature: null,
    description: p.description,
    source: 'preset',
    hour: p.hour,
    weekend: lt.weekday === 0 || lt.weekday === 6,
    thunder: false,
  };
}

export function liveSun(now = new Date()) {
  const sun = sunPosition(now);
  const lt = londonTime(now);
  return { ...sun, daylight: daylightFrom(sun.elevation), hour: lt.hour + lt.minute / 60, weekend: lt.weekday === 0 || lt.weekday === 6 };
}

export function defaultConditions(now = new Date()): Conditions {
  const s = liveSun(now);
  return {
    daylight: s.daylight,
    sunElevation: s.elevation,
    sunAzimuth: s.azimuth,
    cloud: 0.5,
    rain: 0,
    fog: 0,
    temperature: null,
    description: 'Weather unavailable',
    source: 'default',
    hour: s.hour,
    weekend: s.weekend,
    thunder: false,
  };
}

export interface OpenMeteoCurrent {
  temperature_2m: number;
  is_day: number;
  precipitation: number;
  cloud_cover: number;
  weather_code: number;
  visibility: number;
}

export function fromOpenMeteo(cur: OpenMeteoCurrent, now = new Date()): Conditions {
  const s = liveSun(now);
  const w = fromWmo(cur.weather_code, cur.visibility);
  return {
    daylight: s.daylight,
    sunElevation: s.elevation,
    sunAzimuth: s.azimuth,
    cloud: clamp(cur.cloud_cover / 100, 0, 1),
    rain: w.rain,
    fog: w.fog,
    temperature: cur.temperature_2m,
    description: w.description,
    source: 'live, Open-Meteo',
    hour: s.hour,
    weekend: s.weekend,
    thunder: w.thunder,
  };
}

export async function fetchOpenMeteo(lat: number, lng: number): Promise<Conditions> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,is_day,precipitation,cloud_cover,weather_code,visibility&timezone=Europe%2FLondon`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const j = (await res.json()) as { current: OpenMeteoCurrent };
  return fromOpenMeteo(j.current);
}

/** Optional Google Weather (browser Maps key). Visibility is in km. */
export async function fetchGoogleWeather(lat: number, lng: number, key: string): Promise<Conditions> {
  const url = `https://weather.googleapis.com/v1/currentConditions:lookup?key=${encodeURIComponent(key)}&location.latitude=${lat}&location.longitude=${lng}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Google Weather HTTP ${res.status}`);
  const j = (await res.json()) as any;
  const s = liveSun();
  const type = String(j.weatherCondition?.type ?? '');
  const rainy = /RAIN|SHOWER|DRIZZLE|THUNDER/.test(type);
  const heavy = /HEAVY|THUNDER/.test(type);
  const vis = j.visibility?.distance != null ? j.visibility.distance * 1000 : null;
  return {
    daylight: s.daylight,
    sunElevation: s.elevation,
    sunAzimuth: s.azimuth,
    cloud: clamp((j.cloudCover ?? 50) / 100, 0, 1),
    rain: rainy ? (heavy ? 0.95 : /LIGHT/.test(type) ? 0.35 : 0.6) : 0,
    fog: /FOG/.test(type) ? 0.85 : vis != null ? fogFromVisibility(vis) : 0,
    temperature: j.temperature?.degrees ?? null,
    description: j.weatherCondition?.description?.text ?? 'Current weather',
    source: 'live, Google Weather',
    hour: s.hour,
    weekend: s.weekend,
    thunder: /THUNDER/.test(type),
  };
}
