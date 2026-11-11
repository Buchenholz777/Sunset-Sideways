// Bildproben: Hügel, Nacht, Phantom-Turbo, Pfadfinder, Fliegen-Tor.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? 'shots-new';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(vp, touch, extra, freeze = true) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?qa=1${extra}`);
  await page.waitForTimeout(300);
  if (touch) await page.locator('#btn-start').tap(); else await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  if (freeze) await page.evaluate(() => window.__qa.freeze());
  return { ctx, page };
}
const place = (page, spec) => page.evaluate((x) => window.__qa.place(x), spec);
const VIEWS = [['desktop', { width: 1280, height: 720 }, false], ['phone', { width: 390, height: 844 }, true]];
for (const [tag, vp, touch] of VIEWS) {
  // Hügel: laufende Fahrt bei ≈ 430 km/h, Bilder an Anstieg, Kuppe und Gefälle
  {
    const { ctx, page } = await open(vp, touch, '&seed=5&startS=6000');
    const rows = [];
    let best = { up: null, down: null };
    for (let i = 0; i < 70; i++) {
      const st = await page.evaluate(() => window.__qa.state());
      const h0 = st.hill; await sleep(40); const st2 = await page.evaluate(() => window.__qa.state());
      const slope = (st2.hill - h0) / Math.max(1, st2.s - st.s);
      rows.push(slope);
      if (slope > 0.045 && !best.up) { best.up = true; await page.screenshot({ path: `${OUT}/${tag}-huegel-anstieg.png` }); }
      if (slope < -0.045 && !best.down) { best.down = true; await page.screenshot({ path: `${OUT}/${tag}-huegel-gefaelle.png` }); }
    }
    console.log(tag, 'Steigung min/max', Math.min(...rows).toFixed(3), Math.max(...rows).toFixed(3), JSON.stringify(best));
    await page.screenshot({ path: `${OUT}/${tag}-huegel-fahrt.png` });
    await ctx.close();
  }
  // Nacht ab 17,5 km: Verkehr mit Rück- und Unterbodenlicht, Fenster, Sterne
  for (const km of [16.5, 18.5]) {
    const { ctx, page } = await open(vp, touch, `&seed=12&startS=${km * 1000}`);
    for (const [i, k] of ['taxi', 'cabrio', 'sedan', 'truck'].entries()) await place(page, { k: 'obstacle', kind: k, x: [-3.6, 0, 3.6][i % 3], dz: 70 + i * 40, vz: 0 });
    await sleep(400);
    await page.screenshot({ path: `${OUT}/${tag}-nacht-${km}km.png` });
    await ctx.close();
  }
  // Phantom-Turbo (Sunset und Nacht)
  for (const [lab, km] of [['sunset', 3], ['nacht', 21]]) {
    const { ctx, page } = await open(vp, touch, `&seed=12&startS=${km * 1000}`);
    await page.evaluate(() => window.__qa.give(0, 0, 0, 0, 6, 0));
    await sleep(900);
    await page.screenshot({ path: `${OUT}/${tag}-phantom-${lab}.png` });
    await ctx.close();
  }
  // Pfadfinder
  {
    const { ctx, page } = await open(vp, touch, '&seed=12&startS=3000');
    await page.evaluate(() => window.__qa.give(0, 0, 0, 0, 0, 10));
    await place(page, { k: 'obstacle', kind: 'truck', x: -3.6, dz: 110, vz: 10 }); await place(page, { k: 'obstacle', kind: 'taxi', x: 0, dz: 120, vz: 15 });
    await place(page, { k: 'obstacle', kind: 'barrier', x: 3.6, dz: 260 });
    await sleep(300);
    await page.screenshot({ path: `${OUT}/${tag}-pfadfinder.png` });
    await ctx.close();
  }
  // Fliegen-Tor (normaler Versuch, kurz nach dem ersten Auftauchen) und Boost-Pickup
  {
    const { ctx, page } = await open(vp, touch, '&seed=3', false);
    for (let i = 0; i < 200; i++) { const s = await page.evaluate(() => window.__qa.state()); if (s.pickups.length && s.pickups[0].z - s.s < 170) break; await sleep(40); }
    await page.screenshot({ path: `${OUT}/${tag}-fliegen-tor.png` });
    await ctx.close();
  }
}
await browser.close();
