// Erzeugt public/og.jpg (1200×630): echter Spielausschnitt für Social-Vorschau und Spielbeschreibung.
// Voraussetzung: npm run build:pages (dist/ vorhanden). Aufruf: node scripts/make_og.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const srv = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4177', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto('http://localhost:4177/?qa=1&seed=7&startS=14200');
await page.waitForTimeout(500); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
for (let i = 0; i < 14; i++) await page.evaluate(() => { window.__qa.give(5); window.__qa.advance(0.25, 0); });
await page.screenshot({ path: 'public/og.jpg', type: 'jpeg', quality: 82 });
await browser.close(); srv.kill();
console.log('public/og.jpg geschrieben');
