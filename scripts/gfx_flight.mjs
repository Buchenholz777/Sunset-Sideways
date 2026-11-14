// Flug: Abheben mit Überschlag und Düsenstrahl nach hinten (QA-Einstieg). Aufruf: node scripts/gfx_flight.mjs <Ordner> [URL]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] ?? 'grafik-flug', BASE = process.argv[3] ?? 'http://localhost:4173';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
for (const [vn, w, h, touch] of [['desktop', 960, 540, false], ['hoch390', 390, 844, true]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?qa=1&seed=12&startS=3000`); await p.waitForTimeout(300);
  await p.evaluate(() => document.getElementById('btn-start').click()); await p.waitForTimeout(120);
  await p.evaluate(() => { window.__qa.freeze(); window.__qa.give(0, 0, 0, 8, 0, 0); });
  let t = 0;
  for (const dt of [0.05, 0.15, 0.15, 0.15, 0.15, 0.2, 0.6, 3]) {
    await p.evaluate((d) => window.__qa.advance(d, 0), dt); t += dt;
    await p.screenshot({ path: `${OUT}/${vn}-t${String(Math.round(t * 100)).padStart(3, '0')}.png` });
  }
  await ctx.close();
}
await b.close();
