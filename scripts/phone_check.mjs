// Smartphone-Abnahme (Touch-Emulation in Chrome, KEINE echte Hardware): Erreichbarkeit per echtem Tap, Banner, Hilfe, Hinweise, Lebenszyklus.
// Aufruf: node scripts/phone_check.mjs http://localhost:4173 [--before]   (--before: gibt Befunde nur aus, Exit-Code 0)
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const BEFORE = process.argv.includes('--before');
const results = [];
const note = (n, ok, info = '') => { results.push(ok); console.log(ok ? 'OK  ' : 'FAIL', n, info ?? ''); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chrome' });
const PORTRAIT = [[320, 568], [360, 640], [390, 844]];
const LANDSCAPE = [[844, 390], [740, 320]];

/** Trifft ein normaler Tap in die Mitte des Elements wirklich das Element (oder ein Kind)? */
const hit = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel); if (!el) return { ok: false, why: 'fehlt' };
  const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const inView = r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight;
  const top = document.elementFromPoint(cx, cy);
  const ok = inView && !!top && (top === el || el.contains(top));
  return { ok, why: ok ? '' : inView ? `verdeckt von ${top?.id || top?.className || top?.tagName}` : 'außerhalb', w: Math.round(r.width), h: Math.round(r.height) };
}, sel);
const phase = (page) => page.evaluate(() => window.__qa?.state()?.phase ?? 'preview');
async function open(w, h, query = '?qa=1&consent=1&seed=5', { touch = true, mobile = touch } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: mobile });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/' + query); await page.waitForSelector('#btn-start'); await page.waitForTimeout(300);
  return { ctx, page, errs };
}
const tap = async (page, sel) => { const r = await page.locator(sel).boundingBox(); await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); };

