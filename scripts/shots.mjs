// Bildproben aus der normalen Spielkamera: Sportwagen (neutral/links/rechts, Sunset/Nacht, Desktop/Hochformat),
// Verkehr, Gehwege mit Passanten bei Höchsttempo und Gleitflug.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? 'shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWS = [['desktop', { width: 1280, height: 720 }, false], ['phone', { width: 390, height: 844 }, true]];

async function open(vp, touch, extra, freeze = true) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?qa=1&seed=12${extra}`);
  await page.waitForTimeout(300);
  if (touch) await page.locator('#btn-start').tap(); else await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  if (freeze) await page.evaluate(() => window.__qa.freeze());
  return { ctx, page };
}
const place = (page, spec) => page.evaluate((x) => window.__qa.place(x), spec);
const st = (page) => page.evaluate(() => window.__qa.state());
const shot = (page, f) => page.screenshot({ path: `${OUT}/${f}.png` });

for (const [tag, vp, touch] of VIEWS) {
  // ---- Sportwagen aus der normalen Heckkamera (laufendes Spiel, Echtzeit)
  for (const [phase, startS] of [['sunset', 700], ['nacht', 5200]]) {
    const { ctx, page } = await open(vp, touch, `&startS=${startS}&startT=12`);
    await sleep(600);
    await shot(page, `${tag}-wagen-${phase}-neutral`);
    for (const [dir, key] of [['links', 'ArrowLeft'], ['rechts', 'ArrowRight']]) {
      await page.keyboard.down(key); await sleep(90);
      await shot(page, `${tag}-wagen-${phase}-${dir}`);
      await page.keyboard.up(key); await sleep(500);
    }
    await shot(page, `${tag}-wagen-${phase}-nach-loslassen`);
    await ctx.close();
  }
  // ---- Verkehr
  {
    const { ctx, page } = await open(vp, touch, '&startS=700&startT=20');
    await page.evaluate(() => { window.__qa.pause(); document.getElementById('screen-pause').hidden = true; });
    for (const [i, k] of ['taxi', 'cabrio', 'sedan', 'truck'].entries()) for (const [j, x] of [-3.6, 0, 3.6].entries()) await place(page, { k: 'obstacle', kind: k, x, dz: 22 + i * 26 + j * 4 });
    await page.evaluate(() => window.__qa.advance(0.01, 0));
    await shot(page, `${tag}-verkehr`);
    await ctx.close();
  }
  // ---- Gehwege und Passanten bei Höchsttempo (Stadt, Sunset und Nacht)
  for (const [phase, startS] of [['sunset', 900], ['nacht', 6200]]) {
    const { ctx, page } = await open(vp, touch, `&startS=${startS}&startT=400`);
    await place(page, { k: 'obstacle', kind: 'truck', x: 0, dz: 150, vz: 10 });
    await sleep(250);
    await shot(page, `${tag}-gehweg-${phase}-hochtempo`);
    await ctx.close();
  }
  // ---- Gleitflug: Abheben, Überflug eines Lkw, Landepunkt, nach der Landung
  {
    const { ctx, page } = await open(vp, touch, '&startS=2200&startT=40');
    await place(page, { k: 'pickup', type: 'glide', x: 0, dz: 8 });
    await sleep(250); await shot(page, `${tag}-glide-1-abheben`);
    await place(page, { k: 'obstacle', kind: 'truck', x: 0, dz: 90, vz: 0 });
    await place(page, { k: 'obstacle', kind: 'barrier', x: 3.6, dz: 90 });
    await sleep(900); await shot(page, `${tag}-glide-2-flug`);
    for (let i = 0; i < 60; i++) { const s = await st(page); if (s.glideT < 1.1) break; await sleep(60); }
    await shot(page, `${tag}-glide-3-landepunkt`);
    await sleep(1200); await shot(page, `${tag}-glide-4-gelandet`);
    await ctx.close();
  }
}
await browser.close();
console.log('fertig');
