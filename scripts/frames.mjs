// Bildfolgen für die Abnahme (nutzt die versteckten Test-Parameter ?qa=1&startS=&startT=&turbo=1).
// Nutzung: node scripts/frames.mjs <basisURL> <ausgabeordner>
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const log = [];

async function open(viewport, q, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  await page.goto(`${base}/?qa=1&${q.includes('seed=') ? '' : 'seed=12&'}${q}`);
  await page.waitForTimeout(300);
  if (touch) await page.locator('#btn-start').tap(); else await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__qa.pause());
  await page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
  return { ctx, page };
}

// 1) Streckenabschnitte (Desktop + Hochformat)
for (const [name, vp, touch] of [['desktop', { width: 1366, height: 768 }, false], ['hoch390', { width: 390, height: 844 }, true]]) {
  for (const [lab, s, t] of [['0m', 0, 0], ['250m', 260, 8], ['800m', 820, 22], ['1600m', 1650, 45]]) {
    const { ctx, page } = await open(vp, `startS=${s}&startT=${t}`, touch);
    await page.evaluate(() => window.__qa.advance(0.05));
    await page.screenshot({ path: `${out}/abschnitt-${name}-${lab}.png` });
    await ctx.close();
  }
}

// 2) Vorwarnzeit: strengster Fall (320x568, 384 km/h mit Turbo), Bildfolge bis zum Kontakt
{
  const { ctx, page } = await open({ width: 320, height: 568 }, 'startT=3000&turbo=1', true);
  const st0 = await page.evaluate(() => window.__qa.state());
  const first = st0.obstacles[0];
  let rows = [];
  for (let i = 0; i < 14; i++) {
    const st = await page.evaluate(() => window.__qa.state());
    const o = st.obstacles[0];
    if (!o || st.crashed) break;
    const ttc = (o.z - st.s) / (st.v / 3.6 - o.vz);
    rows.push({ frame: i, ttc: +ttc.toFixed(2), dist: +(o.z - st.s).toFixed(1), kmh: Math.round(st.v) });
    await page.screenshot({ path: `${out}/warnung-hoch320-${String(i).padStart(2, '0')}-ttc${ttc.toFixed(2)}.png` });
    await page.evaluate(() => window.__qa.advance(0.2, 3.6));
  }
  log.push({ szenario: 'Vorwarnung 320x568, 384 km/h', erstesObjekt: first, frames: rows });
  await ctx.close();
}

// 3) Pickup und Hindernis gleichzeitig sichtbar, schnell (Hochformat und Desktop); einfacher Ausweichfahrer
for (const [name, vp, touch] of [['hoch390', { width: 390, height: 844 }, true], ['desktop', { width: 1366, height: 768 }, false]]) {
  const { ctx, page } = await open(vp, 'startT=400&turbo=1', touch);
  let shot = 0;
  for (let i = 0; i < 400 && shot < 3; i++) {
    const st = await page.evaluate(() => window.__qa.state());
    if (st.crashed) break;
    const pk = st.pickups.find((p) => p.z > st.s);
    const ob = st.obstacles.filter((o) => o.z - st.s < 160);
    if (pk && st.obstacles.some((o) => o.z > st.s && o.z - st.s < 330) && pk.z - st.s < 220 && pk.z - st.s > 40) {
      await page.screenshot({ path: `${out}/pickup-hindernis-${name}-${shot++}-${pk.type}.png` });
      await page.evaluate(() => window.__qa.advance(0.35, null));
      continue;
    }
    const lanes = [-3.6, 0, 3.6];
    const free = lanes.filter((x) => ob.every((o) => Math.abs(o.x - x) > 2.3));
    const tx = (free.length ? free.sort((a, b) => Math.abs(a - st.x) - Math.abs(b - st.x))[0] : 0);
    await page.evaluate((x) => window.__qa.advance(0.05, x), tx);
  }
  await ctx.close();
}

