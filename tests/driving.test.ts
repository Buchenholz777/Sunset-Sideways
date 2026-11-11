import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { speedAtDist, travelTime } from '../src/core/speed';
import { dragMeters } from '../src/input/input';
import { Sim, type SteerInput } from '../src/sim/sim';

const DT = B.dt;
function clean(startT = 8, startS = 20): Sim {
  const s = new Sim(12, { startS, startT });
  s.obstacles = []; s.pickups = [];
  return s;
}
function run(s: Sim, sec: number, inp: SteerInput | ((i: number) => SteerInput)): void {
  const n = Math.round(sec / DT);
  for (let i = 0; i < n && !s.crashed; i++) { s.obstacles = []; s.pickups = []; s.step(DT, typeof inp === 'function' ? inp(i) : inp); }
}

describe('Tempo nach gefahrener Strecke', () => {
  it('Stützpunkte: 210 / 325 (1 km) / 370 (2 km) / 430 (6 km) / 480 (12 km) / 520 (16 km) / 550 (20 km) / 600 (27 km)', () => {
    const want: [number, number][] = [[0, 210], [1000, 325], [2000, 370], [6000, 430], [12000, 480], [16000, 520], [20000, 550], [27000, 600]];
    for (const [m, v] of want) expect(speedAtDist(m)).toBeCloseTo(v, 6);
  });
  it('ab 27 km konstant 600 km/h; davor monoton steigend, ohne Sprünge und ohne Überschwinger', () => {
    expect(speedAtDist(27000)).toBeCloseTo(600, 6);
    expect(speedAtDist(1e6)).toBe(600);
    let p = 0, maxStep = 0;
    for (let m = 0; m <= 30000; m += 5) {
      const v = speedAtDist(m);
      expect(v).toBeGreaterThanOrEqual(p - 1e-9);
      expect(v).toBeLessThanOrEqual(600 + 1e-9);
      if (m > 0) maxStep = Math.max(maxStep, v - p);
      p = v;
    }
    expect(maxStep).toBeLessThan(0.7);                 // < 0,7 km/h je 5 m (steilster Teil: Start bis 1 km)
    // Zwischen den Stützpunkten bleibt die Kurve innerhalb der Nachbarwerte (monotone Interpolation)
    for (const [m0, m1] of [[0, 1000], [1000, 2000], [2000, 6000], [6000, 12000], [12000, 16000], [16000, 20000], [20000, 27000]]) {
      for (let m = m0; m <= m1; m += (m1 - m0) / 20) { expect(speedAtDist(m)).toBeGreaterThanOrEqual(speedAtDist(m0) - 1e-9); expect(speedAtDist(m)).toBeLessThanOrEqual(speedAtDist(m1) + 1e-9); }
    }
  });
  it('Fahrzeit-Integral stimmt mit schrittweiser Simulation überein', () => {
    const s = new Sim(12); s.obstacles = [];
    let guard = 0;
    while (s.s < 1000 && guard++ < 200000) { s.obstacles = []; s.pickups = []; s.step(DT, { dir: 0 }); }
    expect(s.t).toBeCloseTo(travelTime(0, 1000), 1);
  });
  it('Lauf startet bei 210 km/h; Tempo folgt der Strecke (Sim = Kurve), Tacho zeigt das effektive Tempo', () => {
    const s = new Sim(12); s.obstacles = [];
    expect(s.speedKmh).toBe(210);
    run(s, 8, { dir: 0 });
    expect(s.speedKmh).toBeCloseTo(speedAtDist(s.s), 0);
    expect(s.speedKmh).toBeGreaterThan(270);
  });
  it('Start bei 27 km und weiter: 600 km/h', () => {
    const s = new Sim(12, { startS: 28000 }); s.obstacles = [];
    run(s, 1, { dir: 0 });
    expect(s.speedKmh).toBeCloseTo(600, 1);
  });
});

