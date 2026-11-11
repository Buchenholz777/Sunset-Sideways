// Startbildschirm in echten Browser-Aktionen prüfen (Klick, Tipp, Wisch, Tasten, Moduswechsel, reduzierte Bewegung, Geometrie).
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
const note = (n, ok, info = '') => { results.push(ok); console.log(ok ? 'OK  ' : 'FAIL', n, info); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phase = (page) => page.evaluate(() => (document.getElementById('screen-start').hidden ? 'running' : 'start'));
async function fresh(vp, touch, opts = {}) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?seed=12`);
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

// ---- Desktop: Startaktionen
{
  let { ctx, page, errors } = await fresh({ width: 1366, height: 768 }, false);
  const mode = await page.locator('#howto').getAttribute('data-mode');
  const txt = await page.locator('#controls-line').textContent();
  note('Desktop: Tastenerklärung sofort da', mode === 'keys' && txt === 'Mit den Pfeiltasten lenken', `${mode} · „${txt}“`);
  const a1 = await page.evaluate(() => getComputedStyle(document.querySelector('.hw-car')).animationName);
  const k1 = await page.evaluate(() => getComputedStyle(document.querySelector('.k-l')).backgroundImage + getComputedStyle(document.querySelector('.k-l')).transform);
  await sleep(800);
  const k2 = await page.evaluate(() => getComputedStyle(document.querySelector('.k-l')).backgroundImage + getComputedStyle(document.querySelector('.k-l')).transform);
  const k3 = await page.evaluate(() => getComputedStyle(document.querySelector('.k-r')).backgroundImage);
  await sleep(1800);
  const k4 = await page.evaluate(() => getComputedStyle(document.querySelector('.k-r')).backgroundImage);
  note('Desktop: Tastenkappen leuchten nacheinander, Auto animiert', a1 !== 'none' && k1 !== k2 && k3 !== k4, `Animation ${a1}`);
  await page.locator('.logo').click(); await page.locator('#howto').click(); await page.locator('#screen-start .best').click();
  await page.mouse.click(300, 400);
  await sleep(300);
  note('Desktop: Klick auf Titel, Erklärung, Bestweite und freie Fläche startet keinen Lauf', (await phase(page)) === 'start');
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => { const b = document.getElementById('btn-start'); b.focus(); b.matches(':focus-visible'); return getComputedStyle(b).outlineStyle; });
  await page.keyboard.press('Enter'); await sleep(300);
  note('Desktop: Enter startet die Fahrt', (await phase(page)) === 'running', `Fokus-Outline: ${focus}`);
  await ctx.close();
  ({ ctx, page } = await fresh({ width: 1366, height: 768 }, false));
  await page.keyboard.press('Space'); await sleep(300);
  note('Desktop: Leertaste startet die Fahrt', (await phase(page)) === 'running');
  await ctx.close();
  ({ ctx, page } = await fresh({ width: 1366, height: 768 }, false));
  await page.locator('#btn-start').click(); await sleep(300);
  note('Desktop: Klick auf „Fahren“ startet die Fahrt', (await phase(page)) === 'running');
  await ctx.close();
  note('Desktop: keine Konsolenfehler', errors.length === 0, errors.join('|'));
}

// ---- Smartphone: Tipp, Wisch, Start
{
  let { ctx, page, errors } = await fresh({ width: 390, height: 844 }, true);
  const mode = await page.locator('#howto').getAttribute('data-mode');
  const txt = await page.locator('#controls-line').textContent();
  note('Smartphone: Daumen-Erklärung sofort da', mode === 'touch' && txt === 'Mit dem Daumen nach links oder rechts ziehen', `${mode} · „${txt}“`);
  const thumbAnim = await page.evaluate(() => getComputedStyle(document.querySelector('.hw-thumb')).animationName);
  const t1 = await page.evaluate(() => getComputedStyle(document.querySelector('.hw-thumb')).transform);
  await sleep(1100);
  const t2 = await page.evaluate(() => getComputedStyle(document.querySelector('.hw-thumb')).transform);
  note('Smartphone: Daumen und Auto bewegen sich', thumbAnim !== 'none' && t1 !== t2);
  const cdp = await ctx.newCDPSession(page);
  const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const hb = await page.locator('#howto').boundingBox();
  await page.locator('.logo').tap(); await page.locator('#howto').tap();
  await tp('touchStart', [{ x: hb.x + 20, y: hb.y + hb.height / 2, id: 1 }]);
  for (let i = 1; i <= 6; i++) await tp('touchMove', [{ x: hb.x + 20 + i * 40, y: hb.y + hb.height / 2, id: 1 }]);
  await tp('touchEnd', []);
  await sleep(300);
  note('Smartphone: Tipp auf Titel/Erklärung und Wisch über die Erklärung starten keinen Lauf', (await phase(page)) === 'start');
  await page.locator('#btn-start').tap(); await sleep(300);
  note('Smartphone: Tipp auf „Fahren“ startet die Fahrt', (await phase(page)) === 'running');
  note('Smartphone: keine Konsolenfehler', errors.length === 0, errors.join('|'));
  await ctx.close();
}

// ---- Hybrid: Moduswechsel erhält Grafik, aktualisiert Text und Darstellung
{
  const { ctx, page } = await fresh({ width: 1366, height: 768 }, true);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })));
  await sleep(100);
  const m1 = await page.evaluate(() => [document.getElementById('howto').dataset.mode, document.getElementById('controls-line').textContent, getComputedStyle(document.querySelector('.hw-touch')).display, getComputedStyle(document.querySelector('.hw-keys')).display]);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true })));
  await sleep(100);
  const m2 = await page.evaluate(() => [document.getElementById('howto').dataset.mode, document.getElementById('controls-line').textContent, getComputedStyle(document.querySelector('.hw-touch')).display, getComputedStyle(document.querySelector('.hw-keys')).display]);
  note('Hybrid: Berührung → Daumen-Grafik und -Text, Taste → Tastenkappen und -Text', m1[0] === 'touch' && m1[2] !== 'none' && m1[3] === 'none' && m2[0] === 'keys' && m2[2] === 'none' && m2[3] !== 'none', JSON.stringify([m1[1], m2[1]]));
  await ctx.close();
}

// ---- Reduzierte Bewegung
{
  const { ctx, page } = await fresh({ width: 1366, height: 768 }, false, { reducedMotion: 'reduce' });
  const r = await page.evaluate(() => ({ car: getComputedStyle(document.querySelector('.hw-car')).animationName, kl: getComputedStyle(document.querySelector('.k-l')).animationName, bg: getComputedStyle(document.querySelector('.k-r')).backgroundImage, vis: document.querySelector('.hw-keys').getBoundingClientRect().width > 0 }));
  note('Reduzierte Bewegung: statische, verständliche Tastengrafik (keine Animation)', r.car === 'none' && r.kl === 'none' && r.vis && r.bg.includes('gradient'));
  await page.screenshot({ path: process.argv[3] ? `${process.argv[3]}/start-reduziert.png` : 'start-reduziert.png' });
  await ctx.close();
}

// ---- Geometrie in vier Formaten und beiden Moduswerten
for (const [name, w, h, touch] of [['1366×768', 1366, 768, false], ['320×568', 320, 568, true], ['390×844', 390, 844, true], ['844×390', 844, 390, true]]) {
  for (const mode of ['keys', 'touch']) {
    const { ctx, page } = await fresh({ width: w, height: h }, touch);
    await page.evaluate((m) => window.dispatchEvent(m === 'keys' ? new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true }) : new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })), mode);
    await sleep(200);
    const g = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const l1 = r('.logo .l1'), l2 = r('.logo .l2'), btn = r('#btn-start'), how = r('#howto'), snd = r('#btn-sound');
      const inside = (b) => b.left >= -0.5 && b.right <= innerWidth + 0.5 && b.top >= -0.5 && b.bottom <= innerHeight + 0.5;
      const hit = document.elementFromPoint(btn.left + btn.width / 2, btn.top + btn.height / 2)?.id;
      return { l1: inside(l1), l2: inside(l2), btn: inside(btn), how: inside(how), hit, howBottom: how.bottom, howRight: how.right, btnH: btn.height, overlapSnd: !(l1.right < snd.left || l1.left > snd.right || l1.bottom < snd.top || l1.top > snd.bottom), fs: parseFloat(getComputedStyle(document.querySelector('.logo')).fontSize) };
    });
    const landscapeShort = w > h && h <= 520;
    const carClear = landscapeShort ? g.howRight <= 0.46 * w : g.howBottom <= 0.665 * h;
    note(`${name} ${mode}: Titel vollständig, Button erreichbar (${Math.round(g.btnH)} px), Lenkhilfe sichtbar, Wagen frei, Titel ${Math.round(g.fs)} px`, g.l1 && g.l2 && g.btn && g.how && g.hit === 'btn-start' && g.btnH >= 44 && carClear && !g.overlapSnd, JSON.stringify({ hit: g.hit, howBottom: Math.round(g.howBottom), carClear, overlapSnd: g.overlapSnd }));
    await ctx.close();
  }
}
await browser.close();
const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad}/${results.length} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
