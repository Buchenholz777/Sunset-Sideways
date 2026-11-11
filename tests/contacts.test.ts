import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { Road } from '../src/sim/road';
import { speedAtDist } from '../src/core/speed';
import { Sim } from '../src/sim/sim';
import { PICKUP_TYPES } from '../src/sim/world';
import { createRng } from '../src/core/rng';
import { contactTime, type Footprint } from '../src/sim/contacts';

const DT = B.dt;
const lanes = [-3.6, 0, 3.6];

const obstacle = (s: Sim, kind: 'baken' | 'barrier' | 'taxi' | 'truck', x: number, dz: number, vz = 0) => {
  s.obstacles = [{ id: 9, kind, x, z: s.s + dz, vz, hit: false, knockT: 0, knockVx: 0 }];
};

describe('Pickups: Kontakte', () => {
  for (const [label, seed, startS, startT] of [['Gerade', 12, 20, 8], ['Bogen A', 12, 330, 8], ['Bogen B', 3, 330, 8], ['Höchsttempo', 12, 20, 3000]] as const) {
    for (const type of PICKUP_TYPES.filter((t) => t !== 'glide')) {
      it(`${label}: ${type} wird auf jeder Spur genau einmal gesammelt; Nachbarspur löst nichts aus`, () => {
        for (const lane of lanes) {
          const mk = () => {
            const s = new Sim(seed, { startS, startT });
            s.obstacles = [];
            s.pickups = [{ id: 7, type, x: lane, z: s.s + 80, taken: false }];
            return s;
          };
          const s = mk(); s.q = lane;
          for (let i = 0; i < 240; i++) { s.obstacles = []; s.pickups = s.pickups.filter((p) => p.id === 7); s.step(DT, { dir: 0, target: lane }); }
          expect(s.events.filter((e) => e.type === 'pickup')).toHaveLength(1);
          const n = mk(); n.q = lane === 3.6 ? 0 : lane + 3.6;
          const other = n.q;
          for (let i = 0; i < 240; i++) { n.obstacles = []; n.pickups = n.pickups.filter((p) => p.id === 7); n.step(DT, { dir: 0, target: other }); }
          expect(n.events.filter((e) => e.type === 'pickup')).toHaveLength(0);
        }
      });
    }
  }
  it('Streifschuss: Karosseriekante trifft die Sammelfläche, sichtbar daneben nicht', () => {
    const touch = (dq: number) => {
      const s = new Sim(12, { startS: 20, startT: 8 }); s.obstacles = [];
      s.pickups = [{ id: 7, type: 'shield', x: 0, z: s.s + 80, taken: false }];
      s.q = dq;
      for (let i = 0; i < 240; i++) { s.obstacles = []; s.step(DT, { dir: 0, target: dq }); }
      return s.events.filter((e) => e.type === 'pickup').length;
    };
    expect(touch(1.3)).toBe(1);
    expect(touch(1.8)).toBe(0);
    expect(touch(3.6)).toBe(0);
  });
  it('Pickup bei Höchsttempo mit grobem Schritt (1/20 s ≈ 4,6 m) wird nicht übersprungen', () => {
    for (const dt of [1 / 20, 1 / 30, 1 / 120]) {
      const s = new Sim(12, { startS: 30000, startT: 3000 }); s.obstacles = [];
      s.pickups = [{ id: 7, type: 'magnet', x: 0, z: s.s + 20, taken: false }];
      for (let i = 0; i < Math.ceil(1 / dt); i++) { s.obstacles = []; s.step(dt, { dir: 0 }); }
      expect(s.events.filter((e) => e.type === 'pickup')).toHaveLength(1);
    }
  });
});

