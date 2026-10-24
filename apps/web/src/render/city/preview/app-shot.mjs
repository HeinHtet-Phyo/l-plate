// Needs playwright-core (not a repo dependency): run from a folder where `npm i playwright-core@1.48.2` was done, e.g.
//   mkdir -p /tmp/shot && cd /tmp/shot && npm init -y && npm i playwright-core@1.48.2 && cp <repo>/apps/web/src/render/city/preview/*.mjs .
// Uses the installed Google Chrome (channel "chrome") with the real GPU.
// Usage: node app-shot.mjs "<query>" out.png [waitMs] — screenshots the real app (menu → drive) after waitMs.
import { chromium } from 'playwright-core';
const [, , qs = 'route=goodmayes&weather=sunny&voice=0', out = 'app.png', wait = '9000'] = process.argv;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning' || t.includes('[city]')) logs.push(`${m.type()}: ${t.slice(0, 800)}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(`http://localhost:5173/?${qs}`);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
for (const l of logs.slice(0, 30)) console.log(l);
await browser.close();
