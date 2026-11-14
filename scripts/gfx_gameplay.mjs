// Gameplay-Sicht (QA-Einstiege, gekennzeichnet): Ausweichen links/rechts mit Neigung, schnelle Szene mit Turbo, Flug mit Landung.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] ?? 'grafik-gameplay', BASE = process.argv[3] ?? 'http://localhost:4173';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
for (const [vn, w, h, touch] of [['desktop', 1280, 720, false], ['hoch390', 390, 844, true]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const p = await ctx.newPage();
  const go = async (startS, seed = 12) => { await p.goto(`${BASE}/?qa=1&seed=${seed}&startS=${startS}`); await p.waitForTimeout(300); await p.evaluate(() => document.getElementById('btn-start').click()); await p.waitForTimeout(120); await p.evaluate(() => { window.__qa.freeze(); window.__qa.give(8); }); };
  for (const [name, dir] of [['ausweichen-rechts', 1], ['ausweichen-links', -1]]) {
    await go(1200);
    await p.evaluate(() => window.__qa.place({ k: 'obstacle', kind: 'taxi', x: 0, dz: 55, vz: 16 }));
    await p.evaluate((d) => { window.__qa.advance(0.12, null, d); }, dir);
    await p.screenshot({ path: `${OUT}/${vn}-${name}.png` });
  }
  await go(25000);
  await p.evaluate(() => { window.__qa.give(0, 0, 0, 0, 6, 0); window.__qa.place({ k: 'obstacle', kind: 'truck', x: 3.6, dz: 90, vz: 16 }); window.__qa.place({ k: 'obstacle', kind: 'barrier', x: 0, dz: 140, vz: 0 }); window.__qa.advance(0.25, 0); });
  await p.screenshot({ path: `${OUT}/${vn}-schnell-turbo-nacht.png` });
  await go(3000);
  await p.evaluate(() => { window.__qa.place({ k: 'obstacle', kind: 'sedan', x: 0, dz: 60, vz: 16 }); window.__qa.give(0, 0, 0, 3.2, 0, 0); window.__qa.advance(1.0, 0); });
  await p.screenshot({ path: `${OUT}/${vn}-flug-reiseflug.png` });
  await p.evaluate(() => { window.__qa.advance(1.7, 0); });
  await p.screenshot({ path: `${OUT}/${vn}-flug-landeanflug.png` });
  await p.evaluate(() => { window.__qa.advance(0.55, 0); });
  await p.screenshot({ path: `${OUT}/${vn}-flug-aufsetzen.png` });
  await ctx.close();
}
await b.close();
console.log('Bilder in', OUT);
