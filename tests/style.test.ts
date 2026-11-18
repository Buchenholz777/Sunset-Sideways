import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { StyleState, type StyleCtx, type StyleEvent } from '../src/sim/style';
import { Sim } from '../src/sim/sim';
import { KINDS, type ObjKind, type Obstacle } from '../src/sim/world';

const DT = B.dt;
let nextId = 1000;
const mkObs = (kind: ObjKind, x: number, z: number, vz = 0): Obstacle => ({ id: nextId++, kind, x, z, vz, hit: false, knockT: 0, knockVx: 0 });

interface DodgeOpts { slow?: boolean; magnet?: boolean; dt?: number; shift?: boolean; shiftAtTtc?: number; toQ?: number; invulnerable?: boolean; kind?: ObjKind; x?: number }

/**
 * Synthetische Ausweichfahrt gegen die reine Stil-Logik: ein Hindernis in der Spur, Ausweichen bei der Kollisionszeit shiftAtTtc mit 14 m/s,
 * Passieren, Rückgabe der neuen Zeit. Unabhängig von Sim und Generator, damit jede Regel einzeln prüfbar ist.
 */
function dodge(st: StyleState, t0: number, o: DodgeOpts = {}): { t: number; ob: Obstacle } {
  const dt = o.dt ?? DT, v = 58, kind = o.kind ?? 'barrier', L = KINDS[kind].len;
  const ob = mkObs(kind, o.x ?? 0, v * (o.shiftAtTtc ? Math.max(2.5, o.shiftAtTtc + 1) : 2.5));
  let s = 0, q = 0, t = t0, shifting = false;
  while (s < ob.z + L + B.player.len + 2) {
    if (!shifting && (ob.z - s) / v <= (o.shiftAtTtc ?? 1.0)) shifting = true;
    if (shifting && o.shift !== false) q = Math.min(o.toQ ?? 3.6, q + 14 * dt);
    s += v * dt; t += dt;
    const c: StyleCtx = { t, s, q, speed: v, ts: 1, obstacles: [ob], slowActive: !!o.slow, magnetActive: !!o.magnet, invulnerable: !!o.invulnerable, driven: shifting && o.shift !== false };
    st.update(c, dt);
  }
  return { t, ob };
}
const names = (st: StyleState): string[] => st.events.map((e) => e.type);
const find = <T extends StyleEvent['type']>(st: StyleState, type: T): Extract<StyleEvent, { type: T }>[] => st.events.filter((e): e is Extract<StyleEvent, { type: T }> => e.type === type);

