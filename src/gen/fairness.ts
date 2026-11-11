import { BALANCE as B } from '../config/balance';
import { steerAt } from '../core/speed';

export type Interval = [number, number];
/** Zeitfenster (als Strecke des Spielers) in dem ein Hindernis den Querbereich [l, r] sperrt. */
export interface Gate { sa: number; sb: number; l: number; r: number }

export const XM = B.player.maxX;
const MIN_WIDTH = 0.25;

function normalize(iv: Interval[]): Interval[] {
  const s = iv.filter((i) => i[1] - i[0] >= MIN_WIDTH).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const i of s) {
    const last = out[out.length - 1];
    if (last && i[0] <= last[1]) last[1] = Math.max(last[1], i[1]);
    else out.push([i[0], i[1]]);
  }
  return out;
}

export function expand(reach: Interval[], d: number): Interval[] {
  return normalize(reach.map(([a, b]) => [Math.max(-XM, a - d), Math.min(XM, b + d)] as Interval));
}

export function subtract(reach: Interval[], l: number, r: number): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of reach) {
    if (r <= a || l >= b) out.push([a, b]);
    else {
      if (l > a) out.push([a, l]);
      if (r < b) out.push([r, b]);
    }
  }
  return normalize(out);
}

/**
 * Konservative Erreichbarkeitsprüfung: Von der erreichbaren Menge aus wird zwischen den
 * Sperrfenstern nur mit `vlat` und nach einer Reaktionszeit seitlich verschoben; in den Fenstern
 * gibt es keine Bewegung. `vFast` (m/s) ist die kleinste Zeit je Strecke (höchstes erreichbares Tempo bei der Ankunft).
 */
export function checkChain(reach: Interval[], sEnd: number, gates: Gate[], vFast: number) {
  let cur = reach.map((i) => [i[0], i[1]] as Interval);
  let end = sEnd;
  const sorted = [...gates].sort((a, b) => a.sa - b.sa);
  for (const g of sorted) {
    const dt = Math.max(0, g.sa - end) / vFast;
    // seitlicher Weg: nach der Reaktionszeit mit der (konservativen) Lenkgeschwindigkeit
    const e = Math.max(0, dt - B.gen.react);
    const d = B.gen.reachEff * steerAt(vFast * 3.6).vKey * Math.min(1, B.steer.sens.key, B.steer.sens.touch) * e;   // Lenkgeschwindigkeit wächst mit dem Tempo
    cur = subtract(expand(cur, d), g.l, g.r);
    if (cur.length === 0) return { ok: false, reach: cur, sEnd: end };
    end = Math.max(end, g.sb);
  }
  return { ok: true, reach: cur, sEnd: end };
}
