// Renderkosten der Streckenereignisse (Tunnel, Casino-Durchfahrt, Casino-Boulevard) gegenüber normaler Straße. Chrome headless, Emulation, KEINE echte Mobilhardware.
// node scripts/route_perf.mjs http://localhost:4173   (UNCAP=1: ohne Bildraten-Limit → reine Renderkosten)
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const browser = await chromium.launch({ channel: 'chrome', args: process.env.UNCAP ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [] });
console.log('Browser', browser.version());
const SCENES = [['offene Straße 5 km', 5000], ['Tunnel 10,5 km', 10500], ['Tunnel 19,6 km', 19600], ['Casino-Boulevard 24 km', 24000], ['Casino-Innenraum 21,9 km', 21900], ['Casino-Innenraum 36,9 km', 36950]];
for (const [label, w, h, dpr, touch, cpu] of [['Desktop 1280×720', 1280, 720, 1, false, 1], ['Mobil 390×844 (CPU 4×)', 390, 844, 3, true, 4]]) {
  for (const [sn, startS] of SCENES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    const cdp = await ctx.newCDPSession(page);
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.goto(`${BASE}/?qa=1&consent=1&seed=12&startS=${startS}`); await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('btn-start').click()); await page.waitForTimeout(150);
    await page.evaluate(() => { window.__qa.freeze(); window.__qa.give(0, 0, 0, 0, 0, 0); window.__ft = []; let l = performance.now(); const f = (n) => { window.__ft.push(n - l); l = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.waitForTimeout(3000);
    const ft = (await page.evaluate(() => window.__ft)).slice(5);
    console.log(`${label} · ${sn}: Ø ${(ft.reduce((a, b) => a + b, 0) / ft.length).toFixed(1)} · P95 ${pct(ft, 95).toFixed(1)} · P99 ${pct(ft, 99).toFixed(1)} · max ${Math.max(...ft).toFixed(0)} ms${errs.length ? ' · FEHLER ' + errs[0] : ''}`);
    await ctx.close();
  }
}
await browser.close();
