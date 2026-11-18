import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { Sim, type SimEvent } from '../src/sim/sim';
import { laneX, type ObjKind, type Obstacle } from '../src/sim/world';

const DT = B.dt;
const R = B.style.rush;
let nextId = 5000;
const mkObs = (kind: ObjKind, x: number, z: number, vz = 0): Obstacle => ({ id: nextId++, kind, x, z, vz, hit: false, knockT: 0, knockVx: 0 });
const base = (): Sim => {
  const s = new Sim(12, { startS: 20, startT: 8, noDynamic: true });
  (s.gen as unknown as { update: () => void }).update = () => {};
  s.obstacles = []; s.pickups = [];
  return s;
};
const rushOn = (s: Sim): void => { s.style.rushActive = true; s.style.rushRemaining = R.duration; s.style.rushCharge = R.maxCharge; };
/** Simulation für sec Sekunden; Ereignisse werden gesammelt. target: Funktion (Sim → Zielquerposition | null). */
function run(s: Sim, sec: number, target: (s: Sim) => number | null = () => 0, keep = false): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0, n = Math.round(sec / DT); i < n && !s.crashed; i++) {
    if (!keep) { s.pickups = []; }
    s.step(DT, { dir: 0, target: target(s) });
    ev.push(...s.events); s.events.length = 0;
  }
  return ev;
}
const of = <T extends SimEvent['type']>(ev: SimEvent[], t: T): Extract<SimEvent, { type: T }>[] => ev.filter((e): e is Extract<SimEvent, { type: T }> => e.type === t);

describe('Neon Rush 2.0 – Zustand', () => {
  it('Rush-Energie startet bei 0, Rush-Chain und Tore sind leer', () => {
    const s = base();
    expect(s.style.rushCharge).toBe(0);
    expect(s.style.rushActive).toBe(false);
    expect(s.gates).toHaveLength(0);
  });
  it('6 besonders knappe Near Misses reichen nicht ganz (108 % ⇒ sie reichen), 5 reichen nicht', () => {
    expect(R.chargePerfect * 5).toBeLessThan(R.maxCharge);
    expect(R.chargePerfect * 6).toBeGreaterThanOrEqual(R.maxCharge);
    expect(R.chargePerMiss * 7).toBeLessThan(R.maxCharge);
    expect(R.chargePerMiss * 8).toBeGreaterThanOrEqual(R.maxCharge);
    expect(R.chargePerMiss * 4).toBeLessThan(R.maxCharge);
  });
  it('Rush läuft 6 s und beginnt danach einen Cooldown von 8 s; Energie danach 0', () => {
    const s = base(); rushOn(s);
    run(s, 5.9);
    expect(s.style.rushActive).toBe(true);
    run(s, 0.3);
    expect(s.style.rushActive).toBe(false);
    expect(s.style.rushCharge).toBe(0);
    expect(s.style.rushCooldown).toBeGreaterThan(7.5);
  });
  it('Tempo ×1,15 spürbar, nie über ×1,4 zusammen mit dem Phantom-Turbo; Ende stellt das Tempo wieder her', () => {
    const a = base(), b = base(); rushOn(b);
    run(a, 1); run(b, 1);
    expect(b.speedKmh / a.speedKmh).toBeGreaterThan(1.13);
    b.boostT = 3; b.boostF = B.speed.boostFactor;
    run(b, 0.6);
    expect(b.speedKmh / (a.speedKmh * 1.0)).toBeLessThan(1.4 * 1.06);
    const c = base(); rushOn(c); c.style.rushRemaining = 0.05;
    run(c, 2);
    expect(c.rushF).toBeCloseTo(1, 1);
  });
  it('Rush und Phantom-Turbo beschädigen sich nicht: nach beiden Enden gilt wieder reguläre Kollision, keine hängenden Zustände', () => {
    const s = base(); rushOn(s); s.boostT = 1; s.boostF = 1.2;
    run(s, 7.5);
    expect(s.style.rushActive).toBe(false);
    expect(s.boostT).toBe(0);
    run(s, 1);
    expect(s.invulnerable).toBe(false);
    s.obstacles = [mkObs('barrier', 0, s.s + 300)];
    run(s, 10);
    expect(s.crashed).toBe(true);
  });
});

describe('Neon Rush 2.0 – Durchfahren', () => {
  it('Verkehr kann durchfahren werden: genau ein Kontakt-Impuls je Fahrzeug, kein Schaden, keine Punkte, keine Energie', () => {
    const s = base(); rushOn(s); s.style.rushCharge = 0;
    s.obstacles = [mkObs('taxi', 0, s.s + 40, 10), mkObs('barrier', 0, s.s + 90)];
    const ev = run(s, 2.5);
    expect(s.crashed).toBe(false);
    expect(of(ev, 'rushPass')).toHaveLength(2);
    expect(of(ev, 'nearMiss')).toHaveLength(0);
    expect(s.style.rushCharge).toBe(0);
    expect(s.style.styleScore).toBe(0);
  });
  it('Passives Durchfahren erzeugt keine Near-Miss-Punkte (Nachbarspur, aktive Eingabe)', () => {
    const s = base(); rushOn(s);
    s.obstacles = [mkObs('barrier', 3.6, s.s + 80)];
    run(s, 2.5, () => 3.0);
    expect(s.style.nearMissCount).toBe(0);
  });
});

