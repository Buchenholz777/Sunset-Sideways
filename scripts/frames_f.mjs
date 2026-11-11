// Messungen und Bilder für F05/F09: Straße und Kamera in Bewegung, Debug-Ansicht. Nutzung: node scripts/frames_f.mjs <basisURL> <ausgabeordner>
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
  await page.evaluate(() => { window.__qa.pause(); document.querySelectorAll('.overlay,.brief').forEach((o) => (o.hidden = true)); });
  return { ctx, page };
}
const stats = (rows, key) => {
  const d = rows.slice(1).map((r, i) => Math.abs(r[key] - rows[i][key])).sort((a, b) => a - b);
  return { max: +d[d.length - 1].toFixed(2), median: +d[Math.floor(d.length / 2)].toFixed(3), p99: +d[Math.floor(d.length * 0.99)].toFixed(2) };
};

// Finde Seeds mit Rechts- und Linkskurve zuerst
const seedFor = {};
for (let sd = 1; sd < 14 && Object.keys(seedFor).length < 2; sd++) {
  const { ctx, page } = await open({ width: 800, height: 450 }, `seed=${sd}&startS=336&startT=6&ghost=1`);
  const k = (await page.evaluate(() => window.__qa.state())).k;
  if (!seedFor[Math.sign(k)]) seedFor[Math.sign(k)] = sd;
  await ctx.close();
}

// 1) Strecke/Kamera in Bewegung: Bildspalten je Bild; Sprünge = große Differenzen zwischen Folgebildern
for (const [vpName, vp, touch] of [['desktop', { width: 1366, height: 768 }, false], ['hoch320', { width: 320, height: 568 }, true]]) {
  for (const [dirName, sg] of [['rechts', 1], ['links', -1]]) {
    const { ctx, page } = await open(vp, `seed=${seedFor[sg]}&startS=240&startT=5&ghost=1&debug=1`, touch);
    const rows = await page.evaluate(() => window.__qa.trace(9, 2.2, 3.6));
    const driftFrames = rows.filter((r) => r.drift).length;
    log.push({ szenario: `Kamera-Trace ${dirName} ${vpName} (9 s, Handbremse 2,2–3,6 s)`, bilder: rows.length, driftBilder: driftFrames, maxSchlupfGrad: +Math.max(...rows.map((r) => Math.abs((r.slip * 180) / Math.PI))).toFixed(1), sprung: { strasse40: stats(rows, 'c40'), strasse120: stats(rows, 'c120'), wagen: stats(rows, 'car'), blick: stats(rows, 'head') } });
    await page.evaluate(() => window.__qa.advance(0.02, null, 0, false, 0, true));
    await page.screenshot({ path: `${out}/debug-${dirName}-${vpName}.png` });
    await ctx.close();
  }
}

// 2) Drift am Kurveneingang (Gerade davor), Gegenlenken, Ende – Bildfolge
for (const [dirName, sg] of [['rechts', 1], ['links', -1]]) {
  const { ctx, page } = await open({ width: 1366, height: 768 }, `seed=${seedFor[sg]}&startS=250&startT=5&ghost=1`);
  const rows = [];
  for (let i = 0; i < 3; i++) {
    const r = await page.evaluate(() => window.__qa.trace(1.0, 0.1, 0.9));
    rows.push(...r);
    await page.screenshot({ path: `${out}/drift-${dirName}-${i}.png` });
  }
  log.push({ szenario: `Drift ${dirName} (Eintritt vor dem Bogen)`, beispiel: rows.filter((_, i) => i % 15 === 0).map((r) => [r.t, r.drift, +((r.slip * 180) / Math.PI).toFixed(1), r.u]) });
  await ctx.close();
}

// 3) Pickup: Bodenmarke und Sammelfläche (Debug-Ansicht), Hindernis mit Fahrzeugfläche
{
  const { ctx, page } = await open({ width: 1366, height: 768 }, 'seed=12&startS=20&startT=6&ghost=1&debug=1');
  for (let i = 0; i < 80; i++) {
    const st = await page.evaluate(() => window.__qa.state());
    if (st.pickups.length && st.pickups[0].z - st.s < 70 && st.pickups[0].z - st.s > 40) break;
    await page.evaluate(() => window.__qa.advance(0.25, 0, 0, false, 0, true));
  }
  await page.screenshot({ path: `${out}/pickup-flaeche-debug.png` });
  await ctx.close();
}

writeFileSync(`${out}/messwerte.json`, JSON.stringify(log, null, 1));
console.log(JSON.stringify(log.map((l) => (l.sprung ? { s: l.szenario, drift: l.driftBilder, grad: l.maxSchlupfGrad, ...l.sprung } : l.szenario)), null, 0));
await browser.close();