describe('Gruppe A – Near Miss', () => {
  it('1. gültiger Ausweichvorgang (Kollisionskurs, Ausweichen ≤ 1,5 s vor dem Zusammenstoß, sicher passiert) erzeugt 100 Punkte', () => {
    const st = new StyleState();
    dodge(st, 0);
    expect(st.nearMissCount).toBe(1);
    expect(st.styleScore).toBe(100);
    expect(st.comboCount).toBe(1);
    expect(st.rushCharge).toBe(B.style.rush.chargePerMiss);
    expect(find(st, 'nearMiss')[0].pts).toBe(100);
  });
  it('2. frühes, ungefährliches Ausweichen (3,4 s vor dem Zusammenstoß) erzeugt keine Punkte', () => {
    const st = new StyleState();
    dodge(st, 0, { shiftAtTtc: 3.4 });
    expect(st.nearMissCount).toBe(0);
    expect(st.styleScore).toBe(0);
    expect(st.rushCharge).toBe(0);
  });
  it('3. passives Passieren (Hindernis in der Nachbarspur, keine Ausweichbewegung) erzeugt keine Punkte', () => {
    const st = new StyleState();
    dodge(st, 0, { x: 3.6, shift: false });
    dodge(st, 5, { x: -3.6, shift: false });
    expect(st.nearMissCount).toBe(0);
    expect(st.styleScore).toBe(0);
  });
  it('3b. Ausweichen ohne Spielereingabe (z. B. Korrektur ohne Eingabe) zählt nicht', () => {
    const st = new StyleState();
    const v = 58, ob = mkObs('barrier', 0, v * 2.5);
    let s = 0, q = 0, t = 0;
    while (s < ob.z + 10) { if ((ob.z - s) / v <= 1) q = Math.min(3.6, q + 14 * DT); s += v * DT; t += DT; st.update({ t, s, q, speed: v, ts: 1, obstacles: [ob], slowActive: false, magnetActive: false, invulnerable: false, driven: false }, DT); }
    expect(st.nearMissCount).toBe(0);
  });
  it('4. Kollision verhindert die Wertung (hit → keine Punkte, Combo und Rush enden)', () => {
    const st = new StyleState();
    st.comboCount = 2; st.lastNearMissT = 0; st.rushCharge = 60;
    const v = 58, ob = mkObs('barrier', 0, v * 2.5);
    let s = 0, t = 0;
    while (s < ob.z - 1) { s += v * DT; t += DT; st.update({ t, s, q: 0, speed: v, ts: 1, obstacles: [ob], slowActive: false, magnetActive: false, invulnerable: false, driven: false }, DT); }
    ob.hit = true; st.onHit();
    for (let i = 0; i < 200; i++) { s += v * DT; t += DT; st.update({ t, s, q: 0, speed: v, ts: 1, obstacles: [ob], slowActive: false, magnetActive: false, invulnerable: false, driven: false }, DT); }
    expect(st.nearMissCount).toBe(0);
    expect(st.comboCount).toBe(0);
    expect(st.rushCharge).toBe(0);
  });
  it('5. dasselbe Hindernis wird höchstens einmal gewertet (Ausweichen, Zurücklenken in der Nachbarspur)', () => {
    const st = new StyleState();
    const v = 58, ob = mkObs('truck', 0, v * 2.5);
    let s = 0, q = 0, t = 0, dir = 1;
    while (s < ob.z + KINDS.truck.len + B.player.len + 3) {
      if ((ob.z - s) / v <= 1) { q += dir * 14 * DT; if (q > 4.3) dir = -1; if (q < 3.2) dir = 1; }   // hin und her zwischen 3,2 und 4,3 m (immer neben dem Lkw)
      s += v * DT; t += DT;
      st.update({ t, s, q, speed: v, ts: 1, obstacles: [ob], slowActive: false, magnetActive: false, invulnerable: false, driven: true }, DT);
    }
    expect(st.nearMissCount).toBe(1);
    expect(st.styleScore).toBe(100);
  });
  it('5b. Fliegen, Phantom-Turbo und Schutzphase: keine Wertung und keine Rush-Energie', () => {
    const st = new StyleState();
    dodge(st, 0, { invulnerable: true });
    expect(st.nearMissCount).toBe(0);
    expect(st.rushCharge).toBe(0);
  });
  it('5c. zu großer Seitenabstand (zwei Spuren weiter) ist kein knappes Ausweichen', () => {
    const st = new StyleState();
    dodge(st, 0, { toQ: 8 });
    expect(st.nearMissCount).toBe(0);
  });
  it('6. Neon Rush 2.0 verdoppelt die Near-Miss-Punkte nicht mehr (Combo x3 → 300, Faktor 1)', () => {
    const st = new StyleState();
    st.rushActive = true; st.rushRemaining = 5; st.comboCount = 2; st.lastNearMissT = 0;
    dodge(st, 0.5);
    const e = find(st, 'nearMiss')[0];
    expect(e.mult).toBe(3);
    expect(e.pts).toBe(300);
    expect(st.rushCharge).toBe(0);                                  // während Rush keine neue Energie
  });
  it('7. Zeitblase halbiert die Near-Miss-Punkte (50) und lädt Neon Rush nur anteilig (7 statt 14 %)', () => {
    const st = new StyleState();
    dodge(st, 0, { slow: true });
    const e = find(st, 'nearMiss')[0];
    expect(e.pts).toBe(50);
    expect(st.rushCharge).toBe(B.style.rush.chargePerMiss * B.style.rush.chargeSlowK);
    expect(st.comboCount).toBe(1);                                    // Combo funktioniert weiter
    expect(StyleState.points(3, true, true)).toBe(150);               // Combo x3 × Rush 1 × Zeitblase 0,5: jeder Faktor genau einmal
  });
  it('FPS-unabhängig: 30, 60 und 120 FPS vergeben dieselben Punkte', () => {
    const res = [1 / 30, 1 / 60, 1 / 120, 1 / 144].map((dt) => { const st = new StyleState(); dodge(st, 0, { dt }); dodge(st, 2, { dt }); return [st.nearMissCount, st.styleScore, st.comboCount]; });
    for (const r of res) expect(r).toEqual([2, 300, 2]);
  });
});

