// Erster Lauf mit echten Eingaben (Chrome): Bildfolge bis zum ersten Hindernis, Ausweichen links/rechts (Tastatur und Touch), Spawn/erkennbar/Kontakt.
// node scripts/first_run.mjs http://localhost:4173 [Ausgabeordner]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:4173', OUT = process.argv[3] ?? 'grafik-erster-lauf';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ channel: 'chrome' });
const results = []; const note = (n, ok, i = '') => { results.push(ok); console.log(ok ? 'OK  ' : 'FAIL', n, i); };
const st = (p) => p.evaluate(() => window.__qa.state());
// Bildfolge
for (const [n, w, h, touch] of [['desktop', 1280, 720, false], ['hoch390', 390, 844, true]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?qa=1&seed=12`); await page.waitForSelector('#btn-start'); await sleep(400);
  if (touch) await page.locator('#btn-start').tap(); else await page.keyboard.press('Enter');
  const t0 = Date.now(); let k = 0; const log = [];
  while (Date.now() - t0 < 3300) {
    const s = await st(page); if (s.crashed) break;
    const ob = s.obstacles[0];
    log.push([Math.round(s.t * 100) / 100, ob ? Math.round(ob.z - s.s) : null, await page.evaluate(() => { const h = document.getElementById('hint'); return h && !h.hidden && getComputedStyle(h).display !== 'none'; })]);
    if (k % 3 === 0) await page.screenshot({ path: `${OUT}/${n}-t${String(Math.round(s.t * 100)).padStart(3, '0')}.png` });
    k++; await sleep(150);
  }
  console.log('INFO', n, 'Zeit/Abstand zum Hindernis(m)/Hinweis:', log.filter((_, i) => i % 3 === 0).map((l) => l.join('/')).join('  '));
  await ctx.close();
}
// Ausweichen mit echten Eingaben, je 6 Läufe
for (const side of ['links', 'rechts']) for (const mode of ['Tastatur', 'Touch']) {
  let ok = 0;
  for (let i = 0; i < 4; i++) {
    const touch = mode === 'Touch';
    const ctx = await b.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 720 }, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
    await page.goto(`${BASE}/?qa=1&seed=${12 + i}`); await page.waitForSelector('#btn-start'); await sleep(300);
    if (touch) await page.locator('#btn-start').tap(); else await page.keyboard.press('Enter');
    // erst nach der Reaktionszeit lenken: ≈ 1,0 s nach Start (Hindernis noch ≈ 2 s entfernt)
    while ((await st(page)).t < 1.0) await sleep(20);
    const key = side === 'links' ? 'ArrowLeft' : 'ArrowRight';
    if (touch) { const x0 = 195, dx = side === 'links' ? -90 : 90; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: 600, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx, y: 600, id: 1 }] }); await sleep(500); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { await page.keyboard.down(key); await sleep(350); await page.keyboard.up(key); }
    await sleep(2600);
    const s = await st(page); if (!s.crashed && s.s > 190) ok++;
    await ctx.close();
  }
  note(`Ausweichen ${side} (${mode}), 4 Läufe: erste Absperrung passiert`, ok === 4, `${ok}/4`);
}
await b.close();
const bad = results.filter((x) => !x).length; console.log(`\n${results.length - bad}/${results.length} Prüfungen bestanden`); process.exit(bad ? 1 : 0);
