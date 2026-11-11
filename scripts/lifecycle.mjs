// Lebenszyklus-Prüfungen im Browser (A12-5): Neustarts, Speicher, Fokus, Ton, gehaltene Taste.
// Nutzung: npm run preview (Port 4173) und dann: node scripts/lifecycle.mjs
import { chromium } from 'playwright-core';

const TARGET = process.env.URL ?? 'http://localhost:4173/?seed=12';
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(ok ? 'OK  ' : 'FAIL', name, info); };
const txt = (page, sel) => page.locator(sel).textContent();

const counters = () => {
  // zählt registrierte Event-Handler und gleichzeitig laufende rAF-Callbacks pro Sekunde
  const add = EventTarget.prototype.addEventListener;
  window.__listeners = {};
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    const key = (this === window ? 'window' : this === document ? 'document' : 'element') + ':' + type;
    window.__listeners[key] = (window.__listeners[key] ?? 0) + 1;
    return add.call(this, type, ...rest);
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.__raf = 0;
  window.requestAnimationFrame = (f) => raf((t) => { window.__raf++; f(t); });
};

async function fresh(init, viewport = { width: 1366, height: 768 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(TARGET);
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

async function crashRun(page) {
  await page.keyboard.press('Enter');
  await page.waitForSelector('#screen-result:not([hidden])', { timeout: 30000 });
}

// 1) 20 Neustarts: keine zusätzlichen Event-Handler, genau eine Render-Schleife
{
  const { ctx, page, errors } = await fresh(counters);
  const rafPerSec = async () => { const a = await page.evaluate(() => window.__raf); await page.waitForTimeout(1000); return (await page.evaluate(() => window.__raf)) - a; };
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const l0 = await page.evaluate(() => JSON.stringify(window.__listeners));
  const f0 = await rafPerSec();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Escape');
    await page.locator('#btn-restart').click();
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(2300); // Bedienhinweis läuft ab
  const l1 = await page.evaluate(() => JSON.stringify(window.__listeners));
  const f1 = await rafPerSec();
  check('20 Neustarts: Event-Handler unverändert', l0 === l1, l0 === l1 ? '' : `${l0} → ${l1}`);
  check('20 Neustarts: eine Render-Schleife (Frames/s vorher ≈ nachher)', Math.abs(f1 - f0) <= 8 && f1 < 75, `${f0} → ${f1}`);
  check('20 Neustarts: Lauf aktiv, keine Fehler', (await txt(page, '#hud-distance')) !== '0 m' && errors.length === 0, errors.join('|'));
  await ctx.close();
}

// 2) Beschädigter Speicher
{
  const { ctx, page, errors } = await fresh(() => localStorage.setItem('glimmer-mile:v1', '{kaputt'));
  check('beschädigter Speicher: Start zeigt 0 m', (await txt(page, '#start-best')).trim() === '0 m');
  await crashRun(page);
  check('beschädigter Speicher: Lauf, Ergebnis und Rekord funktionieren', (await page.locator('#res-record').isVisible()) && errors.length === 0);
  await ctx.close();
}

// 3) Gesperrter Speicher: Spiel läuft, Rekord bleibt in der Sitzung
{
  const { ctx, page, errors } = await fresh(() => {
    Storage.prototype.getItem = () => { throw new Error('gesperrt'); };
    Storage.prototype.setItem = () => { throw new Error('gesperrt'); };
  });
  await crashRun(page);
  const best = (await txt(page, '#res-best')).trim();
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  check('gesperrter Speicher: Rekord bleibt in der Sitzung', best !== '0 m' && (await txt(page, '#hud-best')).trim() === best && errors.length === 0, best);
  await ctx.close();
}

// 4) Bestwert nach Reload und Tonstatus
{
  const { ctx, page } = await fresh();
  await crashRun(page);
  const best = (await txt(page, '#res-best')).trim();
  await page.locator('#btn-sound').click();
  await page.reload();
  await page.waitForTimeout(400);
  check('Bestwert nach Reload', (await txt(page, '#start-best')).trim() === best, best);
  check('Tonstatus nach Reload', (await page.locator('#btn-sound').getAttribute('aria-pressed')) === 'true');
  await ctx.close();
}

// 5) Fokus und Sichtbarkeit: Pause, kein Weiterfahren ohne ausdrückliches Fortsetzen
{
  const { ctx, page } = await fresh();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  check('Fokusverlust pausiert', await page.locator('#screen-pause').isVisible());
  const d0 = await txt(page, '#hud-distance');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(500);
  check('Fokus zurück: weiter pausiert, Strecke unverändert', (await page.locator('#screen-pause').isVisible()) && (await txt(page, '#hud-distance')) === d0);
  await page.locator('#btn-resume').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  check('Hintergrundwechsel pausiert', await page.locator('#screen-pause').isVisible());
  await ctx.close();
}

// 6) Gehaltene Taste startet nach dem Crash nicht neu; Wiederstart-Button erst nach 450 ms
{
  const { ctx, page } = await fresh(() => {
    window.__t = {};
    document.addEventListener('DOMContentLoaded', () => {
      const res = document.getElementById('screen-result'), btn = document.getElementById('btn-again');
      new MutationObserver(() => { if (!res.hidden && !window.__t.shown) window.__t.shown = performance.now(); }).observe(res, { attributes: true });
      new MutationObserver(() => { if (!btn.disabled && window.__t.shown && !window.__t.enabled) window.__t.enabled = performance.now(); }).observe(btn, { attributes: true });
    });
  });
  await page.keyboard.press('Enter');
  await page.keyboard.down('Space');
  await page.waitForSelector('#screen-result:not([hidden])', { timeout: 30000 });
  await page.waitForTimeout(900);
  const tt = await page.evaluate(() => window.__t);
  const gap = tt.enabled - tt.shown; // Ergebnis erscheint 300 ms, Button aktiv 450 ms nach dem Crash ⇒ ≈ 150 ms später
  check('Wiederstart-Button erst ≈ 450 ms nach dem Crash aktiv', gap > 90 && gap < 260 && (await page.locator('#btn-again').isEnabled()), `Abstand Ergebnis→aktiv ${Math.round(gap)} ms`);
  check('gehaltene Taste startet nicht neu', await page.locator('#screen-result').isVisible());
  await page.keyboard.up('Space');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  check('neuer Tastendruck startet neu', !(await page.locator('#screen-result').isVisible()));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
