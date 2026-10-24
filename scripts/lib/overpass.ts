// Overpass client: descriptive User-Agent, POST data=, retries across mirrors with backoff.
// Treats timeouts, 429/502/504 and HTTP 200 with a `remark` (and no data) as failures.
import { USER_AGENT } from '../../apps/server/src/osrm.ts';

export const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OverpassResult {
  elements: any[];
  remark?: string;
}

export async function overpass(query: string, label: string, maxAttempts = 24): Promise<OverpassResult> {
  let delay = 4000;
  let lastErr = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length];
    const host = new URL(url).host;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(200_000),
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        throw new Error(lastErr);
      }
      const text = await res.text();
      if (!text.trimStart().startsWith('{')) throw new Error(`non-JSON response (${text.slice(0, 80)})`);
      const body = JSON.parse(text) as OverpassResult;
      if (body.remark && /error|timed out|runtime|out of memory/i.test(body.remark)) {
        throw new Error(`remark: ${body.remark.slice(0, 120)}`);
      }
      console.log(`  [overpass] ${label}: ${body.elements.length} elements from ${host}`);
      return body;
    } catch (e) {
      lastErr = (e as Error).message;
      console.warn(`  [overpass] ${label}: ${host} failed (${lastErr}); retry in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
      delay = Math.min(60_000, delay * 1.5);
    }
  }
  throw new Error(`Overpass failed for ${label}: ${lastErr}`);
}
