// Bildfolge Annäherung → Vorbeifahrt → Rückblick am Motelgrundstück (Abschnitt 12, Strecke 864–936 m). QA-Einstieg, Schild, ohne Lenken.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] ?? 'grafik-sequenz', BASE = process.argv[3] ?? 'http://localhost:4173';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
const p = await (await b.newContext({ viewport: { width: 960, height: 540 } })).newPage();
await p.goto(`${BASE}/?qa=1&seed=12&startS=700`); await p.waitForTimeout(350);
await p.evaluate(() => document.getElementById('btn-start').click()); await p.waitForTimeout(150);
await p.evaluate(() => { window.__qa.freeze(); window.__qa.give(5); });
for (let i = 0; i < 10; i++) { await p.evaluate(() => { window.__qa.give(5); window.__qa.advance(0.17, 0); }); const s = await p.evaluate(() => Math.round(window.__qa.state().s)); await p.screenshot({ path: `${OUT}/${String(i).padStart(2, '0')}-s${s}.png` }); }
await b.close();