describe('Gruppe B – Combo', () => {
  it('8–10. erste Aktion startet die Combo; weitere innerhalb von 4 s erhöhen den Multiplikator bis x5 (gedeckelt), Punkte 100…500', () => {
    const st = new StyleState();
    let t = 0; const pts: number[] = [];
    for (let i = 0; i < 7; i++) { t = dodge(st, t).t; pts.push(find(st, 'nearMiss').at(-1)!.pts); }
    // 7 normale Near Misses laden 98 %: kein Rush
    expect(pts).toEqual([100, 200, 300, 400, 500, 500, 500]);
    expect(find(st, 'nearMiss').map((e) => e.mult)).toEqual([1, 2, 3, 4, 5, 5, 5]);   // Multiplikator bei x5 gedeckelt
    expect(st.comboCount).toBe(7);                                      // interner Zähler wächst weiter
    expect(st.multiplier).toBe(5);
    expect(st.maxCombo).toBe(7);
    expect(st.styleScore).toBe(100 + 200 + 300 + 400 + 500 + 500 + 500);
  });
  it('11. Combo fällt nach 4 s ohne neuen Near Miss zurück (aktive Zeit), danach beginnt sie wieder bei x1', () => {
    const st = new StyleState();
    let t = dodge(st, 0).t; t = dodge(st, t).t;
    expect(st.comboCount).toBe(2);
    const ctx = (tt: number): StyleCtx => ({ t: tt, s: 1e4, q: 0, speed: 58, ts: 1, obstacles: [], slowActive: false, magnetActive: false, invulnerable: false, driven: false });
    st.update(ctx(t + 3.9), DT);
    expect(st.comboCount).toBe(2);
    st.update(ctx(t + 4.05), DT);
    expect(st.comboCount).toBe(0);
    expect(names(st)).toContain('comboLost');
    t = dodge(st, t + 5).t;
    expect(find(st, 'nearMiss').at(-1)!.mult).toBe(1);
  });
  it('12. eine durch Schild abgefangene Kollision unterbricht die Combo (und beendet Rush, Energie 0)', () => {
    const st = new StyleState();
    dodge(st, 0); dodge(st, 2);
    st.rushActive = true; st.rushRemaining = 3;
    st.events.length = 0;
    st.onHit();
    expect(st.comboCount).toBe(0);
    expect(st.rushActive).toBe(false);
    expect(st.rushCharge).toBe(0);
    expect(names(st)).toEqual(['comboLost', 'rushEnd']);
  });
  it('13. das normale Ende von Neon Rush unterbricht die Combo nicht', () => {
    const st = new StyleState();
    st.rushActive = true; st.rushRemaining = 0.01; st.comboCount = 3; st.lastNearMissT = 10;
    st.update({ t: 10.5, s: 0, q: 0, speed: 58, ts: 1, obstacles: [], slowActive: false, magnetActive: false, invulnerable: false, driven: false }, 0.02);
    expect(st.rushActive).toBe(false);
    expect(st.comboCount).toBe(3);
  });
});

describe('Gruppe C – Neon Rush', () => {
  const tick = (st: StyleState, t: number, dt: number, invulnerable = false): void => st.update({ t, s: 1e4, q: 0, speed: 58, ts: 1, obstacles: [], slowActive: false, magnetActive: false, invulnerable, driven: false }, dt);
  it('14–15. Energie steigt je Near Miss um 14 Punkte (4 Near Misses lösen keinen Rush aus); beim 8. startet Neon Rush automatisch (ohne Tasteneingabe)', () => {
    const st = new StyleState();
    let t = 0; const charges: number[] = [];
    for (let i = 0; i < 8; i++) { t = dodge(st, t).t; charges.push(st.rushCharge); if (i === 3) expect(st.rushActive).toBe(false); }
    expect(charges).toEqual([14, 28, 42, 56, 70, 84, 98, 100]);
    expect(st.rushActive).toBe(true);
    expect(st.rushCount).toBe(1);
    expect(find(st, 'rushStart')).toHaveLength(1);
    // Der auslösende Near Miss wird vor der Aktivierung gewertet
    expect(st.styleScore).toBe(100 + 200 + 300 + 400 + 500 + 500 + 500 + 500);
  });
  it('16. Rush läuft exakt 6 s aktiver Spielzeit (bei 30, 60 und 120 FPS)', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
      const st = new StyleState();
      st.rushCharge = 100; st.rushActive = true; st.rushRemaining = B.style.rush.duration;
      let t = 0, ended = -1;
      for (let i = 0; i < 1000 && ended < 0; i++) { t += dt; tick(st, t, dt); if (find(st, 'rushEnd').length) ended = t; }
      expect(Math.abs(ended - B.style.rush.duration), `dt ${dt}`).toBeLessThanOrEqual(dt + 1e-9);
      expect(st.rushCharge).toBe(0);                                   // Anzeige zurück auf 0 %
    }
  });
  it('17. während Rush wird keine neue Energie aufgebaut (Punkte nicht verdoppelt)', () => {
    const st = new StyleState();
    st.rushActive = true; st.rushRemaining = 5; st.rushCharge = 100;
    dodge(st, 0);
    expect(st.rushCharge).toBe(100);
    expect(find(st, 'nearMiss')[0].pts).toBe(100);
  });
  it('18. nach Rush gilt 8 s Abklingzeit: Energie lädt, aber die Aktivierung folgt erst nach Ablauf (keine Mehrfachaktivierung)', () => {
    const st = new StyleState();
    st.rushActive = true; st.rushRemaining = 0.02; st.rushCount = 1;
    tick(st, 0.1, 0.05);
    expect(st.rushActive).toBe(false);
    expect(st.rushCooldown).toBeCloseTo(8, 5);
    st.rushCharge = 90;
    const t1 = dodge(st, 0.2).t;                                          // lädt auf 100, aktiviert aber nicht
    expect(st.rushCharge).toBe(100);
    expect(st.rushActive).toBe(false);
    let t = t1, started = -1;
    for (let i = 0; i < 1000 && started < 0; i++) { t += 0.05; tick(st, t, 0.05); if (st.rushActive) started = t; }
    expect(started - 0.1).toBeGreaterThan(7.9);                           // erst nach den 8 s (gemessen ab Rush-Ende)
    expect(st.rushCount).toBe(2);
    for (let i = 0; i < 100; i++) tick(st, (t += 0.05), 0.05);
    expect(st.rushCount).toBe(2);                                         // nicht mehrfach
  });
  it('19. ein Absturz oder Schildtreffer beendet Rush sofort', () => {
    const st = new StyleState();
    st.rushActive = true; st.rushRemaining = 4;
    st.onHit();
    expect(st.rushActive).toBe(false);
    expect(find(st, 'rushEnd')[0].reason).toBe('hit');
  });
  it('Fliegen/Turbo: Rush-Zeit läuft weiter, aber es entsteht keine Energie', () => {
    const st = new StyleState();
    dodge(st, 0, { invulnerable: true });
    expect(st.rushCharge).toBe(0);
  });
});

