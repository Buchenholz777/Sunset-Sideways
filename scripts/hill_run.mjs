// Durchspielen im Hügelgelände: Testfahrer in Echtzeit, Bilder an Anstieg/Gefälle, Warnzeit und Treffer.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? 'hill-run';
mkdirSync(OUT, { recursive: true });
const LX = [-3.6, 0, 3.6];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chrome' });
const held = new Set();
async function key(page, k, on) { if (on && !held.has(k)) { held.add(k); await page.keyboard.down(k); } if (!on && held.has(k)) { held.delete(k); await page.keyboard.up(k); } }
for (const [seed, startS, secs] of [[12, 1000, 26], [5, 4000, 22], [99, 12000, 18]]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?qa=1&seed=${seed}&startS=${startS}`);
  await page.waitForTimeout(300); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  await page.evaluate(() => window.__qa.noPickups(true));
  const t0 = Date.now(); let last = null, shots = 0, minWarn = 1e9; const seen = new Set(); let prevH = null, prevS = null;
  while (Date.now() - t0 < secs * 1000) {
    const s = await page.evaluate(() => window.__qa.state());
    if (s.crashed) break;
    last = s;
    const v = s.v / 3.6;
    for (const o of s.obstacles) if (!seen.has(o.id)) { seen.add(o.id); if (o.z - s.s > 5) minWarn = Math.min(minWarn, (o.z - s.s) / Math.max(1, v - o.vz)); }
    if (prevH !== null) {
      const slope = (s.hill - prevH) / Math.max(0.5, s.s - prevS);
      if (Math.abs(slope) > 0.025 && shots < 3 && Date.now() - t0 > 1500 * (shots + 1)) { shots++; await page.screenshot({ path: `${OUT}/s${seed}-${startS}-${shots}-${slope > 0 ? 'anstieg' : 'gefaelle'}.png` }); }
    }
    prevH = s.hill; prevS = s.s;
    const tc = LX.map((lx) => { let m = 9; for (const o of s.obstacles) { if (Math.abs(o.x - lx) > 2.3 || o.z < s.s - 3) continue; m = Math.min(m, (o.z - s.s) / Math.max(1, v - o.vz)); } return m; });
    const cur = LX.reduce((bi, lx, i) => (Math.abs(lx - s.q) < Math.abs(LX[bi] - s.q) ? i : bi), 0);
    let best = cur, score = -1e9;
    for (let i = 0; i < 3; i++) {
      const need = Math.abs(LX[i] - s.q) / 20 + 0.1;
      let sc = Math.min(tc[i], 6) - (i === cur ? 0 : 0.35 * Math.abs(i - cur));
      for (let j = Math.min(i, cur); j <= Math.max(i, cur); j++) if (tc[j] < need + 0.25 && j !== i && j !== cur) sc -= 4;
      if (sc > score) { score = sc; best = i; }
    }
    const target = tc[cur] > 3 ? LX[cur] : LX[best];
    const want = target - s.q - s.vq * 0.03;
    await key(page, 'ArrowRight', want > 0.15); await key(page, 'ArrowLeft', want < -0.15);
    await sleep(10);
  }
  await key(page, 'ArrowRight', false); await key(page, 'ArrowLeft', false);
  console.log(`Seed ${seed} ab ${startS} m: ${last.crashed ? 'CRASH' : 'ohne Treffer'}, ${((last.s - startS) / 1000).toFixed(1)} km, bis ${Math.round(last.v)} km/h, Warnzeit min. ${minWarn.toFixed(2)} s, Hügelbilder ${shots}, Fehler ${errors.length}`);
  await ctx.close();
}
await browser.close();