describe('Lenkung per Tastatur', () => {
  it('Spurwechsel per Tastatur bei 210 km/h: Nachbarspur 0,20–0,28 s, Außenspur zu Außenspur 0,38–0,52 s, beide Richtungen', () => {
    const time = (from: number, to: number, dir: number) => {
      const s = clean(); s.q = from;
      let t = 0;
      for (; t < 2000 && (dir > 0 ? s.q < to : s.q > to); t++) { s.obstacles = []; s.step(DT, { dir }); }
      return t * DT;
    };
    for (const [a, b] of [[-3.6, 0], [0, 3.6], [-3.6, 3.6]] as const) {
      const lo = b - a > 4 ? 0.38 : 0.2, hi = b - a > 4 ? 0.52 : 0.28;
      for (const [x, y, d] of [[a, b, 1], [b, a, -1]] as const) { const t = time(x, y, d); expect(t).toBeGreaterThanOrEqual(lo); expect(t).toBeLessThanOrEqual(hi); }
    }
    const s = clean();
    run(s, 0.12, { dir: 1 });
    expect(s.vq).toBeGreaterThan(16.5);
    expect(s.vq).toBeLessThanOrEqual(18.0001);
  });
  it('Gegenlenken wechselt die Richtung schnell (≤ 0,12 s bis Gegenrichtung ≥ 50 %)', () => {
    const s = clean();
    run(s, 0.3, { dir: 1 });
    let t = 0;
    for (; t < 200 && s.vq > -8; t++) { s.obstacles = []; s.step(DT, { dir: -1 }); }
    expect(t * DT).toBeLessThanOrEqual(0.12);
  });
  it('Loslassen: Querbewegung endet zügig (≤ 0,3 s), der Wagen hält seine Position', () => {
    const s = clean();
    run(s, 0.3, { dir: 1 });
    run(s, 0.3, { dir: 0 });
    expect(Math.abs(s.vq)).toBeLessThan(0.05);
    const q = s.q;
    run(s, 2, { dir: 0 });
    expect(s.q).toBeCloseTo(q, 3);
  });
  it('links + rechts gleichzeitig = neutral; Straßenränder begrenzen, kein Randcrash', () => {
    const s = clean();
    run(s, 3, { dir: 1 });
    expect(s.q).toBeLessThanOrEqual(B.player.maxX + 1e-9);
    expect(s.crashed).toBe(false);
    run(s, 3, { dir: -1 });
    expect(s.q).toBeGreaterThanOrEqual(-B.player.maxX - 1e-9);
    expect(s.crashed).toBe(false);
  });
  it('alle drei Spuren sind erreichbar, freie Bewegung dazwischen', () => {
    const s = clean();
    run(s, 1, { dir: 0, target: -3.6 }); expect(s.q).toBeCloseTo(-3.6, 1);
    run(s, 1, { dir: 0, target: 0 }); expect(s.q).toBeCloseTo(0, 1);
    run(s, 1, { dir: 0, target: 3.6 }); expect(s.q).toBeCloseTo(3.6, 1);
    run(s, 1, { dir: 0, target: 1.7 }); expect(s.q).toBeCloseTo(1.7, 1);
  });
});

