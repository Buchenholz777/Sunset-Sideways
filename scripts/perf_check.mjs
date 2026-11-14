// Performance- und Stabilitätsmessung im echten Chrome (Headless-Chrome mit Emulation, KEINE echte Mobilhardware).
// Aufruf: node scripts/perf_check.mjs http://localhost:4173
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const results = [];
const note = (n, ok, info = '') => { results.push(ok); console.log(ok ? 'OK  ' : 'FAIL', n, info); };
const info = (n, v) => console.log('INFO', n, v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LX = [-3.6, 0, 3.6];
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const browser = await chromium.launch({ channel: 'chrome' });
console.log('Browser:', browser.version(), '· Playwright-Chrome, headless/emuliert');

// Fahrer wie in den anderen Abnahmen (QA-Zustand lesen, Tasten drücken)
async function drive(page, seconds, held) {
  const key = async (k, on) => { if (on && !held.has(k)) { held.add(k); await page.keyboard.down(k); } if (!on && held.has(k)) { held.delete(k); await page.keyboard.up(k); } };
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < seconds * 1000) {
    const s = await page.evaluate(() => window.__qa.state());
    if (s.crashed || s.phase !== 'running') break;
    last = s;
    const v = s.v / 3.6;
    const tc = LX.map((lx) => { let m = 9; for (const o of s.obstacles) { if (Math.abs(o.x - lx) > 2.3 || o.z < s.s - 3) continue; m = Math.min(m, (o.z - s.s) / Math.max(1, v - o.vz)); } return m; });
    const cur = LX.reduce((bi, lx, i) => (Math.abs(lx - s.q) < Math.abs(LX[bi] - s.q) ? i : bi), 0);
    let best = cur, score = -1e9;
    for (let i = 0; i < 3; i++) { const need = Math.abs(LX[i] - s.q) / 25 + 0.1; let sc = Math.min(tc[i], 6) - (i === cur ? 0 : 0.35 * Math.abs(i - cur)); for (let j = Math.min(i, cur); j <= Math.max(i, cur); j++) if (tc[j] < need + 0.25 && j !== i && j !== cur) sc -= 4; if (sc > score) { score = sc; best = i; } }
    const want = (tc[cur] > 3 ? LX[cur] : LX[best]) - s.q - s.vq * 0.03;
    await key('ArrowRight', want > 0.15); await key('ArrowLeft', want < -0.15);
    await sleep(8);
  }
  await key('ArrowRight', false); await key('ArrowLeft', false);
  return last;
}

