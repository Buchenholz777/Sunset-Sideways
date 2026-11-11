// Vorher/Nachher-Aufnahmen in Echtzeit + Bildrate. Nutzung:
//   node scripts/compare.mjs <basisURL> <label> <ausgabeordner>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [base, label, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const views = [
  ['desktop', { width: 1366, height: 768 }, false],
  ['hoch320', { width: 320, height: 568 }, true],
];
for (const [name, viewport, touch] of views) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  // Frame-Kosten messen: jeden rAF-Callback (Simulation + Rendering) zeitlich erfassen
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__cb = [];
    window.requestAnimationFrame = (f) => raf((ts) => { const a = performance.now(); f(ts); window.__cb.push(performance.now() - a); });
  });
  await page.goto(`${base}/?seed=12${process.env.EXTRA ?? ''}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${label}-${name}-0-start.png` });
  if (touch) await page.locator('#btn-start').tap(); else await page.keyboard.press('Enter');
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const f = (t) => { n++; if (t - t0 < 3000) requestAnimationFrame(f); else res(n / ((t - t0) / 1000)); };
    requestAnimationFrame(f);
  }));
  const cb = await page.evaluate(() => { const a = window.__cb.slice(-150).sort((x, y) => x - y); return { mean: a.reduce((s, x) => s + x, 0) / a.length, p95: a[Math.floor(a.length * 0.95)] }; });
  console.log(`${label} ${name}: ${fps.toFixed(1)} FPS, Frame-Kosten Ø ${cb.mean.toFixed(2)} ms / p95 ${cb.p95.toFixed(2)} ms (Headless-Chrome, Software-Rendering)`);
  // Fahrt: 3,5 s und 5,2 s nach Start (erstes Hindernis bei ≈ 6 s)
  await page.screenshot({ path: `${out}/${label}-${name}-1-fahrt.png` });
  await page.waitForTimeout(1700);
  await page.screenshot({ path: `${out}/${label}-${name}-2-vor-hindernis.png` });
  await ctx.close();
}
await browser.close();
