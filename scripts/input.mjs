// Eingabe-Regression (S03/S04): Bedienhinweis, Tastatur (Pfeile, Leertaste, E) und Mehrfinger-Touch
// (analoges Lenken, DRIFT-Taste, NITRO-Taste) im Browser. Nutzung: npm run preview (Port 4173), dann: node scripts/input.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.URL ?? 'http://localhost:4173/?seed=12&qa=1&startS=20&startT=0&ghost=1';
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(ok ? 'OK  ' : 'FAIL', name, info); };
const inp = (page) => page.evaluate(() => window.__qa.input());
const st = (page) => page.evaluate(() => window.__qa.state());

async function open(viewport, touch, wait = 2000) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(300);
  if (touch) await page.locator('#btn-start').tap(); else await page.keyboard.press('Enter');
  await page.waitForTimeout(wait);                        // Bedienhinweis (1,7 s) läuft ohne Bestätigung ab
  return { ctx, page, cdp: await ctx.newCDPSession(page) };
}

// ---------------- Bedienhinweis ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const brief = await page.locator('#screen-brief').isVisible();
  const text = (await page.locator('#screen-brief').innerText()).replace(/\s+/g, ' ');
  const s0 = await st(page);
  await page.waitForTimeout(900);
  const s1 = await st(page);
  check('Hinweis vor dem ersten Start sichtbar (Desktop-Text)', brief && /Lenken/.test(text) && /Leertaste/.test(text) && /E · Nitro/.test(text) && /Driften lädt Nitro\./.test(text), text);
  check('während des Hinweises steht die Simulation still', s0.t === s1.t && s0.s === s1.s);
  await page.waitForTimeout(1200);
  check('danach beginnt die Fahrt automatisch', !(await page.locator('#screen-brief').isVisible()) && (await st(page)).s > s1.s);
  // Neustart per Pause-Menü: Hinweis erscheint erneut
  await page.keyboard.press('Escape');
  await page.locator('#btn-restart').click();
  await page.waitForTimeout(200);
  check('Hinweis vor jedem Neustart', await page.locator('#screen-brief').isVisible());
  await ctx.close();
}

// ---------------- Tastatur ----------------
{
  const { ctx, page } = await open({ width: 1366, height: 768 }, false);
  await page.keyboard.down('Space'); await page.waitForTimeout(80);
  check('Leertaste im Lauf: Handbremse an', (await inp(page)).brake === true);
  await page.keyboard.up('Space'); await page.waitForTimeout(50);
  check('Loslassen: Handbremse aus', (await inp(page)).brake === false);
  const n0 = (await inp(page)).nitroSeq;
  await page.keyboard.down('KeyE');
  for (let i = 0; i < 5; i++) { await page.keyboard.press('KeyE'); }
  await page.waitForTimeout(60);
  await page.keyboard.up('KeyE');
  // down + 5×press (press = down+up) ⇒ 6 frische Drücker, nicht mehr
  const n1 = (await inp(page)).nitroSeq;
  check('E: jeder frische Tastendruck zählt einmal', n1 - n0 >= 1 && n1 - n0 <= 6, `+${n1 - n0}`);
  await page.keyboard.down('KeyE'); await page.waitForTimeout(40);
  const n2 = (await inp(page)).nitroSeq;
  await page.keyboard.down('KeyE'); await page.keyboard.down('KeyE'); await page.waitForTimeout(60);
  check('gehaltenes E (Tastaturwiederholung) löst nichts erneut aus', (await inp(page)).nitroSeq === n2);
  await page.keyboard.up('KeyE');
  await ctx.close();
}
{
  // Leertaste/E schon beim Start gehalten: zählt erst nach Loslassen und neuem Drücken
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(300);
  await page.keyboard.down('Space');
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(2200);
  const s = await inp(page);
  check('beim Start gehaltene Leertaste/E lösen nichts aus', s.brake === false && s.nitroSeq === 0);
  await page.keyboard.up('Space'); await page.keyboard.up('KeyE');
  await page.keyboard.down('Space'); await page.keyboard.press('KeyE'); await page.waitForTimeout(80);
  const s2 = await inp(page);
  check('nach Loslassen und neuem Drücken zählen beide', s2.brake === true && s2.nitroSeq === 1);
  await page.keyboard.up('Space');
  await ctx.close();
}
{
  const { ctx, page } = await open({ width: 1366, height: 768 }, false);
  await page.locator('#btn-sound').focus();
  const before = await page.locator('#btn-sound').getAttribute('aria-pressed');
  await page.keyboard.down('Space'); await page.waitForTimeout(60);
  const braking = (await inp(page)).brake;
  await page.keyboard.up('Space');
  check('fokussierter Ton-Button: Leertaste bedient den Button, keine Handbremse', braking === false && before !== (await page.locator('#btn-sound').getAttribute('aria-pressed')));
  await ctx.close();
}

