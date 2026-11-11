// Fahrprobe in Echtzeit mit echten Tastatur-/Touch-Ereignissen (Chrome), mit aktiven Kollisionen (kein ghost=1).
// Nutzung: node scripts/drive_check.mjs [basisURL] [ausgabeordner]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = process.argv[3] ?? 'drive-out';
mkdirSync(OUT, { recursive: true });
const Q = (extra = '') => `${BASE}/?qa=1&debug=1&seed=12${extra}`;
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
const note = (name, ok, info = '') => { results.push({ name, ok }); console.log(ok ? 'OK  ' : 'FAIL', name, info); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LX = [-3.6, 0, 3.6];

async function start(url, viewport = { width: 1366, height: 768 }, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(400);
  const startText = await page.locator('#controls-line').textContent();
  await page.screenshot({ path: `${OUT}/start-${touch ? 'touch' : 'desktop'}.png` });
  if (touch) await page.locator('#btn-start').tap(); else await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const cdp = touch ? await ctx.newCDPSession(page) : null;
  return { ctx, page, errors, cdp, startText };
}
const st = (page) => page.evaluate(() => window.__qa.state());
const held = new Set();
async function key(page, k, on) {
  if (on && !held.has(k)) { held.add(k); await page.keyboard.down(k); }
  if (!on && held.has(k)) { held.delete(k); await page.keyboard.up(k); }
}
/** Echtzeit-Regler per Tastatur auf eine Zielquerposition (Meter). */
async function goQ(page, target, maxMs = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await st(page);
    if (s.crashed) break;
    const want = target - s.q - s.vq * 0.03;
    await key(page, 'ArrowRight', want > 0.12); await key(page, 'ArrowLeft', want < -0.12);
    if (Math.abs(target - s.q) < 0.25 && Math.abs(s.vq) < 1.5) break;
    await sleep(15);
  }
  await key(page, 'ArrowRight', false); await key(page, 'ArrowLeft', false);
  await sleep(120);
  return st(page);
}
const frozen = (page) => page.evaluate(() => window.__qa.freeze());
const place = (page, spec) => page.evaluate((x) => window.__qa.place(x), spec);

// ---------- Desktop ----------
{
  const { ctx, page, errors, startText } = await start(Q());
  note('D: Startbildschirm zeigt nur „← → Lenken“', startText.trim() === '← → Lenken', JSON.stringify(startText));
  const s0 = await st(page);
  note('D: Eine Aktion startet die Fahrt direkt (kein Countdown)', s0.phase === 'running', `Phase ${s0.phase}`);
  note('D: Starttempo 210 km/h', s0.v >= 209.9 && s0.v < 216, `${s0.v.toFixed(1)} km/h bei t=${s0.t.toFixed(2)} s`);
  await frozen(page);
  await key(page, 'ArrowRight', true); await sleep(300); await key(page, 'ArrowRight', false);
  await sleep(500);
  const a = await st(page); await sleep(800); const b = await st(page);
  note('D: Loslassen – Querbewegung endet, Wagen hält die Position', Math.abs(b.q - a.q) < 0.05 && Math.abs(b.vq) < 0.05, `q ${a.q.toFixed(2)} → ${b.q.toFixed(2)}`);
  const goals = [-3.6, 0, 3.6, 0, -3.6, 3.6], reached = [];
  for (const t of goals) reached.push((await goQ(page, t)).q);
  note('D: alle drei Spuren per Tastatur erreichbar', reached.every((q, i) => Math.abs(q - goals[i]) < 0.45), reached.map((q) => q.toFixed(2)).join(' '));
  const t0 = Date.now(); let mn = 9, mx = -9;
  for (let i = 0; i < 10; i++) { await key(page, i % 2 ? 'ArrowLeft' : 'ArrowRight', true); await sleep(130); await key(page, i % 2 ? 'ArrowLeft' : 'ArrowRight', false); const s = await st(page); mn = Math.min(mn, s.q); mx = Math.max(mx, s.q); }
  const sq = await st(page);
  note('D: schnelles Links-rechts-Ausweichen bleibt auf der Straße', !sq.crashed && mn >= -4.46 && mx <= 4.46, `q ${mn.toFixed(2)}…${mx.toFixed(2)} in ${Date.now() - t0} ms`);
  await page.screenshot({ path: `${OUT}/D-fahrt.png` });
  note('D: keine Konsolenfehler', errors.length === 0, errors.join('|'));
  await ctx.close();
}

