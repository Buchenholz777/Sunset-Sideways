// Lastprobe der Musik: misst über N Sekunden, ob die Audiozeit mit der Uhr Schritt hält und wie viele Oszillatoren/Quellen je Sekunde entstehen.
// node scripts/music_load.mjs <URL> [s=20] [cpu=1]
import { chromium } from 'playwright-core';
const [URL, SEC, CPU] = [process.argv[2], Number(process.argv[3] ?? 20), Number(process.argv[4] ?? 1)];
const b = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  localStorage.setItem('ssw-consent', JSON.stringify({ v: 1, d: 'denied', ts: 1 }));
  window.__n = 0;
  const wrap = (P, m) => { const o = P[m]; P[m] = function (...a) { window.__n++; return o.apply(this, a); }; };
  wrap(BaseAudioContext.prototype, 'createOscillator'); wrap(BaseAudioContext.prototype, 'createBufferSource');
  const C = window.AudioContext; window.AudioContext = function (...a) { const c = new C(...a); window.__ac = c; return c; }; window.AudioContext.prototype = C.prototype;
});
const page = await ctx.newPage();
if (CPU > 1) { const s = await ctx.newCDPSession(page); await s.send('Emulation.setCPUThrottlingRate', { rate: CPU }); }
await page.goto(URL); await page.waitForSelector('#btn-start');
await page.mouse.click(5, 5);
await page.waitForFunction(() => !!window.__ac && window.__ac.state === 'running', null, { timeout: 10000 });
const a = await page.evaluate(() => ({ t: window.__ac.currentTime, w: performance.now() / 1000, n: window.__n }));
await page.waitForTimeout(SEC * 1000);
const z = await page.evaluate(() => ({ t: window.__ac.currentTime, w: performance.now() / 1000, n: window.__n, st: window.__ac.state }));
console.log(`Uhr ${(z.w - a.w).toFixed(1)} s, Audiozeit ${(z.t - a.t).toFixed(1)} s, Zustand ${z.st}, Quellen/s ${((z.n - a.n) / (z.w - a.w)).toFixed(0)}`);
await b.close();
