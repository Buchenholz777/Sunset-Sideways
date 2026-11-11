import { BALANCE as B } from '../config/balance';
import { steerAt } from '../core/speed';
import { KINDS, laneX, type Obstacle } from './world';

/**
 * Pfadfinder: plant über die nächsten Sekunden eine freie, erreichbare Spurfolge durch die tatsächlichen Hindernisse
 * (Rückwärts-Programmierung über die drei Spuren, Lenkgeschwindigkeit nach Tempo) und liefert die Spurmitte, auf die
 * der Spieler jetzt zusteuern soll. null = keine Hindernisse in Sicht (aktuelle Spur beibehalten).
 */
export function planGuide(obstacles: readonly Obstacle[], q: number, s: number, speedKmh: number, timeScale: number): number | null {
  const v = speedKmh / 3.6;
  const L = B.player.len;
  const gates: { ta: number; tb: number; l: number; r: number }[] = [];
  for (const o of obstacles) {
    if (o.hit) continue;
    const c = v - o.vz * timeScale;
    if (c <= 0.1) continue;
    const def = KINDS[o.kind];
    const ta = (o.z - s) / c;
    const tb = ta + (L + def.len) / c;
    if (tb < -0.05 || ta > 6.5) continue;
    const half = def.w / 2 + B.player.width / 2 + 0.25;
    gates.push({ ta, tb, l: o.x - half, r: o.x + half });
  }
  const xs = [laneX(0), laneX(1), laneX(2)];
  const near = xs.reduce((bi, x, i) => (Math.abs(x - q) < Math.abs(xs[bi] - q) ? i : bi), 0);
  if (gates.length === 0) return xs[near];
  gates.sort((a, b) => a.ta - b.ta);
  const vk = steerAt(speedKmh).vKey * Math.min(1, B.steer.sens.key, B.steer.sens.touch);
  const reachT = (T: number) => 0.7 * vk * Math.max(0, T - 0.12);
  let safeNext = xs.map(() => true);
  for (let k = gates.length - 1; k >= 0; k--) {
    const g = gates[k], nxt = gates[k + 1];
    const reach = nxt ? reachT(nxt.ta - g.tb) : Infinity;
    safeNext = xs.map((x) => {
      if (x > g.l && x < g.r) return false;
      if (!nxt) return true;
      return xs.some((x2, j) => safeNext[j] && Math.abs(x2 - x) <= reach);
    });
  }
  const reach0 = reachT(gates[0].ta) + 0.6;
  const active = gates.filter((g) => g.ta <= 0.05 && g.tb > 0);
  let best = -1, bestScore = -Infinity;
  for (let i = 0; i < 3; i++) {
    if (!safeNext[i]) continue;
    const d = Math.abs(xs[i] - q);
    if (d > reach0) continue;
    if (active.some((g) => (q <= g.l ? xs[i] > g.l : q >= g.r ? xs[i] < g.r : true))) continue;
    const score = -d - (i === 1 ? -0.4 : 0);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best < 0 ? xs[near] : xs[best];
}
