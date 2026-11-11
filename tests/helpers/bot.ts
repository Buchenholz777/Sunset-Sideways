import { steerAt } from '../../src/core/speed';
import { BALANCE as B } from '../../src/config/balance';
import type { Sim, SteerInput } from '../../src/sim/sim';
import { KINDS } from '../../src/sim/world';

/**
 * Testfahrer: plant per Rückwärts-DP über Querpositionen einen kollisionsfreien Pfad durch
 * die kommenden Hindernisse (aus dem tatsächlichen Simulationszustand) und lenkt per Zielposition.
 */
export function botTarget(sim: Sim, prev: number | null = null): number | null {
  const v = sim.speedKmh / 3.6;
  const L = B.player.len;
  const gates: { ta: number; tb: number; l: number; r: number }[] = [];
  for (const o of sim.obstacles) {
    if (o.hit) continue;
    const c = v - o.vz * sim.timeScale;
    if (c <= 0.1) continue;
    const def = KINDS[o.kind];
    const ta = (o.z - sim.s) / c;
    const tb = ta + (L + def.len) / c;
    if (tb < -0.05 || ta > 6) continue;
    const half = def.w / 2 + B.player.width / 2 + 0.3;
    gates.push({ ta, tb, l: o.x - half, r: o.x + half });
  }
  if (gates.length === 0) return null;
  gates.sort((a, b) => a.ta - b.ta);
  const xs: number[] = [];
  for (let x = -B.player.maxX; x <= B.player.maxX + 1e-6; x += 0.2) xs.push(x);
  // seitlicher Weg mit voller Lenkgeschwindigkeit (etwas weniger konservativ als die Streckenplanung)
  const reachT = (T: number) => 0.85 * steerAt(sim.speedKmh).vKey * Math.min(1, B.steer.sens.key, B.steer.sens.touch) * Math.max(0, T - 0.05);
  let safeNext: boolean[] = xs.map(() => true);
  for (let k = gates.length - 1; k >= 0; k--) {
    const g = gates[k];
    const nxt = gates[k + 1];
    const reach = nxt ? reachT(nxt.ta - g.tb) : Infinity;
    const cur = xs.map((x) => {
      if (x > g.l && x < g.r) return false;
      if (!nxt) return true;
      for (let j = 0; j < xs.length; j++) if (safeNext[j] && Math.abs(xs[j] - x) <= reach) return true;
      return false;
    });
    safeNext = cur;
  }
  const reach0 = reachT(gates[0].ta) + 0.2;
  // Zielwahl: sicher und erreichbar, mit möglichst viel Abstand zu den nächsten Sperrbereichen (Mitte der freien Fläche)
  const near = gates.filter((g) => g.ta < 2.2);
  const clearance = (x: number) => near.reduce((m, g) => Math.min(m, x <= g.l ? g.l - x : x >= g.r ? x - g.r : -1), 3);
  const active = gates.filter((g) => g.ta <= 0.05 && g.tb > 0);
  let best = -1, bestScore = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (!safeNext[i]) continue;
    const d = Math.abs(xs[i] - sim.x);
    if (d > reach0) continue;
    // Während ein Hindernis neben dem Wagen ist, darf dessen Sperrbereich nicht durchquert werden
    if (active.some((g) => (sim.x <= g.l ? xs[i] > g.l : sim.x >= g.r ? xs[i] < g.r : true))) continue;
    const score = Math.min(clearance(xs[i]), 1.6) - 0.12 * d + (prev !== null && Math.abs(xs[i] - prev) < 0.15 ? 0.7 : 0); // Hysterese gegen Hin-und-her-Springen
    if (score > bestScore) { bestScore = score; best = i; }
  }
  if (best < 0 && active.length) return Math.max(-4.2, Math.min(4.2, sim.x)); // neben einem Hindernis: Spur halten
  if (best < 0) {
    let bestD = Infinity;
    for (let i = 0; i < xs.length; i++) {
      if (!safeNext[i]) continue;
      const d = Math.abs(xs[i] - sim.x);
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return best < 0 ? null : xs[best];
}

/** Testfahrer-Eingabe: fährt die geplante Zielquerposition direkt an (wie ein Finger auf dem Bildschirm). */
export function botInput(sim: Sim, stepIndex: number, cache: { target: number | null }): SteerInput {
  if (stepIndex % 4 === 0) cache.target = botTarget(sim, cache.target);
  const q = sim.x;
  const qStar = cache.target ?? Math.max(-B.player.maxX + 0.6, Math.min(B.player.maxX - 0.6, q));
  return { dir: 0, target: qStar };
}
