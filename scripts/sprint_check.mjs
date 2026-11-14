// Sunset-Sprint-Abnahme im echten Chrome: Start, voller Lauf (Echtzeit, Tastatur) bis zum Ziel, Crash-Ergebnis, Teilen, Challenge-Link, Moduswechsel.
// Aufruf: node scripts/sprint_check.mjs http://localhost:4173
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const results = [];
const note = (n, ok, info = '') => { results.push(ok); console.log(ok ? 'OK  ' : 'FAIL', n, info); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LX = [-3.6, 0, 3.6];
const browser = await chromium.launch({ channel: 'chrome' });
const held = new Set();
async function key(page, k, on) { if (on && !held.has(k)) { held.add(k); await page.keyboard.down(k); } if (!on && held.has(k)) { held.delete(k); await page.keyboard.up(k); } }

// 1) Start sichtbar in vier Formaten
for (const [name, w, h, touch] of [['1366×768', 1366, 768, false], ['320×568', 320, 568, true], ['390×844', 390, 844, true], ['844×390', 844, 390, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?qa=1'); await page.waitForTimeout(500);
  const g = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const a = r('#btn-start'), b = r('#btn-sprint'); const inside = (x) => x.left >= 0 && x.right <= innerWidth && x.top >= 0 && x.bottom <= innerHeight; return { fahren: inside(a), sprint: inside(b), hit: document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('#btn-sprint') !== null, h: Math.round(b.height) }; });
  note(`${name}: „Fahren“ bleibt primär, „Sunset Sprint“ als sekundäre Aktion sichtbar und erreichbar`, g.fahren && g.sprint && g.hit && g.h >= 44, JSON.stringify(g));
  await ctx.close();
}

// 2) voller Sprint (QA-Einstieg, Tastatur-Testfahrer in Echtzeit) bis zum Ziel
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/?qa=1'); await page.waitForTimeout(500);
  await page.click('#btn-sprint'); await page.waitForTimeout(300);
  const st0 = await page.evaluate(() => ({ mode: window.__qa.mode(), v: window.__qa.state().v, bar: !document.getElementById('sprint-bar').hidden, best: document.getElementById('hud-best-wrap').hidden }));
  note('Sprint startet mit festen Regeln (240 km/h), Zielleiste sichtbar, Bestweite-Anzeige verborgen', st0.mode === 'sprint' && Math.abs(st0.v - 240) < 15 && st0.bar && st0.best, JSON.stringify(st0));
  const t0 = Date.now(); let last = null, shots = 0;
  while (Date.now() - t0 < 100000) {
    const s = await page.evaluate(() => window.__qa.state());
    if (s.crashed || s.phase !== 'running') break;
    last = s;
    if (shots < 2 && s.s > 2500 + shots * 3000) { shots++; await page.screenshot({ path: `sprint-${shots}.png` }); }
    const v = s.v / 3.6;
    const tc = LX.map((lx) => { let m = 9; for (const o of s.obstacles) { if (Math.abs(o.x - lx) > 2.3 || o.z < s.s - 3) continue; m = Math.min(m, (o.z - s.s) / Math.max(1, v - o.vz)); } return m; });
    const cur = LX.reduce((bi, lx, i) => (Math.abs(lx - s.q) < Math.abs(LX[bi] - s.q) ? i : bi), 0);
    let best = cur, score = -1e9;
    for (let i = 0; i < 3; i++) {
      const need = Math.abs(LX[i] - s.q) / 25 + 0.1;
      let sc = Math.min(tc[i], 6) - (i === cur ? 0 : 0.35 * Math.abs(i - cur));
      for (let j = Math.min(i, cur); j <= Math.max(i, cur); j++) if (tc[j] < need + 0.25 && j !== i && j !== cur) sc -= 4;
      if (sc > score) { score = sc; best = i; }
    }
    const target = tc[cur] > 3 ? LX[cur] : LX[best];
    const want = target - s.q - s.vq * 0.03;
    await key(page, 'ArrowRight', want > 0.15); await key(page, 'ArrowLeft', want < -0.15);
    await sleep(8);
  }
  await key(page, 'ArrowRight', false); await key(page, 'ArrowLeft', false);
  await page.waitForTimeout(900);
  const res = await page.evaluate(() => ({ title: document.getElementById('res-title').textContent, vis: !document.getElementById('screen-result').hidden, share: !document.getElementById('btn-share').hidden, endless: !document.getElementById('btn-endless').hidden, cause: document.getElementById('res-cause').textContent, dist: document.getElementById('res-dist').textContent }));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.title === 'Ziel erreicht!') {
    note('Vollständiger Sprint-Lauf (Tastatur, Echtzeit) endet mit „Ziel erreicht!“ und Sprint-Optionen', res.vis && res.share && res.endless && Number(secs) > 45 && Number(secs) < 80, `${secs} s Echtzeit, ${res.dist}, ${res.cause}`);
    await page.screenshot({ path: 'sprint-ziel.png' });
    // Teilen
    await page.click('#btn-share'); await page.waitForTimeout(400);
    const url = await page.inputValue('#share-url');
    note('„Freund herausfordern“ zeigt den Link der eigenen Domain mit Kennung und Vergleichswert', /\/\?sprint=S1&c=7000$/.test(url) && !(/qa=|admin|testdrive/.test(url)), url);
    // zurück zu Endless: keine Sprint-Werte
    await page.click('#btn-endless'); await page.waitForTimeout(300);
    const e = await page.evaluate(() => ({ mode: window.__qa.mode(), v: window.__qa.state().v, bar: document.getElementById('sprint-bar').hidden }));
    note('Moduswechsel zurück zu Endless: Startwerte (210 km/h) und HUD wie vorher, keine Sprint-Reste', e.mode === 'endless' && Math.abs(e.v - 210) < 6 && e.bar, JSON.stringify(e));
  } else {
    note('Vollständiger Sprint-Lauf bis zum Ziel', false, `Testfahrer schied aus: ${res.title} · ${res.dist} · ${res.cause} (${secs} s)`);
  }
  note('Keine JavaScript-Fehler im Sprint', errs.length === 0, errs.join('|'));
  await ctx.close();
}

