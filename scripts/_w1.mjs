import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome' });
for (const [n, w, h] of [['320x568', 320, 568], ['390x844', 390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto('http://localhost:4173/?qa=1&seed=5&startS=9000'); await p.waitForTimeout(300); await p.evaluate(() => document.getElementById('btn-start').click()); await p.waitForTimeout(150);
  for (let i = 0; i < 4; i++) await p.evaluate(() => { window.__qa.give(5); window.__qa.advance(0.25, 0); });
  await p.screenshot({ path: `warn-${n}.png` });
  await ctx.close();
}
await b.close();