describe('Gruppe C/Integration – Sim', () => {
  const base = () => { const s = new Sim(12, { startS: 20, startT: 8, noDynamic: true }); (s.gen as unknown as { update: () => void }).update = () => {}; s.obstacles = []; s.pickups = []; return s; };
  /** Fährt gegen ein Hindernis und lenkt bei der Kollisionszeit shiftTtc auf die Nachbarspur. */
  const run = (s: Sim, ob: Obstacle, shiftTtc: number, steps = 120 * 5): void => {
    s.obstacles = [ob];
    let target = 0;
    for (let i = 0; i < steps && !s.crashed; i++) {
      const rel = s.speedKmh / 3.6 - ob.vz * s.timeScale;
      if ((ob.z - s.s) / rel <= shiftTtc && ob.z > s.s) target = 3.6;
      s.step(DT, { dir: 0, target });
    }
  };
  it('echtes Ausweichen in der Simulation: ein Near Miss, 100 Punkte, Distanz unverändert', () => {
    const s = base();
    run(s, mkObs('barrier', 0, s.s + 140), 1.0);
    expect(s.crashed).toBe(false);
    expect(s.style.nearMissCount).toBe(1);
    expect(s.style.styleScore).toBe(100);
    expect(s.events.filter((e) => e.type === 'nearMiss')).toHaveLength(1);
  });
  it('Crash in der Simulation: kein Near Miss, Combo 0', () => {
    const s = base();
    run(s, mkObs('barrier', 0, s.s + 140), -1, 120 * 4);                 // nie ausweichen
    expect(s.crashed).toBe(true);
    expect(s.style.nearMissCount).toBe(0);
    expect(s.style.comboCount).toBe(0);
  });
  it('Neon Rush 2.0: Tempo ×1,15 und Unverwundbarkeit (kein Treffer), Ende stellt Tempo und Kollision wieder her', () => {
    const a = base(), b = base();
    b.style.rushActive = true; b.style.rushRemaining = B.style.rush.duration; b.style.rushCharge = 100;
    for (let i = 0; i < 240; i++) { a.step(DT, { dir: 0, target: 0 }); b.step(DT, { dir: 0, target: 0 }); a.obstacles = []; b.obstacles = []; }
    expect(b.speedKmh / a.speedKmh).toBeGreaterThan(1.13);
    expect(b.speedKmh / a.speedKmh).toBeLessThanOrEqual(B.style.rush.speedMult + 0.02);
    const c = base(); c.style.rushActive = true; c.style.rushRemaining = B.style.rush.duration;
    c.obstacles = [mkObs('barrier', 0, c.s + 60)];
    for (let i = 0; i < 120 * 3 && !c.crashed; i++) c.step(DT, { dir: 0, target: 0 });
    expect(c.crashed).toBe(false);                                       // Durchfahren
    expect(c.style.rushActive).toBe(true);
    c.style.rushRemaining = 0.001;
    for (let i = 0; i < 20; i++) c.step(DT, { dir: 0, target: 0 });
    expect(c.style.rushActive).toBe(false);
    c.obstacles = [mkObs('barrier', 0, c.s + 400)];
    for (let i = 0; i < 120 * 12 && !c.crashed; i++) c.step(DT, { dir: 0, target: 0 });
    expect(c.crashed).toBe(true);                                        // danach wieder reguläre Kollision
  });
});
