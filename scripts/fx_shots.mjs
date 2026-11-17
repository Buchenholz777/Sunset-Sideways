// Effekt-Bilder: Landespur kurz vor dem Aufsetzen, Schild-Treffer (Stoßring), Turbo-Ende. node scripts/fx_shots.mjs <Ordner>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] ?? 'grafik-fx', BASE = process.argv[3] ?? 'http://localhost:4173';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ channel: 'chrome' });
for (const [vn, w, h, touch, startS] of [['desktop', 1280, 720, false, 800], ['hoch390', 390, 844, true, 800], ['nacht390', 390, 844, true, 21000]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?qa=1&seed=12&startS=${startS}`); await page.waitForSelector('#btn-start'); await sleep(300);
  await page.evaluate(() => document.getElementById('btn-start').click()); await sleep(150);
  await page.evaluate(() => { window.__qa.freeze(); window.__qa.give(0, 0, 0, 8, 0, 0); window.__qa.advance(6.6, 0); });
  await page.screenshot({ path: `${OUT}/${vn}-landespur-a.png` });
  await page.evaluate(() => window.__qa.advance(0.5, 0)); await page.screenshot({ path: `${OUT}/${vn}-landespur-b.png` });
  // Schild-Treffer
  await page.evaluate(() => { window.__qa.advance(3, 0); });
  await page.evaluate(() => { window.__qa.give(10, 0, 0, 0, 0, 0); window.__qa.place({ k: 'obstacle', kind: 'barrier', x: 0, dz: 16 }); });
  await sleep(190); await page.screenshot({ path: `${OUT}/${vn}-schild-treffer.png` });
  await ctx.close();
}
await b.close();
