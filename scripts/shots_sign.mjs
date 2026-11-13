// Bilder: Streckenschild alle 5 km (Annäherung) und Anstieg ohne „Knick“ am unteren Bildrand.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] ?? 'sign-shots'; mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4188', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const b = await chromium.launch({ channel: 'chrome' });
for (const [name, w, h] of [['desktop', 1280, 720], ['mobil', 390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  for (const [startS, seed, tag, until] of [[4700, 5, 'schild-5km', 4960], [9800, 5, 'schild-10km', 9965], [1000, 3, 'anstieg', 1100]]) {
    await p.goto(`http://localhost:4188/?qa=1&seed=${seed}&startS=${startS}`); await p.waitForTimeout(300); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
    await p.evaluate(() => window.__qa.freeze());
    for (let i = 0; i < 60; i++) { const s = await p.evaluate(() => { window.__qa.advance(0.1, 0); return window.__qa.state().s; }); if (s >= until) break; }
    await p.screenshot({ path: `${OUT}/${name}-${tag}.png` });
  }
  console.log(name, 'Fehler:', errs.length);
  await p.close();
}
await b.close(); srv.kill();