describe('Hindernisse: Treffer ohne Durchtunneln', () => {
  it('gleichzeitiger Kontakt quer und längs zwischen den Endpositionen zählt', () => {
    const box = (x: number, z: number): Footprint => ({ x, z, yaw: 0, halfWidth: 0.2, halfLength: 0.2 });
    const pad = box(0, 0);
    expect(contactTime(box(-2, -2), box(2, 2), pad, pad)).toBeCloseTo(0.4, 10);
    expect(contactTime(box(-2, -2), box(2, 6), pad, pad)).toBeNull();
  });
  it('dünnes Hindernis (Bake, 0,9 m) bei Höchsttempo wird auch mit grobem Schritt getroffen', () => {
    for (const dt of [1 / 120, 1 / 60, 1 / 20]) {
      const s = new Sim(12, { startS: 30000, startT: 3000 }); s.pickups = [];
      obstacle(s, 'baken', 0, 40);
      for (let i = 0; i < Math.ceil(1.5 / dt) && !s.crashed; i++) { s.pickups = []; s.step(dt, { dir: 0 }); }
      expect(s.crashed).toBe(true);
      expect(s.crash?.kind).toBe('baken');
    }
  });
  it('Zufallsfälle: grober Schritt verpasst nie, was feine Schritte treffen (inkl. Verkehr, Höchsttempo)', () => {
    const rng = createRng(2024);
    let hits = 0, missed = 0;
    for (let n = 0; n < 400; n++) {
      const kind = (['baken', 'barrier', 'taxi', 'truck'] as const)[Math.floor(rng() * 4)];
      const moving = kind === 'taxi' || kind === 'truck';
      const ox = (rng() - 0.5) * 5, z = 3 + rng() * 17, qT = (rng() - 0.5) * 6;
      const build = () => { const s = new Sim(12, { startS: 30000, startT: 3000 }); s.pickups = []; s.q = qT; obstacle(s, kind, ox, z, moving ? 12 : 0); return s; };
      const fine = build(), coarse = build();
      for (let i = 0; i < 192; i++) { fine.step(1 / 960, { dir: 0, target: qT }); fine.obstacles = fine.obstacles.filter((o) => o.id === 9); fine.pickups = []; }
      for (let i = 0; i < 24; i++) { coarse.step(1 / 120, { dir: 0, target: qT }); coarse.obstacles = coarse.obstacles.filter((o) => o.id === 9); coarse.pickups = []; }
      if (fine.crashed) { hits++; if (!coarse.crashed) missed++; }
    }
    expect(hits).toBeGreaterThan(40);
    expect(missed).toBe(0);
  });
  it('knapper Fehlschlag bleibt ein Fehlschlag: Karosserie berührt Barriere ⇒ Crash; sichtbarer Abstand ⇒ frei', () => {
    const run = (q: number) => {
      const s = new Sim(12, { startS: 20, startT: 8 }); s.pickups = [];
      obstacle(s, 'barrier', 0, 40); s.q = q;
      for (let i = 0; i < 400 && !s.crashed; i++) { s.pickups = []; s.step(DT, { dir: 0, target: q }); }
      return s.crashed;
    };
    const touching = 1.3 + 0.95 - B.player.hitInsetX - B.obstacle.hitInset;                  // halbe Barriere + halbe Wagenbreite − Toleranzen
    expect(run(touching - 0.05)).toBe(true);
    expect(run(touching + 0.2)).toBe(false);
    expect(run(0)).toBe(true);
  });
  it('Schild läuft im selben Schritt aus: Kontaktzeitpunkt entscheidet', () => {
    const run = (f: number) => {
      const s = new Sim(12, { startS: 20, startT: 8 }); s.pickups = [];
      const v = s.speedKmh / 3.6;
      s.obstacles = [{ id: 9, kind: 'barrier', x: 0, z: s.s - B.player.hitInsetZ - B.obstacle.hitInset + v * DT * f, vz: 0, hit: false, knockT: 0, knockVx: 0 }];
      s.shieldT = DT * 0.5;
      s.step(DT, { dir: 0 });
      return s.crashed;
    };
    expect(run(0.2)).toBe(false);
    expect(run(0.9)).toBe(true);
  });
  it('gleiche Eingabe ergibt gleiche Ereignisse unabhängig von der Rendergruppierung', () => {
    const go = (group: number) => {
      const s = new Sim(5); s.obstacles = [{ id: 9, kind: 'baken', x: 0, z: 70, vz: 0, hit: false, knockT: 0, knockVx: 0 }];
      let n = 0;
      while (!s.crashed && n < 1200) { for (let k = 0; k < group; k++) { s.step(DT, { dir: 0 }); n++; } }
      return [s.s.toFixed(3), s.events.map((e) => e.type).join()];
    };
    expect(go(1)).toEqual(go(2));
    expect(go(1)[1]).toContain('crash');
  });
});

