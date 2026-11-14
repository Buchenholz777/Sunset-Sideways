// P0-Abnahme im echten Chrome (Eingabe, Pause-Ursachen, Tastatur-Fokus, erstes Hindernis, Touch-Abbruch). Aufruf: node scripts/p0_check.mjs http://localhost:4173
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const results = [];
const note = (n, ok, info = '') => { results.push(ok); console.log(ok ? 'OK  ' : 'FAIL', n, info); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chrome' });
const fresh = async (opts = {}, url = '/?qa=1&seed=12') => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...opts });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + url); await page.waitForTimeout(500);
  return { ctx, page, errs };
};
const phase = (p) => p.evaluate(() => window.__qa.state()?.phase ?? 'preview');

// 1) erstes Hindernis: Hinweis erscheint, Ausweichen blendet aus, Crash → wieder da
{
  const { ctx, page, errs } = await fresh();
  await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  note('Erstes Hindernis: Hinweis „Weiche aus“ mit Pfeilen sichtbar', await page.locator('#hint').isVisible() && (await page.textContent('#hint')).includes('Weiche aus'));
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(350); await page.keyboard.up('ArrowRight'); await page.waitForTimeout(200);
  note('Nach Ausweichen verschwindet der Hinweis', !(await page.locator('#hint').isVisible()));
  await ctx.close();
}
{
  const { ctx, page } = await fresh();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('screen-result') && !document.getElementById('screen-result').hidden, null, { timeout: 15000 });
  const sum = await page.evaluate(() => window.__qa.state());
  note('Ohne Lenken: früher Crash beim ersten Hindernis (Referenz ≈ 2,9 s / 175 m)', sum.crashed && sum.s > 120 && sum.s < 260, `${Math.round(sum.s)} m nach ${sum.t.toFixed(2)} s`);
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  note('Nach frühem Crash erscheint der Hinweis im nächsten Lauf wieder', await page.locator('#hint').isVisible());
  await ctx.close();
}
{ // Persistenz im normalen Lauf (ohne QA): Ausweichen merken, nach Neuladen kein Hinweis mehr
  const { ctx, page } = await fresh({}, '/?seed=12');
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(350); await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(3600);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sunset-sideways:v1') ?? '{}'));
  note('Erfolgreiches Umfahren wird gespeichert (nur normale Läufe)', saved.dodged === true, JSON.stringify(saved));
  await page.reload(); await page.waitForTimeout(400); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  note('Nach Neuladen: kein Hinweis mehr', !(await page.locator('#hint').isVisible()));
  await ctx.close();
}

