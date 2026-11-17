// Dauerlauf im Vordergrund-Chrome: 3 echte Läufe à 45 s mit automatischem Fahrer, Pausen-Log, Framezeiten; dazu absichtlicher Hintergrundwechsel und ein verlängerter Frame.
// node scripts/soak_check.mjs http://localhost:4173
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LX = [-3.6, 0, 3.6];
const b = await chromium.launch({ channel: 'chrome' });
const res = []; const note = (n, ok, i = '') => { res.push(ok); console.log(ok ? 'OK  ' : 'FAIL', n, i); };
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`${BASE}/?qa=1&seed=9`); await page.waitForSelector('#btn-start'); await sleep(400);
await page.evaluate(() => { window.__ft = []; let l = performance.now(); const f = (n) => { window.__ft.push(n - l); l = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
const held = new Set();
const key = async (k, on) => { if (on && !held.has(k)) { held.add(k); await page.keyboard.down(k); } if (!on && held.has(k)) { held.delete(k); await page.keyboard.up(k); } };
async function drive(sec) {
  const t0 = Date.now();
  while (Date.now() - t0 < sec * 1000) {
    const s = await page.evaluate(() => window.__qa.state()); if (!s || s.crashed || s.phase !== 'running') return s;
    const v = s.v / 3.6;
    const tc = LX.map((lx) => { let m = 9; for (const o of s.obstacles) { if (Math.abs(o.x - lx) > 2.3 || o.z < s.s - 3) continue; m = Math.min(m, (o.z - s.s) / Math.max(1, v - o.vz)); } return m; });
    const cur = LX.reduce((bi, lx, i) => (Math.abs(lx - s.q) < Math.abs(LX[bi] - s.q) ? i : bi), 0);
    let best = cur, score = -1e9;
    for (let i = 0; i < 3; i++) { let sc = Math.min(tc[i], 6) - (i === cur ? 0 : 0.35 * Math.abs(i - cur)); if (sc > score) { score = sc; best = i; } }
    const want = (tc[cur] > 3 ? LX[cur] : LX[best]) - s.q - s.vq * 0.03;
    await key('ArrowRight', want > 0.15); await key('ArrowLeft', want < -0.15); await sleep(8);
  }
  return page.evaluate(() => window.__qa.state());
}
let firstPauseAt = null;
for (let run = 1; run <= 3; run++) {
  await page.keyboard.press('Enter'); await sleep(300);
  const last = await drive(45);
  const log = await page.evaluate(() => window.__qa.pauseLog());
  console.log('INFO Lauf', run, 'Strecke', Math.round(last?.s ?? 0), 'm, Pausen:', log.join(',') || 'keine');
  if (log.length && firstPauseAt === null) firstPauseAt = run;
  await key('ArrowLeft', false); await key('ArrowRight', false);
  if (last?.crashed) { await sleep(900); } else { await page.keyboard.press('Escape'); await sleep(200); await page.click('#btn-restart'); await sleep(300); }
}
const ft = await page.evaluate(() => window.__ft.slice(5)); const sorted = [...ft].sort((a, c) => a - c);
console.log('INFO Frames', ft.length, 'Mittel', (ft.reduce((a, c) => a + c, 0) / ft.length).toFixed(1), 'ms, P99', sorted[Math.floor(sorted.length * 0.99)].toFixed(1), 'ms, Max', Math.max(...ft).toFixed(0), 'ms');
note('Vordergrundlauf (3 × 45 s): keine automatische Pause', (await page.evaluate(() => window.__qa.pauseLog())).filter((x) => x !== 'manual').length === 0, String(await page.evaluate(() => window.__qa.pauseLog().join(','))));
// absichtlicher Hintergrundwechsel
await page.keyboard.press('Enter').catch(() => {}); await sleep(300);
const ph0 = await page.evaluate(() => window.__qa.state()?.phase);
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); }); await sleep(150);
note('Hintergrundwechsel: Pause mit Grund „hidden“', (await page.evaluate(() => window.__qa.pauseLog())).includes('hidden'), ph0);
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
await page.click('#btn-resume'); await sleep(300);
note('Fortsetzen nach Hintergrund: läuft weiter ohne Absturz', (await page.evaluate(() => window.__qa.state().phase)) === 'running');
// kontrolliert verlängerter Frame (1,3 s Blockade des Hauptthreads)
await page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 1300); }); await sleep(300);
const log2 = await page.evaluate(() => window.__qa.pauseLog());
note('Verlängerter Frame (1,3 s): Pause mit Grund „stall“', log2.includes('stall'), log2.join(','));
await page.click('#btn-resume').catch(() => {}); await sleep(300);
const sA = await page.evaluate(() => window.__qa.state()); await sleep(500); const sB = await page.evaluate(() => window.__qa.state());
note('Nach Fortsetzen: Zeit läuft stetig (kein Sprung)', sB.t - sA.t > 0.3 && sB.t - sA.t < 0.8, (sB.t - sA.t).toFixed(2));
note('Keine JavaScript-Fehler', errs.length === 0, errs.join('|'));
await b.close(); const bad = res.filter((x) => !x).length; console.log(`\n${res.length - bad}/${res.length} Prüfungen bestanden`); process.exit(bad ? 1 : 0);
