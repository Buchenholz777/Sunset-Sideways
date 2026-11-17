// Spielwelt-Szenen (QA-Einstiege, Seed fest): früher Boulevard, Hotelviertel, volle Nacht – jeweils mit Hindernis voraus. node scripts/world_shots.mjs <Ordner>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] ?? 'grafik-welt', BASE = process.argv[3] ?? 'http://localhost:4173';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ channel: 'chrome' });
for (const [vn, w, h, touch] of [['desktop', 1280, 720, false], ['hoch390', 390, 844, true]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  for (const [n, S] of [['boulevard-400', 400], ['hotel-3500', 3500], ['unterhaltung-9000', 9000], ['nacht-21000', 21000]]) {
    await page.goto(`${BASE}/?qa=1&seed=12&startS=${S}`); await page.waitForSelector('#btn-start'); await sleep(300);
    await page.evaluate(() => document.getElementById('btn-start').click()); await sleep(150);
    await page.evaluate(() => { window.__qa.freeze(); window.__qa.place({ k: 'obstacle', kind: 'truck', x: 0, dz: 70, vz: 20 }); window.__qa.place({ k: 'obstacle', kind: 'barrier', x: 3.6, dz: 55 }); window.__qa.advance(0.2, 0); });
    await page.screenshot({ path: `${OUT}/${vn}-${n}.png` });
  }
  await ctx.close();
}
await b.close();
