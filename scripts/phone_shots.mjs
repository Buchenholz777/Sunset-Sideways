// Bilder fürs Vorher/Nachher: node scripts/phone_shots.mjs <Ordner> [URL]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] ?? 'grafik-phone', BASE = process.argv[3] ?? 'http://localhost:4173';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [w, h, touch] of [[320, 568, true], [390, 844, true], [844, 390, true], [740, 320, true], [1366, 768, false]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const n = `${w}x${h}`;
  await page.goto(`${BASE}/?qa=1&consent=1&seed=5`); await page.waitForSelector('#btn-start'); await sleep(500);
  await page.screenshot({ path: `${OUT}/${n}-1-start-banner.png` });
  await page.evaluate(() => document.getElementById('about').open = true); await sleep(200);
  await page.screenshot({ path: `${OUT}/${n}-2-hilfe.png` });
  await page.evaluate(() => document.getElementById('about').open = false);
  await page.evaluate(() => document.getElementById('btn-start').click()); await sleep(300);
  await page.screenshot({ path: `${OUT}/${n}-3-fahrt.png` });
  await page.evaluate(() => { for (let i = 0; i < 40 && !window.__qa.state().crashed; i++) window.__qa.advance(1, 0); }); await sleep(1500);
  await page.screenshot({ path: `${OUT}/${n}-4-ergebnis.png` });
  await page.evaluate(() => document.getElementById('btn-again').click()); await sleep(300);
  await page.evaluate(() => document.getElementById('btn-pause').click()); await sleep(250);
  await page.screenshot({ path: `${OUT}/${n}-5-pause.png` });
  await ctx.close();
}
await b.close();
