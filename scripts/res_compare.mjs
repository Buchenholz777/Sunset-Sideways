// Auflösungsvergleich alt (Referenz-Build) vs. neu: Puffergröße, Framezeiten, Aufnahmen. Chrome headless, Emulation, KEINE echte Mobilhardware.
// node scripts/res_compare.mjs http://localhost:4174 http://localhost:4173 [shots-dir]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [A, B, OUT = 'scratch/res'] = [process.argv[2], process.argv[3], process.argv[4]];
fs.mkdirSync(OUT, { recursive: true });
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const browser = await chromium.launch({ channel: 'chrome', args: process.env.UNCAP ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [] });
console.log('Browser', browser.version());
const VPS = [['d1280', 1280, 720, 1, false, 1], ['d1920', 1920, 1080, 1, false, 1], ['d1600', 1600, 900, 1, false, 1], ['p390', 390, 844, 3, true, 4], ['p320', 320, 568, 2, true, 4], ['l844', 844, 390, 3, true, 4]];
const SCENES = [['boulevard', 300], ['hotel', 1450], ['nacht', 10000]];
for (const [lab, w, h, dpr, touch, cpu] of VPS) {
  for (const [sn, startS] of SCENES) {
    const row = [];
    for (const [tag, base] of [['alt', A], ['neu', B]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      await page.goto(`${base}/?qa=1&consent=1&seed=12&startS=${startS}`); await page.waitForTimeout(300);
      await page.evaluate(() => document.getElementById('btn-start').click()); await page.waitForTimeout(150);
      await page.evaluate(() => { window.__qa.freeze(); window.__qa.give(0, 0, 0, 0, 0, 0); window.__ft = []; let l = performance.now(); const f = (n) => { window.__ft.push(n - l); l = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
      await page.waitForTimeout(3000);
      const ft = (await page.evaluate(() => window.__ft)).slice(5);
      const buf = await page.evaluate(() => { const c = document.getElementById('stage'), f = document.getElementById('stage-fx'); return `${c.width}×${c.height} fx ${f.width}×${f.height} ${getComputedStyle(c).imageRendering}`; });
      if (sn !== 'nacht' || lab.startsWith('d')) await page.screenshot({ path: `${OUT}/${lab}_${sn}_${tag}.png` });
      row.push(`${tag}: ${buf} · Ø ${(ft.reduce((a, b) => a + b, 0) / ft.length).toFixed(1)} P95 ${pct(ft, 95).toFixed(1)} P99 ${pct(ft, 99).toFixed(1)} max ${Math.max(...ft).toFixed(0)} ms`);
      await ctx.close();
    }
    console.log(`${lab} ${sn}: ${row.join('  |  ')}`);
  }
}
await browser.close();
