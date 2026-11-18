// Bildproben des Spurwechsel-Blinkers (Typ B): Fahrzeug kündigt an (Warnung) und wechselt (Bewegung); Desktop und Smartphone. node scripts/p1_blinker.mjs <URL> <Ordner>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:4173', OUT = process.argv[3] ?? 'grafik-vergleich/p1';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ channel: 'chrome' });
for (const [name, w, h, touch] of [['desktop', 1280, 720, false], ['p390', 390, 844, true]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { try { localStorage.setItem('sunset-sideways:v1', JSON.stringify({ v: 1, best: 4210, muted: true, dodged: true })); localStorage.setItem('ssw-consent', JSON.stringify({ v: 1, d: 'denied', ts: 1 })); } catch {} });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?qa=1&seed=12&startS=1500&startT=60`); await page.waitForSelector('#btn-start'); await sleep(800);
  await page.evaluate(() => document.getElementById('btn-start').click()); await sleep(600);
  await page.evaluate(() => { window.__qa.freeze(); window.__qa.noPickups(true); const s = window.__qa.state(); window.__qa.place({ k: 'obstacle', kind: 'sedan', x: 3.6, dz: 1.9 * (s.v / 3.6 - 13) + 40, vz: 13, lcTo: 0 }); window.__qa.place({ k: 'obstacle', kind: 'taxi', x: -3.6, dz: 1.5 * (s.v / 3.6 - 13) + 90, vz: 13, lcTo: 0 }); });
  let shot = 0;
  for (let i = 0; i < 120 && shot < 3; i++) {
    const s = await page.evaluate(() => window.__qa.state());
    const o = s.obstacles.find((x) => x.lc === 'warn' || x.lc === 'move');
    if (o && s.crashed) break;
    if (o && ((shot === 0 && o.lc === 'warn') || (shot === 1 && o.lc === 'move') || (shot === 2 && o.lc === 'move' && o.x !== 3.6 && o.x !== 0))) { await page.screenshot({ path: `${OUT}/${name}-blinker${shot}.png` }); shot++; await sleep(250); }
    else await sleep(35);
  }
  console.log(name, 'Aufnahmen:', shot);
  await ctx.close();
}
await b.close();