// 3) Crash vor dem Ziel (normaler Lauf ohne QA): Ergebnis, Speicherung getrennt von Endless
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '/'); await page.waitForTimeout(500);
  await page.evaluate(() => localStorage.setItem('sunset-sideways:v1', JSON.stringify({ v: 1, best: 4321, muted: true, dodged: true })));
  await page.reload(); await page.waitForTimeout(500);
  await page.tap('#btn-sprint');
  await page.waitForFunction(() => !document.getElementById('screen-result').hidden, null, { timeout: 15000 });
  const r = await page.evaluate(() => ({ title: document.getElementById('res-title').textContent, cause: document.getElementById('res-cause').textContent, goal: document.getElementById('res-goal').textContent, best: document.getElementById('res-best').textContent, label: document.getElementById('res-best-label').textContent, save: JSON.parse(localStorage.getItem('sunset-sideways:v1')) }));
  note('Crash vor dem Ziel: „Dein Sprint“, Ursache und Ziel-Satz', r.title === 'Dein Sprint' && /getroffen/.test(r.cause) && /Neonnacht/.test(r.goal), `${r.cause} · ${r.goal}`);
  note('Sprint-Fortschritt gespeichert, Endless-Bestweite (4321) und Tonwahl unverändert', r.save.best === 4321 && r.save.muted === true && r.save.sprintBest > 100 && r.label.includes('Sprint'), JSON.stringify(r.save));
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const again = await page.evaluate(() => ({ hidden: document.getElementById('screen-result').hidden, bar: !document.getElementById('sprint-bar').hidden }));
  note('„Nochmal fahren“ startet denselben Sprint erneut (gleiche Regeln)', again.hidden && again.bar, JSON.stringify(again));
  await ctx.close();
}

// 4) Challenge-Link in neuem Kontext
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?sprint=S1&c=4200'); await page.waitForTimeout(500);
  const c = await page.evaluate(() => ({ txt: document.getElementById('challenge').textContent, vis: !document.getElementById('challenge').hidden, running: document.getElementById('screen-start').hidden, qa: !!window.__qa }));
  note('Gültiger Link: Herausforderung sichtbar (Modus, Ziel, Absender-Angabe), Spiel startet nicht von allein, keine QA-Funktion', c.vis && !c.running && !c.qa && /4,2 km/.test(c.txt) && /Angabe des Absenders/.test(c.txt), c.txt);
  await page.tap('#btn-sprint'); await page.waitForTimeout(300);
  note('Start aus dem Link nur per eigener Aktion, Sprint-Modus aktiv', await page.evaluate(() => document.getElementById('screen-start').hidden) && await page.evaluate(() => !document.getElementById('sprint-bar').hidden));
  await ctx.close();
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await c2.newPage();
  await p2.goto(BASE + '/?sprint=ABC&c=1'); await p2.waitForTimeout(400);
  const bad = await p2.evaluate(() => ({ txt: document.getElementById('challenge').textContent, start: !document.getElementById('btn-start').hidden }));
  note('Unbekannte Kennung: verständlicher Hinweis, Endless und aktueller Sprint bleiben startbar', /gibt es nicht mehr/.test(bad.txt) && bad.start, bad.txt);
  await p2.goto(BASE + '/?sprint=S1&c=99999999999&qa=0&admin=1'); await p2.waitForTimeout(400);
  const big = await p2.evaluate(() => document.getElementById('challenge').textContent);
  note('Manipulierter Vergleichswert wird begrenzt, fremde Parameter schalten nichts frei', /Ziel erreicht \(Angabe/.test(big) || /7,0 km weit/.test(big) || !/99999/.test(big), big);
  await c2.close();
}
await browser.close();
const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad}/${results.length} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
