// Hügel-Bildproben: Kuppen, Gefälle, Verkehr dahinter (Verdeckung), Desktop und Hochformat.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? 'shots-hills';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [tag, vp, touch] of [['desktop', { width: 1280, height: 720 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  for (const [seed, startS] of [[12, 1300], [12, 1780], [5, 1360], [99, 5200]]) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1.5 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?qa=1&seed=${seed}&startS=${startS}`);
    await page.waitForTimeout(300);
    if (touch) await page.locator('#btn-start').tap(); else await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__qa.freeze());
    for (const [i, k] of ['taxi', 'sedan', 'truck', 'cabrio', 'taxi'].entries()) await page.evaluate((x) => window.__qa.place(x), { k: 'obstacle', kind: k, x: [-3.6, 0, 3.6][i % 3], dz: 120 + i * 55, vz: 0 });
    await sleep(350);
    await page.screenshot({ path: `${OUT}/${tag}-s${seed}-${startS}.png` });
    await ctx.close();
  }
}
await browser.close();
