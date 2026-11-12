// Einwilligung im echten Chrome: nichts von Google vor der Zustimmung, Zustimmung/Ablehnung/Widerruf, Tastatur, keine Wirkung im Spielfluss.
// Aufruf: node scripts/consent_check.mjs http://localhost:4173
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const results = [];
const note = (n, ok, info = '') => { results.push(ok); console.log(ok ? 'OK  ' : 'FAIL', n, info); };
const browser = await chromium.launch({ channel: 'chrome' });

async function fresh(vp = { width: 1280, height: 720 }, touch = false) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
  const hits = [];
  await ctx.route('**/*googletagmanager.com/**', (r) => { hits.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* GTM-Attrappe */' }); });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  return { ctx, page, hits, errs };
}

{ // Erstbesuch
  const { ctx, page, hits, errs } = await fresh();
  await page.goto(BASE + '/'); await page.waitForTimeout(800);
  note('Erstbesuch: Einwilligungshinweis sichtbar, Ablehnen und Akzeptieren gleichwertig', await page.locator('#consent').isVisible() && (await page.locator('#consent button').count()) === 2);
  note('Erstbesuch: vor der Entscheidung KEIN Aufruf an googletagmanager.com', hits.length === 0, `Aufrufe: ${hits.length}`);
  const sizes = await page.$$eval('#consent button', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  note('Beide Schaltflächen gleich groß und ≥ 44 px hoch', sizes[0][0] === sizes[1][0] && sizes[0][1] >= 44 && sizes[1][1] >= 44, JSON.stringify(sizes));
  // Tastatur: Enter auf „Ablehnen“ startet die Fahrt nicht
  await page.focus('#consent button[data-d="denied"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  note('Enter auf „Ablehnen“ entscheidet, startet aber keine Fahrt', !(await page.locator('#consent').count()) && !(await page.evaluate(() => document.getElementById('screen-start').hidden)));
  note('Ablehnen: weiterhin kein Google-Aufruf, Entscheidung gemerkt', hits.length === 0 && (await page.evaluate(() => JSON.parse(localStorage.getItem('ssw-consent')).d)) === 'denied');
  await page.reload(); await page.waitForTimeout(600);
  note('Nach Neuladen: kein Banner, weiter kein Google-Aufruf', (await page.locator('#consent').count()) === 0 && hits.length === 0);
  // Spiel läuft unabhängig
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  note('Spielstart funktioniert (Entscheidung beeinflusst den Spielfluss nicht)', await page.evaluate(() => document.getElementById('screen-start').hidden));
  note('Keine JavaScript-Fehler', errs.length === 0, errs.join('|'));
  await ctx.close();
}
{ // Zustimmung, Widerruf
  const { ctx, page, hits } = await fresh();
  await page.goto(BASE + '/'); await page.waitForTimeout(600);
  await page.click('#consent button[data-d="granted"]'); await page.waitForTimeout(600);
  note('Akzeptieren: Tag Manager mit korrekter Container-ID wird geladen', hits.some((u) => u.includes('gtm.js?id=GTM-WRM84FRX')), hits.join(',').slice(0, 90));
  await page.reload(); await page.waitForTimeout(800);
  note('Nach Neuladen: kein Banner, Tag Manager wird weiter geladen', (await page.locator('#consent').count()) === 0 && hits.length >= 2);
  const before = hits.length;
  await page.click('#consent-settings'); await page.waitForSelector('#consent');
  await page.click('#consent button[data-d="denied"]'); await page.waitForTimeout(900);
  const after = hits.length;
  await page.waitForTimeout(600);
  note('Widerruf über „Cookie-Einstellungen“: Seite lädt neu, danach kein weiterer Google-Aufruf', (await page.evaluate(() => JSON.parse(localStorage.getItem('ssw-consent')).d)) === 'denied' && hits.length === after && after === before, `vorher ${before}, nachher ${hits.length}`);
  await ctx.close();
}
{ // QA / Testfahrt / Smartphone
  const { ctx, page, hits } = await fresh();
  await page.goto(BASE + '/?qa=1'); await page.waitForTimeout(500);
  note('QA-Lauf: weder Banner noch Google-Aufruf', (await page.locator('#consent').count()) === 0 && hits.length === 0);
  await ctx.close();
  const m = await fresh({ width: 390, height: 844 }, true);
  await m.page.goto(BASE + '/'); await m.page.waitForTimeout(700);
  const g = await m.page.evaluate(() => { const r = document.getElementById('consent').getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, over: document.documentElement.scrollWidth > innerWidth }; });
  note('Smartphone 390×844: Banner vollständig im Bild, kein Seitwärts-Scrollen', g.inside && !g.over, JSON.stringify(g));
  await m.page.screenshot({ path: 'consent-mobil.png' });
  const links = await m.page.$$eval('.legal a', (a) => a.map((x) => x.getAttribute('href')));
  note('Datenschutz- und Impressum-Link vorhanden', links.includes('/datenschutz') && links.includes('/impressum'), links.join(','));
  await m.ctx.close();
}
await browser.close();
const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad}/${results.length} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
