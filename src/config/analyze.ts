import { BALANCE as B } from './balance';
import { applyConfig, normalize, type GameConfig, type Issue } from './runtime';
import { Generator, type GenWorld } from '../gen/generator';
import { speedAtDist, steerAt, travelTime } from '../core/speed';

export interface Sample {
  km: number; kmh: number;
  /** Begegnungen je km im Probelauf. */
  perKm: number;
  /** Anteil der Begegnungen, die der Generator wegen der Erreichbarkeitsprüfung auf mehr als das 1,7-Fache des Abstands strecken musste. */
  fallback: number;
  /** Zeit für einen Spurwechsel (s) bei dieser Geschwindigkeit und Empfindlichkeit. */
  laneChangeS: number;
  /** Zeit zwischen zwei Reihen einer Folge (s). */
  rowGapS: number;
}
export interface Analysis { samples: Sample[]; issues: Issue[] }

/**
 * Prüft die Kombination aus Tempo, Dichte, Abständen und Empfindlichkeit mit der echten Generator-Logik
 * (Erreichbarkeitsprüfung `checkChain`): Zieht der Generator die Begegnungen oft auseinander, widersprechen sich die Einstellungen.
 */
export function analyze(input: unknown, seeds = [11, 23, 37, 59]): Analysis {
  const cfg: GameConfig = normalize(input);
  applyConfig(cfg, false);
  const issues: Issue[] = [];
  const samples: Sample[] = [];
  const dist = cfg.tempo.distToMaxKm;
  for (const km of [0, Math.round(dist * 0.35), dist + 3]) {
    const startS = km * 1000;
    let enc = 0, fb = 0;
    const SPAN = 1500;
    for (const seed of seeds) {
      const g = new Generator(seed, { record: true, startS });
      const w: GenWorld = { s: startS, t: 0, obstacles: [], pickups: [], nextId: 1 };
      while (w.s < startS + SPAN) {
        const dt = travelTime(w.s, w.s + 20);
        for (const o of w.obstacles) o.z += o.vz * dt;
        w.s += 20; w.t += dt;
        g.update(w);
        w.obstacles = w.obstacles.filter((o) => o.z > w.s - 40);
      }
      for (const e of g.log) { if (e.anchor < startS + SPAN) { enc++; if (e.mult >= 1.7) fb++; } }
    }
    const kmh = speedAtDist(startS);
    const vKey = steerAt(kmh).vKey * Math.min(1, cfg.controls.key, cfg.controls.touch);
    const laneChangeS = B.road.laneWidth / (B.gen.reachEff * vKey) + 0.12;
    const t = startS > 0 ? travelTime(0, startS) : 0;
    samples.push({
      km, kmh, perKm: enc / (seeds.length * SPAN / 1000), fallback: enc ? fb / enc : 0, laneChangeS,
      rowGapS: B.gen.rowBase + B.gen.rowGain * Math.exp(-t / B.gen.rowTau),
    });
  }
  const worst = Math.max(...samples.map((s) => s.fallback));
  const hardest = samples.reduce((a, b) => (b.laneChangeS / b.rowGapS > a.laneChangeS / a.rowGapS ? b : a));
  if (worst > 0.5) issues.push({ path: 'tempo.density', level: 'error', msg: `Bei dieser Dichte zieht der Generator ${(worst * 100).toFixed(0)} % der Begegnungen auseinander, weil sie sonst nicht erreichbar wären. Dichte senken, Mindestabstand erhöhen oder Empfindlichkeit anheben.` });
  else if (worst > 0.2) issues.push({ path: 'tempo.density', level: 'warn', msg: `Hohe Dichte: ${(worst * 100).toFixed(0)} % der Begegnungen werden aus Fairness-Gründen auseinandergezogen – die wirksame Dichte ist niedriger als eingestellt.` });
  if (hardest.laneChangeS > 0.6) issues.push({ path: Math.min(cfg.controls.key, cfg.controls.touch) < 1 ? (cfg.controls.key <= cfg.controls.touch ? 'controls.key' : 'controls.touch') : 'tempo.maxKmh', level: hardest.laneChangeS > 0.75 ? 'error' : 'warn', msg: `Ein Spurwechsel dauert bei ${Math.round(hardest.kmh)} km/h und dieser Empfindlichkeit ${hardest.laneChangeS.toFixed(2)} s.` });
  if (hardest.laneChangeS * 2 > hardest.rowGapS) issues.push({ path: 'traffic.minGap', level: 'warn', msg: `Zwei Spurwechsel (${(hardest.laneChangeS * 2).toFixed(2)} s) passen kaum in den Reihenabstand (${hardest.rowGapS.toFixed(2)} s).` });
  return { samples, issues };
}
