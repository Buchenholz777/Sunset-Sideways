import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { BALANCE as B } from '../src/config/balance';
import { applyConfig, applyDefaults } from '../src/config/runtime';
import { travelTime } from '../src/core/speed';
import { Sim } from '../src/sim/sim';
import { SPRINT_CONFIG, SPRINT_FINISH_M, SPRINT_ROUTE, SPRINT_SEED, sprintStageScale } from '../src/sprint/rules';
import { lightT, stageAt } from '../src/render/scenery';
import { botInput } from './helpers/bot';
import { recordSprintRoute } from './helpers/recordRoute';

afterEach(() => { applyDefaults(); sprintStageScale(false); });

/** Mit WRITE_ROUTE=1 wird die Route neu aufgenommen und gespeichert (src/sprint/route_v1.json); sonst wird die gespeicherte geprüft. */
describe('Sunset Sprint: feste, versionierte Strecke', () => {
  it('Route aufnehmen und speichern (nur mit WRITE_ROUTE=1)', () => {
    if (process.env.WRITE_ROUTE !== '1') return;
    writeFileSync('src/sprint/route_v1.json', JSON.stringify(recordSprintRoute()) + '\n');
  });

  it('gespeicherte Route ist nicht leer, sortiert und entspricht dem Generator dieser Version', () => {
    expect(SPRINT_ROUTE.length).toBeGreaterThan(40);
    for (let i = 1; i < SPRINT_ROUTE.length; i++) expect(SPRINT_ROUTE[i].s).toBeGreaterThanOrEqual(SPRINT_ROUTE[i - 1].s);
    expect(SPRINT_ROUTE.filter((e) => e.o).length).toBeGreaterThan(25);
    expect(SPRINT_ROUTE.some((e) => e.p?.t === 'glide')).toBe(true);
    // erste Begegnung wie im Endless: Hindernis in der Mitte, rund 175 m voraus
    const first = SPRINT_ROUTE.find((e) => e.o)!.o!;
    expect(first.x).toBeCloseTo(0, 5);
    expect(first.z).toBeGreaterThan(150); expect(first.z).toBeLessThan(260);
    // Generator unverändert? Weicht die Aufnahme ab, die Route bewusst neu speichern und SPRINT_VERSION erhöhen.
    expect(recordSprintRoute()).toEqual(SPRINT_ROUTE);
  });

  it('Zeit bis zum Ziel: nominal 45–75 s', () => {
    applyConfig(SPRINT_CONFIG, false);
    const t = travelTime(0, SPRINT_FINISH_M);
    expect(t).toBeGreaterThan(45); expect(t).toBeLessThan(75);
  });

  it('Licht: Dämmerung beginnt nach rund 10–20 s, volle Nacht liegt vor dem Ziel, Strip-Abschnitt erreicht', () => {
    applyConfig(SPRINT_CONFIG, false); sprintStageScale(true);
    expect(lightT(0)).toBe(0);
    const tDusk = travelTime(0, SPRINT_CONFIG.scenery.duskKm * 1000);
    expect(tDusk).toBeGreaterThan(8); expect(tDusk).toBeLessThan(22);
    expect(lightT(SPRINT_FINISH_M - 300)).toBe(1);
    expect(stageAt(SPRINT_FINISH_M)).toBe(4);
    expect(stageAt(100)).toBe(0);
    sprintStageScale(false);
    expect(stageAt(SPRINT_FINISH_M)).toBeLessThan(4);                               // Endless unverändert
  });

  it('gleiche Strecke und Regeln: unterschiedliche Fahrweise ändert Typen, Spuren und Reihenfolge der Begegnungen nicht', () => {
    applyConfig(SPRINT_CONFIG, false);
    const a = new Sim(SPRINT_SEED, { script: SPRINT_ROUTE, ghost: true }), b = new Sim(SPRINT_SEED, { script: SPRINT_ROUTE, ghost: true });
    const cache = { target: null as number | null };
    const seenA: string[] = [], seenB: string[] = [];
    const seen = (sim: Sim, into: string[], known: Set<number>): void => {
      for (const o of sim.obstacles) if (!known.has(o.id)) { known.add(o.id); into.push(`${o.id}:${o.kind}:${o.x.toFixed(2)}`); }
      for (const p of sim.pickups) if (!known.has(p.id)) { known.add(p.id); into.push(`${p.id}:${p.type}:${p.x.toFixed(2)}`); }
    };
    const ka = new Set<number>(), kb = new Set<number>();
    let i = 0;
    while (a.s < 3000 && i++ < 120 * 60) {
      a.step(B.dt, { dir: i % 400 < 200 ? 1 : -1 });        // pendelt
      b.step(B.dt, botInput(b, i, cache));                   // fährt vernünftig
      seen(a, seenA, ka); seen(b, seenB, kb);
    }
    const n = Math.min(seenA.length, seenB.length) - 3;     // der Rand hängt vom Tempo-Unterschied beider Läufe ab
    expect(n).toBeGreaterThan(12);
    expect(seenA.slice(0, n)).toEqual(seenB.slice(0, n));
  });

  it('Testfahrer erreicht das Ziel ohne Treffer in 45–75 s Fahrzeit', () => {
    applyConfig(SPRINT_CONFIG, false);
    const sim = new Sim(SPRINT_SEED, { script: SPRINT_ROUTE });
    const cache = { target: null as number | null };
    let i = 0;
    while (sim.s < SPRINT_FINISH_M && !sim.crashed && i < 120 * 120) { sim.step(B.dt, botInput(sim, i, cache)); i++; }
    expect(sim.crashed, `Treffer bei ${Math.round(sim.s)} m`).toBe(false);
    expect(sim.s).toBeGreaterThanOrEqual(SPRINT_FINISH_M);
    expect(sim.t).toBeGreaterThan(45); expect(sim.t).toBeLessThan(75);
  });

  it('ohne Lenken: früher Crash am ersten Hindernis, Ergebnis reproduzierbar', () => {
    const run = () => { applyConfig(SPRINT_CONFIG, false); const s = new Sim(SPRINT_SEED, { script: SPRINT_ROUTE }); let i = 0; while (!s.crashed && i++ < 120 * 30) s.step(B.dt, { dir: 0 }); return [s.crashed, Math.round(s.s), s.crash?.kind]; };
    const a = run(), b = run();
    expect(a).toEqual(b);
    expect(a[0]).toBe(true);
    expect(a[1] as number).toBeLessThan(400);
  });
});