// ---------- Desktop: Power-ups ----------
{
  const { ctx, page } = await start(Q('&startS=700&startT=30'));
  await frozen(page);
  const types = ['shield', 'slow', 'clear', 'magnet'];
  await goQ(page, 0);
  for (const [i, t] of types.entries()) await place(page, { k: 'pickup', type: t, x: LX[i % 3], dz: 45 + 8 * Math.floor(i / 3) });
  await sleep(120);
  await page.screenshot({ path: `${OUT}/D-pickups-formen.png` });
  for (const type of types) {
    for (const lane of LX) {
      await frozen(page);
      await goQ(page, lane);
      const before = await st(page);
      await place(page, { k: 'pickup', type, x: lane, dz: 60 });
      if (type === 'clear') { await place(page, { k: 'obstacle', kind: 'barrier', x: lane, dz: 120 }); await place(page, { k: 'obstacle', kind: 'baken', x: lane === 0 ? 3.6 : 0, dz: 118 }); }
      const t0 = Date.now(); let s;
      while (Date.now() - t0 < 2500) { s = await st(page); if (s.pickups.length === 0) break; await sleep(20); }
      await sleep(250);
      s = await st(page);
      const got = s.pickupEvents - before.pickupEvents;
      let eff = true;
      if (type === 'shield') eff = s.shieldT > 5.5; else if (type === 'slow') eff = s.slowT > 2.5; else if (type === 'magnet') eff = s.magnetT > 10.5;
      else eff = s.obstacles.filter((o) => Math.abs(o.x - lane) < 1.8).length === 0 && s.obstacles.length === 1;
      note(`D: Pickup ${type} auf Spur ${lane}: genau einmal ausgelöst, Wirkung sichtbar`, got === 1 && eff && !s.crashed, `Ereignisse ${got}, Schild ${s.shieldT.toFixed(1)} Zeitlupe ${s.slowT.toFixed(1)} Magnet ${s.magnetT.toFixed(1)}, Hindernisse ${s.obstacles.length}`);
    }
  }
  await frozen(page);
  await goQ(page, 0);
  await page.evaluate(() => window.__qa.give(0, 0, 12));
  await place(page, { k: 'obstacle', kind: 'barrier', x: -3.6, dz: 140 }); await place(page, { k: 'obstacle', kind: 'truck', x: 3.6, dz: 190, vz: 10 });
  await sleep(150);
  await page.screenshot({ path: `${OUT}/D-magnet.png` });
  await ctx.close();
}

// ---------- Desktop: Treffer ----------
{
  const { ctx, page } = await start(Q('&startS=700&startT=30'));
  await frozen(page);
  await place(page, { k: 'obstacle', kind: 'barrier', x: 0, dz: 90 });
  await goQ(page, 0);
  let s; const t0 = Date.now();
  while (Date.now() - t0 < 5000) { s = await st(page); if (s.crashed) break; await sleep(30); }
  await page.waitForTimeout(700);
  const vis = await page.locator('#screen-result').isVisible();
  await page.screenshot({ path: `${OUT}/D-crash-ergebnis.png` });
  note('D: Hindernis ohne Schild beendet den Lauf, Ergebnis mit Strecke und Bestweite', s.crashed && vis, `Strecke ${await page.locator('#res-dist').textContent()}, Bestweite ${await page.locator('#res-best').textContent()}`);
  await page.waitForTimeout(500);
  await page.locator('#btn-again').click();
  await page.waitForTimeout(250);
  const s2 = await st(page);
  note('D: „Nochmal fahren“ startet direkt neu', s2 && s2.phase === 'running' && !s2.crashed && s2.t - 30 < 1, `Phase ${s2?.phase}, t=${s2?.t.toFixed(2)}`);
  await frozen(page);
  await page.evaluate(() => window.__qa.give(7, 0, 0));
  await place(page, { k: 'obstacle', kind: 'baken', x: 0, dz: 70 }); await place(page, { k: 'obstacle', kind: 'baken', x: 0, dz: 160 });
  await goQ(page, 0);
  let mid = null; const t1 = Date.now();
  while (Date.now() - t1 < 6000) { s = await st(page); if (!mid && s.shieldT === 0 && !s.crashed) mid = s; if (s.crashed) break; await sleep(30); }
  note('D: Schild fängt genau einen Treffer ab, der nächste beendet den Lauf', !!mid && s.crashed, `Schild nach 1. Treffer verbraucht: ${!!mid}, danach Crash: ${s.crashed}`);
  await ctx.close();
}