// 1) Kalter und warmer Start
for (const [label, vp, touch, cpu] of [['Desktop 1366×768', { width: 1366, height: 768 }, false, 1], ['Mobil 390×844, CPU 4× gedrosselt', { width: 390, height: 844 }, true, 4]]) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const t1 = Date.now();
  await page.goto(BASE + '/?qa=1', { waitUntil: 'load' }); await page.waitForSelector('#btn-start');
  const cold = Date.now() - t1;
  const clk = async () => page.evaluate(() => new Promise((res) => { const t0 = performance.now(); document.getElementById('btn-start').click(); const tick = () => { const s = window.__qa.state(); if (s && s.t > 0.01) res(performance.now() - t0); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
  const coldCtl = await clk();
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('#btn-start');
  const t2 = Date.now(); await page.reload({ waitUntil: 'load' }); await page.waitForSelector('#btn-start');
  const warm = Date.now() - t2;
  const warmCtl = await clk();
  info(`${label}: Navigation → Startknopf kalt / warm`, `${cold} / ${warm} ms`);
  info(`${label}: Startklick → erster steuerbarer Schritt kalt / warm`, `${Math.round(coldCtl)} / ${Math.round(warmCtl)} ms`);
  note(`${label}: Startklick → steuerbar im Budget (warm ≤ 250 ms${cpu > 1 ? ', gedrosselt ≤ 600 ms' : ''})`, warmCtl <= (cpu > 1 ? 600 : 250), `${Math.round(warmCtl)} ms`);
  await ctx.close();
}

// 2) Framezeiten in aktiver Fahrt (Neonnacht, dichter Verkehr), Desktop und gedrosselt mobil; jede automatische Pause wird gemeldet
for (const [label, vp, touch, cpu] of [['Desktop', { width: 1280, height: 720 }, false, 1], ['Mobil CPU 4×', { width: 390, height: 844 }, true, 4]]) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await page.goto(BASE + '/?qa=1&seed=7&startS=21000'); await page.waitForTimeout(500);
  await page.evaluate(() => { window.__ft = []; let l = performance.now(); const f = (n) => { window.__ft.push(n - l); l = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await page.evaluate(() => document.getElementById('btn-start').click()); await page.waitForTimeout(200);
  await page.evaluate(() => window.__qa.give(0, 0, 0, 0, 6, 0));            // Phantom-Turbo zusätzlich
  const held = new Set();
  const last = await drive(page, 15, held);
  const ft = await page.evaluate(() => window.__ft.slice(5));
  const log = await page.evaluate(() => window.__qa.pauseLog());
  info(`${label}: Frames ${ft.length}, Mittel ${(ft.reduce((a, b) => a + b, 0) / ft.length).toFixed(1)} ms, P95 ${pct(ft, 95).toFixed(1)} ms, P99 ${pct(ft, 99).toFixed(1)} ms, Max ${Math.max(...ft).toFixed(0)} ms, Frames > 50 ms: ${ft.filter((x) => x > 50).length}`, `Strecke bis ${last ? Math.round(last.s) : '?'} m`);
  note(`${label}: keine automatische Pause während 15 s Fahrt in der Neonnacht`, log.length === 0, log.join(',') || 'keine');
  await ctx.close();
}

// 3) zehn Neustarts: Heap, Audio-Schleifen, Timer
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript(() => { const si = window.setInterval; window.__iv = new Set(); window.setInterval = (f, ms, ...a) => { const id = si(f, ms, ...a); window.__iv.add(id); return id; }; const ci = window.clearInterval; window.clearInterval = (id) => { window.__iv.delete(id); ci(id); }; });
  await page.goto(BASE + '/?qa=1&seed=3'); await page.waitForTimeout(500);
  const heap = () => page.evaluate(() => { if (window.gc) window.gc(); return performance.memory ? performance.memory.usedJSHeapSize : 0; });
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  const h0 = await heap();
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { window.__qa.pause(); }); await page.waitForTimeout(80); await page.click('#btn-restart'); await page.waitForTimeout(250); await page.evaluate(() => { for (let k = 0; k < 3; k++) window.__qa.advance(0.3, 0); }); }
  const h1 = await heap();
  const ivs = await page.evaluate(() => window.__iv.size);
  info('Heap nach 10 Neustarts', `${(h0 / 1048576).toFixed(1)} MB → ${(h1 / 1048576).toFixed(1)} MB (ohne erzwungene GC, Chrome-Messung grob)`);
  note('Zehn Neustarts: höchstens eine Musik-Schleife aktiv (keine doppelten Loops), keine Fehler', ivs <= 2 && errs.length === 0, `aktive setInterval-Timer: ${ivs}`);
  note('Zehn Neustarts: Speicherzuwachs begrenzt (< 25 MB)', h1 - h0 < 25 * 1048576, `${((h1 - h0) / 1048576).toFixed(1)} MB`);
  await ctx.close();
}

// 4) Rotation/Resize im Lauf, Zurück/Vorwärts, Rand-Eingaben
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/?qa=1&seed=3'); await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('btn-start').click()); await page.waitForTimeout(300);
  await page.evaluate(() => window.__qa.freeze());
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(300);
  const ph = await page.evaluate(() => ({ phase: window.__qa.state().phase, log: window.__qa.pauseLog(), inp: window.__qa.input() }));
  note('Rotation im Lauf: kein Pause-Auslöser, Eingabe neutral, Lauf geht weiter', ph.phase === 'running' && ph.log.length === 0 && ph.inp.drag === null, JSON.stringify(ph));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 1, y: 200, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 60, y: 200, id: 1 }] });
  const edge = await page.evaluate(() => window.__qa.input());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  note('Berührung am äußersten Bildrand wird als Lenkeingabe angenommen', edge.drag !== null, JSON.stringify(edge));
  await page.goto('about:blank'); await page.goBack({ waitUntil: 'load' }).catch(() => {}); await page.waitForTimeout(500);
  const back = await page.evaluate(() => ({ start: !document.getElementById('screen-start')?.hidden, canvas: !!document.getElementById('stage') })).catch(() => ({ start: false, canvas: false }));
  note('Browser-Zurück: Spiel startet sauber am Startbildschirm', back.start && back.canvas, JSON.stringify(back));
  note('Keine JavaScript-Fehler', errs.length === 0, errs.join('|'));
  await ctx.close();
}
await browser.close();
const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad}/${results.length} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
