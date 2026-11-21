import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { speedAtDist } from '../src/core/speed';
import { Sim } from '../src/sim/sim';
import { createRng } from '../src/core/rng';

/** Streckenmeter, bei denen das Grundtempo 700 / 800 / 900 / 1000 km/h erreicht (gleiche Steigung wie zwischen 20 und 27 km). */
const AT: Array<[number, number]> = [[700, 41_000], [800, 55_000], [900, 69_000], [1000, 83_000]];

describe('Tempo 700 bis 1000 km/h', () => {
  it('Streckenpunkte liefern das erwartete Tempo; 1000 km/h ist die Obergrenze (auch dahinter)', () => {
    for (const [kmh, s] of AT) expect(speedAtDist(s)).toBeCloseTo(kmh, 3);
    expect(speedAtDist(200_000)).toBe(1000);
    expect(B.speed.capKmh).toBe(1000);
  });
  for (const [kmh, s0] of AT) {
    it(`${kmh} km/h: Hindernisse werden bei jeder Schrittweite getroffen (kein Durchtunneln)`, () => {
      for (const kind of ['baken', 'barrier', 'truck'] as const) for (const dt of [1 / 120, 1 / 60, 1 / 30, 1 / 15]) {
        const s = new Sim(12, { startS: s0, startT: 3000 }); s.pickups = [];
        s.obstacles = [{ id: 9, kind, x: 0, z: s.s + 60, vz: 0, hit: false, knockT: 0, knockVx: 0 }];
        for (let i = 0; i < Math.ceil(1.5 / dt) && !s.crashed; i++) { s.pickups = []; s.step(dt, { dir: 0 }); }
        expect(s.crashed, `${kind} @ ${kmh} km/h, dt ${dt}`).toBe(true);
        expect(s.speedKmh).toBeGreaterThan(kmh - 2);
      }
    });
  }
  it('Zufallsfälle bei 1000 km/h: grober Schritt (30 Hz) verpasst nie, was feine Schritte treffen', () => {
    const rng = createRng(77);
    let hits = 0, missed = 0;
    for (let n = 0; n < 300; n++) {
      const kind = (['baken', 'barrier', 'taxi', 'truck'] as const)[Math.floor(rng() * 4)];
      const moving = kind === 'taxi' || kind === 'truck';
      const ox = (rng() - 0.5) * 5, z = 3 + rng() * 25, qT = (rng() - 0.5) * 6;
      const build = () => { const s = new Sim(12, { startS: 83_000, startT: 3000 }); s.pickups = []; s.q = qT; s.obstacles = [{ id: 9, kind, x: ox, z: s.s + z, vz: moving ? 12 : 0, hit: false, knockT: 0, knockVx: 0 }]; return s; };
      const fine = build(), coarse = build();
      for (let i = 0; i < 480; i++) { fine.step(1 / 960, { dir: 0, target: qT }); fine.obstacles = fine.obstacles.filter((o) => o.id === 9); fine.pickups = []; }
      for (let i = 0; i < 15; i++) { coarse.step(1 / 30, { dir: 0, target: qT }); coarse.obstacles = coarse.obstacles.filter((o) => o.id === 9); coarse.pickups = []; }
      if (fine.crashed) { hits++; if (!coarse.crashed) missed++; }
    }
    expect(hits).toBeGreaterThan(30);
    expect(missed).toBe(0);
  });
  it('Fairness: Spurwechsel bleibt bei 1000 km/h schnell (≤ 0,4 s Außenspur zu Außenspur) und das Tempo übersteigt nie 1000 km/h', () => {
    const s = new Sim(12, { startS: 83_000, startT: 3000 }); s.obstacles = []; s.pickups = []; s.q = -3.6;
    let t = 0;
    for (; t < 600 && s.q < 3.4; t++) { s.obstacles = []; s.step(B.dt, { dir: 1 }); }
    expect(t * B.dt).toBeLessThan(0.4);
    s.boostT = 5; s.boostF = 1.35;
    for (let i = 0; i < 240; i++) { s.obstacles = []; s.step(B.dt, { dir: 0 }); expect(s.speedKmh).toBeLessThanOrEqual(1000 + 1e-6); }
  });
  it('Generator: Vorlauf und Abstände skalieren mit dem Tempo (Zeitabstände bei 1000 km/h wie bei 600 km/h)', () => {
    const gaps = (startS: number): number[] => {
      const s = new Sim(12, { startS, startT: 3000 }); s.pickups = [];
      const seen = new Map<number, { z: number; x: number }>();
      for (let i = 0; i < 120 * 40 && !s.crashed; i++) { s.step(B.dt, { dir: 0, target: 0 }); if (i % 6 === 0) for (const o of s.obstacles) seen.set(o.id, { z: o.z, x: o.x }); }
      const zs = [...seen.values()].map((o) => o.z).sort((a, b) => a - b);
      const v = speedAtDist(startS) / 3.6;
      return zs.slice(1).map((z, i) => (z - zs[i]) / v);
    };
    const a = gaps(27_000), b = gaps(83_000);
    const med = (x: number[]) => [...x].sort((p, q) => p - q)[Math.floor(x.length / 2)] ?? 0;
    expect(a.length).toBeGreaterThan(5); expect(b.length).toBeGreaterThan(5);
    expect(med(b) / med(a)).toBeGreaterThan(0.8); expect(med(b) / med(a)).toBeLessThan(1.25);
  });
});