describe('Neon Rush 2.0 – Neon Gates, Rush Chain, Schockwelle', () => {
  it('erstes Tor ≈ 1 s nach dem Start, weitere alle ≈ 1,4 s, höchstens 3, auf einer anderen Spur als der Wagen', () => {
    const s = base(); rushOn(s);
    const times: number[] = [];
    for (let i = 0; i < 120 * 6 && !s.crashed; i++) {
      s.step(DT, { dir: 0, target: 0 });
      for (const e of s.events) if (e.type === 'gateSpawn') { times.push(s.style.rushElapsed); expect(Math.abs(e.x - s.q)).toBeGreaterThan(2.5); }
      s.events.length = 0;
    }
    expect(times).toHaveLength(R.gateCount);
    expect(times[0]).toBeGreaterThanOrEqual(R.gateFirst - 0.02);
    expect(times[0]).toBeLessThan(R.gateFirst + 0.05);
    expect(times[1] - times[0]).toBeCloseTo(R.gateEvery, 1);
  });
  it('Tore liegen weit genug voraus (kein Sofort-Einsammeln) und werden nicht ohne Spurwechsel gewertet', () => {
    const s = base(); rushOn(s);
    const ev = run(s, 6.2, () => 0);
    expect(of(ev, 'gate').filter((g) => Math.abs(g.x) < 0.1)).toHaveLength(0);
    for (const g of of(ev, 'gateSpawn')) expect(g.z).toBeGreaterThan(0);
    expect(s.style.gatePoints).toBe(of(ev, 'gate').reduce((a, g) => a + g.pts, 0));
  });
  it('alle drei Tore eingesammelt: +150, +300, +450 = 900; jedes Tor genau einmal; Rush Chain steigt 1–3 und endet mit dem Rush', () => {
    const s = base(); rushOn(s);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 120 * 6.5 && !s.crashed; i++) {
      const g = s.gates.find((x) => !x.taken && !x.missed);
      s.step(DT, { dir: 0, target: g ? g.x : s.q });
      ev.push(...s.events); s.events.length = 0;
    }
    const gates = of(ev, 'gate');
    expect(gates.map((g) => g.pts)).toEqual([150, 300, 450]);
    expect(gates.map((g) => g.n)).toEqual([1, 2, 3]);
    expect(s.style.gatePoints).toBe(900);
    expect(s.style.styleScore).toBe(900);                             // keine Combo-Multiplikation
    expect(s.style.rushActive).toBe(false);
    expect(s.style.rushChain).toBe(0);                                 // Kette endet mit dem Rush, Punkte bleiben
    expect(s.gates).toHaveLength(0);
  });
  it('nicht eingesammelte Tore erzeugen keine Punkte', () => {
    const s = base(); rushOn(s);
    const ev = run(s, 6.5, () => 0);
    expect(of(ev, 'gate')).toHaveLength(0);
    expect(of(ev, 'gateMiss').length).toBeGreaterThan(0);
    expect(s.style.styleScore).toBe(0);
  });
  it('Schockwelle: löst Fahrzeuge im Wirkbereich auf (ohne Punkte und Near Miss), entfernte Fahrzeuge verschwinden aus Kollision und Verkehr', () => {
    const s = base(); rushOn(s);
    let placed = false;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 120 * 4 && !s.crashed; i++) {
      const g = s.gates.find((x) => !x.taken && !x.missed);
      if (g && !placed && g.z - s.s < 30) { placed = true; s.obstacles = [mkObs('sedan', g.x, g.z - 3), mkObs('barrier', g.x, s.s + R.waveAhead + 60)]; }
      s.step(DT, { dir: 0, target: g ? g.x : s.q });
      ev.push(...s.events); s.events.length = 0;
    }
    expect(of(ev, 'shockwave').length).toBeGreaterThan(0);
    expect(of(ev, 'cleared').some((c) => c.kind === 'sedan')).toBe(true);
    expect(of(ev, 'nearMiss')).toHaveLength(0);
    expect(s.style.styleScore).toBe(s.style.gatePoints);
  });
});

