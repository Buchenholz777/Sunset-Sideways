// P1-Vergleich (vorbereitete QA-Aufnahmen): Startbildschirm, Sportwagen vor heller Fassade und auf dunklem Asphalt, Spurwechsel,
// Phantom-Turbo und sein Ende, Schild läuft ab, Schild-Treffer, Bodenfluss bei Höchsttempo. node scripts/p1_shots.mjs <URL> <Ordner>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:4173', OUT = process.argv[3] ?? 'grafik-p1';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ channel: 'chrome' });
for (const [vn, w, h, touch] of [['desktop', 1280, 720, false], ['p390', 390, 844, true], ['p320', 320, 568, true], ['q844', 844, 390, true]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { try { localStorage.setItem('sunset-sideways:v1', JSON.stringify({ best: 4210, muted: true, dodged: true })); localStorage.setItem('ssw-consent', JSON.stringify({ v: 1, d: 'denied', ts: 1 })); } catch {} });
  const page = await ctx.newPage();
  // Startbildschirm (normale Seite, kein QA): zwei Zeitpunkte der Neon-Animation
  await page.goto(`${BASE}/`); await page.waitForSelector('#btn-start'); await sleep(900);
  await page.screenshot({ path: `${OUT}/${vn}-start-a.png` }); await sleep(1700); await page.screenshot({ path: `${OUT}/${vn}-start-b.png` });
  if (vn === 'q844') { await ctx.close(); continue; }
  const go = async (S) => {
    await page.goto(`${BASE}/?qa=1&ghost=1&seed=12&startS=${S}`); await page.waitForSelector('#btn-start'); await sleep(250);
    await page.evaluate(() => document.getElementById('btn-start').click()); await sleep(150);
    await page.evaluate(() => { window.__qa.freeze(); window.__qa.noPickups(true); window.__qa.advance(0.3, 0); });
  };
  const shot = async (n) => { await sleep(60); await page.screenshot({ path: `${OUT}/${vn}-${n}.png` }); };
  // Wagen vor heller Fassade (Tag) und Spurwechsel
  await go(9000); await shot('wagen-tag');
  await page.evaluate(() => window.__qa.advance(0.12, 3.6, 1)); await shot('wagen-spurwechsel');
  // Nacht: Wagen auf dunklem Asphalt, Verkehr voraus
  await go(22000); await page.evaluate(() => { window.__qa.place({ k: 'obstacle', kind: 'taxi', x: 0, dz: 60, vz: 25 }); window.__qa.place({ k: 'obstacle', kind: 'baken', x: 3.6, dz: 45 }); window.__qa.advance(0.1, 0); }); await shot('wagen-nacht');
  // Phantom-Turbo: läuft, dann Ende (Echtzeit: Effekt-Enden sind Animationen von ≈ 0,5 s)
  await page.evaluate(() => { window.__qa.give(0, 0, 0, 0, 1.6, 0); window.__qa.advance(0.8, 0); }); await shot('turbo');
  await page.evaluate(() => window.__qa.give(0, 0, 0, 0, 0.25, 0)); await sleep(330); await page.screenshot({ path: `${OUT}/${vn}-turbo-ende.png` });
  // Schild läuft ab (ohne Treffer)
  await page.evaluate(() => { window.__qa.give(1.2, 0, 0, 0, 0, 0); window.__qa.advance(0.6, 0); }); await shot('schild');
  await page.evaluate(() => window.__qa.give(0.2, 0, 0, 0, 0, 0)); await sleep(330); await page.screenshot({ path: `${OUT}/${vn}-schild-ende.png` });
  // Schild fängt Treffer
  await page.evaluate(() => { window.__qa.give(8, 0, 0, 0, 0, 0); window.__qa.place({ k: 'obstacle', kind: 'barrier', x: 0, dz: 14 }); }); await sleep(170); await shot('schild-treffer');
  // Bodenfluss bei Höchsttempo (30 km, 600 km/h), Hindernis voraus
  await go(30000); await page.evaluate(() => { window.__qa.place({ k: 'obstacle', kind: 'truck', x: -3.6, dz: 90, vz: 20 }); window.__qa.place({ k: 'obstacle', kind: 'barrier', x: 0, dz: 70 }); window.__qa.advance(0.1, 0); }); await sleep(400); await shot('tempo');
  await ctx.close();
}
await b.close();
console.log('fertig', OUT);
