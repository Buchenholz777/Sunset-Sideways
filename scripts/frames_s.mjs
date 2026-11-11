// Bildfolgen und Messwerte für Sunset Sideways (S02, S05, S06, S07, S08). Nutzung: node scripts/frames_s.mjs <basisURL> <ausgabeordner>
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const log = [];

async function open(viewport, q, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  await page.goto(`${base}/?qa=1&${q}`);
  await page.waitForTimeout(300);
  if (touch) await page.locator('#btn-start').tap(); else await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  return { ctx, page };
}
const hideUi = (page) => page.evaluate(() => { window.__qa.pause(); document.querySelectorAll('.overlay,.brief').forEach((o) => (o.hidden = true)); });
const adv = (page, ...a) => page.evaluate((x) => window.__qa.advance(...x), a);
const state = (page) => page.evaluate(() => window.__qa.state());

// 0) Bedienhinweis (Desktop und Smartphone)
for (const [name, vp, touch] of [['desktop', { width: 1366, height: 768 }, false], ['hoch320', { width: 320, height: 568 }, true], ['hoch390', { width: 390, height: 844 }, true]]) {
  const { ctx, page } = await open(vp, 'seed=12', touch);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/hinweis-${name}.png` });
  await ctx.close();
}

// 1) Physik: ohne Lenken geradeaus, relativ zur Straße nach außen; linke/mittlere/rechte Startspur, beide Bogenrichtungen
const seedFor = {};
for (let sd = 1; sd < 12 && Object.keys(seedFor).length < 2; sd++) {
  const { ctx, page } = await open({ width: 800, height: 450 }, `seed=${sd}&startS=300&startT=6`);
  await hideUi(page);
  const k = (await state(page)).k;
  if (!seedFor[Math.sign(k)]) seedFor[Math.sign(k)] = sd;
  await ctx.close();
}
for (const [dirName, sg] of [['rechts', 1], ['links', -1]]) {
  for (const q0 of [-3.6, 0, 3.6]) {
    const { ctx, page } = await open({ width: 1366, height: 768 }, `seed=${seedFor[sg]}&startS=300&startT=6&ghost=1`);
    await hideUi(page);
    await page.evaluate((q) => window.__qa.setQ(q), q0);
    const rows = [];
    for (let i = 0; i <= 8; i++) {
      const s = await state(page);
      rows.push({ t: +(i * 0.25).toFixed(2), s: +s.s.toFixed(0), q: +s.q.toFixed(2), welt: +s.X.toFixed(2), psi: +s.psi.toFixed(4) });
      if (i === 0 || i === 4 || i === 8) await page.screenshot({ path: `${out}/physik-${dirName}-q${q0}-${i}.png` });
      await adv(page, 0.25, 0, 0, false, 0, false);
    }
    log.push({ szenario: `Physik neutral ${dirName}kurve, Startspur q=${q0}`, seed: seedFor[sg], verlauf: rows });
    await ctx.close();
  }
}

// 2) Drift mit Combo, Ladefunken und sichtbarer Flanke (beide Richtungen, Desktop und Hochformat)
for (const [dirName, sg] of [['rechts', 1], ['links', -1]]) {
  for (const [name, vp, touch] of [['desktop', { width: 1366, height: 768 }, false], ['hoch390', { width: 390, height: 844 }, true]]) {
    const { ctx, page } = await open(vp, `seed=${seedFor[sg]}&startS=336&startT=6&ghost=1`, touch);
    await hideUi(page);
    const rows = [];
    for (let i = 1; i <= 24; i++) {
      await adv(page, 0.1, null, 0, true, 0, true);
      const s = await state(page);
      rows.push({ t: +(i * 0.1).toFixed(1), drift: s.drifting, combo: s.combo, nitro: +s.nitro.toFixed(1), winkel: +((s.slipVis * 180) / Math.PI).toFixed(1), kmh: Math.round(s.v) });
      if ([5, 13, 22].includes(i)) await page.screenshot({ path: `${out}/drift-${dirName}-${name}-${i}.png` });
    }
    log.push({ szenario: `Drift ${dirName} ${name}`, verlauf: rows.filter((_, i) => i % 3 === 0) });
    await ctx.close();
  }
}

// 3) Nitro: Zündung bei ≥ 40 %, getrennter Look
{
  const { ctx, page } = await open({ width: 1366, height: 768 }, 'seed=12&startS=20&startT=0&ghost=1');
  await hideUi(page);
  await page.evaluate(() => window.__qa.nitro(100));
  await adv(page, 0.1, 0, 0, false, 0, true);
  await page.screenshot({ path: `${out}/nitro-bereit.png` });
  await adv(page, 0.3, 0, 0, false, 1, true);
  await page.screenshot({ path: `${out}/nitro-aktiv.png` });
  const s = await state(page);
  log.push({ szenario: 'Nitro gezündet', tank: +s.nitro.toFixed(1), restzeit: +s.nitroT.toFixed(2), kmh: Math.round(s.v) });
  await ctx.close();
}

// 4) Licht: langer Sunset, sinkende Sonne, blaue Stunde, Nacht (Desktop + Hochformat) und Flugzeug
for (const [name, vp, touch] of [['desktop', { width: 1366, height: 768 }, false], ['hoch390', { width: 390, height: 844 }, true]]) {
  for (const [lab, s, tt] of [['0000m', 40, 0], ['1000m', 1000, 20], ['2000m', 2000, 30], ['2700m', 2700, 40], ['3400m', 3400, 50], ['4200m', 4200, 60], ['5200m', 5200, 80]]) {
    const { ctx, page } = await open(vp, `seed=12&startS=${s}&startT=${tt}&ghost=1`, touch);
    await hideUi(page);
    await page.evaluate(() => window.__qa.scene(11));
    await adv(page, 0.05, 0, 0, false, 0, true);
    await page.screenshot({ path: `${out}/licht-${name}-${lab}.png` });
    await ctx.close();
  }
}
{
  const { ctx, page } = await open({ width: 1366, height: 768 }, 'seed=12&startS=3800&startT=60&ghost=1');
  await hideUi(page);
  for (const t of [9, 12, 15, 18]) { await page.evaluate((x) => window.__qa.scene(x), t); await page.screenshot({ path: `${out}/flugzeug-t${t}.png` }); }
  await ctx.close();
}

writeFileSync(`${out}/messwerte.json`, JSON.stringify(log, null, 1));
await browser.close();
console.log('fertig', Object.keys(seedFor));