describe('Lenkung wird mit dem Tempo schneller', () => {
  const laneTime = (startS: number, from: number, to: number) => {
    const s = new Sim(12, { startS }); (s.gen as unknown as { update: () => void }).update = () => {}; s.obstacles = []; s.pickups = []; s.q = from;
    let t = 0;
    for (; t < 2000 && (to > from ? s.q < to : s.q > to); t++) { s.obstacles = []; s.step(DT, { dir: to > from ? 1 : -1 }); }
    return t * DT;
  };
  it('Nachbarspur: 210 km/h > 360 km/h > 500 km/h > 600 km/h; bei 600 km/h ≤ 0,15 s, Außenspur ↔ Außenspur ≤ 0,26 s', () => {
    const t210 = laneTime(20, 0, 3.6), t360 = laneTime(1800, 0, 3.6), t500 = laneTime(14000, 0, 3.6), t600 = laneTime(28000, 0, 3.6);
    expect(t210).toBeGreaterThan(t360); expect(t360).toBeGreaterThan(t500); expect(t500).toBeGreaterThan(t600);
    expect(t600).toBeLessThanOrEqual(0.15);
    expect(laneTime(28000, -3.6, 3.6)).toBeLessThanOrEqual(0.26);
    expect(laneTime(28000, 3.6, -3.6)).toBeLessThanOrEqual(0.26);
  });
  it('Gegenlenken bei 600 km/h wechselt die Richtung in ≤ 0,07 s; Loslassen hält die Position', () => {
    const s = new Sim(12, { startS: 28000 }); s.obstacles = [];
    for (let i = 0; i < 12; i++) { s.obstacles = []; s.step(DT, { dir: 1 }); }
    let t = 0;
    for (; t < 200 && s.vq > -10; t++) { s.obstacles = []; s.step(DT, { dir: -1 }); }
    expect(t * DT).toBeLessThanOrEqual(0.07);
    for (let i = 0; i < 12; i++) { s.obstacles = []; s.step(DT, { dir: 0 }); }
    const q = s.q;
    for (let i = 0; i < 120; i++) { s.obstacles = []; s.step(DT, { dir: 0 }); }
    expect(Math.abs(s.q - q)).toBeLessThan(0.02);
  });
  it('Touch: Swipe über ein Drittel der Breite erreicht die Außenspur bei 600 km/h in ≤ 0,2 s', () => {
    const s = new Sim(12, { startS: 28000 }); s.obstacles = []; s.pickups = []; s.q = -3.6;
    s.step(DT, { dir: 0, drag: 0, dragSeq: 1 });
    let t = 0;
    for (; t < 400 && s.q < 3.5; t++) { s.obstacles = []; s.step(DT, { dir: 0, drag: 7.2, dragSeq: 1 }); }
    expect(t * DT).toBeLessThanOrEqual(0.2);
  });
});

describe('Lenkung per Finger', () => {
  it('Aufsetzen springt nicht; der Wagen folgt dem Finger; Loslassen hält die Position', () => {
    const s = clean();
    s.q = 1.1;
    s.step(DT, { dir: 0, drag: 0, dragSeq: 1 });
    expect(s.q).toBeCloseTo(1.1, 3);
    run(s, 0.6, { dir: 0, drag: -2.5, dragSeq: 1 });
    expect(s.q).toBeCloseTo(1.1 - 2.5, 1);
    run(s, 0.05, { dir: 0, drag: null, dragSeq: 1 });
    const q = s.q;
    run(s, 1.5, { dir: 0, drag: null, dragSeq: 1 });
    expect(Math.abs(s.q - q)).toBeLessThan(0.05);
    expect(Math.abs(s.vq)).toBeLessThan(0.05);
  });
  it('zweites Aufsetzen verankert neu an der aktuellen Position (kein Sprung)', () => {
    const s = clean();
    run(s, 0.6, { dir: 0, drag: 2, dragSeq: 1 });
    const q = s.q;
    s.step(DT, { dir: 0, drag: 0, dragSeq: 2 });
    expect(Math.abs(s.q - q)).toBeLessThan(0.1);
    run(s, 0.4, { dir: 0, drag: 0, dragSeq: 2 });
    expect(Math.abs(s.q - q)).toBeLessThan(0.1);
  });
  it('schnelles Hin- und Herziehen: Position folgt, ohne Überschwingen über das Ziel hinaus', () => {
    const s = clean();
    let maxOver = 0;
    for (let i = 0; i < 360; i++) {
      s.obstacles = []; s.pickups = [];
      const tgt = (Math.floor(i / 60) % 2 ? -3.6 : 3.6);
      s.step(DT, { dir: 0, target: tgt });
      maxOver = Math.max(maxOver, Math.abs(s.q) - 3.6);
    }
    expect(maxOver).toBeLessThan(0.15);
  });
  it('Fingerweg → Meter: Totzone, 11 m je Bildbreite', () => {
    expect(dragMeters(6, 400)).toBe(0);
    expect(dragMeters(203, 400)).toBeCloseTo(((203 - B.touch.deadPx) / 400) * B.touch.mPerWidth, 9);
    expect(dragMeters(400 / 3 + B.touch.deadPx, 400)).toBeGreaterThan(7.1);   // ein Drittel der Breite ≈ Außenspur zu Außenspur
    expect(dragMeters(-203, 400)).toBeCloseTo(-((203 - B.touch.deadPx) / 400) * B.touch.mPerWidth, 9);
  });
});

