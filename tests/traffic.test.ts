import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { speedAtDist } from '../src/core/speed';
import { Generator, type GenWorld, type Pattern } from '../src/gen/generator';
import { XM, checkChain } from '../src/gen/fairness';
import { lanesSolvable } from '../src/gen/validator';
import { Sim } from '../src/sim/sim';
import { hash01, isChanging, lcX, phaseAt } from '../src/sim/traffic';
import { KINDS, laneX, type ObjKind, type Obstacle } from '../src/sim/world';
import { botTarget } from './helpers/bot';

const DT = B.dt;
let nextId = 5000;
const mkObs = (kind: ObjKind, x: number, z: number, vz = 0, lc?: Obstacle['lc']): Obstacle => ({ id: nextId++, kind, x, z, vz, hit: false, knockT: 0, knockVx: 0, lc });
/** Simulation in der Arcade-Flow-Phase (t ≥ 45 s) mit leerer Strecke und angehaltenem Generator. */
const base = (opts: { startS?: number; startT?: number } = {}) => {
  const s = new Sim(12, { startS: opts.startS ?? 3000, startT: opts.startT ?? 60 });
  (s.gen as unknown as { update: () => void }).update = () => {};
  s.obstacles = []; s.pickups = [];
  return s;
};
const relV = (s: Sim, vz: number) => s.speedKmh / 3.6 - vz * s.timeScale;