// 4) Mond und Flugzeug: Szenenzeit direkt vorgeben
for (const [name, vp, touch] of [['desktop', { width: 1366, height: 768 }, false], ['hoch390', { width: 390, height: 844 }, true]]) {
  const { ctx, page } = await open(vp, 'startS=0', touch);
  for (const t of [0, 10, 60, 180, 600]) {
    await page.evaluate((tt) => window.__qa.scene(tt), t);
    await page.screenshot({ path: `${out}/mond-${name}-t${String(t).padStart(3, '0')}.png` });
  }
  const plan = await page.evaluate(() => { const r = []; return r; });
  void plan;
  await ctx.close();
}
// 5) Heck: Normalfahrt, Turbo, Bremslicht nach Turbo-Ende, Schild
{
  const { ctx, page } = await open({ width: 1366, height: 768 }, 'startT=100', false);
  await page.evaluate(() => window.__qa.advance(0.3, 0));
  await page.screenshot({ path: `${out}/heck-1-normal.png`, clip: { x: 383, y: 420, width: 600, height: 348 } });
  await page.evaluate(() => window.__qa.give(3, 10));
  await page.evaluate(() => window.__qa.advance(1.0, 0));
  await page.screenshot({ path: `${out}/heck-2-turbo-schild.png`, clip: { x: 383, y: 420, width: 600, height: 348 } });
  await page.evaluate(() => window.__qa.advance(2.05, 0));
  await page.evaluate(() => window.__qa.advance(0.05, 0));
  await page.screenshot({ path: `${out}/heck-3-bremslicht.png`, clip: { x: 383, y: 420, width: 600, height: 348 } });
  await ctx.close();
}

// 6) Handbremsdrift in beiden Richtungen: Tastatur (Leertaste + Pfeil) und Touch (DRIFT + Ziehen)
const seedFor = {};
for (let sd = 1; sd < 12 && Object.keys(seedFor).length < 2; sd++) {
  const { ctx, page } = await open({ width: 800, height: 450 }, `seed=${sd}&startS=330&startT=8`, false);
  const k = (await page.evaluate(() => window.__qa.state())).k;
  if (!seedFor[Math.sign(k)]) seedFor[Math.sign(k)] = sd;
  await ctx.close();
}
for (const dirName of ['rechts', 'links']) {
  const sd = seedFor[dirName === 'rechts' ? 1 : -1];
  for (const [name, vp, touch, mode] of [['desktop', { width: 1366, height: 768 }, false, 'taste'], ['hoch390', { width: 390, height: 844 }, true, 'touch']]) {
    const { ctx, page } = await open(vp, `seed=${sd}&startS=330&startT=8`, touch);
    await page.evaluate(() => window.__qa.give(0, 20));
    const sgn = Math.sign((await page.evaluate(() => window.__qa.state())).k) || 1;
    const frames = [];
    const vBefore = (await page.evaluate(() => window.__qa.state())).v;
    for (let i = 0; i < 10; i++) {
      const args = mode === 'taste' ? [0.12, null, sgn, 0, 0, true] : [0.12, null, 0, sgn, 1, true];
      if (mode === 'touch') args[1] = (await page.evaluate(() => window.__qa.state())).x;
      await page.evaluate((a) => window.__qa.advance(...a), args);
      const st = await page.evaluate(() => window.__qa.state());
      frames.push({ t: +(0.12 * (i + 1)).toFixed(2), drifting: st.drifting, slipM: +st.slip.toFixed(2), winkelGrad: +st.ang.toFixed(1), kmh: Math.round(st.v) });
      if (i === 4 || i === 8) await page.screenshot({ path: `${out}/drift-${dirName}-${name}-${i}.png` });
    }
    for (let i = 0; i < 6; i++) await page.evaluate(() => window.__qa.advance(0.12, null, 0, 0, 0, false));
    const end = await page.evaluate(() => window.__qa.state());
    await page.screenshot({ path: `${out}/drift-${dirName}-${name}-ende.png` });
    log.push({ szenario: `Handbremsdrift ${dirName} ${name}`, seed: sd, kmhVorher: Math.round(vBefore), frames, nachLoslassen: { drifting: end.drifting, slipM: +end.slip.toFixed(3), winkel: +end.ang.toFixed(2) } });
    await ctx.close();
  }
}

// 7) Vier Pickups im Bild, Hochformat und Graustufen-Vergleich (CSS-Filter)
{
  const { ctx, page } = await open({ width: 390, height: 844 }, 'startT=20', true);
  await page.evaluate(() => window.__qa.give(0, 30));
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => window.__qa.state());
    if (st.pickups.length >= 1 && st.pickups[0].z - st.s < 120 && st.pickups[0].z - st.s > 50) break;
    await page.evaluate(() => window.__qa.advance(0.3, null));
  }
  await page.screenshot({ path: `${out}/pickups-farbe.png` });
  await page.addStyleTag({ content: '#stage{filter:grayscale(1)}' });
  await page.screenshot({ path: `${out}/pickups-grau.png` });
  await ctx.close();
}