for (const [w, h] of [...PORTRAIT, ...LANDSCAPE]) {
  const tag = `${w}×${h}`;
  // ---- Start mit offenem Banner
  try {
    const { ctx, page } = await open(w, h);
    note(`${tag} Start: Banner vorhanden`, await page.locator('#consent').count() === 1);
    for (const [n, sel] of [['Fahren', '#btn-start'], ['Spielhilfe', '#about > summary'], ['Datenschutz', '.legal a[href="/datenschutz"]'], ['Impressum', '.legal a[href="/impressum"]'], ['Banner Ablehnen', '#consent [data-d="denied"]'], ['Banner Akzeptieren', '#consent [data-d="granted"]']]) {
      const r = await hit(page, sel); note(`${tag} Start+Banner: ${n} per Tap erreichbar`, r.ok, r.why);
    }
    // Spielhilfe öffnen, schließen; keine Fahrt gestartet
    await tap(page, '#about > summary'); await sleep(150);
    const open1 = await page.evaluate(() => document.getElementById('about').open);
    const body = await hit(page, '.about-body'); const sum = await hit(page, '#about > summary');
    note(`${tag} Spielhilfe öffnet sich per Tap`, open1);
    note(`${tag} offene Spielhilfe: Kopfzeile bleibt antippbar (Schließen)`, sum.ok, sum.why);
    const scroll = await page.evaluate(() => { const b = document.querySelector('.about-body'); const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, sh: b.scrollHeight, ch: b.clientHeight }; });
    note(`${tag} offene Spielhilfe liegt im Bild (oben ≥ 0)`, scroll.top >= 0, JSON.stringify(scroll));
    await page.evaluate(() => { const b = document.querySelector('.about-body'); b.scrollTop = 40; });
    note(`${tag} Scroll in der Hilfe startet keine Fahrt`, (await phase(page)) === 'preview');
    await tap(page, '#about > summary'); await sleep(150);
    note(`${tag} Spielhilfe schließt sich per Tap`, !(await page.evaluate(() => document.getElementById('about').open)));
    const f = await hit(page, '#btn-start'); note(`${tag} nach Schließen: Fahren erreichbar`, f.ok, f.why);
    // Überlappung Hilfe-Knopf ↔ Rechtslinks
    const ov = await page.evaluate(() => { const a = document.querySelector('#about > summary').getBoundingClientRect(); return [...document.querySelectorAll('.legal > *')].map((e) => { const b = e.getBoundingClientRect(); return !(b.right <= a.left || b.left >= a.right || b.bottom <= a.top || b.top >= a.bottom); }).some(Boolean); });
    note(`${tag} Spielhilfe überlappt keine Rechtslinks`, !ov);
    // Fahren per Tap mit offenem Banner
    await tap(page, '#btn-start'); await sleep(250);
    note(`${tag} Fahren per Tap startet (Banner offen)`, (await phase(page)) === 'running');
    note(`${tag} in der Fahrt ist das Banner nicht bedienbar im Weg`, await page.evaluate(() => { const c = document.getElementById('consent'); return !c || getComputedStyle(c).display === 'none'; }));
    const stored = await page.evaluate(() => localStorage.getItem('ssw-consent'));
    note(`${tag} Banner-Wegblenden speichert keine Entscheidung`, stored === null, String(stored));
    // Crash ohne Lenken
    await page.evaluate(() => { for (let i = 0; i < 40 && !window.__qa.state().crashed; i++) window.__qa.advance(1, 0); });
    await sleep(1400);
    const hintVis = await page.evaluate(() => { const h = document.getElementById('hint'); return !!h && getComputedStyle(h).display !== 'none'; });
    note(`${tag} Ergebnis: „Weiche aus“ nicht sichtbar`, !hintVis);
    const ag = await hit(page, '#btn-again'); note(`${tag} Ergebnis: „Nochmal fahren“ per Tap erreichbar`, ag.ok, ag.why);
    if (ag.ok) { await tap(page, '#btn-again'); await sleep(300); note(`${tag} zweiter Start per Tap`, (await phase(page)) === 'running'); }
    // Pause
    await page.evaluate(() => { window.__qa.freeze?.(); });
    await tap(page, '#btn-pause'); await sleep(200);
    note(`${tag} Pause per Tap`, (await phase(page)) === 'paused');
    const hintP = await page.evaluate(() => { const h = document.getElementById('hint'); return !!h && getComputedStyle(h).display !== 'none'; });
    note(`${tag} Pause: „Weiche aus“ nicht sichtbar`, !hintP);
    for (const [n, sel] of [['Fortsetzen', '#btn-resume'], ['Neu starten', '#btn-restart']]) { const r = await hit(page, sel); note(`${tag} Pause: ${n} erreichbar`, r.ok, r.why); }
    await ctx.close();
  } catch (e) { note(tag + " Ablauf mit Banner abgebrochen", false, String(e).slice(0, 120)); }
  // ---- Start ohne Banner (Entscheidung gespeichert): Platz im Fußbereich
  {
    const { ctx, page } = await open(w, h, '?qa=1&seed=5');
    for (const [n, sel] of [['Fahren', '#btn-start'], ['Spielhilfe', '#about > summary'], ['Datenschutz', '.legal a[href="/datenschutz"]'], ['Impressum', '.legal a[href="/impressum"]'], ['Cookie-Einstellungen', '#consent-settings']]) {
      const r = await hit(page, sel); note(`${tag} Start ohne Banner: ${n} erreichbar`, r.ok, r.why);
    }
    const sizes = await page.evaluate(() => ['#btn-start', '#about > summary', '#consent-settings', '.legal a'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.width), Math.round(r.height)]; }));
    console.log('INFO Trefferflächen', tag, JSON.stringify(sizes));
    await ctx.close();
  }
}

