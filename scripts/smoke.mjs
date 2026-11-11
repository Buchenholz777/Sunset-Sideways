// Browser-Smoke-Test gegen den Produktionsbuild (npm run preview muss laufen, Port 4173).
// Nutzung: node scripts/smoke.mjs [ausgabeordner]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'smoke-out';
mkdirSync(out, { recursive: true });
const TARGET = process.env.URL ?? 'http://localhost:4173/?seed=12';
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(ok ? 'OK  ' : 'FAIL', name, info); };

async function scenario(label, viewport, touch) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(TARGET);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${label}-1-start.png` });
  check(`${label}: Startoverlay sichtbar`, await page.locator('#screen-start').isVisible());
  if (touch) await page.locator('#btn-start').tap(); else await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  check(`${label}: Fahrt läuft (Strecke > 0)`, (await page.locator('#hud-distance').textContent()) !== '0 m', await page.locator('#hud-distance').textContent());
  if (touch) {
    const b = await page.locator('#stage').boundingBox();
    const y = b.y + b.height * 0.85;
    const cdp = await ctx.newCDPSession(page);
    const tp = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await tp('touchStart', b.x + b.width / 2);
    for (let i = 1; i <= 8; i++) { await tp('touchMove', b.x + b.width / 2 + i * 3); await page.waitForTimeout(30); }
    for (let i = 7; i >= 0; i--) { await tp('touchMove', b.x + b.width / 2 + i * 3); await page.waitForTimeout(30); }
    // Gegenlenken, damit die Richtung wieder zur Straße passt (neutral hält die Richtung)
    for (let i = 1; i <= 8; i++) { await tp('touchMove', b.x + b.width / 2 - i * 3); await page.waitForTimeout(30); }
    for (let i = 7; i >= 0; i--) { await tp('touchMove', b.x + b.width / 2 - i * 3); await page.waitForTimeout(30); }
    await tp('touchEnd', 0);
  } else {
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(80); await page.keyboard.up('ArrowRight'); await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(110); await page.keyboard.up('ArrowLeft');
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${label}-2-drive.png` });
  // Rotation/Größenwechsel mitten im Lauf: Run bleibt erhalten, Bild wird neu komponiert
  if (touch) {
    const before = await page.locator('#hud-distance').textContent();
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${label}-3b-rotation.png` });
    const after = await page.locator('#hud-distance').textContent();
    check(`${label}: Rotation bewahrt den Lauf`, !(await page.locator('#screen-start').isVisible()) && after !== undefined, `${before} → ${after}`);
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);
  }
  // Pause per Button
  await page.locator('#btn-pause').click({ timeout: 4000 }).catch(async (e) => { console.log('PAUSE-CLICK FEHLT:', await page.evaluate(() => ({ res: !document.getElementById('screen-result').hidden, d: document.getElementById('hud-distance').textContent, p: !document.getElementById('btn-pause').hidden }))); throw e; });
  check(`${label}: Pause-Overlay`, await page.locator('#screen-pause').isVisible());
  await page.screenshot({ path: `${out}/${label}-3-pause.png` });
  await page.locator('#btn-resume').click();
  check(`${label}: Fortsetzen`, !(await page.locator('#screen-pause').isVisible()));
  // Bis zum Crash fahren (ohne Lenken)
  await page.waitForSelector('#screen-result:not([hidden])', { timeout: 30000 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${label}-4-result.png` });
  check(`${label}: Ergebnis zeigt Strecke`, /\d/.test(await page.locator('#res-dist').textContent()), await page.locator('#res-dist').textContent());
  await page.waitForTimeout(500);
  check(`${label}: Nochmal-Button aktiv`, await page.locator('#btn-again').isEnabled());
  if (touch) await page.locator('#btn-again').tap(); else await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  check(`${label}: Neustart ohne Hauptmenü`, !(await page.locator('#screen-result').isVisible()) && !(await page.locator('#hud').isHidden()));
  const ext = requests.filter((u) => !u.startsWith(new URL(TARGET).origin));
  check(`${label}: keine externen Anfragen`, ext.length === 0, ext.join(','));
  check(`${label}: keine Konsolenfehler`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await scenario('desktop1366', { width: 1366, height: 768 }, false);
await scenario('hoch390', { width: 390, height: 844 }, true);
await scenario('klein320', { width: 320, height: 568 }, true);
await scenario('quer844', { width: 844, height: 390 }, true);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
process.exit(failed.length ? 1 : 0);
