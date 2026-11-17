// Framezeiten und Lenkreaktion zweier Builds unter gleichen Bedingungen (Chrome, Touch-Emulation, CPU-Drosselung – KEINE echte Hardware).
// node scripts/perf_compare.mjs <URL vorher> <URL nachher> [CPU-Faktor=4]
// Je Viewport und Szene: 5 s Echtzeitfahrt (ghost=1, Seed 12, Verkehr aktiv), rAF-Abstände; danach 6 schnelle Daumenzüge (CDP-Touch) und
// Zeit bis zur ersten sichtbaren Querbewegung des Wagens (Bild, in dem sim.X sich um > 0,05 m ändert).
import { chromium } from 'playwright-core';
const [A, Bu, cpuArg] = process.argv.slice(2);
const CPU = Number(cpuArg ?? 4);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const br = await chromium.launch({ channel: 'chrome' });
console.log(`Chrome ${br.version()}, CPU-Drosselung ${CPU}×, Touch-Emulation (keine echte Hardware)`);
const run = async (base, vp, S, glide) => {
  const ctx = await br.newContext({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { try { localStorage.setItem('sunset-sideways:v1', JSON.stringify({ dodged: true, muted: true })); localStorage.setItem('ssw-consent', JSON.stringify({ v: 1, d: 'denied', ts: 1 })); } catch {} });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const t0 = Date.now();
  await page.goto(`${base}/?qa=1&ghost=1&seed=12&startS=${S}`); await page.waitForSelector('#btn-start');
  const box = await page.locator('#btn-start').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => window.__qa?.state()?.phase === 'running');
  const startMs = Date.now() - t0;
  if (glide) await page.evaluate(() => window.__qa.give(0, 0, 0, 8, 6, 0));
  await page.evaluate(() => { window.__ft = []; window.__xs = []; let l = performance.now(); const f = (n) => { window.__ft.push(n - l); l = n; const s = window.__qa.state(); window.__xs.push([n, s ? s.X : 0]); requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await page.waitForTimeout(5000);
  const ft = (await page.evaluate(() => window.__ft)).slice(10);
  // Lenkreaktion: schnelle Daumenzüge abwechselnd nach links/rechts
  const lat = [];
  const cx = vp.width / 2, cy = vp.height * 0.75;
  for (let i = 0; i < 6; i++) {
    const dir = i % 2 ? -1 : 1;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
    await page.waitForTimeout(80);
    const tStart = await page.evaluate(() => { window.__xs = []; return performance.now(); });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dir * vp.width * 0.3, y: cy, id: 1 }] });
    await page.waitForTimeout(400);
    const xs = await page.evaluate(() => window.__xs);
    const x0 = xs.length ? xs[0][1] : 0;
    const hit = xs.find(([, x]) => Math.abs(x - x0) > 0.05);
    if (hit) lat.push(hit[0] - tStart);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
  }
  const phase = await page.evaluate(() => window.__qa.state().phase);
  await ctx.close();
  const mean = ft.reduce((a, b) => a + b, 0) / ft.length;
  return { mean, p95: pct(ft, 95), p99: pct(ft, 99), max: Math.max(...ft), long: ft.filter((x) => x > 25).length, n: ft.length, lat: lat.length ? pct(lat, 50) : NaN, latMax: lat.length ? Math.max(...lat) : NaN, startMs, phase };
};
const f = (r) => `Ø ${r.mean.toFixed(1)} · P95 ${r.p95.toFixed(1)} · P99 ${r.p99.toFixed(1)} · max ${r.max.toFixed(0)} ms · >25 ms: ${r.long}/${r.n} · Lenkung Median ${r.lat.toFixed(0)} ms (max ${r.latMax.toFixed(0)}) · Start→Fahrt ${r.startMs} ms${r.phase !== 'running' ? ' · PHASE ' + r.phase : ''}`;
for (const [vn, vp] of [['320×568', { width: 320, height: 568 }], ['390×844', { width: 390, height: 844 }], ['844×390', { width: 844, height: 390 }]]) {
  for (const [sn, S, glide] of [['Unterhaltung 10,2 km (Riesenrad)', 10200, false], ['Neonnacht 22 km', 22000, false], ['Flug + Phantom-Turbo 12,5 km', 12500, true]]) {
    const a = await run(A, vp, S, glide), b = await run(Bu, vp, S, glide);
    console.log(`${vn} · ${sn}\n  vorher : ${f(a)}\n  nachher: ${f(b)}`);
  }
}
await br.close();