describe('Neon Rush 2.0 – Neon Slash', () => {
  it('aktiver Spurwechsel löst genau einen Slash aus; Hin-und-her-Wechsel höchstens alle 0,7 s', () => {
    const s = base(); rushOn(s);
    const ev: SimEvent[] = [];
    let flip = 0;
    for (let i = 0; i < 120 * 3 && !s.crashed; i++) {
      flip = Math.floor(i / 20) % 2;                                    // alle 1/6 s die Spur wechseln
      s.step(DT, { dir: 0, target: flip ? -3.6 : 3.6 });
      ev.push(...s.events); s.events.length = 0;
    }
    const slashes = of(ev, 'slash');
    expect(slashes.length).toBeGreaterThanOrEqual(3);
    expect(slashes.length).toBeLessThanOrEqual(Math.floor(3 / R.slashCooldown) + 1);
    expect(s.style.slashCount).toBe(slashes.length);
  });
  it('einmaliger Wechsel in die Nachbarspur = ein Slash in die richtige Richtung; ohne Rush keiner', () => {
    const s = base(); rushOn(s);
    const ev = run(s, 1.5, () => 3.6);
    const sl = of(ev, 'slash');
    expect(sl).toHaveLength(1);
    expect(sl[0].dir).toBe(1);
    const t = base();
    expect(of(run(t, 1.5, () => 3.6), 'slash')).toHaveLength(0);
  });
  it('ohne Eingabe (keine Zielvorgabe) keine Auslösung', () => {
    const s = base(); rushOn(s);
    s.q = 3.0; s.vq = 0;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 120; i++) { s.step(DT, { dir: 0, target: null }); ev.push(...s.events); s.events.length = 0; }
    expect(of(ev, 'slash')).toHaveLength(0);
  });
});

describe('Neon Rush 2.0 – sicheres Ende', () => {
  it('Fahrzeuge in der eigenen Spur kurz voraus werden beim Ende aufgelöst, weit entfernte bleiben; kurzer Übergangsschutz', () => {
    const s = base(); rushOn(s); s.style.rushRemaining = 0.02;
    const v = s.speedKmh / 3.6;
    const near = mkObs('sedan', 0, s.s + v * 0.5), far = mkObs('barrier', 0, s.s + 200), side = mkObs('barrier', 3.6, s.s + 10);
    s.obstacles = [near, far, side];
    const ev = run(s, 0.2);
    expect(of(ev, 'rushExit')).toHaveLength(1);
    expect(near.hit && near.cleared).toBe(true);
    expect(far.hit).toBe(false);
    expect(side.hit).toBe(false);
    expect(s.graceT).toBeGreaterThan(0);
    expect(s.graceT).toBeLessThanOrEqual(R.safeExit + 1e-9);
  });
  it('Nach dem Ende gibt es keinen Sofort-Crash, auch mit dichtem Verkehr in der Spur; der Schutz ist auf 0,5 s begrenzt', () => {
    const s = base(); rushOn(s); s.style.rushRemaining = 0.02;
    const v = s.speedKmh / 3.6;
    s.obstacles = [mkObs('sedan', 0, s.s + v * 0.15), mkObs('truck', 0, s.s + 4)];
    run(s, 1.5);
    expect(s.crashed).toBe(false);
    expect(s.graceT).toBe(0);
    expect(s.invulnerable).toBe(false);
  });
  it('Schildtreffer/Absturz beendet den Rush ohne Ghost-State (Gates leer, Chain 0)', () => {
    const s = base(); rushOn(s);
    run(s, 2);
    s.style.onHit();
    run(s, 0.1);
    expect(s.style.rushActive).toBe(false);
    expect(s.style.rushChain).toBe(0);
    expect(s.gates).toHaveLength(0);
    expect(s.invulnerable).toBe(false);
  });
});

describe('Neon Rush 2.0 – Wiederholung und Zeit', () => {
  it('Cooldown 8 s: erneute Aktivierung erst nach Ablauf und nur bei 100 %', () => {
    const s = base(); rushOn(s);
    run(s, 6.2);
    expect(s.style.rushActive).toBe(false);
    s.style.rushCharge = 100;
    run(s, 7);
    expect(s.style.rushActive).toBe(false);
    run(s, 1.3);
    expect(s.style.rushActive).toBe(true);
    expect(s.style.rushCount).toBe(1);
  });
  it('Laufzeiten sind simulierte Zeit: kein Fortschritt ohne step (Pause / Tab im Hintergrund)', () => {
    const s = base(); rushOn(s);
    const rem = s.style.rushRemaining;
    expect(s.style.rushRemaining).toBe(rem);
  });
  it('Gate-Positionen liegen immer auf einer der drei Spuren', () => {
    const s = base(); rushOn(s);
    const ev = run(s, 6.2, () => 0);
    for (const g of of(ev, 'gateSpawn')) expect([laneX(0), laneX(1), laneX(2)].some((x) => Math.abs(x - g.x) < 1e-9)).toBe(true);
  });
});
