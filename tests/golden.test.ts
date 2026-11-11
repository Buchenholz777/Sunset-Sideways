import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { Sim } from '../src/sim/sim';
import { botInput } from './helpers/bot';

/**
 * Golden-Vergleich des Fahrkerns (V01/V08): gleicher Seed + gleiche Eingabe ⇒ gleiche Abfolge,
 * Position und Wirkung spielrelevanter Objekte. Die Datei wurde VOR dem Grafikupdate erzeugt.
 */
const FILE = new URL('./golden.json', import.meta.url);

function snapshot(seed: number) {
  const s = new Sim(seed);
  const cache = { target: null as number | null };
  const out: (string | number)[][] = [];
  for (let i = 0; i < 120 * 90; i++) {
    s.step(B.dt, botInput(s, i, cache));
    if (i % 600 === 0 || s.crashed) {
      const sig = s.obstacles.map((o) => `${o.kind}:${o.x.toFixed(2)}:${o.z.toFixed(2)}${o.hit ? 'h' : ''}`).join('|');
      let h = 0;
      for (const ch of sig) h = (h * 31 + ch.charCodeAt(0)) | 0;
      out.push([i, s.t.toFixed(4), s.s.toFixed(3), s.x.toFixed(3), s.obstacles.length, s.pickups.length, s.shieldT.toFixed(3), h]);
    }
    if (s.crashed) break;
  }
  return out;
}

describe('Fahrkern unverändert (Golden)', () => {
  const seeds = [1, 12, 42, 777, 2024];
  it('Seeds liefern identische Abfolgen', () => {
    const now = Object.fromEntries(seeds.map((sd) => [sd, snapshot(sd)]));
    if (!existsSync(FILE)) { writeFileSync(FILE, JSON.stringify(now)); return; }
    expect(now).toEqual(JSON.parse(readFileSync(FILE, 'utf8')));
  });
});