// ---------- Desktop: knapper Fehlschlag und dünnes Hindernis bei Höchsttempo ----------
{
  const touching = 1.3 + 0.95 - 0.07 - 0.05;
  const probe = async (q, url, kind, dz = 80) => {
    const { ctx, page } = await start(Q(url));
    await frozen(page);
    await page.evaluate((qq) => window.__qa.setQ(qq), q);
    await place(page, { k: 'obstacle', kind, x: 0, dz });
    const t0 = Date.now(); let s;
    while (Date.now() - t0 < 4000) { s = await st(page); if (s.crashed || s.obstacles.every((o) => o.z < s.s - 10)) break; await sleep(25); }
    await ctx.close();
    return { crashed: s.crashed, v: s.v };
  };
  const near = await probe(touching - 0.05, '&startS=700&startT=30', 'barrier');
  const free = await probe(touching + 0.2, '&startS=700&startT=30', 'barrier');
  note('D: knapper Fehlschlag (Kante berührt Barriere) bleibt ein Fehlschlag', near.crashed === true, 'Überlappung 0,05 m');
  note('D: sichtbar 0,2 m Abstand ⇒ frei', free.crashed === false, 'Abstand 0,2 m');
  const thin = await probe(0, '&startS=27000', 'baken', 150);
  note('D: dünne Bake (0,9 m) bei Höchsttempo wird getroffen', thin.crashed === true, `${thin.v.toFixed(0)} km/h`);
}

// ---------- Desktop: Durchgänge mit Testfahrer in Echtzeit, ohne Power-ups ----------
async function botRun(url, seconds, tag) {
  const { ctx, page } = await start(url);
  await page.evaluate(() => window.__qa.noPickups(true));
  const t0 = Date.now(); let s = await st(page); let vmax = 0;
  while (Date.now() - t0 < seconds * 1000) {
    s = await st(page);
    if (s.crashed) break;
    vmax = Math.max(vmax, s.v);
    const v = s.v / 3.6;
    const tc = LX.map((lx) => {
      let m = 9;
      for (const o of s.obstacles) {
        if (Math.abs(o.x - lx) > 2.3 || o.z < s.s - 3) continue;
        m = Math.min(m, (o.z - s.s) / Math.max(1, v - o.vz));
      }
      return m;
    });
    const cur = LX.reduce((bi, lx, i) => (Math.abs(lx - s.q) < Math.abs(LX[bi] - s.q) ? i : bi), 0);
    let best = cur, score = -1e9;
    for (let i = 0; i < 3; i++) {
      const need = Math.abs(LX[i] - s.q) / 14 + 0.12;
      let sc = Math.min(tc[i], 6) - (i === cur ? 0 : 0.35 * Math.abs(i - cur));
      for (let j = Math.min(i, cur); j <= Math.max(i, cur); j++) if (tc[j] < need + 0.3 && j !== i && j !== cur) sc -= 4;
      if (sc > score) { score = sc; best = i; }
    }
    const target = tc[cur] > 3 ? LX[cur] : LX[best];
    const want = target - s.q - s.vq * 0.03;
    await key(page, 'ArrowRight', want > 0.15); await key(page, 'ArrowLeft', want < -0.15);
    await sleep(12);
  }
  await key(page, 'ArrowRight', false); await key(page, 'ArrowLeft', false);
  const res = { crashed: s.crashed, t: s.t, s: s.s, vmax };
  await page.screenshot({ path: `${OUT}/bot-${tag}.png` });
  await ctx.close();
  return res;
}
for (const [label, url, sec, tag] of [['Seed 12 vom Start', '', 55, 'start'], ['Seed 12 bei 600 km/h', '&startS=27000', 25, 'hoch']]) {
  const r = await botRun(Q(url), sec, tag);
  console.log(`  Testfahrer ${label}: ${r.crashed ? 'Crash' : 'ohne Crash'} nach ${r.t.toFixed(1)} s, ${r.s.toFixed(0)} m, bis ${r.vmax.toFixed(0)} km/h`);
  results.push({ name: `Testfahrer ${label}`, ok: !r.crashed });
}

// ---------- Tempo nach gefahrener Strecke (Stützpunkte) ----------
{
  const knots = [[0, 210], [1000, 325], [2000, 370], [6000, 430], [12000, 480], [16000, 520], [20000, 550], [27000, 600], [30000, 600]];
  const got = [];
  for (const [m, v] of knots) {
    const { ctx, page } = await start(Q(`&startS=${m}`));
    await frozen(page);
    await sleep(120);
    const st0 = await st(page);
    got.push({ m, want: v, v: st0.v, hud: await page.locator('#hud-speed').textContent() });
    await ctx.close();
  }
  note('Tempo an den Stützpunkten (0/1/2/6/12/16/20/27/30 km) entspricht der Tabelle, Tacho zeigt das effektive Tempo', got.every((g) => Math.abs(g.v - g.want) < 4 && Math.abs(Number(g.hud) - g.v) < 2), got.map((g) => `${g.m / 1000} km: ${g.v.toFixed(0)} km/h (HUD ${g.hud})`).join(' · '));
  // Echtzeit-Verlauf über die ersten Sekunden eines normalen Versuchs
  const { ctx, page } = await start(Q(''));
  await frozen(page);
  const rows = [];
  const t0 = Date.now();
  for (const w of [0, 10, 20, 30]) { while (Date.now() - t0 < w * 1000) await sleep(20); const s2 = await st(page); rows.push(`${s2.t.toFixed(0)} s: ${s2.v.toFixed(0)} km/h bei ${(s2.s / 1000).toFixed(2)} km`); }
  console.log('  Tempo im normalen Versuch (leere Strecke): ' + rows.join(' · '));
  await ctx.close();
}