describe('Strecke: stetig und leicht', () => {
  it('Mittellinie, Richtung und Krümmung sind über 30 km ohne Sprung', { timeout: 60000 }, () => {
    for (const seed of [1, 12, 99]) {
      const r = new Road(seed);
      let c0 = r.center(0), h0 = r.heading(0), k0 = r.curv(0);
      for (let z = 0.25; z < 30000; z += 0.25) {
        const c = r.center(z), h = r.heading(z), k = r.curv(z);
        expect(Math.abs(c - c0)).toBeLessThan(0.25 * 0.8);
        expect(Math.abs(h - h0)).toBeLessThan(0.25 * 3e-3);
        expect(Math.abs(k - k0)).toBeLessThan(2e-5);
        c0 = c; h0 = h; k0 = k;
      }
    }
  });
  it('Bögen sind leicht: Radius ≥ 650 m, Kurswinkel bleibt klein', () => {
    const r = new Road(12);
    let maxK = 0, maxH = 0;
    for (let z = 0; z < 40000; z += 5) { maxK = Math.max(maxK, Math.abs(r.curv(z))); maxH = Math.max(maxH, Math.abs(r.heading(z))); }
    expect(maxK).toBeLessThanOrEqual(1 / 650 + 1e-9);
    expect(maxH).toBeLessThan(0.5);
  });
  it('Randlinien und Objekte teilen dieselbe Funktion (Rand = Mittellinie ± halbe Breite)', () => {
    const r = new Road(12);
    for (let z = 0; z < 2000; z += 37) expect(r.center(z) + B.road.halfWidth - (r.center(z) - B.road.halfWidth)).toBeCloseTo(2 * B.road.halfWidth, 9);
  });
});

describe('Hügel: bergige Strecke bis 20 km, danach flach', () => {
  it('Start flach, sanfte Hügel von ≈ 3 bis 17 km (Steigung ≤ 20 %, meist 3–7 %), stetig, ab 20 km völlig flach', () => {
    for (const seed of [1, 12, 99]) {
      const r = new Road(seed);
      for (let z = 0; z <= 600; z += 25) expect(r.height(z)).toBe(0);
      for (let z = 20000; z < 60000; z += 97) expect(r.height(z)).toBe(0);
      let mn = Infinity, mx = -Infinity, maxSlope = 0, prev = r.height(0);
      for (let z = 5; z <= 22000; z += 5) { const h = r.height(z); maxSlope = Math.max(maxSlope, Math.abs(h - prev) / 5); prev = h; if (z > 800 && z < 17000) { mn = Math.min(mn, h); mx = Math.max(mx, h); } }
      expect(mx - mn).toBeGreaterThan(7);
      expect(maxSlope).toBeLessThan(0.2);
    }
  });
});

describe('Hügel verdecken keine Hindernisse in der Warnweite', () => {
  it('Sichtlinie vom Wagen (3,4 m über der Straße) über jede Kuppe zum Hindernis (1,3 m hoch) ist ab 1,25 s Vorlauf bis 1,3-fach frei, 0,8–20 km, mehrere Seeds', { timeout: 60000 }, () => {
    for (const seed of [1, 12, 99, 5]) {
      const r = new Road(seed);
      for (let c = 800; c < 20000; c += 25) {
        const eye = r.height(c) + 3.4, dWarn = (1.25 * speedAtDist(c)) / 3.6;
        for (const m of [1, 1.15, 1.3]) {
          const D = dWarn * m, z = c + D, top = r.height(z) + 1.3;
          for (let u = c + 3; u < z; u += 3) expect(r.height(u)).toBeLessThanOrEqual(eye + ((top - eye) * (u - c)) / D);
        }
      }
    }
  });
});
