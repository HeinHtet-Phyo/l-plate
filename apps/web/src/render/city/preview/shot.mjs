// Needs playwright-core (not a repo dependency): run from a folder where `npm i playwright-core@1.48.2` was done, e.g.
//   mkdir -p /tmp/shot && cd /tmp/shot && npm init -y && npm i playwright-core@1.48.2 && cp <repo>/apps/web/src/render/city/preview/*.mjs .
// Uses the installed Google Chrome (channel "chrome") with the real GPU.
// Usage: node shot.mjs "<query string>" <out.png> [width] [height]
// Opens the city preview in headless Chrome (real GPU via Metal), waits for window.__ready, screenshots.
import { chromium } from 'playwright-core';

const [, , qs = '', out = 'shot.png', w = '1280', h = '720'] = process.argv;
const base = process.env.PREVIEW_URL ?? 'http://localhost:5173/src/render/city/preview/index.html';
const url = `${base}?${qs.replace(/^\?/, '')}`;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warning' || t.includes('[city]')) logs.push(`${m.type()}: ${t.slice(0, 1500)}`);
});
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
try {
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 180000 });
} catch {
  logs.push('timeout waiting for __ready');
}
await page.waitForTimeout(800);
await page.screenshot({ path: out });
const res = await page.evaluate(() => ({ error: window.__error, stats: window.__stats, renderer: (() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c?.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; })() }));
console.log(JSON.stringify({ url, ...res }, null, 1));
for (const l of logs.slice(0, 40)) console.log(l);
await browser.close();
