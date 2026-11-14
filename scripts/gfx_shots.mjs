// Reproduzierbare Grafik-Vergleichsbilder (vorher/nachher). Aufruf: node scripts/gfx_shots.mjs <Ausgabeordner> [Basis-URL]
// QA-Szenen: feste Seeds, Streckenpositionen und Eingabefolgen (?qa=1&seed=&startS=); die „natürlichen“ Aufnahmen laufen ohne QA-Parameter über den normalen Start.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] ?? 'grafik-shots';
const BASE = process.argv[3] ?? 'http://localhost:4173';
mkdirSync(OUT, { recursive: true });
const VIEWS = [['desktop', 1280, 720, false], ['hoch390', 390, 844, true], ['hoch320', 320, 568, true], ['quer844', 844, 390, true]];
// Szenen: Name, Seed, Startposition (m), Lauf-Sekunden vor dem Bild (Simulation mit Schild, ohne Lenken)
const SCENES = [['00-start', 12, null, 0], ['01-boulevard-300m', 12, 300, 0.3], ['02-boulevard-1100m', 12, 1100, 0.3], ['03-boulevard-1450m', 12, 1450, 0.3], ['04-5km', 12, 5000, 0.3], ['05-10km', 12, 10000, 0.3], ['06-daemmerung-16km', 12, 16000, 0.3], ['07-nacht-21km', 12, 21000, 0.3]];
const browser = await chromium.launch({ channel: 'chrome' });
for (const [vn, w, h, touch] of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await ctx.newPage();
  for (const [name, seed, startS, sec] of SCENES) {
    if (startS === null) { await page.goto(`${BASE}/?seed=${seed}`); await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}/${vn}-${name}.png` }); continue; }
    await page.goto(`${BASE}/?qa=1&seed=${seed}&startS=${startS}`); await page.waitForTimeout(350);
    await page.evaluate(() => document.getElementById('btn-start').click()); await page.waitForTimeout(150);
    await page.evaluate((sec) => { window.__qa.freeze(); window.__qa.give(5); window.__qa.advance(sec, 0); }, sec);
    await page.screenshot({ path: `${OUT}/${vn}-${name}.png` });
  }
  await ctx.close();
}
// natürliche Fahrt (normaler Start, ohne QA): Einstieg, Ausweichen nach rechts, spätere Fahrt – echte Tasten, Echtzeit
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?seed=12`); await page.waitForTimeout(700);
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/natuerlich-a-start.png` });
  await page.waitForTimeout(500);
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(330); await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}/natuerlich-b-ausweichen.png` });
  await page.waitForTimeout(1400); await page.screenshot({ path: `${OUT}/natuerlich-c-vorbei.png` });
  await ctx.close();
}
await browser.close();
console.log('Aufnahmen in', OUT);