describe('Fahrmechanik ohne Drift', () => {
  it('keine Handbremse, Drift, Combo oder Nitro im Fahrkern', () => {
    const s = clean() as unknown as Record<string, unknown>;
    for (const k of ['drifting', 'slipVis', 'combo', 'nitro', 'nitroT', 'turboT', 'gripT']) expect(k in s).toBe(false);
  });
  it('Kurven werden automatisch mitgefahren: Querposition ändert sich ohne Eingabe nicht', () => {
    const s = new Sim(12, { startS: 250, startT: 8 });
    run(s, 12, { dir: 0 });
    expect(s.s).toBeGreaterThan(550);
    expect(s.q).toBe(0);
    expect(Math.abs(s.road.center(s.s))).toBeGreaterThan(0.2);   // die Straße hat sich tatsächlich geneigt
  });
  it('Fahrzeugnase folgt der Straße plus kleinem Zusatz aus der Querbewegung (< 16° bei 600 km/h)', () => {
    const s = clean(3000, 30000);
    run(s, 0.04, { dir: 1 });
    expect(Math.abs(s.relAngle)).toBeLessThan((16 * Math.PI) / 180);
    expect(s.relAngle).toBeGreaterThan(0);
  });
  it('deterministisch bei gleicher Eingabefolge', () => {
    const f = () => { const x = new Sim(5); x.obstacles = []; run(x, 3, (i) => ({ dir: i < 100 ? 1 : i < 200 ? -1 : 0 })); return [x.q, x.s, x.vq, x.t]; };
    expect(f()).toEqual(f());
  });
});

describe('Zeitlupe', () => {
  it('senkt Spieler- und Verkehrstempo auf ≈ 78 % für 7 s, danach gilt das erreichte Grundtempo', () => {
    const s = clean();
    s.slowT = B.effects.slow;
    s.obstacles = [{ id: 9, kind: 'sedan', x: 0, z: s.s + 900, vz: 12, hit: false, knockT: 0, knockVx: 0 }];
    const z0 = s.obstacles[0].z;
    for (let i = 0; i < 120 * 1.5; i++) { s.pickups = []; s.step(DT, { dir: 0 }); }
    expect(s.speedKmh / speedAtDist(s.s)).toBeCloseTo(B.speed.slowFactor, 2);
    const dz = s.obstacles[0].z - z0;
    expect(dz / (12 * 1.5)).toBeGreaterThan(0.75);
    expect(dz / (12 * 1.5)).toBeLessThan(0.9);
    for (let i = 0; i < 120 * (B.effects.slow - 0.6); i++) { s.obstacles = []; s.pickups = []; s.step(DT, { dir: 0 }); }
    expect(s.slowT).toBe(0);
    expect(s.speedKmh / speedAtDist(s.s)).toBeGreaterThan(0.99);
  });
  it('Lenkung bleibt direkt (gleiche Querreaktion wie ohne Zeitlupe)', () => {
    const a = clean(), b = clean();
    b.slowT = 4; b.slowF = B.speed.slowFactor;
    run(a, 0.5, { dir: 1 }); run(b, 0.5, { dir: 1 });
    expect(b.q).toBeCloseTo(a.q, 6);
  });
});