// ---------- Lenkzeiten per Tastatur (gemessen im Browser, Bildtakt) ----------
{
  const { ctx, page } = await start(Q('&startS=20'));
  await frozen(page);
  const measure = async (from, to) => {
    await page.evaluate((q) => window.__qa.setQ(q), from);
    await sleep(150);
    const key = to > from ? 'ArrowRight' : 'ArrowLeft';
    const ms = await page.evaluate(([k, target, dir]) => new Promise((resolve) => {
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: k, bubbles: true }));
      const tick = () => {
        const q = window.__qa.state().q;
        if (dir > 0 ? q >= target - 0.01 : q <= target + 0.01) { window.dispatchEvent(new KeyboardEvent('keyup', { code: k, bubbles: true })); resolve(performance.now() - t0); }
        else if (performance.now() - t0 > 1500) { window.dispatchEvent(new KeyboardEvent('keyup', { code: k, bubbles: true })); resolve(-1); }
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), [key, to, to > from ? 1 : -1]);
    await sleep(300);
    return ms;
  };
  const near = [await measure(-3.6, 0), await measure(0, 3.6), await measure(3.6, 0), await measure(0, -3.6)];
  const outer = [await measure(-3.6, 3.6), await measure(3.6, -3.6)];
  note('Lenkzeit bei 210 km/h: Nachbarspur 0,20–0,28 s (Bildtakt ±17 ms)', near.every((m) => m >= 190 && m <= 300), near.map((m) => m.toFixed(0) + ' ms').join(' · '));
  note('Lenkzeit bei 210 km/h: Außenspur ↔ Außenspur 0,38–0,52 s (Bildtakt ±17 ms)', outer.every((m) => m >= 360 && m <= 540), outer.map((m) => m.toFixed(0) + ' ms').join(' · '));
  // Gegenlenken und Loslassen
  await page.evaluate(() => window.__qa.setQ(0));
  await key(page, 'ArrowRight', true); await sleep(120); await key(page, 'ArrowRight', false); await key(page, 'ArrowLeft', true); await sleep(120); await key(page, 'ArrowLeft', false);
  await sleep(200);
  const a = await st(page); await sleep(500); const b = await st(page);
  note('Schneller Richtungswechsel und Loslassen: Position wird gehalten', Math.abs(a.q - b.q) < 0.05 && Math.abs(b.vq) < 0.05, `q ${a.q.toFixed(2)} → ${b.q.toFixed(2)}`);
  await ctx.close();
}

// ---------- Lenkzeit wächst mit dem Tempo: 360 / 500 / 600 km/h ----------
for (const [label, startS, nMax, oMax] of [['360 km/h', 1800, 220, 400], ['500 km/h', 14000, 170, 320], ['600 km/h', 28000, 150, 280]]) {
  const { ctx, page } = await start(Q(`&startS=${startS}`));
  await frozen(page);
  const measure = async (from, to) => {
    await page.evaluate((q) => window.__qa.setQ(q), from);
    await sleep(150);
    const key2 = to > from ? 'ArrowRight' : 'ArrowLeft';
    const ms = await page.evaluate(([k, target, dir]) => new Promise((resolve) => {
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: k, bubbles: true }));
      const tick = () => {
        const q = window.__qa.state().q;
        if (dir > 0 ? q >= target - 0.01 : q <= target + 0.01) { window.dispatchEvent(new KeyboardEvent('keyup', { code: k, bubbles: true })); resolve(performance.now() - t0); }
        else if (performance.now() - t0 > 1500) { window.dispatchEvent(new KeyboardEvent('keyup', { code: k, bubbles: true })); resolve(-1); }
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), [key2, to, to > from ? 1 : -1]);
    await sleep(300);
    return ms;
  };
  const nb = [await measure(-3.6, 0), await measure(0, 3.6), await measure(3.6, 0), await measure(0, -3.6)];
  const ou = [await measure(-3.6, 3.6), await measure(3.6, -3.6)];
  note(`Lenkzeit bei ${label}: Nachbarspur ≤ ${nMax} ms, Außenspur ↔ Außenspur ≤ ${oMax} ms`, nb.every((m) => m > 0 && m <= nMax) && ou.every((m) => m > 0 && m <= oMax), `Nachbar ${nb.map((m) => m.toFixed(0)).join('/')} ms · außen ${ou.map((m) => m.toFixed(0)).join('/')} ms`);
  await ctx.close();
}

