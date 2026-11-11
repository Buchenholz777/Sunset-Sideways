// Audio-Messung im Browser (nur Headless-Chrome, kein Gehör): Pegel des tatsächlichen Web-Audio-Ausgangs.
// Nutzung: npm run preview (Port 4173), dann: node scripts/audio.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.URL ?? 'http://localhost:4173/?seed=12&qa=1&startS=330&startT=8';
const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  // Analyser am Ausgang: jede Verbindung zum AudioDestinationNode wird zusätzlich abgegriffen
  const origConnect = AudioNode.prototype.connect;
  window.__an = null;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode && !window.__an) {
      const an = this.context.createAnalyser();
      an.fftSize = 2048;
      origConnect.call(this, an);
      window.__an = an;
    }
    return origConnect.call(this, dest, ...rest);
  };
  window.__measure = (ms) => new Promise((res) => {
    const an = window.__an; if (!an) return res({ rmsDb: -999, peak: 0 });
    const buf = new Float32Array(an.fftSize);
    let sum = 0, n = 0, peak = 0; const t0 = performance.now();
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      for (const v of buf) { sum += v * v; n++; peak = Math.max(peak, Math.abs(v)); }
      if (performance.now() - t0 < ms) setTimeout(tick, 40); else res({ rmsDb: +(20 * Math.log10(Math.sqrt(sum / n) + 1e-9)).toFixed(1), peak: +peak.toFixed(3) });
    };
    tick();
  });
});
await page.goto(BASE);
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.evaluate(() => window.__qa.give(0, 60));
const out = {};
out.musikUndMotor = await page.evaluate(() => window.__measure(4000));
await page.keyboard.down('Space'); await page.keyboard.up('Space');
await page.keyboard.down('ArrowRight');
await page.keyboard.down('Space');
out.mitDrift = await page.evaluate(() => window.__measure(2000));
await page.keyboard.up('Space'); await page.keyboard.up('ArrowRight');
await page.evaluate(() => window.__qa.give(6, 60));
out.mitTurbo = await page.evaluate(() => window.__measure(2000));
await page.locator('#btn-sound').click();
await page.waitForTimeout(300);
out.stumm = await page.evaluate(() => window.__measure(1000));
await page.locator('#btn-sound').click();
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
out.pause = await page.evaluate(() => window.__measure(1000));
console.log(JSON.stringify(out, null, 1));
const ok = out.musikUndMotor.rmsDb > -40 && out.musikUndMotor.peak < 1 && out.mitDrift.peak < 1 && out.mitTurbo.peak < 1 && out.stumm.rmsDb < -80 && out.pause.rmsDb < -50;
console.log(ok ? 'OK: Pegel im Rahmen, kein Clipping, Stumm/Pause still' : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
