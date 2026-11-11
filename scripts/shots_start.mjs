// Startbildschirm in vier Formaten, je mit Tastatur- und Touch-Erklärung.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? 'shots-start';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWS = [['1366x768', 1366, 768, false], ['320x568', 320, 568, true], ['390x844', 390, 844, true], ['844x390', 844, 390, true]];
for (const [name, w, h, touch] of VIEWS) {
  for (const mode of ['tastatur', 'touch']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?seed=12`);
    await page.waitForTimeout(500);
    if (mode === 'tastatur') await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true })));
    else await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })));
    await page.waitForTimeout(1100);
    await page.screenshot({ path: `${OUT}/${name}-${mode}.png` });
    await ctx.close();
  }
}
await browser.close();