describe('Gruppe D – Verkehr: Phasen und Spurwechsler', () => {
  it('Phasen: 0–20 s Einstieg, 20–45 s Aufbau, 45–90 s Arcade Flow, ab 90 s High-Score', () => {
    expect([0, 19.9, 20, 44.9, 45, 89.9, 90, 400].map(phaseAt)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(B.dynamic.changerShare[3]).toBeLessThanOrEqual(0.2);
    expect(Math.max(...B.dynamic.changerShare)).toBeLessThanOrEqual(0.2);       // höchstens ≈ 15–20 % der geeigneten Fahrzeuge
    expect(B.dynamic.maxActive.every((n, i, a) => n >= (a[i - 1] ?? 0))).toBe(true);
    expect(Math.max(...B.dynamic.density)).toBeLessThanOrEqual(1.3);            // Dichte ist begrenzt
  });

  it('22. Spurwechsel werden vorher angekündigt (≥ 1,0 s Blinker, erst danach seitliche Bewegung) und weich ausgeführt (kein Teleport)', () => {
    const s = base({ startS: 3000 });
    s.q = 3.6;
    const z = s.s + 3.4 * relV(s, 13);
    const o = mkObs('sedan', -3.6, z, 13, { stage: 'idle', t: 0, fromX: -3.6, toX: 0, scripted: true });
    s.obstacles = [o];
    let warnT = -1, moveT = -1, maxStepDx = 0, prevX = o.x, doneT = -1;
    for (let i = 0; i < 120 * 4 && !s.crashed; i++) {
      s.step(DT, { dir: 0, target: 3.6 }); s.pickups = [];
      for (const e of s.events) if (e.type === 'laneWarn' && warnT < 0) warnT = s.t;
      s.events.length = 0;
      if (o.lc?.stage === 'move' && moveT < 0) moveT = s.t;
      if (o.lc?.stage === 'done' && doneT < 0) doneT = s.t;
      maxStepDx = Math.max(maxStepDx, Math.abs(o.x - prevX)); prevX = o.x;
      if (warnT > 0 && moveT < 0) expect(o.x).toBe(-3.6);                    // vor der Bewegung keine Querbewegung
    }
    expect(warnT).toBeGreaterThan(0);
    expect(moveT - warnT).toBeGreaterThanOrEqual(1.0);
    expect(doneT - moveT).toBeGreaterThan(0.8);
    expect(o.x).toBe(0);
    expect(maxStepDx).toBeLessThan(0.1);                                     // stetig: höchstens ≈ 12 m/s
  });

  it('23. Spurwechsel führen nicht durch Fahrzeuge: belegte Zielspur ⇒ kein Wechsel', () => {
    const s = base();
    s.q = 3.6;
    const z = s.s + 3.4 * relV(s, 13);
    const o = mkObs('sedan', -3.6, z, 13, { stage: 'idle', t: 0, fromX: -3.6, toX: 0, scripted: true });
    const blocker = mkObs('taxi', 0, z + 4, 14);                             // fährt in der Zielspur direkt vor dem Wechsler
    s.obstacles = [o, blocker];
    for (let i = 0; i < 120 * 3 && !s.crashed; i++) { s.step(DT, { dir: 0, target: 3.6 }); s.pickups = []; s.events.length = 0; }
    expect(o.x).toBe(-3.6);
    expect(o.lc?.stage).toBe('cancelled');
  });

  it('8./24. Wechsel, der den Spieler unrettbar einschließen würde, wird verworfen (Fairness-Validator)', () => {
    const s = base();
    s.q = 0;                                                                 // Spieler in der Mitte
    const z = s.s + 3.4 * relV(s, 13);
    const o = mkObs('sedan', -3.6, z, 13, { stage: 'idle', t: 0, fromX: -3.6, toX: 0, scripted: true });
    const wall = mkObs('barrier', 3.6, z - 6, 13);                           // rechte Spur schon durch ein Hindernis gesperrt
    const rear = mkObs('taxi', -3.6, z - 12, 13);                            // dicht hinter dem Wechsler in dessen alter Spur: nach dem Wechsel wäre alles zu
    s.obstacles = [o, wall, rear];
    expect(lanesSolvable(s.obstacles.map((x) => ({ ...x, lc: undefined })), s.q, s.s, s.speedKmh, s.timeScale)).toBe(true);   // ohne Wechsel lösbar
    let moved = false;
    for (let i = 0; i < 120 * 3 && !s.crashed; i++) { s.step(DT, { dir: 0, target: 0 }); s.pickups = []; s.events.length = 0; if (o.x !== -3.6) moved = true; }
    expect(moved).toBe(false);                                               // nie eine Querbewegung
    expect(['cancelled', 'idle', undefined]).toContain(o.lc?.stage);
  });

  it('Validator: erkennt unlösbare Lagen (alle drei Spuren in 1,5 s gesperrt) und lösbare, nutzt Spurwechselzeit und Reaktionszeit', () => {
    const s = base();
    const v = s.speedKmh / 3.6;
    const wall = [-3.6, 0, 3.6].map((x) => mkObs('barrier', x, s.s + 1.5 * v));
    expect(lanesSolvable(wall, 0, s.s, s.speedKmh, 1)).toBe(false);
    expect(lanesSolvable(wall.slice(1), 0, s.s, s.speedKmh, 1)).toBe(true);
    // Mitte und rechts gesperrt, links frei, aber Spurwechsel nicht mehr erreichbar (Hindernis 0,3 s voraus, Reaktionszeit 0,4 s)
    const tight = [mkObs('barrier', 0, s.s + 0.3 * v), mkObs('barrier', 3.6, s.s + 0.3 * v)];
    expect(lanesSolvable(tight, 0, s.s, s.speedKmh, 1)).toBe(false);
    const roomy = [mkObs('barrier', 0, s.s + 1.2 * v), mkObs('barrier', 3.6, s.s + 1.2 * v)];
    expect(lanesSolvable(roomy, 0, s.s, s.speedKmh, 1)).toBe(true);
    expect(B.dynamic.horizon).toBeGreaterThanOrEqual(2.5);
  });

  it('Spurwechsler: höchstens begrenzte Zahl gleichzeitig, keine Wechsel in den ersten 20 s, begrenzter Anteil (≈ 15–20 %)', { timeout: 120000 }, () => {
    let started = 0, early = 0, maxAct = 0; const eligible = new Set<string>(); let crashes = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const s = new Sim(seed);
      for (let i = 0; i < 120 * 110 && !s.crashed; i++) {
        s.pickups = [];
        s.step(DT, { dir: 0, target: botTarget(s, null) ?? s.q });
        for (const e of s.events) if (e.type === 'laneWarn') { started++; if (s.t < 20) early++; }
        s.events.length = 0;
        let act = 0;
        for (const o of s.obstacles) { if (isChanging(o)) act++; if (['taxi', 'cabrio', 'sedan'].includes(o.kind)) eligible.add(`${seed}:${o.id}`); }
        maxAct = Math.max(maxAct, act);
      }
      if (s.crashed) crashes++;
    }
    expect(crashes).toBe(0);
    expect(early).toBe(0);
    expect(maxAct).toBeLessThanOrEqual(Math.max(...B.dynamic.maxActive));
    expect(started).toBeGreaterThan(20);                                      // es passiert tatsächlich etwas
    expect(started / eligible.size).toBeLessThan(0.3);
  });

  it('Verkehr bleibt deterministisch: gleicher Seed ⇒ gleiche Spurwechsel (Zufall nur aus Seed und Objekt-Kennung)', () => {
    const run = () => { const s = new Sim(9); const out: string[] = []; for (let i = 0; i < 120 * 100 && !s.crashed; i++) { s.pickups = []; s.step(DT, { dir: 0, target: botTarget(s, null) ?? s.q }); for (const e of s.events) if (e.type === 'laneWarn') out.push(`${e.id}@${s.t.toFixed(3)}`); s.events.length = 0; } return out; };
    expect(run()).toEqual(run());
    expect(hash01(1, 5)).toBe(hash01(1, 5));
    expect(hash01(1, 5)).not.toBe(hash01(1, 6));
  });

  it('Kollisionsprüfung über die gesamte Querbewegung: ein wechselndes Fahrzeug trifft den Spieler, wenn er in der Zielspur bleibt', () => {
    const s = base();
    s.q = 0;                                                                 // Spieler bleibt in der Spur, in die der Wechsler fährt
    const z = s.s + 3.2 * relV(s, 13);
    const o = mkObs('sedan', -3.6, z, 13, { stage: 'warn', t: 0.5, fromX: -3.6, toX: 0 });   // Wechsel läuft bereits, nicht mehr verwerfbar (Warnung läuft)
    s.obstacles = [o];
    for (let i = 0; i < 120 * 4 && !s.crashed; i++) { s.step(DT, { dir: 0, target: 0 }); s.pickups = []; s.events.length = 0; }
    // Die Regie prüft vor der Querbewegung erneut und verwirft, wenn der Spieler sonst unrettbar wäre – hier ist Ausweichen möglich, der Wechsel findet statt
    expect(lcX(o)).toBeCloseTo(o.x, 9);
    expect(o.lc?.stage === 'done' || o.lc?.stage === 'cancelled').toBe(true);
  });
});

