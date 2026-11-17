// Vorher/Nachher-Bildvergleich (vorbereitete QA-Aufnahmen, keine normalen Fahrten): gleiche Seeds, Positionen, Eingaben, Viewports.
// node scripts/vis_compare.mjs <URL> <Ordner> [nur=szenen|landmarke|kurve|flug]
// Szenen: früher Boulevard 400 m, 3,5 km, 9 km, 12,5 km, Dämmerung 17,5 km, Neonnacht 22 km – je mit Lkw und Absperrung voraus.
// Landmarke: Annäherung an das Riesenrad bei 10 714 m (rechts) von ≈ 1,5 km bis zur Vorbeifahrt. Kurve: erste starke Kurve nach 6 km mit Verkehr.
// Flug: Abheben bis Aufsetzen. ghost=1 (keine Kollisionen), Seed 12, Grafikstufe automatisch (Desktop/Headless bleibt Stufe 0).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:4173', OUT = process.argv[3] ?? 'grafik-vergleich', ONLY = process.argv[4] ?? '';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VPS = [['desktop', 1280, 720, false], ['p390', 390, 844, true], ['p320', 320, 568, true], ['q844', 844, 390, true]];
const b = await chromium.launch({ channel: 'chrome' });
const start = async (page, S, extra = '') => {
  await page.goto(`${BASE}/?qa=1&ghost=1&seed=12&startS=${S}${extra}`); await page.waitForSelector('#btn-start'); await sleep(250);
  await page.evaluate(() => document.getElementById('btn-start').click()); await sleep(150);
  await page.evaluate(() => { window.__qa.freeze(); window.__qa.noPickups(true); });
};
// in kleinen Schritten (je Aufruf ≤ 0,5 s Spielzeit), sonst erkennt das Spiel einen blockierten Thread und pausiert
const advanceTo = async (page, s) => {
  for (let i = 0; i < 200; i++) {
    const left = await page.evaluate((s) => { const st = window.__qa.state(); if (st.s >= s) return 0; const t = Math.min(0.5, Math.max(0.02, (s - st.s) / (st.v / 3.6))); window.__qa.advance(t, 0); return 1; }, s);
    if (!left) break;
    await sleep(30);
  }
  await sleep(60);
  return page.evaluate(() => window.__qa.state().s);
};
for (const [vn, w, h, touch] of VPS) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { try { localStorage.setItem('sunset-sideways:v1', JSON.stringify({ best: 0, muted: true, dodged: true, sprintBest: 0, sprintDone: 0 })); localStorage.setItem('ssw-consent', JSON.stringify({ v: 1, d: 'denied', ts: 1 })); } catch {} });
  const page = await ctx.newPage();
  if (!ONLY || ONLY === 'szenen') for (const [n, S] of [['boulevard-400', 400], ['artdeco-3500', 3500], ['hotel-9000', 9000], ['unterhaltung-12500', 12500], ['daemmerung-17500', 17500], ['nacht-22000', 22000]]) {
    await start(page, S);
    await page.evaluate(() => { window.__qa.place({ k: 'obstacle', kind: 'truck', x: 0, dz: 70, vz: 20 }); window.__qa.place({ k: 'obstacle', kind: 'taxi', x: -3.6, dz: 95, vz: 25 }); window.__qa.place({ k: 'obstacle', kind: 'barrier', x: 3.6, dz: 55 }); window.__qa.advance(0.2, 0); });
    await page.screenshot({ path: `${OUT}/${vn}-${n}.png` });
  }
  if ((!ONLY || ONLY === 'landmarke') && vn !== 'p320') {
    await start(page, 9150);
    for (const d of [1500, 1100, 800, 550, 380, 250, 140, 60, 15]) {
      const s = await advanceTo(page, 10714 - d);
      await page.screenshot({ path: `${OUT}/${vn}-landmarke-d${String(d).padStart(4, '0')}.png` });
      if (s < 0) break;
    }
  }
  if (!ONLY || ONLY === 'kurve') {
    await start(page, 6000);
    for (let i = 0; i < 300; i++) { const k = await page.evaluate(() => { window.__qa.advance(0.2, 0); return Math.abs(window.__qa.state().k); }); if (k >= 0.0011) break; await sleep(20); }
    await page.evaluate(() => { window.__qa.place({ k: 'obstacle', kind: 'truck', x: 0, dz: 85, vz: 20 }); window.__qa.place({ k: 'obstacle', kind: 'baken', x: -3.6, dz: 60 }); window.__qa.place({ k: 'obstacle', kind: 'taxi', x: 3.6, dz: 120, vz: 25 }); window.__qa.advance(0.15, 0); });
    await page.screenshot({ path: `${OUT}/${vn}-kurve.png` });
  }
  if ((!ONLY || ONLY === 'flug') && vn !== 'q844') {
    await start(page, 12500);
    await page.evaluate(() => { window.__qa.give(0, 0, 0, 8, 0, 0); window.__qa.advance(0.05, 0); });
    for (const [i, t] of [[0, 0.25], [1, 0.6], [2, 2.6], [3, 2.6], [4, 0.6], [5, 0.5], [6, 0.5]].map(([i, t]) => [i, t])) {
      await page.evaluate((t) => window.__qa.advance(t, 0), t);
      if (i === 3) await page.evaluate(() => { window.__qa.place({ k: 'obstacle', kind: 'truck', x: 0, dz: 40, vz: 20 }); window.__qa.place({ k: 'obstacle', kind: 'barrier', x: 3.6, dz: 90 }); });
      await page.screenshot({ path: `${OUT}/${vn}-flug-${i}.png` });
    }
  }
  await ctx.close();
}
await b.close();
console.log('fertig', OUT);