// ---------------- Touch ----------------
const overlap = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
for (const [label, vp] of [['390×844 Hochformat', { width: 390, height: 844 }], ['844×390 Querformat', { width: 844, height: 390 }], ['320×568 klein', { width: 320, height: 568 }]]) {
  const { ctx, page, cdp } = await open(vp, true);
  const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const bd = await page.locator('#btn-drift').boundingBox(), bn = await page.locator('#btn-nitro').boundingBox();
  const pb = await page.locator('#btn-pause').boundingBox(), sb = await page.locator('#btn-sound').boundingBox();
  const cv = await page.locator('#stage').boundingBox();
  const inView = (b) => b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height;
  check(`${label}: DRIFT- und NITRO-Taste sichtbar, ≥ 64 × 64 px, im Bild`, bd && bn && bd.width >= 64 && bd.height >= 64 && bn.width >= 64 && bn.height >= 64 && inView(bd) && inView(bn), `${Math.round(bd.width)}×${Math.round(bd.height)}`);
  check(`${label}: Tasten verdecken weder Pause noch Ton noch einander`, !overlap(bd, pb) && !overlap(bd, sb) && !overlap(bn, pb) && !overlap(bn, sb) && !overlap(bd, bn));
  const dx = bd.x + bd.width / 2, dy = bd.y + bd.height / 2, nx = bn.x + bn.width / 2, ny = bn.y + bn.height / 2;
  const cx = cv.x + cv.width / 2, sy = cv.y + cv.height * 0.55;

  // analoges Lenken: relative Bezugsposition, Totzone, Halten, Gegenlenken, neutral beim Loslassen
  await tp('touchStart', [{ x: cx, y: sy, id: 1 }]); await page.waitForTimeout(40);
  let s = await inp(page);
  check(`${label}: Aufsetzen setzt nur den Bezugspunkt (Ausschlag 0)`, s.analog === 0);
  await tp('touchMove', [{ x: cx + 3, y: sy, id: 1 }]); await page.waitForTimeout(30);
  check(`${label}: Totzone`, (await inp(page)).analog === 0);
  await tp('touchMove', [{ x: cx + 40, y: sy, id: 1 }]); await page.waitForTimeout(30);
  const a1 = (await inp(page)).analog;
  await page.waitForTimeout(150);
  check(`${label}: seitlicher Zug = analoger Ausschlag, Halten hält ihn`, a1 > 0.2 && (await inp(page)).analog === a1, `analog ${a1?.toFixed(2)}`);
  await tp('touchMove', [{ x: cx, y: sy - 80, id: 1 }]); await page.waitForTimeout(30);
  check(`${label}: zurück zur Mitte = neutral (vertikale Bewegung zählt nicht)`, (await inp(page)).analog === 0);
  await tp('touchMove', [{ x: cx - 40, y: sy, id: 1 }]); await page.waitForTimeout(30);
  check(`${label}: über die Mitte hinaus wirkt das Gegenlenken`, (await inp(page)).analog < -0.2);
  await tp('touchEnd', []); await page.waitForTimeout(40);
  check(`${label}: Loslassen setzt die Eingabe auf neutral`, (await inp(page)).analog === null);

  // zwei Daumen, beide Reihenfolgen
  await tp('touchStart', [{ x: dx, y: dy, id: 2 }]); await page.waitForTimeout(40);
  check(`${label}: DRIFT-Taste = Handbremse`, (await inp(page)).brake === true);
  await tp('touchStart', [{ x: dx, y: dy, id: 2 }, { x: cx, y: sy, id: 3 }]);
  for (let i = 1; i <= 5; i++) { await tp('touchMove', [{ x: dx, y: dy, id: 2 }, { x: cx + i * 12, y: sy, id: 3 }]); await page.waitForTimeout(20); }
  s = await inp(page);
  check(`${label}: zwei Daumen (Taste zuerst): Taste hält, zweiter Finger lenkt`, s.brake === true && s.analog > 0.2);
  await tp('touchEnd', [{ x: dx, y: dy, id: 2 }]); await page.waitForTimeout(40);
  s = await inp(page);
  check(`${label}: Taste loslassen beendet nur die Handbremse, Lenkfinger bleibt`, s.brake === false && s.analog > 0.2);
  await tp('touchEnd', []); await page.waitForTimeout(40);
  await tp('touchStart', [{ x: cx, y: sy, id: 4 }]);
  await tp('touchMove', [{ x: cx + 50, y: sy, id: 4 }]);
  await tp('touchStart', [{ x: cx + 50, y: sy, id: 4 }, { x: dx, y: dy, id: 5 }]); await page.waitForTimeout(40);
  s = await inp(page);
  check(`${label}: zwei Daumen (Lenkfinger zuerst): beide Rollen aktiv`, s.brake === true && s.analog > 0.2);

  // NITRO-Tipp unterbricht den lenkenden Finger nicht
  const n0 = s.nitroSeq;
  await tp('touchStart', [{ x: cx + 50, y: sy, id: 4 }, { x: dx, y: dy, id: 5 }, { x: nx, y: ny, id: 6 }]); await page.waitForTimeout(30);
  await tp('touchEnd', [{ x: nx, y: ny, id: 6 }]); await page.waitForTimeout(40);
  s = await inp(page);
  check(`${label}: NITRO-Tipp zählt einmal, Lenkung und Handbremse laufen weiter`, s.nitroSeq === n0 + 1 && s.analog > 0.2 && s.brake === true);
  await tp('touchCancel', []); await page.waitForTimeout(40);
  s = await inp(page);
  check(`${label}: Abbruch (touchcancel) löscht Lenkung und Handbremse`, s.brake === false && s.analog === null);

  // Ein-Daumen: Taste lenkt relativ mit, Ziehen aus der Taste bleibt erfasst, Nitro-Tipp danach ohne Sprung
  await tp('touchStart', [{ x: dx, y: dy, id: 7 }]); await page.waitForTimeout(40);
  s = await inp(page);
  check(`${label}: Ein-Daumen: Start ohne Lenksprung (Ausschlag 0, Handbremse an)`, s.brake === true && s.analog === 0);
  for (let i = 1; i <= 8; i++) { await tp('touchMove', [{ x: dx - i * 10, y: dy, id: 7 }]); await page.waitForTimeout(20); }
  s = await inp(page);
  check(`${label}: Ein-Daumen: Ziehen lenkt (auch außerhalb der Taste)`, s.brake === true && s.analog < -0.2, `analog ${s.analog?.toFixed(2)}`);
  await tp('touchEnd', []); await page.waitForTimeout(40);
  await tp('touchStart', [{ x: nx, y: ny, id: 8 }]); await page.waitForTimeout(30); await tp('touchEnd', []); await page.waitForTimeout(30);
  await tp('touchStart', [{ x: cx, y: sy, id: 9 }]); await page.waitForTimeout(40);
  check(`${label}: nach einhändigem Nitro-Tipp setzt die Lenkung ohne Sprung wieder ein`, (await inp(page)).analog === 0);
  await tp('touchEnd', []);

  // Übergabe von der Taste an einen Lenkfinger ohne Sprung
  await tp('touchStart', [{ x: dx, y: dy, id: 10 }]);
  for (let i = 1; i <= 5; i++) { await tp('touchMove', [{ x: dx + i * 8, y: dy, id: 10 }]); await page.waitForTimeout(15); }
  await tp('touchStart', [{ x: dx + 40, y: dy, id: 10 }, { x: cx, y: sy, id: 11 }]); await page.waitForTimeout(40);
  s = await inp(page);
  check(`${label}: Lenkfinger übernimmt von der Taste mit neuer Bezugsposition, Taste bleibt Handbremse`, s.analog === 0 && s.brake === true);
  await tp('touchCancel', []);

  // Pause räumt alles auf
  await tp('touchStart', [{ x: dx, y: dy, id: 12 }]);
  await page.locator('#btn-pause').click({ force: true }); await page.waitForTimeout(60);
  s = await inp(page);
  check(`${label}: Pause löscht Handbremse und Lenkung`, s.brake === false && s.analog === null);
  await tp('touchEnd', []);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
