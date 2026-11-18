// P1-Abnahme im echten Chrome (Desktop, Smartphone-Emulation Hoch- und Querformat, Echtzeit):
// Near Miss per Tastatur, kein Near Miss bei passivem Vorbeifahren und bei Crash, Stil-HUD (Combo, Rush), Spurwechsel-Blinker, Ergebnisanzeige,
// Neustart, reduzierte Bewegung, Konsolenfehler, Layout (kein Überlauf, nichts außerhalb des Bildschirms). node scripts/p1_check.mjs <URL> [Ordner]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:4173', OUT = process.argv[3] ?? 'grafik-vergleich/p1';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => { results.push([name, ok]); console.log(`${ok ? 'bestanden   ' : 'FEHLGESCHLAGEN'}  ${name}${info ? '  [' + info + ']' : ''}`); };

const b = await chromium.launch({ channel: 'chrome' });
const errors = [];

async function open(vp, qa, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: !!vp.touch, isMobile: !!vp.touch, deviceScaleFactor: 1, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(() => { try { localStorage.setItem('sunset-sideways:v1', JSON.stringify({ v: 1, best: 4210, muted: true, dodged: true })); localStorage.setItem('ssw-consent', JSON.stringify({ v: 1, d: 'denied', ts: 1 })); } catch {} });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${vp.name}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${vp.name}: ${e.message}`));
  await page.goto(`${BASE}/?qa=1&seed=12&${qa}`);
  await page.waitForSelector('#btn-start');
  await sleep(250);
  await page.evaluate(() => document.getElementById('btn-start').click());
  // Die Simulation muss in Echtzeit laufen (der erste Seitenaufruf nach dem Browserstart kann kurz blockieren und löst die automatische Pause aus)
  const t0 = (await page.evaluate(() => window.__qa.state())).t;
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    const s = await page.evaluate(() => window.__qa.state());
    if (s.phase === 'paused') await page.evaluate(() => document.getElementById('btn-resume')?.click());
    else if (s.t > t0 + 0.15) break;
  }
  await page.evaluate(() => { window.__qa.freeze(); window.__qa.noPickups(true); });
  return { ctx, page };
}
const st = (page) => page.evaluate(() => window.__qa.state());
let s;
{ const w = await b.newContext({ viewport: { width: 800, height: 450 } }); const wp = await w.newPage(); await wp.goto(`${BASE}/`); await wp.waitForSelector('#btn-start'); await sleep(600); await w.close(); }   // Aufwärmen

/** Wartet in Echtzeit, bis die Kollisionszeit zum ersten Hindernis ≤ ttc ist. */
async function waitTtc(page, ttc, timeout = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await st(page);
    const o = s.obstacles.find((x) => x.z > s.s);
    if (!o) return false;
    if ((o.z - s.s) / (s.v / 3.6 - o.vz) <= ttc) return true;
    await sleep(8);
  }
  return false;
}

// ---------------------------------------------------------------- Desktop: Near Miss, Combo, Ergebnis
for (const vp of [{ name: 'desktop', w: 1280, h: 720 }]) {
  let { ctx, page } = await open(vp, 'startS=700&startT=30');
  // 1. gültiger Near Miss mit echter Tasteneingabe
  await page.evaluate(() => window.__qa.place({ k: 'obstacle', kind: 'barrier', x: 0, dz: 190 }));
  check('Near Miss: Hindernis rechtzeitig erreicht', await waitTtc(page, 1.0));
  await page.keyboard.down('ArrowRight'); await sleep(230); await page.keyboard.up('ArrowRight');
  let seenText = '';
  for (let i = 0; i < 60; i++) { const txt = await page.evaluate(() => { const e = document.getElementById('fx-miss'); return e.hidden ? '' : e.textContent; }); if (/near miss/i.test(txt)) { seenText = txt; break; } await sleep(30); }
  let s = await st(page);
  check('Near Miss: genau einer, 100 Stilpunkte, Combo x1, Rush-Ladung 20 %', s.style.near === 1 && s.style.score === 100 && s.style.mult === 1 && s.style.charge === 20, JSON.stringify(s.style));
  check('Near Miss: Hinweis „Near Miss! +100“ erscheint', /near miss/i.test(seenText) && /100/.test(seenText), seenText);
  check('Near Miss: HUD zeigt Stil 100, Combo x1 und Rush 20 %', await page.evaluate(() => document.getElementById('hud-style-score').textContent === '100' && document.getElementById('hud-combo-x').textContent === 'x1' && document.getElementById('hud-rush-txt').textContent === '20 %'));
  check('Distanz unverändert gezählt (Strecke > 700 m, Stilpunkte getrennt)', s.s > 700 && s.style.score === 100);
  await page.screenshot({ path: `${OUT}/${vp.name}-nearmiss.png` });
  await ctx.close();

  // 2. passives Vorbeifahren: kein Near Miss
  ({ ctx, page } = await open(vp, 'startS=700&startT=30'));
  await page.evaluate(() => window.__qa.place({ k: 'obstacle', kind: 'barrier', x: 3.6, dz: 190 }));
  await sleep(3600);
  s = await st(page);
  check('passives Vorbeifahren: kein Near Miss, keine Punkte, nicht abgestürzt', s.style.near === 0 && s.style.score === 0 && !s.crashed, JSON.stringify(s.style));
  await ctx.close();

  // 3. Crash: kein Near Miss, Ergebnisanzeige mit allen Kennzahlen, Neustart per Taste
  ({ ctx, page } = await open(vp, 'startS=700&startT=30'));
  await page.evaluate(() => { window.__qa.styleSet({ combo: 3, charge: 40, score: 1200, near: 7, maxCombo: 4, rushCount: 1 }); window.__qa.place({ k: 'obstacle', kind: 'barrier', x: 0, dz: 150 }); });
  await page.waitForSelector('#screen-result:not([hidden])', { timeout: 8000 });
  await sleep(700);
  const res = await page.evaluate(() => ({ dist: document.getElementById('res-dist').textContent, style: document.getElementById('res-style').textContent, near: document.getElementById('res-near').textContent, combo: document.getElementById('res-combo').textContent, rush: document.getElementById('res-rush').textContent, rec: !document.getElementById('res-style-record').hidden, best: document.getElementById('res-style-best').textContent, again: !document.getElementById('btn-again').disabled }));
  check('Crash: Ergebnis zeigt Distanz, Stilpunkte, Near Misses, beste Combo, Rush-Phasen', /\d/.test(res.dist) && res.style === '1.200' && res.near === '7' && res.combo === 'x4' && res.rush === '1', JSON.stringify(res));
  check('Crash: QA-Lauf schreibt keinen Rekord (Stil-Rekord bleibt 0, kein „Neuer Stil-Rekord“)', !res.rec && res.best === '0');
  check('Crash: „Nochmal fahren“ ist sofort wieder möglich', res.again);
  await page.screenshot({ path: `${OUT}/${vp.name}-ergebnis.png` });
  await page.keyboard.press('Enter'); await sleep(400);
  const after = await page.evaluate(() => ({ score: document.getElementById('hud-style-score').textContent, combo: document.getElementById('hud-combo').hidden, rush: document.getElementById('hud-rush-txt').textContent, phase: document.documentElement.dataset.phase }));
  check('Neustart: neuer Lauf mit zurückgesetztem Stil-HUD', after.phase === 'running' && after.score === '0' && after.combo && after.rush === '0 %', JSON.stringify(after));
  await ctx.close();

  // 4. HUD mit Combo und Neon Rush, Spurwechsel-Blinker
  ({ ctx, page } = await open(vp, 'startS=3000&startT=60'));
  await page.evaluate(() => { window.__qa.styleSet({ combo: 3, charge: 100, rush: 4.2, score: 2400, near: 6, maxCombo: 3, rushCount: 1 }); });
  await sleep(120);
  const hud = await page.evaluate(() => ({ x: document.getElementById('hud-combo-x').textContent, vis: !document.getElementById('hud-combo').hidden, rush: document.getElementById('hud-rush').className, txt: document.getElementById('hud-rush-txt').textContent, hudRush: document.getElementById('hud').classList.contains('rush') }));
  check('HUD: Combo x3 sichtbar, Neon Rush aktiv mit Restzeit in Sekunden', hud.x === 'x3' && hud.vis && /on/.test(hud.rush) && /^\d,\d s$/.test(hud.txt) && hud.hudRush, JSON.stringify(hud));
  await page.screenshot({ path: `${OUT}/${vp.name}-rush.png` });
  // Pause: Rush- und Combo-Timer (aktive Spielzeit) stehen still, beim Fortsetzen kein Zeitsprung
  const before = await st(page);
  await page.evaluate(() => document.getElementById('btn-pause').click());
  await sleep(2500);
  const paused = await st(page);
  check('Pause: Rush-Restzeit, Combo und Spielzeit stehen still (2,5 s Pause)', paused.phase === 'paused' && Math.abs(paused.style.rushT - before.style.rushT) < 0.3 && paused.style.combo === before.style.combo && Math.abs(paused.t - before.t) < 0.3, `${before.style.rushT.toFixed(2)} → ${paused.style.rushT.toFixed(2)}`);
  await page.evaluate(() => document.getElementById('btn-resume').click());
  await sleep(400);
  const resumed = await st(page);
  check('Fortsetzen: kein Zeitsprung (Rush läuft ≈ 0,4 s weiter)', resumed.phase === 'running' && paused.style.rushT - resumed.style.rushT < 0.7 && paused.style.rushT - resumed.style.rushT >= 0, `${paused.style.rushT.toFixed(2)} → ${resumed.style.rushT.toFixed(2)}`);
  await page.evaluate(() => { window.__qa.styleSet({ rush: 0, charge: 0 }); window.__qa.place({ k: 'obstacle', kind: 'sedan', x: -3.6, dz: 330, vz: 13, lcTo: 0 }); });
  let stage = null, moved = false;
  for (let i = 0; i < 150; i++) { s = await st(page); const o = s.obstacles.find((x) => x.kind === 'sedan'); if (o) { if (o.lc === 'warn' && !stage) { stage = 'warn'; await page.screenshot({ path: `${OUT}/${vp.name}-blinker.png` }); } if (stage === 'warn' && o.x !== -3.6 && o.lc === 'move') moved = true; } await sleep(30); }
  check('Verkehr: Spurwechsler kündigt an (Blinker-Zustand warn) und bewegt sich erst danach', stage === 'warn' && moved);
  await ctx.close();
}

// ---------------------------------------------------------------- Power-ups im echten Browser: Fliegen (3 s), Phantom-Turbo (2,25 s, durchlässig), Schild (15 s)
{
  const { ctx, page } = await open({ name: 'powerups', w: 1280, h: 720 }, 'startS=3000&startT=60');
  await page.evaluate(() => window.__qa.give(0, 0, 0, 3));
  let maxH = 0; for (let i = 0; i < 50; i++) { const q = await st(page); maxH = Math.max(maxH, q.height); await sleep(60); }
  await sleep(1200);
  s = await st(page);
  check('Fliegen: hebt auf ≈ 4 m ab und landet nach ≈ 3 s ohne Absturz', maxH > 3.5 && s.height === 0 && s.glideT === 0 && !s.crashed, `max. Höhe ${maxH.toFixed(2)} m`);
  const v0 = (await st(page)).v;
  await page.evaluate(() => { window.__qa.give(0, 0, 0, 0, 2.25); window.__qa.place({ k: 'obstacle', kind: 'barrier', x: window.__qa.state().q, dz: 70 }); });
  let vMax = 0; for (let i = 0; i < 40; i++) { const q = await st(page); vMax = Math.max(vMax, q.v); await sleep(50); }
  s = await st(page);
  check('Phantom-Turbo: Tempo ≈ +35 %, Verkehr durchlässig (Absperrung getroffen ohne Absturz, kein Near Miss)', vMax / v0 > 1.3 && !s.crashed && s.style.near === 0, `${v0.toFixed(0)} → ${vMax.toFixed(0)} km/h`);
  await sleep(2200);
  s = await st(page);
  check('Phantom-Turbo endet: Tempo zurück, Schutzphase vorbei, Lauf geht weiter', s.boostT === 0 && s.style.grace === 0 && !s.crashed);
  await page.evaluate(() => window.__qa.give(15));
  await sleep(300);
  s = await st(page);
  check('Impulsschild: 15 s Dauer', s.shieldT > 14.2 && s.shieldT <= 15, `${s.shieldT.toFixed(2)} s`);
  await ctx.close();
}

// ---------------------------------------------------------------- Smartphone: Layout, Hochformat, Querformat, kleines Gerät
for (const vp of [{ name: 'p390', w: 390, h: 844, touch: true }, { name: 'p320', w: 320, h: 568, touch: true }, { name: 'q844', w: 844, h: 390, touch: true }]) {
  let { ctx, page } = await open(vp, 'startS=3000&startT=60');
  await page.evaluate(() => { window.__qa.styleSet({ combo: 5, charge: 100, rush: 3.4, score: 123456, near: 12, maxCombo: 7, rushCount: 2 }); window.__qa.place({ k: 'obstacle', kind: 'sedan', x: -3.6, dz: 300, vz: 13, lcTo: 0 }); });
  await sleep(300);
  const lay = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, vis: !e.hidden }; };
    const hud = r('hud-style'), btns = r('hud-btns'), eff = r('hud-effects');
    const overlap = !(hud.r < btns.l || hud.l > btns.r || hud.b < btns.t || hud.t > btns.b);
    return { vw, vh, hud, btns, overlap, scrollX: document.documentElement.scrollWidth > vw, inside: hud.l >= 0 && hud.r <= vw && hud.t >= 0 && hud.b <= vh, effInside: eff.r <= vw };
  });
  check(`${vp.name}: Stil-HUD liegt im Bild, überlagert Pause-/Tonknopf nicht, kein horizontales Scrollen`, lay.inside && !lay.overlap && !lay.scrollX, JSON.stringify({ hud: lay.hud, btns: lay.btns }));
  await page.screenshot({ path: `${OUT}/${vp.name}-hud.png` });
  // Near Miss per Daumenzug (Touch), Ergebnisanzeige lesbar
  await page.evaluate(() => { window.__qa.styleSet({ combo: 0, charge: 0, rush: 0, score: 0, near: 0, maxCombo: 0, rushCount: 0 }); window.__qa.freeze(); window.__qa.place({ k: 'obstacle', kind: 'barrier', x: 0, dz: 190 }); });
  const okTtc = await waitTtc(page, 1.0);
  const cdp = await ctx.newCDPSession(page);
  const x0 = vp.w / 2, y0 = vp.h * 0.8;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * vp.w * 0.06, y: y0 }] }); await sleep(18); }
  await sleep(200);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(1400);
  s = await st(page);
  check(`${vp.name}: Near Miss per Daumenzug`, okTtc && s.style.near === 1 && !s.crashed, JSON.stringify(s.style));
  await page.evaluate(() => { window.__qa.place({ k: 'obstacle', kind: 'barrier', x: window.__qa.state().q, dz: 60 }); });
  await page.waitForSelector('#screen-result:not([hidden])', { timeout: 8000 });
  await sleep(700);
  const rl = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const box = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const parts = ['#res-dist', '#res-stats', '#btn-again'].map(box);
    return { inside: parts.every((p) => p.l >= 0 && p.r <= vw && p.t >= 0 && p.b <= vh), parts, scrollX: document.documentElement.scrollWidth > vw };
  });
  check(`${vp.name}: Ergebnis vollständig lesbar (Distanz, Kennzahlen, Neustart im Bild)`, rl.inside && !rl.scrollX, JSON.stringify(rl.parts));
  await page.screenshot({ path: `${OUT}/${vp.name}-ergebnis.png` });
  await ctx.close();
}

// ---------------------------------------------------------------- reduzierte Bewegung
{
  const { ctx, page } = await open({ name: 'reduced', w: 390, h: 844, touch: true }, 'startS=700&startT=30', { reduced: true });
  await page.evaluate(() => window.__qa.place({ k: 'obstacle', kind: 'barrier', x: 0, dz: 190 }));
  await waitTtc(page, 1.0);
  await page.keyboard.down('ArrowRight'); await sleep(230); await page.keyboard.up('ArrowRight');
  await sleep(250);
  const anim = await page.evaluate(() => getComputedStyle(document.getElementById('fx-miss')).animationName);
  check('reduzierte Bewegung: keine Pop-up-Animation', anim === 'none', anim);
  await ctx.close();
}

check('keine Konsolenfehler', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close();
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} Prüfungen bestanden`);
process.exit(failed ? 1 : 0);
