import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { speedAtDist } from '../src/core/speed';
import { Sim } from '../src/sim/sim';
import { KINDS, type ObjKind, type Obstacle, type PickupType } from '../src/sim/world';
import { planGuide } from '../src/sim/guide';

const DT = B.dt;
let nextId = 9000;
const mkObs = (kind: ObjKind, x: number, z: number, vz = 0): Obstacle => ({ id: nextId++, kind, x, z, vz, hit: false, knockT: 0, knockVx: 0 });
const base = (startS = 3000) => { const s = new Sim(12, { startS, startT: 8, noDynamic: true }); (s.gen as unknown as { update: () => void }).update = () => {}; s.obstacles = []; s.pickups = []; return s; };
const take = (s: Sim, type: PickupType) => { s.pickups = [{ id: nextId++, type, x: s.q, z: s.s + 4, taken: false }]; for (let i = 0; i < 12; i++) s.step(DT, { dir: 0, target: s.q }); };

describe('Gruppe E – Power-up-Zustände (P1.3.9)', () => {
  it('34. Power-ups stapeln nicht: erneutes Einsammeln setzt die Dauer auf den Grundwert zurück, nie darüber', () => {
    for (const [type, key] of [['shield', 'shieldT'], ['slow', 'slowT'], ['magnet', 'magnetT'], ['guide', 'guideT']] as const) {
      const s = base();
      take(s, type);
      const first = s[key];
      for (let i = 0; i < 120; i++) { s.obstacles = []; s.step(DT, { dir: 0, target: 0 }); }
      take(s, type);
      expect(s[key], type).toBeLessThanOrEqual(B.effects[type]);
      expect(s[key], type).toBeGreaterThan(first - 0.3);                      // zurückgesetzt, nicht addiert
    }
    const s = base(); take(s, 'boost'); take(s, 'boost');
    expect(s.boostT).toBeLessThanOrEqual(B.effects.boost);
    expect(s.pendingFx).toBeNull();                                           // derselbe Effekt wird nicht vorgemerkt
  });

  it('35. alle Timer enden zuverlässig und der Effekt ist danach vollständig entfernt', () => {
    const s = base();
    for (const t of ['shield', 'slow', 'magnet', 'guide', 'clear'] as PickupType[]) take(s, t);
    s.boostT = B.effects.boost; s.boostF = B.speed.boostFactor;
    for (let i = 0; i < 120 * (B.effects.shield + 1); i++) { s.obstacles = []; s.pickups = []; s.step(DT, { dir: 0, target: 0 }); }
    expect([s.shieldT, s.slowT, s.magnetT, s.guideT, s.boostT, s.blitzT, s.glideT, s.graceT]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(s.guideQ).toBeNull();
    expect(s.speedKmh / speedAtDist(s.s)).toBeGreaterThan(0.999);
    expect(s.speedKmh / speedAtDist(s.s)).toBeLessThan(1.001);
    expect(s.height).toBe(0);
    expect(s.invulnerable).toBe(false);
  });

  it('Fliegen und Phantom-Turbo sind exklusiv: im Flug werden Boden-Pickups nicht eingesammelt; nach dem Flug ist der Turbo normal verfügbar', () => {
    const s = base();
    take(s, 'glide');
    expect(s.glideT).toBeGreaterThan(0);
    take(s, 'boost');                                                          // im Flug liegt der Boden-Pickup unerreichbar unter dem Wagen
    expect(s.boostT).toBe(0);
    expect(s.pendingFx).toBeNull();
    let both = false;
    for (let i = 0; i < 120 * 5; i++) { s.obstacles = []; s.pickups = []; s.step(DT, { dir: 0, target: 0 }); if (s.glideT > 0 && s.boostT > 0) both = true; }
    expect(both).toBe(false);
    take(s, 'boost');
    expect(s.boostT).toBeGreaterThan(0);
  });
  it('Phantom-Turbo → Fliegen: Fliegen wird vorgemerkt (Ereignis „queued“) und startet erst nach dem Turbo, nie gleichzeitig', () => {
    const s = base();
    take(s, 'boost');
    expect(s.boostT).toBeGreaterThan(0);
    s.events.length = 0;
    take(s, 'glide');
    expect(s.glideT).toBe(0);
    expect(s.pendingFx).toBe('glide');
    expect(s.events.some((e) => e.type === 'queued')).toBe(true);
    let both = false, flew = false;
    for (let i = 0; i < 120 * 8; i++) {
      s.obstacles = []; s.pickups = []; s.step(DT, { dir: 0, target: 0 });
      if (s.glideT > 0 && s.boostT > 0) both = true;
      if (s.glideT > 0) flew = true;
    }
    expect(both).toBe(false);
    expect(flew).toBe(true);
    expect(s.pendingFx).toBeNull();
    expect(s.glideT).toBe(0);
  });

  it('ein weiterer gleicher Pickup während der Vormerkung ersetzt sie (kein Stapel, höchstens ein vorgemerkter Effekt)', () => {
    const s = base();
    take(s, 'boost');
    take(s, 'glide');
    take(s, 'glide');
    expect(s.pendingFx).toBe('glide');
    let flights = 0, prev = 0;
    for (let i = 0; i < 120 * 10; i++) { s.obstacles = []; s.pickups = []; s.step(DT, { dir: 0, target: 0 }); if (prev === 0 && s.glideT > 0) flights++; prev = s.glideT; }
    expect(flights).toBe(1);                                                   // genau ein Flug
  });

  it('Schild bleibt während anderer Effekte gespeichert und stapelt nicht', () => {
    const s = base();
    take(s, 'shield');
    take(s, 'boost');
    expect(s.shieldT).toBeGreaterThan(0);
    expect(s.boostT).toBeGreaterThan(0);
    take(s, 'shield');
    expect(s.shieldT).toBeLessThanOrEqual(B.effects.shield);
  });

  it('Zeitblase verlangsamt nur den Verkehr/Spieler-Vortrieb, nicht die Spiellogik: Timer laufen in echter aktiver Zeit', () => {
    const s = base();
    take(s, 'slow');
    const t0 = s.t, st0 = s.slowT;
    for (let i = 0; i < 120; i++) { s.obstacles = []; s.step(DT, { dir: 0, target: 0 }); }
    expect(s.t - t0).toBeCloseTo(1, 2);
    expect(st0 - s.slowT).toBeCloseTo(1, 2);                                   // genau eine Sekunde Spielzeit, nicht 0,6
    expect(s.slowF).toBeLessThan(0.7);
  });

  it('33. Pfadfinder zeigt einen gültigen Fahrweg und berücksichtigt angekündigte Spurwechsel (beide Spuren gesperrt)', () => {
    const s = base();
    const v = s.speedKmh / 3.6;
    const z = s.s + 2.0 * (v - 13);
    // Ein Fahrzeug in der linken Spur kündigt den Wechsel in die Mitte an; die rechte Spur ist frei
    const o = mkObs('sedan', -3.6, z, 13); o.lc = { stage: 'warn', t: 0.3, fromX: -3.6, toX: 0 };
    const q = planGuide([o], 0, s.s, s.speedKmh, 1);
    expect(q).toBe(3.6);
    // ohne Ankündigung wäre die Mitte frei: dann bleibt der Marker in der aktuellen (mittleren) Spur
    const plain = mkObs('sedan', -3.6, z, 13);
    expect(planGuide([plain], 0, s.s, s.speedKmh, 1)).toBe(0);
    // alle Marker liegen auf einer Spurmitte
    expect([-3.6, 0, 3.6]).toContain(q);
  });
});

describe('Gruppe E – Nichts bleibt unfair: Schutzphasen', () => {
  it('Schildtreffer-Schutzphase ≈ 0,5 s; Phantom-Turbo-Reaktivierungsschutz ≈ 0,5 s', () => {
    expect(B.powers.graceShield).toBeCloseTo(0.5, 5);
    expect(B.powers.graceBoost).toBeLessThanOrEqual(0.5);
  });
  it('Landung am Ende der Verlängerung ist nie ein sofortiger Crash (Überlappung gilt bis zur Trennung als passiert)', () => {
    const s = base();
    s.glideT = 0.04;
    s.obstacles = [mkObs('truck', 0, s.s - 3, 0)];                              // stehender Lkw direkt unter dem Landepunkt, länger als die Verlängerung
    for (let i = 0; i < 120 * 4 && !s.crashed; i++) { s.step(DT, { dir: 0, target: 0 }); s.pickups = []; }
    expect(s.crashed).toBe(false);
    void KINDS;
  });
});
