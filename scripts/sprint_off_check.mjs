// Sprint ist abgeschaltet (SPRINT_ENABLED=false): kein Knopf, Links öffnen Endless ohne Banner. Aufruf: node scripts/sprint_off_check.mjs http://localhost:4173
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const results = [];
const note = (n, ok, info = '') => { results.push(ok); console.log(ok ? 'OK  ' : 'FAIL', n, info); };
const browser = await chromium.launch({ channel: 'chrome' });
for (const [name, w, h, touch] of [['1366×768', 1366, 768, false], ['390×844', 390, 844, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?qa=1'); await page.waitForTimeout(500);
  const vis = await page.evaluate(() => ({ sprint: getComputedStyle(document.getElementById('btn-sprint')).display !== 'none', start: getComputedStyle(document.getElementById('btn-start')).display !== 'none' }));
  note(`${name}: „Sunset Sprint“-Knopf nicht sichtbar, „Fahren“ bleibt`, !vis.sprint && vis.start, JSON.stringify(vis));
  await page.evaluate(() => document.getElementById('btn-start').click()); await page.waitForTimeout(300);
  note(`${name}: Start ergibt Endless`, (await page.evaluate(() => window.__qa.mode())) === 'endless');
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?sprint=S1&c=4200&qa=1'); await page.waitForTimeout(500);
  const c = await page.evaluate(() => ({ box: !document.getElementById('challenge').hidden, mode: window.__qa.mode() }));
  note('Herausforderungs-Link: kein Banner, Spiel startet erst auf Klick im Endless-Modus', !c.box && c.mode === 'endless', JSON.stringify(c));
  await page.evaluate(() => document.getElementById('btn-start').click()); await page.waitForTimeout(200);
  note('… und der Sprint-Balken bleibt aus', await page.evaluate(() => document.getElementById('sprint-bar').hidden));
  await ctx.close();
}
await browser.close();
const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad}/${results.length} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
