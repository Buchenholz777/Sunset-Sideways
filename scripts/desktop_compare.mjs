// PC-Vergleich zweier Builds (Referenz vs. neu): Position, Größe und Sichtbarkeit aller Bedienelemente je Zustand.
// (Pixelvergleiche scheiden aus: die Echtzeitschleife macht auch zwei Läufe desselben Builds ungleich.)
// node scripts/desktop_compare.mjs http://localhost:4174 http://localhost:4173
import { chromium } from 'playwright-core';
const [A, B] = [process.argv[2], process.argv[3]];
const b = await chromium.launch({ channel: 'chrome' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEL = ['#screen-start .panel', '.logo', '#btn-start', '#howto', '#about', '#about > summary', '.about-body', '.legal', '.legal a', '#consent-settings', '#consent', '#hint', '#fx-toast', '#btn-pause', '#btn-sound', '#hud', '#screen-pause', '#btn-resume', '#btn-restart', '#screen-result', '#btn-again', '#res-dist'];
async function geo(page) {
  return page.evaluate((SEL) => SEL.map((s) => { const e = document.querySelector(s); if (!e) return s + ':-'; const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    const vis = cs.display !== 'none' && cs.visibility !== 'hidden' && !e.closest('[hidden]'); return `${s}:${vis ? [r.left, r.top, r.width, r.height].map((x) => Math.round(x * 10) / 10).join(',') : 'aus'}`; }).join('|'), SEL);
}
async function run(base, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const page = await ctx.newPage(); const out = {};
  await page.goto(`${base}/?qa=1&consent=1&seed=5`); await page.waitForSelector('#btn-start'); await sleep(500);
  out.start = await geo(page);
  await page.evaluate(() => document.getElementById('about').open = true); await sleep(200); out.hilfe = await geo(page);
  await page.evaluate(() => document.getElementById('about').open = false);
  await page.keyboard.press('Enter'); await sleep(300); out.fahrt = await geo(page);
  await page.keyboard.press('Escape'); await sleep(200); out.pause = await geo(page);
  await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(() => { for (let i = 0; i < 40 && !window.__qa.state().crashed; i++) window.__qa.advance(1, 0); }); await sleep(1500); out.ergebnis = await geo(page);
  await ctx.close(); return out;
}
let diff = 0;
for (const [w, h] of [[1366, 768], [1920, 1080], [500, 700], [900, 320]]) {
  const a = await run(A, w, h), n = await run(B, w, h);
  for (const k of Object.keys(a)) {
    const same = a[k] === n[k]; if (!same) { diff++; const x = a[k].split('|'), y = n[k].split('|'); console.log('ANDERS', `${w}×${h}`, k, x.map((v, i) => v !== y[i] ? `${v} → ${y[i]}` : null).filter(Boolean).join(' ; ')); }
    else console.log('gleich', `${w}×${h}`, k);
  }
}
await b.close(); process.exit(diff ? 1 : 0);