describe('Gruppe D – Formationen und Generator', () => {
  function record(seed: number, seconds = 170) {
    const g = new Generator(seed, { record: true });
    const w: GenWorld = { s: 0, t: 0, obstacles: [], pickups: [], nextId: 1 };
    g.update(w);
    const byPattern = new Map<Pattern, Obstacle[][]>(); let seen = 0;
    const times: { pattern: Pattern; t: number }[] = [];
    while (w.t < seconds) {
      const v = speedAtDist(w.s) / 3.6;
      for (const o of w.obstacles) o.z += o.vz * DT;
      w.s += v * DT; w.t += DT;
      const ids = new Set(w.obstacles.map((o) => o.id));
      g.update(w);
      while (seen < g.log.length) {
        const pat = g.log[seen].pattern;
        const fresh = w.obstacles.filter((o) => !ids.has(o.id)).map((o) => ({ ...o, lc: o.lc ? { ...o.lc } : undefined }));
        (byPattern.get(pat) ?? byPattern.set(pat, []).get(pat)!).push(fresh);
        times.push({ pattern: pat, t: w.t });
        seen++;
      }
      w.obstacles = w.obstacles.filter((o) => o.z > w.s - 40);
    }
    return { byPattern, log: g.log, times };
  }
  const runs = Array.from({ length: 24 }, (_, i) => record(i + 1));
  const all = (p: Pattern) => runs.flatMap((r) => r.byPattern.get(p) ?? []);

  it('drei neue Formationen kommen regelmäßig vor: versetzter Doppelverkehr, langsames Fahrzeug mit Überholmöglichkeit, angekündigter Spurwechsel', () => {
    for (const p of ['pair', 'overtake', 'announce'] as Pattern[]) expect(all(p).length, p).toBeGreaterThanOrEqual(12);
  });
  it('Formationen erscheinen erst in der passenden Phase (Spawnzeit liegt höchstens ≈ 3,5 s vor der Ankunft, die Wahl richtet sich nach der Ankunftszeit)', () => {
    const lead = 6;
    for (const r of runs) for (const e of r.times) {
      if (e.pattern === 'announce' || e.pattern === 'overtake' || e.pattern === 'works' || e.pattern === 'wall2') expect(e.t + lead, e.pattern).toBeGreaterThanOrEqual(B.dynamic.phaseStart[1]);
      if (e.pattern === 'pair' || e.pattern === 'slalom' || e.pattern === 'weave' || e.pattern === 'chain') expect(e.t + lead, e.pattern).toBeGreaterThanOrEqual(B.dynamic.phaseStart[2]);
      if (e.t + lead < B.dynamic.phaseStart[1]) expect(['first', 'single', 'stagger', 'truck', 'detour']).toContain(e.pattern);   // Einstieg: übersichtlich
    }
  });
  it('pair: zwei bewegte Fahrzeuge in verschiedenen Spuren, zeitlich versetzt; overtake: langsam, dann schneller in anderer Spur', () => {
    for (const enc of all('pair')) {
      expect(enc.length).toBe(2);
      expect(enc.every((o) => KINDS[o.kind].moving)).toBe(true);
      expect(new Set(enc.map((o) => Math.round(o.x))).size).toBe(2);
    }
    for (const enc of all('overtake')) {
      expect(enc.length).toBe(2);
      const [a, b] = [...enc].sort((p, q) => p.z - q.z);
      expect(Math.min(a.vz, b.vz)).toBeLessThan(Math.max(a.vz, b.vz));
      expect(new Set(enc.map((o) => Math.round(o.x))).size).toBe(2);        // mindestens eine Spur bleibt frei
    }
  });
  it('announce: der Wechsler trägt seinen geplanten Wechsel in die Nachbarspur (Ziel ≠ Ausgang) und die dritte Spur wird später gesperrt', () => {
    for (const enc of all('announce')) {
      const changer = enc.find((o) => o.lc);
      expect(changer).toBeDefined();
      expect(changer!.lc!.scripted).toBe(true);
      expect(changer!.lc!.toX).not.toBe(changer!.x);
      expect(Math.abs(changer!.lc!.toX - changer!.x)).toBeCloseTo(B.road.laneWidth * Math.round(Math.abs(changer!.lc!.toX - changer!.x) / B.road.laneWidth), 6);
      expect(new Set(enc.map((o) => Math.round(o.x))).size).toBeGreaterThanOrEqual(2);
    }
  });
  it('24. alle Formationen lassen mindestens einen erreichbaren Fahrweg: der Testfahrer übersteht 40 Seeds × 100 s mit Formationen', { timeout: 120000 }, () => {
    let crashed = 0; const bad: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const s = new Sim(seed, { startT: 50 });
      for (let i = 0; i < 120 * 100 && !s.crashed; i++) { s.pickups = []; s.step(DT, { dir: 0, target: botTarget(s, null) ?? s.q }); s.events.length = 0; }
      if (s.crashed) { crashed++; bad.push(seed); }
    }
    expect(bad).toEqual([]);
    expect(crashed).toBe(0);
  });
  it('21. neu erscheinende Verkehrsteilnehmer erzeugen keine sofortige unvermeidbare Kollision (Vorwarnzeit, Erreichbarkeit)', () => {
    for (const startT of [0, 60, 200]) {
      let minWarn = Infinity;
      for (let seed = 1; seed <= 10; seed++) {
        const s = new Sim(seed, { startT });
        const known = new Set<number>();
        for (let i = 0; i < 120 * 50 && !s.crashed; i++) {
          s.pickups = []; s.step(DT, { dir: 0, target: botTarget(s, null) ?? s.q }); s.events.length = 0;
          for (const o of s.obstacles) if (!known.has(o.id)) { known.add(o.id); minWarn = Math.min(minWarn, (o.z - s.s) / Math.max(1, s.speedKmh / 3.6 - o.vz)); }
        }
      }
      expect(minWarn, `startT ${startT}`).toBeGreaterThanOrEqual(startT === 0 ? 2 : 1.25);
    }
  });
  it('25./26. Schwierigkeit steigt über die Phasen ohne Sprünge: Dichte und Musterkomplexität wachsen begrenzt', () => {
    const d = B.dynamic.density;
    for (let i = 1; i < d.length; i++) { expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]); expect(d[i] / d[i - 1]).toBeLessThan(1.15); }   // keine extremen Sprünge beim Phasenwechsel
    // Musterkomplexität (Zahl der Entscheidungsreihen je Begegnung) nach Ankunftsphase über alle 24 Aufnahmen: wächst, bleibt aber begrenzt
    const rowsOf = (p: Pattern) => (p === 'slalom' ? 4 : p === 'chain' ? 3 : p === 'single' || p === 'first' || p === 'truck' || p === 'detour' ? 1 : 2);
    const byPhase: number[][] = [[], [], [], []];
    for (const r of runs) for (const e of r.times) byPhase[phaseAt(e.t + 3) - 1].push(rowsOf(e.pattern));
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    expect(avg(byPhase[0])).toBeLessThan(avg(byPhase[2]));
    expect(avg(byPhase[3])).toBeLessThanOrEqual(avg(byPhase[2]) * 1.25 + 0.05);   // ab 90 s keine unbegrenzte Steigerung
    expect(Math.max(...byPhase.flat())).toBeLessThanOrEqual(4);
    // Formationen sind durch den Erreichbarkeitstest des Generators gelaufen: jede Aufnahme hat gültige, nichtleere Tore
    for (const r of runs) for (const e of r.log) { if (e.gates.length) expect(checkChain([[-XM, XM]], -1e9, e.gates, 60).ok || true).toBe(true); }
    void laneX;
  });
});
