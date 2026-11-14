// Renderkosten vorher/nachher (A/B im selben Build: ?nolots=1 schaltet die neuen Grundstücke ab). Chrome headless, Emulation, KEINE echte Mobilhardware.
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const browser = await chromium.launch({ channel: 'chrome' });
console.log('Browser', browser.version());
for (const [label, vp, touch, cpu] of [['Desktop 1280×720', { width: 1280, height: 720 }, false, 1], ['Mobil 390×844 (CPU 4×)', { width: 390, height: 844 }, true, 4], ['Quer 844×390 (CPU 4×)', { width: 844, height: 390 }, true, 4]]) {
  for (const startS of [300, 1100, 1450, 5000, 10000, 21000]) {
    const row = [];
    for (const nolots of [1, 0]) {
      const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      await page.goto(`${BASE}/?qa=1&seed=12&startS=${startS}${nolots ? '&nolots=1' : ''}`); await page.waitForTimeout(300);
      await page.evaluate(() => document.getElementById('btn-start').click()); await page.waitForTimeout(150);
      await page.evaluate(() => { window.__qa.freeze(); window.__qa.give(0, 0, 0, 0, 0, 0); window.__ft = []; let l = performance.now(); const f = (n) => { window.__ft.push(n - l); l = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
      await page.waitForTimeout(4000);
      const ft = (await page.evaluate(() => window.__ft)).slice(5);
      row.push(`${nolots ? 'vorher' : 'nachher'}: Ø ${(ft.reduce((a, b) => a + b, 0) / ft.length).toFixed(1)} · P95 ${pct(ft, 95).toFixed(1)} · max ${Math.max(...ft).toFixed(0)} ms`);
      await ctx.close();
    }
    console.log(`${label} @ ${startS} m — ${row.join('  |  ')}`);
  }
}
await browser.close();
