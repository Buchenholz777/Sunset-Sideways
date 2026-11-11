// Abnahme im echten Chrome: Admin-Bereich (Desktop + Smartphone), Anmeldung, Einstellungen, Veröffentlichung, Testfahrt,
// Wirkung im Spiel, Spielstart ohne Konfig-API, Versionswechsel zwischen Fahrten, Messung, SEO. Startet einen eigenen Server mit frischer Datenbank.
import { chromium, request } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const PORT = 8090, BASE = `http://127.0.0.1:${PORT}`, OUT = process.argv[2] ?? 'admin-shots', DB = 'data-accept/accept.db', PW = 'Abnahme-Passwort-2026';
rmSync('data-accept', { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const env = { ...process.env, PORT: String(PORT), DB_PATH: DB, SEO_ALLOW_LOCAL: '1' };
const pw = spawnSync('node', ['dist-server/cli.mjs', 'admin:passwd'], { env, input: PW + '\n', encoding: 'utf8' });
console.log('Passwort-CLI:', pw.stdout.trim());
const srv = spawn('node', ['dist-server/index.mjs'], { env, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* warten */ } await sleep(150); }

const results = [];
const note = (n, ok, info = '') => { results.push(ok); console.log(ok ? 'OK  ' : 'FAIL', n, info); };
const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];

const num = (id) => `#${id} >> xpath=ancestor::div[contains(@class,"ctl")]//input[@type="number"]`;
async function login(page, pass = PW) {
  await page.goto(`${BASE}/admin`);
  await page.fill('#pw', pass);
  await page.click('#go');
}

try {
  // ---- Direkter Zugriff auf private APIs ohne Anmeldung
  const anon = await request.newContext();
  const codes = [];
  for (const p of ['/admin/api/state', '/admin/api/kpi', '/admin/api/seo', '/admin/api/me']) codes.push((await anon.get(BASE + p)).status());
  const w = await anon.put(BASE + '/admin/api/draft', { data: { config: {} } });
  const asset = await anon.get(BASE + '/admin/assets/nichts.js');
  note('Private APIs ohne Anmeldung: 401; Schreibzugriff 401; Admin-Assets nicht ausgeliefert', codes.every((c) => c === 401) && w.status() === 401 && !(await asset.text()).includes('function'), codes.join(','));
  const home = await anon.get(BASE + '/');
  note('Startseite öffnet ohne Anmeldung direkt das Spiel', home.status() === 200 && (await home.text()).includes('id="stage"'));
  await anon.dispose();

  // ---- Desktop
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const d = await dctx.newPage();
  d.on('pageerror', (e) => errors.push('desktop: ' + e));
  await login(d, 'falsches-passwort-xx');
  await d.waitForFunction(() => document.getElementById('msg').textContent.length > 0);
  note('Falsches Passwort: Fehlermeldung, keine Sitzung', (await d.textContent('#msg')).includes('fehlgeschlagen'));
  await d.fill('#pw', PW); await d.click('#go');
  await d.waitForSelector('.top');
  await d.screenshot({ path: `${OUT}/d-uebersicht-leer.png` });
  note('Anmeldung → Übersicht; Leerzustand „Noch keine Messdaten“ (kein Fehler, keine Nullen)', (await d.textContent('main')).includes('Noch keine Messdaten'));
  const cookies = await dctx.cookies();
  const c = cookies.find((x) => x.name.includes('ssw_admin'));
  note('Sitzungscookie: HttpOnly + SameSite=Strict', !!c && c.httpOnly && c.sameSite === 'Strict', JSON.stringify({ httpOnly: c?.httpOnly, sameSite: c?.sameSite }));
  const hdr = await (await dctx.request.get(BASE + '/admin')).headers();
  note('Private Seite: Cache-Control no-store, noindex', hdr['cache-control'] === 'no-store' && hdr['x-robots-tag'].includes('noindex'));

  // Einstellungen
  await d.click('text=Spieleinstellungen');
  await d.waitForSelector('#sec-tempo');
  await d.screenshot({ path: `${OUT}/d-einstellungen.png`, fullPage: true });
  const startVal = await d.inputValue('#c-tempo-startKmh');
  note('Regler startet mit dem echten Standardwert (210 km/h)', startVal === '210', `Regler=${startVal}`);
  // Tastatur: Pfeiltaste ändert den Wert, Zahlfeld ebenfalls
  await d.focus('#c-tempo-startKmh');
  for (let i = 0; i < 6; i++) await d.keyboard.press('ArrowLeft');
  const afterKey = await d.inputValue('#c-tempo-startKmh');
  note('Regler per Tastatur bedienbar (6× ←: 210 → 180)', afterKey === '180', afterKey);
  await d.fill(num('c-tempo-maxKmh'), '540');
  await d.press(num('c-tempo-maxKmh'), 'Enter');
  await d.waitForTimeout(900);
  const statusTxt = await d.textContent('.statusbar');
  note('Statusleiste: „Entwurf – nicht veröffentlicht“, Änderungen gezählt, Standardwert-Hinweis sichtbar', statusTxt.includes('Entwurf') && /Änderung/.test(statusTxt) && (await d.textContent('#sec-tempo')).includes('Standard: 210'));
  // Konflikt: hohe Dichte + niedrige Empfindlichkeit
  await d.fill(num('c-controls-key'), '0.5');
  await d.press(num('c-controls-key'), 'Enter');
  await d.waitForTimeout(900);
  const issue = await d.textContent('#sec-controls');
  const pubBtn = d.locator('.sb-actions .btn.primary');
  note('Konflikt (Tastatur 50 %) wird am Regler gezeigt und blockiert „Veröffentlichen“', issue.includes('Konflikt') && (await pubBtn.isDisabled()), issue.match(/Konflikt: [^.]*\./)?.[0] ?? '');
  await d.screenshot({ path: `${OUT}/d-konflikt.png` });
  await d.fill(num('c-controls-key'), '1');
  await d.press(num('c-controls-key'), 'Enter');
  await d.waitForTimeout(900);
  // Power-up „Phantom-Turbo“ ausschalten, Fliegen-Anteil
  await d.locator('label[for="t-pickups-on-boost"]').click();
  await d.locator('label[for="t-pickups-on-magnet"]').click();
  await d.waitForTimeout(900);
  // Entwurf bleibt nach Neuladen erhalten
  await d.reload(); await d.waitForSelector('#sec-tempo');
  note('Entwurf überlebt Neuladen (serverseitig gespeichert)', (await d.inputValue('#c-tempo-startKmh')) === '180' && !(await d.locator('#t-pickups-on-boost').isChecked()));
  // Öffentliche API zeigt noch den alten Stand
  const pub0 = await (await fetch(BASE + '/api/config')).json();
  note('Entwurf ist öffentlich unsichtbar (API liefert eingebaute Werte)', pub0.id === 'builtin' && pub0.config.tempo.startKmh === 210);

  // Testfahrt (neuer Tab) – Entwurf, nicht gezählt
  const [tab] = await Promise.all([dctx.waitForEvent('page'), d.click('text=Testfahrt')]);
  await tab.waitForLoadState();
  tab.on('pageerror', (e) => errors.push('testfahrt: ' + e));
  await tab.waitForSelector('#testdrive-badge');
  await tab.waitForTimeout(500);
  await tab.keyboard.press('Enter'); await tab.waitForTimeout(400);
  const tdSpeed = await tab.evaluate(() => Number(document.getElementById('hud-speed').textContent));
  note('Testfahrt nutzt den Entwurf (Starttempo ≈ 180 km/h) und zeigt „zählt nicht“', Math.abs(tdSpeed - 180) < 12, `HUD ${tdSpeed} km/h`);
  await tab.waitForTimeout(6000);                                      // fährt geradeaus bis zum Aufprall oder weiter
  await tab.close();

  // Veröffentlichen mit Zusammenfassung
  await d.click('.sb-actions .btn.primary');
  await d.waitForSelector('dialog[open] .difflist');
  const diff = await d.textContent('dialog[open] .difflist');
  note('Veröffentlichen-Dialog listet geänderte Werte (alt → neu)', diff.includes('Starttempo') && diff.includes('Phantom-Turbo') && diff.includes('→'), diff.replace(/\s+/g, ' ').slice(0, 160));
  await d.screenshot({ path: `${OUT}/d-veroeffentlichen.png` });
  await d.fill('#pub-label', 'Abnahme A');
  await d.click('dialog[open] .btn.primary');
  await d.waitForSelector('.badge.live');
  const pub1 = await (await fetch(BASE + '/api/config')).json();
  note('Veröffentlicht: Version 1 öffentlich, Entwurf = veröffentlicht', pub1.id === '1' && pub1.config.tempo.startKmh === 180 && pub1.config.pickups.on.boost === false);

  // ---- Wirkung im Spiel (echtes Spiel, QA-Hooks, Messung aus)
  const gctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const g = await gctx.newPage();
  g.on('pageerror', (e) => errors.push('spiel: ' + e));
  await g.goto(`${BASE}/?qa=1&seed=5`);
  await g.waitForTimeout(500); await g.keyboard.press('Enter'); await g.waitForTimeout(300);
  const st0 = await g.evaluate(() => window.__qa.state());
  note('Spiel übernimmt veröffentlichte Version: Starttempo 180 km/h', Math.abs(st0.v - 180) < 6, `v=${st0.v.toFixed(0)}`);
  const seenTypes = new Set();
  for (let seed = 1; seed <= 3; seed++) {
    await g.goto(`${BASE}/?qa=1&seed=${seed}&startS=1200`);
    await g.waitForTimeout(250); await g.keyboard.press('Enter'); await g.waitForTimeout(150);
    for (let i = 0; i < 90; i++) {
      await g.evaluate(() => { window.__qa.give(5); window.__qa.advance(0.25, 0); });
      const s2 = await g.evaluate(() => window.__qa.state());
      for (const pk of s2.pickups) seenTypes.add(pk.type);
      if (s2.crashed) break;
    }
  }
  note('Ausgeschaltete Power-ups (Phantom-Turbo, Magnetfeld) erscheinen in 3 Fahrten à 22 s nie, andere schon', !seenTypes.has('boost') && !seenTypes.has('magnet') && seenTypes.size >= 3, 'gesehen: ' + [...seenTypes].join(','));
  await gctx.close();

  // ---- Spielstart ohne Konfig-API (eingebaute Werte)
  const nctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const n = await nctx.newPage();
  await n.route('**/api/config**', (r) => r.abort());
  await n.route('**/api/e', (r) => r.abort());
  n.on('pageerror', (e) => errors.push('api-down: ' + e));
  await n.goto(`${BASE}/?qa=1&seed=5`);
  await n.waitForTimeout(500); await n.keyboard.press('Enter'); await n.waitForTimeout(300);
  const stN = await n.evaluate(() => window.__qa.state());
  note('Konfig-API nicht erreichbar: Spiel startet trotzdem mit eingebauten Werten (210 km/h)', Math.abs(stN.v - 210) < 6, `v=${stN.v.toFixed(0)}`);
  await nctx.close();

  // ---- Versionswechsel zwischen zwei Fahrten (ohne Neuladen)
  const vctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const v = await vctx.newPage();
  v.on('pageerror', (e) => errors.push('versionswechsel: ' + e));
  await v.goto(`${BASE}/?qa=1&seed=9`);
  await v.waitForTimeout(500); await v.keyboard.press('Enter'); await v.waitForTimeout(300);
  const r1 = await v.evaluate(() => window.__qa.state().v);
  // zweite Version über die Admin-Oberfläche: Starttempo 300
  await d.reload(); await d.waitForSelector('#sec-tempo');
  await d.fill(num('c-tempo-startKmh'), '300');
  await d.press(num('c-tempo-startKmh'), 'Enter');
  await d.waitForTimeout(900);
  await d.click('.sb-actions .btn.primary'); await d.waitForSelector('dialog[open] .difflist');
  await d.fill('#pub-label', 'Abnahme B'); await d.click('dialog[open] .btn.primary'); await d.waitForSelector('.badge.live');
  const stillOld = await v.evaluate(() => { window.__qa.advance(0.2, 0); return window.__qa.state().v; });
  await v.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await v.waitForTimeout(700);
  await v.evaluate(() => window.__qa.pause()); await v.waitForTimeout(200);
  await v.click('[data-action="restart"]'); await v.waitForTimeout(300);
  const r2 = await v.evaluate(() => window.__qa.state().v);
  note('Version 2 gilt erst für die nächste Fahrt: laufende Fahrt bleibt bei Version 1, neue Fahrt startet mit 300 km/h', Math.abs(r1 - 180) < 6 && stillOld < 200 && Math.abs(r2 - 300) < 8, `Fahrt 1: ${r1.toFixed(0)}, laufend nach Veröffentlichung: ${stillOld.toFixed(0)}, Fahrt 2: ${r2.toFixed(0)}`);
  await vctx.close();

  // ---- Messung im echten Spiel (nicht QA): Besuch, Start, Pickup sichtbar, Ende
  const mctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const m = await mctx.newPage();
  m.on('pageerror', (e) => errors.push('messung: ' + e));
  await m.goto(`${BASE}/?seed=12`);
  await m.waitForTimeout(600); await m.keyboard.press('Enter');
  await m.waitForFunction(() => !document.getElementById('screen-result').hidden, null, { timeout: 40000 });   // fährt geradeaus bis zum Aufprall
  await m.waitForTimeout(6000);                                                                              // Bündel wird spätestens nach 5 s gesendet
  const kpi = await (await dctx.request.get(`${BASE}/admin/api/kpi?period=24h`)).json();
  note('Echte Fahrt wird gemessen: 1 Besuch, 1 Fahrt mit Endereignis, Strecke > 0, Konfiguration 2 zugeordnet', kpi.cards.views === 1 && kpi.cards.runs === 1 && kpi.metrics.withEnd === 1 && kpi.metrics.dist.median > 0 && kpi.metrics.crash.n === 1, JSON.stringify({ v: kpi.cards.views, r: kpi.cards.runs, d: kpi.metrics.dist.median, cause: kpi.metrics.crash.causes[0]?.cause }));
  const runCfg = new DatabaseSync(DB, { readOnly: true }).prepare('SELECT cfg FROM runs').all();
  note('Testfahrt und QA-Läufe sind in den Daten nicht enthalten (nur die eine echte Fahrt)', runCfg.length === 1 && runCfg[0].cfg === '2', JSON.stringify(runCfg));
  const best = await m.evaluate(() => localStorage.getItem('glimmer-mile') ?? JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
  await mctx.close();
  void best;

  // ---- Ereignis automatisch beenden (Datenbankuhr verstellt) und Anzeige
  await d.reload(); await d.waitForSelector('#sec-event');
  await d.locator('label[for="t-event-on"]').click();
  await d.waitForTimeout(900);
  await d.click('.sb-actions .btn.primary'); await d.waitForSelector('dialog[open] .difflist'); await d.click('dialog[open] .btn.primary'); await d.waitForSelector('.badge.live');
  const evOn = await (await fetch(BASE + '/api/config')).json();
  note('Flugwoche: nach Veröffentlichung läuft das Ereignis mit Enddatum', !!evOn.event && evOn.event.endsAt > Date.now() + 2 * 86400_000, evOn.event ? `endet ${new Date(evOn.event.endsAt).toLocaleString('de-DE')}` : 'kein Ereignis');
  await d.screenshot({ path: `${OUT}/d-flugwoche.png`, fullPage: false });
  const rw = new DatabaseSync(DB);
  rw.prepare('UPDATE config_versions SET event_end = ? WHERE id = (SELECT MAX(id) FROM config_versions)').run(Date.now() - 1000);
  rw.close();
  const evOff = await (await fetch(BASE + '/api/config')).json();
  note('Flugwoche endet automatisch: API liefert danach kein Ereignis mehr, reguläre Konfiguration gilt', evOff.event === null && evOff.config.event.on === true);

  // ---- Übersicht mit Daten, SEO
  await d.click('text=Übersicht'); await d.waitForSelector('.kpis');
  await d.waitForTimeout(500);
  await d.screenshot({ path: `${OUT}/d-uebersicht.png`, fullPage: true });
  const cardsTxt = await d.textContent('.kpis');
  note('Übersicht zeigt 5 Kennzahlenkarten mit Vergleich und Stichprobe', (await d.locator('.kpi').count()) === 5 && /Vorperiode/.test(cardsTxt) && /Stichprobe/.test(cardsTxt));
  await d.focus('.chart-wrap'); await d.keyboard.press('ArrowRight');
  note('Diagramm per Tastatur lesbar (Wertanzeige)', (await d.textContent('.chart .readout')).includes(':'));
  await d.click('.tbl-box .link >> nth=0');
  note('Tabellenansicht schaltbar', await d.locator('table.data >> nth=0').isVisible());
  await d.click('text=SEO'); await d.waitForSelector('#seo-domain');
  await d.fill('#seo-domain', BASE); await d.click('text=Jetzt prüfen');
  await d.waitForSelector('.checks');
  await d.waitForTimeout(300);
  await d.screenshot({ path: `${OUT}/d-seo.png`, fullPage: true });
  const checks = await d.$$eval('.check', (els) => els.map((e) => ({ cls: e.className, t: e.querySelector('h3').textContent })));
  const failing = checks.filter((c) => c.cls.includes('fail')).map((c) => c.t);
  note('SEO-Check (ohne Search Console): 12+ Prüfpunkte, keine Fehler an der Startseite', checks.length >= 12 && failing.length === 0, `${checks.length} Punkte, Fehler: ${failing.join('|') || 'keine'}`);
  note('Search Console optional: ohne Einrichtung nur Hinweis, Check funktioniert', (await d.textContent('main')).includes('Nicht eingerichtet'));

  // ---- Passwort ändern, Abmelden
  const d2ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const d2 = await d2ctx.newPage();
  await login(d2); await d2.waitForSelector('.top');
  await d.click('text=Passwort'); await d.fill('#pw-cur', PW); await d.fill('#pw-new', 'Neues-Abnahme-Passwort-9'); await d.click('dialog[open] button[type=submit]');
  await d.waitForSelector('#pw');
  note('Passwortwechsel meldet auf diesem Gerät ab', true);
  const other = await d2ctx.request.get(BASE + '/admin/api/state');
  note('… und beendet die Sitzung des zweiten Geräts sofort (401)', other.status() === 401, String(other.status()));
  await login(d, PW); await d.waitForFunction(() => document.getElementById('msg').textContent.length > 0);
  note('Altes Passwort ist ungültig', (await d.textContent('#msg')).includes('fehlgeschlagen'));
  await d.fill('#pw', 'Neues-Abnahme-Passwort-9'); await d.click('#go'); await d.waitForSelector('.top');
  await d.click('text=Abmelden'); await d.waitForSelector('#pw');
  const afterOut = await dctx.request.get(BASE + '/admin/api/state');
  note('Abmelden beendet die Sitzung (API 401, Login-Seite)', afterOut.status() === 401);
  await d2ctx.close();
  await dctx.close();

  // ---- Smartphone
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await pctx.newPage();
  p.on('pageerror', (e) => errors.push('phone: ' + e));
  await login(p, 'Neues-Abnahme-Passwort-9'); await p.waitForSelector('.top');
  const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  note('Smartphone: Übersicht ohne horizontales Scrollen', ov.sw <= ov.iw + 1, JSON.stringify(ov));
  await p.screenshot({ path: `${OUT}/p-uebersicht.png`, fullPage: true });
  const tabBox = await p.locator('.tabs').boundingBox();
  note('Smartphone: Bereichs-Tabs liegen unten im Daumenbereich', tabBox.y + tabBox.height > 800, JSON.stringify(tabBox));
  await p.click('.tabs >> text=Spieleinstellungen'); await p.waitForSelector('#sec-tempo');
  const st = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  note('Smartphone: Einstellungen ohne horizontales Scrollen, Regler untereinander', st.sw <= st.iw + 1, JSON.stringify(st));
  await p.screenshot({ path: `${OUT}/p-einstellungen.png`, fullPage: false });
  // Touch-Bedienung eines Reglers (Wischen auf der Spur)
  const box = await p.locator('#c-tempo-maxKmh').boundingBox();
  const before = await p.inputValue('#c-tempo-maxKmh');
  await p.touchscreen.tap(box.x + box.width * 0.35, box.y + box.height / 2);
  await p.waitForTimeout(300);
  note('Smartphone: Regler per Fingertipp verstellbar', (await p.inputValue('#c-tempo-maxKmh')) !== before, `${before} → ${await p.inputValue('#c-tempo-maxKmh')}`);
  const mins = await p.$$eval('.sb-actions .btn, .tabs a, .seg button', (els) => els.map((e) => e.getBoundingClientRect().height));
  note('Smartphone: Schaltflächen mindestens 38 px hoch', mins.every((h) => h >= 38), `min ${Math.min(...mins).toFixed(0)} px`);
  await p.click('.tabs >> text=SEO'); await p.waitForSelector('#seo-domain');
  const sw3 = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  note('Smartphone: SEO-Ansicht ohne horizontales Scrollen', sw3.sw <= sw3.iw + 1, JSON.stringify(sw3));
  await p.screenshot({ path: `${OUT}/p-seo.png`, fullPage: true });
  await pctx.close();

  note('Keine JavaScript-Fehler in allen Seiten', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  srv.kill();
}
const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad}/${results.length} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