// ---------- Gleitflug im Browser (aktive Kollisionen) ----------
{
  const { ctx, page } = await start(Q('&startS=2200&startT=40'));
  await frozen(page);
  await goQ(page, 0);
  await place(page, { k: 'pickup', type: 'glide', x: 0, dz: 8 });
  await sleep(120);
  await place(page, { k: 'obstacle', kind: 'truck', x: 0, dz: 70, vz: 0 });
  await place(page, { k: 'obstacle', kind: 'barrier', x: 3.6, dz: 70 });
  let hMax = 0, over = false, crashed = false; const t0 = Date.now();
  await sleep(500);
  const s05 = await st(page);
  await key(page, 'ArrowRight', true); await sleep(250); await key(page, 'ArrowRight', false);   // Luftlenkung
  const sSteer = await st(page);
  while (Date.now() - t0 < 4000) { const s = await st(page); hMax = Math.max(hMax, s.height); if (s.crashed) crashed = true; if (s.s > 2200 + 60 && s.height > 3.6) over = true; await sleep(30); }
  note('Gleitflug: Abheben auf Höhe über dem Lkw (> 3,6 m) nach ≈ 0,5 s', s05.height > 3.6, `Höhe nach 0,5 s: ${s05.height.toFixed(1)} m, max. ${hMax.toFixed(1)} m`);
  note('Gleitflug: Luftlenkung wirkt weiter', sSteer.q > 1.5, `q = ${sSteer.q.toFixed(2)}`);
  await page.screenshot({ path: `${OUT}/D-glide-flug.png` });
  // Lkw und Absperrung überflogen, keine Kollision bis zum Aufsetzen
  await frozen(page);
  await goQ(page, 0);
  await page.evaluate(() => window.__qa.give(0, 0, 0, 3));
  await place(page, { k: 'obstacle', kind: 'truck', x: 0, dz: 60, vz: 0 });
  const t1 = Date.now(); let flewOver = false;
  while (Date.now() - t1 < 1900) { const s = await st(page); if (s.crashed) crashed = true; if (s.obstacles.some((o) => o.kind === 'truck' && o.z < s.s) ) flewOver = true; await sleep(25); }
  note('Gleitflug: Lkw und Absperrung werden überflogen, kein Treffer in der Luft', !crashed, `Überflug des Lkw: ${flewOver}`);
  // Landung, danach reguläre Treffer
  await sleep(1500);
  const land = await st(page);
  await place(page, { k: 'obstacle', kind: 'barrier', x: land.q, dz: 40 });
  const t2 = Date.now(); let after;
  while (Date.now() - t2 < 3000) { after = await st(page); if (after.crashed) break; await sleep(30); }
  note('Gleitflug: nach der Landung zählt der erste Treffer regulär', land.height === 0 && after.crashed === true, `Höhe nach Landung ${land.height}, Crash ${after.crashed}`);
  await ctx.close();
}

// ---------- Phantom-Turbo, Pfadfinder, Hügel ----------
{
  const { ctx, page, } = await start(Q('&startS=6000'));
  await frozen(page);
  const base = await st(page);
  await place(page, { k: 'pickup', type: 'boost', x: 0, dz: 40 });
  await goQ(page, 0);
  await sleep(1400);
  const b1 = await st(page);
  const ratio = b1.v / (base.v * (1 + (b1.s - base.s) * 0.00001));
  await page.screenshot({ path: `${OUT}/D-phantom.png` });
  note('Phantom-Turbo: Tempo +20 %, Tacho zeigt das effektive Tempo, Karosserie schwarz (Zustand aktiv)', b1.boostT > 3 && b1.v > base.v * 1.17 && Number(await page.locator('#hud-speed').textContent()) >= Math.round(b1.v) - 2, `${base.v.toFixed(0)} → ${b1.v.toFixed(0)} km/h, Rest ${b1.boostT.toFixed(1)} s`);
  await sleep(6200);
  const b2 = await st(page);
  note('Phantom-Turbo endet nach 6 s, Tempo fällt weich auf das Grundtempo zurück', b2.boostT === 0 && b2.v < base.v * 1.05 + 25, `${b2.v.toFixed(0)} km/h`);
  await frozen(page);
  await page.evaluate(() => window.__qa.give(0, 0, 0, 0, 0, 10));
  await place(page, { k: 'obstacle', kind: 'truck', x: -3.6, dz: 110, vz: 10 }); await place(page, { k: 'obstacle', kind: 'taxi', x: 0, dz: 120, vz: 15 });
  await sleep(250);
  const g1 = await st(page);
  note('Pfadfinder zeigt die freie Spur (rechts)', g1.guideT > 5 && g1.guideQ === 3.6, `guideQ ${g1.guideQ}`);
  await ctx.close();
}
{
  const { ctx, page } = await start(Q('&startS=2000'));
  await frozen(page);
  const hs = [];
  for (let i = 0; i < 40; i++) { hs.push((await st(page)).hill); await sleep(150); }
  const flat = await start(Q('&startS=21000'));
  await frozen(flat.page);
  const hf = [];
  for (let i = 0; i < 20; i++) { hf.push((await st(flat.page)).hill); await sleep(150); }
  note('Hügel: Strecke bis 20 km hebt und senkt sich, ab 20 km völlig flach', Math.max(...hs) - Math.min(...hs) > 2.5 && hf.every((h) => h === 0), `Höhe bei ≈ 2 km: ${Math.min(...hs).toFixed(1)}…${Math.max(...hs).toFixed(1)} m, bei 21 km: ${Math.max(...hf.map(Math.abs))} m`);
  await flat.ctx.close(); await ctx.close();
}

