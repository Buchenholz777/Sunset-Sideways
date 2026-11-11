// Bildproben der Kulisse nach gefahrener Strecke (Sunset → Dämmerung → Strip → hoher Mond) aus der normalen Spielkamera.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? 'shots-km';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const KMS = (process.argv[4] ?? '14.8,16,17,18.5,19.8,20.4,21.5,27').split(',').map(Number);
for (const [tag, vp, touch] of [['desktop', { width: 1280, height: 720 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  for (const km of KMS) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1.5 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?qa=1&seed=12&startS=${Math.round(km * 1000)}`);
    await page.waitForTimeout(300);
    if (touch) await page.locator('#btn-start').tap(); else await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__qa.freeze());
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => window.__qa.state());
    await page.screenshot({ path: `${OUT}/${tag}-km${String(km).replace('.', '_')}.png` });
    console.log(tag, km, 'km', Math.round(st.v), 'km/h');
    await ctx.close();
  }
}
await browser.close();
