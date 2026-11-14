import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
for (const s of [300, 1100]) {
  await p.goto(`http://localhost:4173/?qa=1&seed=12&startS=${s}`); await p.waitForTimeout(350);
  await p.evaluate(() => document.getElementById('btn-start').click()); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__qa.freeze(); window.__qa.give(5); window.__qa.advance(0.3, 0); });
  await p.screenshot({ path: `lots-${s}.png` });
}
console.log('Fehler:', errs.join('|') || 'keine');
await b.close();
