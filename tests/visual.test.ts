import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { Sim } from '../src/sim/sim';
import { botInput } from './helpers/bot';
import { READ_LANE_PX, READ_OBJECT_PX, depthEff, depthInv, makeLayout, readableDistance, scaleAt, type Layout } from '../src/render/projection';
import { STAGES, decoType, moonAt, planeAt, planeFlight, stageAt } from '../src/render/scenery';

const VIEWPORTS: [string, number, number][] = [
  ['320x568', 320, 568], ['390x844', 390, 844], ['844x390', 844, 390], ['1366x768', 1366, 768], ['1920x1080', 1920, 1080],
];
const VMAX = 600 / 3.6;

/** Spawnabstand jedes Hindernisses beim ersten Auftreten in der echten Simulation. */
function spawnSamples(opts: { startT?: number; startS?: number }, seeds: number[], seconds: number) {
  const out: { dist: number; closing: number }[] = [];
  for (const seed of seeds) {
    const sim = new Sim(seed, opts);
    const known = new Set<number>();
    const cache = { target: null as number | null };
    const record = () => {
      for (const o of sim.obstacles) {
        if (known.has(o.id)) continue;
        known.add(o.id);
        out.push({ dist: o.z - sim.s, closing: sim.speedKmh / 3.6 - o.vz });
      }
    };
    record();
    for (let i = 0; i < seconds * 120 && !sim.crashed; i++) { sim.step(B.dt, botInput(sim, i, cache)); record(); }
  }
  return out;
}

describe('Projektion', () => {
  it('ist bis D0 linear und danach stetig, streng monoton und invertierbar', () => {
    const L = makeLayout(390, 844);
    let prev = 0;
    for (let d = 1; d < 3000; d += 7) {
      const e = depthEff(d, L);
      expect(e).toBeGreaterThan(prev);
      expect(depthInv(e, L)).toBeCloseTo(d, 6);
      prev = e;
    }
  });
  it('Spielerwagen bleibt bei 80–85 % der Höhe verankert, Horizont im oberen Drittel', () => {
    for (const [, w, h] of VIEWPORTS) {
      const L = makeLayout(w, h);
      expect(L.gy / L.h).toBeGreaterThanOrEqual(0.8);
      expect(L.gy / L.h).toBeLessThanOrEqual(0.85);
      expect(L.hy / L.h).toBeLessThanOrEqual(0.37);
    }
  });
});

describe('Vorwarnzeit (V02): erstes lesbares Bild bis zum frühestmöglichen Kontakt', () => {
  /** Zeit ab dem Moment, in dem Spur (≥ 6 px Spurbreite) bzw. Objekt lesbar ist und das Hindernis existiert. */
  function warn(L: Layout, dist: number, closing: number, widthM: number): number {
    const dLane = readableDistance(B.road.laneWidth, READ_LANE_PX, L);
    const dObj = readableDistance(widthM, READ_OBJECT_PX, L);
    return Math.min(dist, Math.max(dLane, dObj)) / closing;
  }
  const start = spawnSamples({}, [1, 12, 42, 99, 2024, 31], 25);
  const fast = spawnSamples({ startS: 30000 }, [1, 12, 42, 99, 2024, 31], 12);

  it('Stichproben vorhanden', () => { expect(start.length).toBeGreaterThan(10); expect(fast.length).toBeGreaterThan(10); });

  for (const [name, w, h] of VIEWPORTS) {
    it(`${name}: ≥ 2,0 s am Anfang und ≥ 1,25 s bei 384 km/h mit Turbo`, () => {
      const L = makeLayout(w, h);
      const minStart = Math.min(...start.map((s) => warn(L, s.dist, s.closing, 0.9)));
      const minFast = Math.min(...fast.map((s) => warn(L, s.dist, s.closing, 0.9)));
      expect(minStart).toBeGreaterThanOrEqual(2.0);
      expect(minFast).toBeGreaterThanOrEqual(1.25);
    });
  }

  it('Vorher (lineare Perspektive) verfehlt die Vorgabe im kleinsten Hochformat', () => {
    const L = { ...makeLayout(320, 568), gamma: 1 };
    const minFast = Math.min(...fast.map((s) => warn(L, s.dist, s.closing, 0.9)));
    expect(minFast).toBeLessThan(1.25);
  });

  it('Fernsicht: Spuren sind im kleinsten Hochformat ab ≈ 170 m unterscheidbar', () => {
    const L = makeLayout(320, 568);
    expect(scaleAt(150, L) * B.road.laneWidth).toBeGreaterThanOrEqual(READ_LANE_PX);
    expect(readableDistance(B.road.laneWidth, READ_LANE_PX, L) / VMAX).toBeGreaterThanOrEqual(1.25);
  });

  it('Spawn liegt weit genug vorn (kein später Objekt-Spawn)', () => {
    expect(Math.min(...fast.map((s) => s.dist / s.closing))).toBeGreaterThanOrEqual(1.25);
    expect(Math.min(...start.map((s) => s.dist / s.closing))).toBeGreaterThanOrEqual(2.0);
  });
});