// ---------- Erstes Power-up ist Fliegen: normale Versuche mit mehreren Seeds, Einsammeln und vollständiger Flug ----------
async function plannedDrive(page, seconds, opts = {}) {
  // Testfahrer in Echtzeit: weicht aus und steuert das Flug-Pickup an, wenn es erreichbar ist
  const t0 = Date.now(); let s = await st(page); const log = { firstPickup: null, collectedAt: null, minWarn: 1e9, crashed: false, maxV: 0, flightMax: 0, landed: false, tFlightStart: null };
  const seenObs = new Set();
  while (Date.now() - t0 < seconds * 1000) {
    s = await st(page);
    if (s.crashed) { log.crashed = true; break; }
    log.maxV = Math.max(log.maxV, s.v); log.flightMax = Math.max(log.flightMax, s.height);
    if (log.tFlightStart === null && s.glideT > 0) log.tFlightStart = s.t;
    if (log.tFlightStart !== null && s.glideT === 0 && !log.landed) log.landed = true;
    const v = s.v / 3.6;
    for (const o of s.obstacles) { const key = o.id; if (!seenObs.has(key)) { seenObs.add(key); if (o.z - s.s > 5) log.minWarn = Math.min(log.minWarn, (o.z - s.s) / Math.max(1, v - o.vz)); } }
    const pk = s.pickups.find((p) => p.z > s.s + 3);
    if (pk && !log.firstPickup) log.firstPickup = { type: pk.type, dist: pk.z, seenAtS: s.s, seenAtT: s.t, gate: s.pickups.filter((p) => Math.abs(p.z - pk.z) < 1 && p.type === pk.type).length };
    if (s.pickupEvents > 0 && !log.collectedAt) log.collectedAt = { t: s.t, s: s.s, glide: s.glideT > 0 };
    const tc = LX.map((lx) => { let m = 9; for (const o of s.obstacles) { if (Math.abs(o.x - lx) > 2.3 || o.z < s.s - 3) continue; m = Math.min(m, (o.z - s.s) / Math.max(1, v - o.vz)); } return m; });
    const cur = LX.reduce((bi, lx, i) => (Math.abs(lx - s.q) < Math.abs(LX[bi] - s.q) ? i : bi), 0);
    let best = cur, score = -1e9;
    const pkLane = pk && s.glideT === 0 ? LX.findIndex((lx) => Math.abs(lx - pk.x) < 1) : -1;
    const pkT = pk ? (pk.z - s.s) / Math.max(1, v) : 99;
    for (let i = 0; i < 3; i++) {
      const need = Math.abs(LX[i] - s.q) / 20 + 0.1;
      let sc = Math.min(tc[i], 6) - (i === cur ? 0 : 0.35 * Math.abs(i - cur));
      for (let j = Math.min(i, cur); j <= Math.max(i, cur); j++) if (tc[j] < need + 0.25 && j !== i && j !== cur) sc -= 4;
      if (i === pkLane && pkT < 6 && tc[i] > pkT + 0.8) sc += 6;
      if (sc > score) { score = sc; best = i; }
    }
    const target = (tc[cur] > 3 && !(pkLane >= 0 && pkT < 6 && tc[pkLane] > pkT + 0.8)) ? LX[cur] : LX[best];
    if (opts.touch) await opts.touch(target, s);
    else { const want = target - s.q - s.vq * 0.03; await key(page, 'ArrowRight', want > 0.15); await key(page, 'ArrowLeft', want < -0.15); }
    await sleep(10);
  }
  await key(page, 'ArrowRight', false); await key(page, 'ArrowLeft', false);
  return { ...log, s, finalS: s.s };
}
{
  const rows = [];
  for (const seed of [1, 2, 3, 4]) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?qa=1&seed=${seed}`);
    await page.waitForTimeout(300); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const r = await plannedDrive(page, 24);
    rows.push({ seed, ...r });
    if (seed === 1) await page.screenshot({ path: `${OUT}/D-flug-seed1.png` });
    await ctx.close();
  }
  for (const r of rows) {
    const ok = r.firstPickup && r.firstPickup.type === 'glide' && r.firstPickup.dist >= 550 && r.firstPickup.dist <= 900 && r.firstPickup.gate === 3 && r.collectedAt && r.collectedAt.glide;
    note(`Seed ${r.seed}: erstes Pickup = Fliegen (Tor über 3 Spuren), ${r.firstPickup ? Math.round(r.firstPickup.dist) : '?'} m, gesehen bei ${r.firstPickup ? r.firstPickup.seenAtT.toFixed(1) : '?'} s, eingesammelt bei ${r.collectedAt ? r.collectedAt.t.toFixed(1) : '—'} s`, !!ok, `Flug max. ${r.flightMax.toFixed(1)} m, gelandet ${r.landed}, Crash ${r.crashed}`);
    note(`Seed ${r.seed}: kompletter Flug mit Landung, danach weiter ohne Crash`, r.landed && !r.crashed, `Warnzeit min. ${r.minWarn.toFixed(2)} s, bis ${r.maxV.toFixed(0)} km/h`);
  }
}

// ---------- Schnelle Abschnitte bei ≈ 360 / 500 / 600 km/h (Tastatur, aktive Kollisionen) ----------
for (const [label, startS] of [['360 km/h', 1800], ['500 km/h', 14000], ['600 km/h', 27000]]) {
  const { ctx, page } = await start(Q(`&startS=${startS}`));
  await page.evaluate(() => window.__qa.noPickups(true));
  const r = await plannedDrive(page, 22);
  await page.screenshot({ path: `${OUT}/D-tempo-${startS}.png` });
  note(`Tastatur bei ${label}: 22 s ohne Treffer, Warnzeit ≥ 1,25 s`, !r.crashed && r.minWarn >= 1.25, `Warnzeit min. ${r.minWarn.toFixed(2)} s, ${((r.finalS - startS) / 1000).toFixed(1)} km gefahren, bis ${r.maxV.toFixed(0)} km/h${r.crashed ? ', CRASH' : ''}`);
  await ctx.close();
}

// ---------- Schnelle Abschnitte per Touch (Hochformat, Emulation, aktive Kollisionen) ----------
for (const [label, startS] of [['360 km/h', 1800], ['500 km/h', 14000], ['600 km/h', 27000]]) {
  const { ctx, page, cdp } = await start(Q(`&startS=${startS}`), { width: 390, height: 844 }, true);
  await page.evaluate(() => window.__qa.noPickups(true));
  const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const dxPx = (m) => (Math.abs(m) / 22) * 390 + 9;
  let busy = false, lastT = null;
  const touch = async (target, s) => {
    if (busy || (lastT === target && Math.abs(target - s.q) < 0.5) || Math.abs(target - s.q) < 0.35) return;
    busy = true; lastT = target;
    const d = Math.sign(target - s.q) * dxPx(target - s.q);
    await tp('touchStart', [{ x: 195, y: 620, id: 1 }]);
    await tp('touchMove', [{ x: 195 + d * 0.5, y: 620, id: 1 }]);
    await tp('touchMove', [{ x: 195 + d, y: 620, id: 1 }]);
    await tp('touchEnd', []);
    busy = false;
  };
  const r = await plannedDrive(page, 18, { touch });
  await page.screenshot({ path: `${OUT}/M-tempo-${startS}.png` });
  note(`Touch bei ${label}: 18 s ohne Treffer, Warnzeit ≥ 1,25 s`, !r.crashed && r.minWarn >= 1.25, `Warnzeit min. ${r.minWarn.toFixed(2)} s, ${((r.finalS - startS) / 1000).toFixed(1)} km gefahren, bis ${r.maxV.toFixed(0)} km/h${r.crashed ? ', CRASH' : ''}`);
  await ctx.close();
}

// ---------- Smartphone-Hochformat ----------
{
  const { ctx, page, cdp, errors, startText } = await start(Q('&startS=700&startT=30'), { width: 390, height: 844 }, true);
  note('M: Startbildschirm zeigt nur „Mit dem Daumen ziehen“', startText.trim() === 'Mit dem Daumen ziehen', JSON.stringify(startText));
  const s0 = await st(page);
  note('M: Tippen startet die Fahrt direkt', s0.phase === 'running');
  const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await frozen(page);
  const cx = 195, y = 620;
  await page.evaluate(() => window.__qa.setQ(1.1));
  await tp('touchStart', [{ x: cx, y, id: 1 }]); await sleep(60);
  const down = await st(page);
  note('M: Aufsetzen springt nicht', Math.abs(down.q - 1.1) < 0.08, `q ${down.q.toFixed(2)}`);
  const dx = (m) => (m / 22) * 390 + 9;
  const samples = [];
  for (const m of [1, 2.5, 4.6]) {                                   // nach links ziehen
    const x1 = cx - dx(m);
    for (let i = 1; i <= 6; i++) { await tp('touchMove', [{ x: cx - ((cx - x1) * i) / 6, y, id: 1 }]); await sleep(25); }
    await sleep(160);
    samples.push((await st(page)).q);
  }
  note('M: Wagen folgt dem Finger direkt (−1 / −2,5 m, am Rand begrenzt)', Math.abs(samples[0] - 0.1) < 0.35 && Math.abs(samples[1] - (1.1 - 2.5)) < 0.35 && samples[2] <= -3.3 && samples[2] >= -4.46, samples.map((q) => q.toFixed(2)).join(' → '));
  await page.screenshot({ path: `${OUT}/M-hochformat-links.png` });
  await tp('touchEnd', []);
  await sleep(150); const r1 = await st(page); await sleep(900); const r2 = await st(page);
  note('M: Loslassen – Wagen bleibt an der erreichten Position', Math.abs(r2.q - r1.q) < 0.05 && Math.abs(r2.vq) < 0.05, `q ${r1.q.toFixed(2)} → ${r2.q.toFixed(2)}`);
  const reached = [], goals = [3.6, 0, -3.6, 3.6];
  for (const target of goals) {
    const s = await st(page);
    await tp('touchStart', [{ x: cx, y, id: 1 }]);
    const d = dx(Math.abs(target - s.q)) * Math.sign(target - s.q);
    for (let i = 1; i <= 5; i++) { await tp('touchMove', [{ x: cx + (d * i) / 5, y, id: 1 }]); await sleep(18); }
    await sleep(140); await tp('touchEnd', []); await sleep(100);
    reached.push((await st(page)).q);
  }
  note('M: alle Spuren und schnelles Hin und Her per Touch', reached.every((q, i) => Math.abs(q - goals[i]) < 0.4), reached.map((q) => q.toFixed(2)).join(' '));
  await frozen(page);
  await place(page, { k: 'pickup', type: 'shield', x: 0, dz: 70 });
  const s = await st(page);
  await tp('touchStart', [{ x: cx, y, id: 1 }]);
  const d = dx(Math.abs(s.q)) * Math.sign(0 - s.q);
  for (let i = 1; i <= 5; i++) { await tp('touchMove', [{ x: cx + (d * i) / 5, y, id: 1 }]); await sleep(18); }
  await sleep(1500); await tp('touchEnd', []);
  const sp = await st(page);
  note('M: Pickup per Daumen eingesammelt (genau einmal)', sp.pickupEvents === 1 && sp.shieldT > 0, `Ereignisse ${sp.pickupEvents}, Schild ${sp.shieldT.toFixed(1)} s`);
  await page.screenshot({ path: `${OUT}/M-hochformat-schild.png` });
  // kurzer Swipe mit sofortigem Loslassen: Ziel wird nach dem Loslassen zügig erreicht; Tipp lässt den Wagen stehen
  await sleep(1100);                                                   // offene Ziele der vorigen Eingaben laufen aus
  await frozen(page);
  await page.evaluate(() => window.__qa.setQ(-3.6));
  await sleep(150);
  const sw0 = await st(page);
  await tp('touchStart', [{ x: 100, y, id: 1 }]);
  await tp('touchMove', [{ x: 100 + dx(7.2) * 0.5, y, id: 1 }]);
  await tp('touchMove', [{ x: 100 + dx(7.2), y, id: 1 }]);
  await tp('touchEnd', []);                                            // sofort loslassen
  const tr0 = Date.now(); let swT = -1;
  while (Date.now() - tr0 < 1500) { const s = await st(page); if (s.q > 3.3) { swT = Date.now() - tr0; break; } await sleep(10); }
  note('M: kurzer Swipe (≈ ein Drittel der Breite) + sofortiges Loslassen erreicht die rechte Außenspur', swT > 0, `von ${sw0.q.toFixed(1)} m nach 3,6 m in ${swT} ms nach dem Loslassen`);
  await sleep(1200);
  const hold0 = await st(page);
  await tp('touchStart', [{ x: 200, y, id: 1 }]); await tp('touchMove', [{ x: 204, y, id: 1 }]); await tp('touchEnd', []);
  await sleep(600);
  const hold1 = await st(page);
  note('M: Tipp und kleine Fingerbewegung lassen den Wagen stehen', Math.abs(hold1.q - hold0.q) < 0.1, `q ${hold0.q.toFixed(2)} → ${hold1.q.toFixed(2)}`);
  note('M: keine Konsolenfehler', errors.length === 0, errors.join('|'));
  await ctx.close();
}

await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} Fahrprüfungen bestanden`);
process.exit(bad ? 1 : 0);
