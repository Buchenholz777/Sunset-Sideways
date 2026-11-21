// Streckenereignisse im echten Spiel: Einfahrt/Ausfahrt nach Distanz, Bildfolge, Konsolenfehler. Chrome headless (Emulation).
// node scripts/route_e2e.mjs http://localhost:4173 [seed]
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:4173', SEED = process.argv[3] ?? '12';
const b = await chromium.launch({ channel: 'chrome' });
const CASES = [['Tunnel 1 Einfahrt', 9_800, 10_200, 10_000], ['Tunnel 1 Ausfahrt', 12_300, 12_700, 12_500], ['Casino Einfahrt', 21_500, 21_900, 21_699], ['Casino Ausfahrt', 22_500, 22_900, 22_659]];
let bad = 0;
for (const fps of [30, 60, 120]) for (const [name, s0, s1, edge] of CASES) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${BASE}/?qa=1&consent=1&seed=${SEED}&startS=${s0}&ghost=1`); await p.waitForTimeout(300);
  await p.evaluate(() => document.getElementById('btn-start').click()); await p.waitForTimeout(150);
  const rows = await p.evaluate(async ([fps, s1]) => {
    const out = []; let guard = 0;
    while (guard++ < 2000) { window.__qa.advance(1 / fps, 0); const r = window.__qa.route(); out.push([r.s, r.kind, r.k]); if (r.s >= s1) break; }
    return out;
  }, [fps, s1]);
  const inside = rows.filter((r) => r[1] && r[2] >= 1 - 1e-9).length, kinds = new Set(rows.map((r) => r[1]));
  const monotone = rows.every((r, i) => i === 0 || Math.abs(r[2] - rows[i - 1][2]) < 0.25);
  const first = rows.find((r) => r[1] && r[2] > 0.01), last = rows[rows.length - 1];
  const ok = errs.length === 0 && monotone && kinds.size >= 2;
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'FEHLER'} ${String(fps).padStart(3)} fps · ${name}: Strecke ${rows[0][0].toFixed(0)}→${last[0].toFixed(0)} m, Übergang ab ${first ? first[0].toFixed(0) : '-'} m (Kante ${edge}), Bilder voll ${inside}, größter Sprung ${Math.max(...rows.map((r, i) => i ? Math.abs(r[2] - rows[i - 1][2]) : 0)).toFixed(3)}${errs.length ? ' · ' + errs[0] : ''}`);
  await ctx.close();
}
await b.close();
console.log(bad ? `${bad} Fehlerfälle` : 'alle bestanden');
process.exit(bad ? 1 : 0);