describe('Himmel und Kulisse', () => {
  it('Flugplan: erster Überflug 8–14 s, Abstand 25–45 s, Dauer 8–14 s, nie zwei gleichzeitig', () => {
    for (let seed = 0; seed < 60; seed++) {
      const f0 = planeFlight(seed, 0);
      expect(f0.start).toBeGreaterThanOrEqual(8);
      expect(f0.start).toBeLessThanOrEqual(14);
      let prevEnd = f0.start + f0.dur;
      for (let i = 1; i < 8; i++) {
        const f = planeFlight(seed, i);
        expect(f.dur).toBeGreaterThanOrEqual(8);
        expect(f.dur).toBeLessThanOrEqual(14);
        expect(f.start - prevEnd).toBeGreaterThanOrEqual(25);
        expect(f.start - prevEnd).toBeLessThanOrEqual(45);
        prevEnd = f.start + f.dur;
      }
    }
  });
  it('Flugzeug fliegt von links nach rechts und ist nur in seinem Zeitfenster sichtbar', () => {
    const f = planeFlight(7, 0);
    expect(planeAt(7, f.start - 0.1)).toBeNull();
    let lastP = -1;
    for (let t = f.start; t <= f.start + f.dur; t += 0.5) { const a = planeAt(7, t)!; expect(a.p).toBeGreaterThan(lastP); lastP = a.p; }
    expect(planeAt(7, f.start + f.dur + 0.1)).toBeNull();
  });
  it('Mond: erst bei 17–20 km knapp über dem Horizont, steigt danach stetig nach der Strecke, ab 27 km deutlich höher', () => {
    for (const [, w, h] of VIEWPORTS) {
      const L = makeLayout(w, h);
      let py = Infinity, px = -Infinity;
      for (let m = 0; m <= 40000; m += 250) {
        const mo = moonAt(m, L);
        expect(mo.y).toBeLessThanOrEqual(py + 1e-9);
        expect(mo.x).toBeGreaterThanOrEqual(px - 1e-9);
        expect(mo.y - mo.R).toBeGreaterThanOrEqual(0.1 * L.h);   // unter den oberen HUD-Buttons
        expect(mo.y).toBeLessThan(L.hy);                         // über dem Horizont
        expect(mo.x).toBeGreaterThan(0.55 * L.w);                // rechts vom Distanz-HUD
        py = mo.y; px = mo.x;
      }
      const at = (m: number) => moonAt(m, L).y;
      expect(L.hy - at(20000)).toBeLessThan(0.1 * L.hy + 6);      // bei 20 km noch tief
      expect(at(20000) - at(27000)).toBeGreaterThan(0.15 * L.hy); // bis 27 km deutlich gestiegen
      expect(at(27000) - at(32000)).toBeGreaterThanOrEqual(0);    // danach flach auslaufend
    }
  });
  it('Streckenabschnitte bei 0 / 1,5 / 5 / 10 / 20 km und deterministische Kulisse', () => {
    expect(STAGES).toEqual([0, 1500, 5000, 10000, 20000]);
    expect([0, 1499, 1500, 4999, 5000, 9999, 10000, 19999, 20000, 40000].map(stageAt)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    for (let k = 0; k < 50; k++) expect(decoType(k, 1, k * 22)).toBe(decoType(k, 1, k * 22));
    const kinds = (z0: number) => new Set(Array.from({ length: 80 }, (_, i) => decoType(i + Math.floor(z0 / 22), i % 2 ? 1 : -1, z0 + i * 22)));
    expect(kinds(0).has('motel')).toBe(true);
    expect(kinds(1800).has('deco')).toBe(true);
    expect(kinds(5500).has('tower')).toBe(true);
    expect(kinds(10500).has('show')).toBe(true);
    // Strip erst ab 20 km: Eiffelturm, Fontänensee und Casino-Fassaden
    for (const t of ['eiffel', 'lake', 'casino'] as const) { expect(kinds(0).has(t)).toBe(false); expect(kinds(15000).has(t)).toBe(false); expect(kinds(20500).has(t)).toBe(true); }
  });
});

describe('Messwerte (Ausgabe für die Abnahmetabelle)', () => {
  it('Vorwarnzeiten je Viewport, vorher/nachher', () => {
    const start = spawnSamples({}, [1, 12, 42, 99, 2024, 31], 25);
    const fast = spawnSamples({ startS: 30000 }, [1, 12, 42, 99, 2024, 31], 12);
    const rows: string[] = ['Viewport | Anfang vorher | Anfang nachher | 384 km/h vorher | 384 km/h nachher | Spur lesbar ab (m) nachher'];
    for (const [name, w, h] of VIEWPORTS) {
      const L = makeLayout(w, h);
      const Lold: Layout = { ...L, gamma: 1 };
      const f = (LL: Layout, set: { dist: number; closing: number }[]) => Math.min(...set.map((s) => {
        const dl = readableDistance(B.road.laneWidth, READ_LANE_PX, LL), dobj = readableDistance(0.9, READ_OBJECT_PX, LL);
        return Math.min(s.dist, Math.max(dl, dobj)) / s.closing;
      })).toFixed(2);
      rows.push(`${name} | ${f(Lold, start)} s | ${f(L, start)} s | ${f(Lold, fast)} s | ${f(L, fast)} s | ${readableDistance(B.road.laneWidth, READ_LANE_PX, L).toFixed(0)}`);
    }
    console.log(rows.join('\n'));
    expect(rows.length).toBe(VIEWPORTS.length + 1);
  });
});
