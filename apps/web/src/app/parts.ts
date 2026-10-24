// Picks up each section's render module as soon as it is merged; falls back to simple stand-ins until then.
import type { CreateAtmosphere, CreateCabin, CreateCity, CreateTraffic } from '../render/types.ts';
import { createAtmosphereFallback, createCabinFallback, createCityFallback, createTrafficFallback } from './fallbacks.ts';

const city = import.meta.glob<{ createCity?: CreateCity }>('../render/city/index.ts', { eager: true });
const traffic = import.meta.glob<{ createTraffic?: CreateTraffic }>('../render/traffic/index.ts', { eager: true });
const atmosphere = import.meta.glob<{ createAtmosphere?: CreateAtmosphere }>('../render/atmosphere/index.ts', { eager: true });
const cabin = import.meta.glob<{ createCabin?: CreateCabin }>('../render/cabin/index.ts', { eager: true });

export const createCity: CreateCity = Object.values(city)[0]?.createCity ?? createCityFallback;
export const createTraffic: CreateTraffic = Object.values(traffic)[0]?.createTraffic ?? createTrafficFallback;
export const createAtmosphere: CreateAtmosphere = Object.values(atmosphere)[0]?.createAtmosphere ?? createAtmosphereFallback;
export const createCabin: CreateCabin = Object.values(cabin)[0]?.createCabin ?? createCabinFallback;

export const partSources = {
  city: Object.keys(city).length ? 'team' : 'fallback',
  traffic: Object.keys(traffic).length ? 'team' : 'fallback',
  atmosphere: Object.keys(atmosphere).length ? 'team' : 'fallback',
  cabin: Object.keys(cabin).length ? 'team' : 'fallback',
};