// 2) Start → steuerbarer Frame
{
  const { ctx, page } = await fresh();
  const ms = await page.evaluate(() => new Promise((res) => {
    const t0 = performance.now(); document.getElementById('btn-start').click();
    const tick = () => { const s = window.__qa.state(); if (s && s.t > 0.01) res(performance.now() - t0); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
  note('Klick auf „Fahren“ bis erster simulierter Schritt (steuerbar)', ms < 250, `${Math.round(ms)} ms (warmer Desktop-Test, Chrome)`);
  await ctx.close();
}

// 3) Tastatur-Fokus und Pause
{
  const { ctx, page } = await fresh();
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  await page.evaluate(() => window.__qa.freeze());                       // Strecke leeren: der Lauf endet nicht während der Prüfungen
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  note('Escape pausiert (manuell, ohne Hinweistext)', (await phase(page)) === 'paused' && !(await page.locator('#pause-reason').isVisible()));
  await page.focus('#btn-restart'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  const s1 = await page.evaluate(() => window.__qa.state());
  note('Enter auf fokussiertem „Neu starten“ startet wirklich neu (nicht Fortsetzen)', s1.phase === 'running' && s1.t < 0.6, `t=${s1.t.toFixed(2)}`);
  await page.evaluate(() => window.__qa.freeze());                       // nach dem Neustart erneut leeren
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.focus('#btn-resume'); await page.keyboard.press('Space'); await page.waitForTimeout(200);
  note('Leertaste auf „Fortsetzen“ setzt fort, genau eine Aktion', (await phase(page)) === 'running');
  // schnelles Mehrfachklicken auf Fortsetzen/Neu starten ändert nichts Unerwartetes
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  for (let i = 0; i < 5; i++) await page.click('#btn-resume', { delay: 5 }).catch(() => {});
  note('Mehrfachklick auf „Fortsetzen“: Lauf läuft einmal weiter', (await phase(page)) === 'running', await phase(page));
  await ctx.close();
}

// 4) Pause-Ursachen
{
  const { ctx, page } = await fresh();
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  await page.evaluate(() => window.__qa.freeze());
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(150);
  const log1 = await page.evaluate(() => window.__qa.pauseLog());
  note('Fokusverlust pausiert mit Ursache „blur“ und zeigt den Grund', (await phase(page)) === 'paused' && log1.at(-1) === 'blur' && (await page.textContent('#pause-reason')).includes('Fokus'), log1.join(','));
  await page.click('#btn-resume'); await page.waitForTimeout(200);
  note('Fortsetzen nach blur: Lauf läuft, Eingabe neutral', (await phase(page)) === 'running' && (await page.evaluate(() => window.__qa.input().dir)) === 0);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(150);
  const log2 = await page.evaluate(() => window.__qa.pauseLog());
  note('Versteckter Tab pausiert mit Ursache „hidden“', (await phase(page)) === 'paused' && log2.at(-1) === 'hidden');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
  await page.click('#btn-resume'); await page.waitForTimeout(150);
  const t0 = (await page.evaluate(() => window.__qa.state())).t;
  await page.evaluate(() => { const e = performance.now() + 450; while (performance.now() < e) { /* langer Frame */ } });
  await page.waitForTimeout(200);
  const t1 = (await page.evaluate(() => window.__qa.state())).t;
  note('Langer Frame (450 ms) pausiert nicht und holt keine Weltzeit nach', (await phase(page)) === 'running' && t1 - t0 < 0.5, `Δt=${(t1 - t0).toFixed(2)} s bei 450 ms Blockade + 200 ms Warten`);
  await page.evaluate(() => { const e = performance.now() + 1300; while (performance.now() < e) { /* Unterbrechung */ } });
  await page.waitForTimeout(150);
  const log3 = await page.evaluate(() => window.__qa.pauseLog());
  note('Unterbrechung (1,3 s) pausiert mit Ursache „stall“ ohne Zeitsprung', (await phase(page)) === 'paused' && log3.at(-1) === 'stall' && (await page.evaluate(() => window.__qa.state().t)) - t1 < 0.6, log3.join(','));
  await ctx.close();
}
{ // eingebetteter Browser ohne Fokus: kein Pause-Dauerschleife
  const { ctx, page } = await fresh();
  await page.evaluate(() => { Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true }); });
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(300);
  note('Ohne Dokumentfokus von Anfang an: blur löst keine Dauer-Pause aus', (await phase(page)) === 'running');
  await ctx.close();
}

// 5) Touch: relative Lenkung, Abbruch sofort neutral
{
  const { ctx, page } = await fresh({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const cdp = await ctx.newCDPSession(page);
  const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await page.keyboard.press('Enter').catch(() => {}); await page.evaluate(() => document.getElementById('btn-start').click()); await page.waitForTimeout(300);
  const q0 = (await page.evaluate(() => window.__qa.state())).q;
  await tp('touchStart', [{ x: 100, y: 600, id: 1 }]); await page.waitForTimeout(80);
  const q1 = (await page.evaluate(() => window.__qa.state())).q;
  note('Aufsetzen versetzt das Auto nicht', Math.abs(q1 - q0) < 0.3, `Δq=${(q1 - q0).toFixed(2)} m`);
  for (let i = 1; i <= 6; i++) await tp('touchMove', [{ x: 100 + i * 12, y: 600, id: 1 }]);
  await page.waitForTimeout(120);
  const mid = await page.evaluate(() => window.__qa.input());
  note('Ziehen setzt eine Lenkanforderung', mid.drag !== null && mid.drag > 0.5, `drag=${mid.drag}`);
  await tp('touchCancel', []); await page.waitForTimeout(60);
  const aft = await page.evaluate(() => window.__qa.input());
  note('Abbruch (touchcancel): Lenkanforderung sofort neutral, kein Nachführen', aft.drag === null, JSON.stringify(aft));
  await tp('touchStart', [{ x: 100, y: 600, id: 2 }]); for (let i = 1; i <= 6; i++) await tp('touchMove', [{ x: 100 + i * 12, y: 600, id: 2 }]);
  await tp('touchEnd', []); await page.waitForTimeout(80);
  const rel = await page.evaluate(() => window.__qa.input());
  note('Reguläres Loslassen: Ziel bleibt kurz bestehen (Nachführen)', rel.drag !== null, JSON.stringify(rel));
  await page.waitForTimeout(1000);
  note('… und endet nach dem Settle-Zeitraum', (await page.evaluate(() => window.__qa.input())).drag === null);
  note('Spielfläche verschiebt die Seite nicht (touch-action: none)', (await page.evaluate(() => getComputedStyle(document.getElementById('stage')).touchAction)) === 'none');
  await ctx.close();
}
await browser.close();
const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad}/${results.length} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