// ================= Daumenlenkung, Rotation, Unterbrechung (Touch über CDP, Chrome-Emulation) =================
{
  const { ctx, page, errs } = await open(390, 844, '?qa=1&seed=5');
  const cdp = await ctx.newCDPSession(page);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const inp = () => page.evaluate(() => window.__qa.input());
  await tap(page, '#btn-start'); await sleep(300);
  await page.evaluate(() => window.__qa.freeze());
  await T('touchStart', [{ x: 200, y: 600, id: 1 }]); const s0 = await inp();
  note('Touch: Aufsetzen verschiebt nicht (drag 0)', s0.drag === 0, JSON.stringify(s0));
  await T('touchMove', [{ x: 280, y: 600, id: 1 }]); const s1 = await inp();
  note('Touch: Ziehen nach rechts lenkt nach rechts', s1.drag > 0.5, String(s1.drag));
  await T('touchStart', [{ x: 280, y: 600, id: 1 }, { x: 40, y: 600, id: 2 }]); await T('touchMove', [{ x: 280, y: 600, id: 1 }, { x: 5, y: 600, id: 2 }]);
  const s2 = await inp(); note('Touch: zweiter Finger ändert die Lenkung nicht', Math.abs(s2.drag - s1.drag) < 0.05, String(s2.drag));
  // nur die Höhe ändert sich (Browserleiste): Daumenzug bleibt
  await page.setViewportSize({ width: 390, height: 780 }); await sleep(250);
  const s3 = await inp(); note('Browserleiste (nur Höhe): laufender Daumenzug bleibt erhalten', s3.drag !== null && s3.drag > 0.5, String(s3.drag));
  // Rotation: alter Kontakt wird beendet
  await page.setViewportSize({ width: 844, height: 390 }); await sleep(250);
  const s4 = await inp(); note('Rotation: alte Lenkung wird neutral', s4.drag === null, String(s4.drag));
  note('Rotation: Lauf läuft weiter', (await phase(page)) === 'running');
  await T('touchEnd', []);
  await T('touchStart', [{ x: 300, y: 200, id: 3 }]); const s5 = await inp();
  note('Neuer Kontakt beginnt mit frischem Bezugspunkt (drag 0)', s5.drag === 0, String(s5.drag));
  await T('touchCancel', []); const s6 = await inp();
  note('Abbruch (touchcancel): Lenkung neutral', s6.drag === null, String(s6.drag));
  // Tastendruck mitten in der Fahrt ändert das Layout nicht
  await page.keyboard.press('ArrowLeft'); await sleep(50);
  note('Tastendruck während der Fahrt schaltet das Touch-Layout nicht um', await page.evaluate(() => document.documentElement.classList.contains('touch')));
  // Hintergrund und Rückkehr
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(200);
  const t0 = (await page.evaluate(() => window.__qa.state())).t;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(200);
  note('Hintergrund: Spiel pausiert', (await phase(page)) === 'paused' && (await page.evaluate(() => window.__qa.pauseLog())).includes('hidden'));
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(1200);
  const t1 = (await page.evaluate(() => window.__qa.state())).t;
  note('Pausiert bleibt pausiert, keine Zeit läuft weiter', Math.abs(t1 - t0) < 0.1, (t1 - t0).toFixed(3));
  await tap(page, '#btn-resume'); await sleep(300);
  const s7 = await inp(); const t2 = (await page.evaluate(() => window.__qa.state())).t;
  note('Fortsetzen: kein Zeitsprung, keine alte Lenkbewegung', (await phase(page)) === 'running' && s7.drag === null && t2 - t1 < 0.6, `drag ${s7.drag}, Δt ${(t2 - t1).toFixed(2)}`);
  note('Keine JavaScript-Fehler', errs.length === 0, errs.join('|'));
  await ctx.close();
}

// ================= PC-Abgrenzung: keine Smartphone-Regeln ohne Touch =================
for (const [w, h] of [[1366, 768], [1920, 1080], [500, 700], [900, 320]]) {
  const { ctx, page, errs } = await open(w, h, '?qa=1&consent=1&seed=5', { touch: false });
  const tag = `PC ${w}×${h}`;
  note(`${tag}: kein Touch-Layout`, !(await page.evaluate(() => document.documentElement.classList.contains('touch'))));
  const pos = await page.evaluate(() => [getComputedStyle(document.querySelector('.about')).position, getComputedStyle(document.querySelector('.legal')).position, getComputedStyle(document.querySelector('.foot')).display]);
  note(`${tag}: Fußbereich unverändert (absolut positioniert, Wrapper ohne Box)`, pos[0] === 'absolute' && pos[1] === 'absolute' && pos[2] === 'contents', pos.join(','));
  await page.keyboard.press('Enter'); await sleep(300);
  note(`${tag}: Enter startet`, (await phase(page)) === 'running');
  await page.keyboard.down('ArrowLeft'); await sleep(250); await page.keyboard.up('ArrowLeft');
  await page.keyboard.press('Escape'); await sleep(150);
  note(`${tag}: Esc pausiert`, (await phase(page)) === 'paused');
  await page.keyboard.press('Escape'); await sleep(150);
  note(`${tag}: Esc setzt fort`, (await phase(page)) === 'running');
  await page.evaluate(() => { for (let i = 0; i < 40 && !window.__qa.state().crashed; i++) window.__qa.advance(1, 0); }); await sleep(1400);
  const banner = await page.evaluate(() => { const c = document.getElementById('consent'); return !!c && getComputedStyle(c).display !== 'none'; });
  note(`${tag}: Banner-Verhalten am PC unverändert (bleibt sichtbar)`, banner);
  await page.keyboard.press('Enter'); await sleep(300);
  note(`${tag}: Enter startet neu`, (await phase(page)) === 'running');
  note(`${tag}: keine JavaScript-Fehler`, errs.length === 0, errs.join('|'));
  await ctx.close();
}
await browser.close();
const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad}/${results.length} Prüfungen bestanden`);
process.exit(bad && !BEFORE ? 1 : 0);
