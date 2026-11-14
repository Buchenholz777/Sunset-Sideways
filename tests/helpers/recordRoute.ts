import { BALANCE as B } from '../../src/config/balance';
import { applyConfig, applyDefaults } from '../../src/config/runtime';
import { speedAtDist } from '../../src/core/speed';
import { Generator, type GenWorld } from '../../src/gen/generator';
import { SPRINT_CONFIG, SPRINT_FINISH_M, SPRINT_SEED, type RouteEntry } from '../../src/sprint/rules';

const r2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Nimmt die Sprint-Strecke mit dem echten Generator auf: Der Spieler fährt nominal (ohne Effekte) im festen 1/120-s-Takt;
 * jedes neu entstandene Objekt wird mit der Streckenposition festgehalten, bei der es erschien.
 * Läuft mit den Sprint-Regeln und stellt danach die Standardwerte wieder her.
 */
export function recordSprintRoute(extra = 300): RouteEntry[] {
  applyConfig(SPRINT_CONFIG, false);
  try {
    const g = new Generator(SPRINT_SEED, { startS: 0 });
    const w: GenWorld = { s: 0, t: 0, obstacles: [], pickups: [], nextId: 1 };
    const out: RouteEntry[] = [];
    const seenO = new Set<number>(), seenP = new Set<number>();
    g.update(w);
    const capture = (): void => {
      for (const o of w.obstacles) if (!seenO.has(o.id)) { seenO.add(o.id); out.push({ s: r2(w.s), o: { k: o.kind, x: r2(o.x), z: r2(o.z), v: r2(o.vz) } }); }
      for (const p of w.pickups) if (!seenP.has(p.id)) { seenP.add(p.id); out.push({ s: r2(w.s), p: { t: p.type, x: r2(p.x), z: r2(p.z) } }); }
    };
    capture();
    while (w.s < SPRINT_FINISH_M + extra) {
      const v = speedAtDist(w.s) / 3.6;
      for (const o of w.obstacles) o.z += o.vz * B.dt;
      w.s += v * B.dt; w.t += B.dt;
      g.update(w);
      capture();
      w.obstacles = w.obstacles.filter((o) => o.z > w.s - 40);
    }
    return out;
  } finally { applyDefaults(); }
}
