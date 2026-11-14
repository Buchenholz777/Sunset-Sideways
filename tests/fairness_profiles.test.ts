import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { DEFAULT_CONFIG, applyConfig, applyDefaults, withProfile, type GameConfig } from '../src/config/runtime';
import { Sim } from '../src/sim/sim';
import { botInput } from './helpers/bot';

afterEach(() => applyDefaults());

/** Fährt den Testfahrer `sec` Sekunden ab startS (optional mit Effekt); liefert Ergebnis und gefahrene Strecke. */
function run(seed: number, startS: number, sec: number, fx?: { boost?: number; slow?: number }) {
  const sim = new Sim(seed, { startS });
  if (fx?.boost) sim.boostT = fx.boost;
  if (fx?.slow) sim.slowT = fx.slow;
  const cache = { target: null as number | null };
  for (let i = 0; i < sec * 120 && !sim.crashed; i++) sim.step(B.dt, botInput(sim, i, cache));
  return { crashed: sim.crashed, km: (sim.s - startS) / 1000, kmh: sim.speedKmh };
}

const PROFILES: Array<[string, GameConfig]> = [
  ['Arcade (Standard)', DEFAULT_CONFIG], ['Entspannt', withProfile(DEFAULT_CONFIG, 'relaxed')], ['Anspruchsvoll', withProfile(DEFAULT_CONFIG, 'hard')],
];

describe('Fairness: Testfahrer übersteht jedes Profil (frühe, mittlere und Höchsttempo-Fahrt, Kuppen, Effekte)', () => {
  for (const [name, cfg] of PROFILES) {
    it(name, () => {
      applyConfig(cfg);
      const dist = cfg.tempo.distToMaxKm * 1000;
      const points: Array<[string, number]> = [['Start', 0], ['mittlere Fahrt', Math.round(dist * 0.35)], ['Höchsttempo', dist + 2000]];
      for (const [label, s0] of points) {
        for (const seed of [4, 21, 77]) {
          const r = run(seed, s0, 30);
          expect(r.crashed, `${name} · ${label} · Seed ${seed}: Treffer nach ${r.km.toFixed(2)} km bei ${Math.round(r.kmh)} km/h`).toBe(false);
        }
      }
      // Effekte: Phantom-Turbo (+20 % Tempo) und Zeitblase mitten in der schnellen Fahrt
      for (const seed of [4, 21]) {
        expect(run(seed, dist + 2000, 20, { boost: 6 }).crashed, `${name} · Turbo · Seed ${seed}`).toBe(false);
        expect(run(seed, dist * 0.5, 20, { slow: 7 }).crashed, `${name} · Zeitblase · Seed ${seed}`).toBe(false);
      }
    });
  }
  it('geringere Lenkempfindlichkeit (80 %) wird in der Generierung berücksichtigt: Testfahrer übersteht trotzdem', () => {
    const c = structuredClone(DEFAULT_CONFIG); c.controls.key = 0.8; c.controls.touch = 0.8;
    applyConfig(c);
    for (const seed of [4, 21, 77]) expect(run(seed, 27000, 30).crashed, `Seed ${seed}`).toBe(false);
  });
});