// 10) Lichtphasen nach Distanz (Desktop + Hochformat), Hindernis im Abendlicht
for (const [name, vp, touch] of [['desktop', { width: 1366, height: 768 }, false], ['hoch390', { width: 390, height: 844 }, true]]) {
  for (const [lab, s, tt] of [['0000m', 40, 0], ['0500m', 500, 12], ['1050m', 1050, 28], ['1400m', 1400, 36], ['2100m', 2100, 50], ['2800m', 2800, 70], ['3600m', 3600, 90]]) {
    const { ctx, page } = await open(vp, `startS=${s}&startT=${tt}`, touch);
    await page.evaluate(() => window.__qa.advance(0.05));
    await page.screenshot({ path: `${out}/licht-${name}-${lab}.png` });
    await ctx.close();
  }
}

// 9) Kurvengrip: dieselbe Drift-Eingabe einmal ohne und einmal mit Effekt
{
  const res = {};
  for (const grip of [0, 8]) {
    const { ctx, page } = await open({ width: 1366, height: 768 }, 'startS=330&startT=8', false);
    await page.evaluate((g) => window.__qa.give(0, 30, g, 0), grip);
    const sgn = Math.sign((await page.evaluate(() => window.__qa.state())).k) || 1;
    let maxSlip = 0;
    for (let i = 0; i < 6; i++) { await page.evaluate((d) => window.__qa.advance(0.1, null, d, 0, 0, true), sgn); maxSlip = Math.max(maxSlip, Math.abs((await page.evaluate(() => window.__qa.state())).slip)); }
    const out0 = [];
    for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__qa.advance(0.05, null, 0)); out0.push(+Math.abs((await page.evaluate(() => window.__qa.state())).slip).toFixed(3)); }
    res[grip ? 'mitGrip' : 'ohneGrip'] = { maxSchlupfM: +maxSlip.toFixed(3), schlupfNachLoslassenM: out0 };
    await ctx.close();
  }
  log.push({ szenario: 'Kurvengrip gleiche Drift-Eingabe', ...res });
}

// 8) Ruhiger Horizont: schnelle Links-rechts-Wechsel auf der Geraden dürfen Himmel/Skyline nicht verschieben
{
  const { ctx, page } = await open({ width: 1366, height: 768 }, 'startS=420&startT=12', false);
  await page.evaluate(() => window.__qa.give(0, 60));
  const grab = () => page.evaluate(() => {
    const c = document.getElementById('stage'); const g = c.getContext('2d');
    const hy = Math.floor(c.height * 0.34);
    // Horizontband (ferne Skyline/Berge), mittlere 50 % der Breite; nahe Straßenrand-Kulisse liegt außerhalb
    return Array.from(g.getImageData(Math.floor(c.width * 0.25), Math.floor(hy * 0.62), Math.floor(c.width * 0.5), Math.floor(hy * 0.38) - 3).data);
  });
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++; return +(100 * n / (a.length / 4)).toFixed(2); };
  await page.evaluate(() => window.__qa.advance(0.5, -3.6));
  await page.evaluate(() => window.__qa.advance(0.02, -3.6));
  const a = await grab();
  await page.evaluate(() => window.__qa.advance(0.5, 3.6));
  await page.evaluate(() => window.__qa.advance(0.02, 3.6));
  const b = await grab();
  await page.evaluate(() => window.__qa.advance(0.5, 3.6));
  await page.evaluate(() => window.__qa.advance(0.02, 3.6));
  const c2 = await grab();
  const st = await page.evaluate(() => window.__qa.state());
  log.push({ szenario: 'Ruhiger Horizont: Spurwechsel links→rechts auf der Geraden (Horizontband mittlere 50 %, Prozent geänderter Pixel)', geaendertProzentMitSpurwechsel: diff(a, b), geaendertProzentKontrolleOhneSpurwechsel: diff(b, c2), sNachher: +st.s.toFixed(0), anmerkung: 'Ausgangsfehler waren querfliegende Kulisse; hier verschiebt nur der Fahrweg (≈ 30 m) die Skyline-Höhe schrittweise' });
  await ctx.close();
}

writeFileSync(`${out}/messwerte.json`, JSON.stringify(log, null, 1));
console.log(JSON.stringify(log, null, 1));
await browser.close();
