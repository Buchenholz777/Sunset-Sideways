// SEO-Abnahme im echten Chrome: initiales HTML vs. gerendert, Beschreibung aufklappbar (Tastatur), Spielstart, Performance (FCP/LCP/Zeit bis steuerbar).
// Aufruf: node scripts/seo_check.mjs http://localhost:4173 seo-shots
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:4173', OUT = process.argv[3] ?? 'seo-shots';
mkdirSync(OUT, { recursive: true });
const results = [];
const note = (n, ok, info = '') => { results.push(ok); console.log(ok ? 'OK  ' : 'FAIL', n, info); };

// 1) Initiales HTML (ohne JavaScript)
const raw = await (await fetch(BASE + '/')).text();
note('Initiales HTML: Titel, Beschreibung, Canonical, H1, Tagline, Steuerhinweis, Spielbeschreibung', /<title>Sunset Sideways – Arcade-Rennspiel im Browser<\/title>/.test(raw) && /name="description"/.test(raw) && /rel="canonical" href="https:\/\/www\.sunsetsideways\.com\/"/.test(raw) && /<h1[^>]*>/.test(raw) && raw.includes('Arcade-Rennspiel im Browser</p>') && raw.includes('Mit den Pfeiltasten lenken') && raw.includes('Impulsschild') && raw.includes('<noscript>'));
note('JSON-LD (VideoGame) vorhanden und gültiges JSON', (() => { try { const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(raw); const j = JSON.parse(m[1].replace(/__ORIGIN__/g, 'https://www.sunsetsideways.com')); return j['@type'] === 'VideoGame' && j.url === 'https://www.sunsetsideways.com/'; } catch { return false; } })());
note('Kein noindex im HTML', !/noindex/i.test(raw));
note('Keine ungefüllten Platzhalter (__ORIGIN__) im Produktionsbuild', !raw.includes('__ORIGIN__'));
for (const p of ['/og.jpg', '/robots.txt', '/sitemap.xml', '/favicon.svg']) { const r = await fetch(BASE + p); note(`Datei ${p}: 200 und kein HTML-Fallback`, r.status === 200 && !(r.headers.get('content-type') ?? '').includes('text/html'), `${r.status} ${r.headers.get('content-type')}`); }

const browser = await chromium.launch({ channel: 'chrome' });
// 2) Gerendert, vier Formate, Beschreibung offen
for (const [name, w, h, touch] of [['desktop-1366x768', 1366, 768, false], ['mobil-390x844', 390, 844, true], ['mobil-320x568', 320, 568, true], ['quer-844x390', 844, 390, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/'); await page.waitForTimeout(600);
  const vis = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const b = r('#btn-start'), h1 = r('h1.logo'), tg = r('.tagline'), s = r('#about > summary'); return { btnInside: b.bottom <= innerHeight && b.top >= 0, h1: h1.width > 0, tag: tg.width > 0, sumInside: s.bottom <= innerHeight + 1 && s.top > b.bottom - 1, overflowX: document.documentElement.scrollWidth > innerWidth }; });
  note(`${name}: H1, Tagline, Startknopf und „So funktioniert“ sichtbar, kein Seitwärts-Scrollen`, vis.btnInside && vis.h1 && vis.tag && vis.sumInside && !vis.overflowX, JSON.stringify(vis));
  await page.screenshot({ path: `${OUT}/${name}-start.png` });
  // Tastatur: Summary fokussieren, Leertaste klappt auf und startet NICHT das Spiel
  await page.focus('#about > summary'); await page.keyboard.press('Space'); await page.waitForTimeout(250);
  const st = await page.evaluate(() => ({ open: document.getElementById('about').open, running: document.getElementById('screen-start').hidden }));
  note(`${name}: Leertaste auf „So funktioniert“ klappt auf, startet keine Fahrt`, st.open && !st.running, JSON.stringify(st));
  await page.screenshot({ path: `${OUT}/${name}-beschreibung.png` });
  await page.keyboard.press('Space'); await page.waitForTimeout(150);
  await page.focus('#btn-start'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  note(`${name}: Spielstart funktioniert danach`, await page.evaluate(() => document.getElementById('screen-start').hidden), errs.join('|'));
  await ctx.close();
}

// 3) Performance (Chrome, Emulation): mobil mit 4× CPU-Drosselung und „Fast 4G“, Desktop ohne Drosselung
async function perf(label, opts, throttle) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (throttle) { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 }); }
  await page.addInitScript(() => { window.__m = {}; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__m.fcp = e.startTime; }).observe({ type: 'paint', buffered: true }); new PerformanceObserver((l) => { const e = l.getEntries().pop(); window.__m.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); });
  const t0 = Date.now();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#btn-start');
  const tBtn = Date.now() - t0;
  await page.focus('#btn-start'); const t1 = Date.now();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('screen-start').hidden);
  const tRun = Date.now() - t0;
  const m = await page.evaluate(() => window.__m);
  const sz = await page.evaluate(() => performance.getEntriesByType('resource').reduce((a, e) => a + (e.transferSize || 0), 0));
  console.log(`PERF ${label}: FCP ${Math.round(m.fcp)} ms · LCP ${Math.round(m.lcp)} ms · Startknopf sichtbar nach ${tBtn} ms · Fahrt gestartet nach ${tRun} ms (Enter-Reaktion ${Date.now() - t1 - (tRun - (t1 - t0))} ms) · übertragen ${Math.round(sz / 1024)} KB`);
  await ctx.close();
  return m;
}
const pm = await perf('mobil (Pixel-ähnlich 390×844, CPU 4×, Fast 4G)', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, true);
const pd = await perf('Desktop 1366×768 (ungedrosselt, lokal)', { viewport: { width: 1366, height: 768 } }, false);
note('FCP mobil < 2,5 s (gedrosselt) und Desktop < 1,5 s', pm.fcp < 2500 && pd.fcp < 1500, `${Math.round(pm.fcp)} / ${Math.round(pd.fcp)} ms`);
await browser.close();
const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad}/${results.length} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
