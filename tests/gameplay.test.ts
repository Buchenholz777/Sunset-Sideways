import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { Sim } from '../src/sim/sim';
import { KINDS, PICKUP_TYPES, type Obstacle, type PickupType } from '../src/sim/world';
import { botTarget } from './helpers/bot';
import { speedAtDist } from '../src/core/speed';

const DT = B.dt;
const mkObs = (kind: Obstacle['kind'], x: number, z: number, vz = 0): Obstacle => ({ id: Math.floor(Math.random() * 1e9), kind, x, z, vz, hit: false, knockT: 0, knockVx: 0 });

/** Testfahrer; mit collect=true steuert er zusätzlich das nächste erreichbare Pickup an (Zwangstor an seiner Position). */
function drive(seed: number, seconds: number, opts: { collect?: boolean; strip?: boolean } = {}) {
  const sim = new Sim(seed);
  let target: number | null = null;
  const seen = new Map<number, number>(), taken = new Set<PickupType>();
  const firstPickupT: number[] = [];
  let collected = 0, offered = 0, clearTaken = 0, clearedHit = 0;
  const types: PickupType[] = [];
  for (let i = 0; i < seconds * 120 && !sim.crashed; i++) {
    if (opts.strip) sim.pickups = [];
    if (i % 4 === 0) {
      let view: Pick<Sim, 'obstacles' | 'speedKmh' | 'timeScale' | 's' | 'x'> = sim;
      const pk = opts.collect ? sim.pickups.filter((p) => !p.taken && p.z > sim.s + 2).sort((a, b) => a.z - b.z)[0] : undefined;
      if (pk && (pk.z - sim.s) / (sim.speedKmh / 3.6) < 5.5) {
        const fake = (x: number): Obstacle => mkObs('barrier', x, pk.z - 0.3);
        view = { obstacles: [...sim.obstacles, fake(pk.x - 8.55), fake(pk.x - 3.45), fake(pk.x + 3.45), fake(pk.x + 8.55)], speedKmh: sim.speedKmh, timeScale: sim.timeScale, s: sim.s, x: sim.x };
      }
      target = botTarget(view as Sim, target);
    }
    for (const p of sim.pickups) if (!seen.has(p.id)) { const dup = p.type === 'glide' && [...seen.values()].some((z) => Math.abs(z - p.z) < 1); seen.set(p.id, dup ? 1e12 : p.z); if (!dup) types.push(p.type); }   // das Fliegen-Tor über drei Spuren zählt einmal
    sim.step(DT, { dir: 0, target: target ?? Math.max(-3.8, Math.min(3.8, sim.x)) });
    for (const e of sim.events) if (e.type === 'pickup') { collected++; taken.add(e.pickup); if (firstPickupT.length === 0) firstPickupT.push(sim.t); }
    for (const e of sim.events) { if (e.type === 'pickup' && e.pickup === 'clear') clearTaken++; if (e.type === 'cleared') clearedHit++; }
    sim.events.length = 0;
  }
  for (const z of seen.values()) if (z < sim.s) offered++;
  return { clearTaken, clearedHit, sim, collected, offered, taken, firstPickupT: firstPickupT[0] ?? null, types };
}

describe('Anlauf', () => {
  it('erster Ausweichmoment nach ≈ 3 s: statisches Hindernis in der Mitte, links und rechts frei', () => {
    for (const seed of [1, 12, 42, 777]) {
      const s = new Sim(seed);
      const o = [...s.obstacles].sort((a, b) => a.z - b.z);
      expect(o[0].vz).toBe(0);
      expect(o[0].x).toBe(0);
      const t = (o[0].z - s.s) / (s.speedKmh / 3.6);
      expect(t).toBeGreaterThan(2.6);
      expect(t).toBeLessThan(3.4);
    }
  });
  it('erstes Power-up ist immer Fliegen: sichtbar nach dem ersten Ausweichmanöver, bei ≈ 550–900 m, nach ≈ 8–12 s erreichbar', () => {
    const arrivals: number[] = [], dists: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const s = new Sim(seed);
      const firstObstacleZ = Math.min(...s.obstacles.map((o) => o.z));
      let first: { t: number; z: number; type: string } | null = null;
      for (let i = 0; i < 120 * 14 && !s.crashed && first === null; i++) {
        s.step(DT, { dir: 0, target: botTarget(s, null) ?? s.q });
        const pk = s.pickups.find((p) => !p.taken);
        if (pk) first = { t: s.t + (pk.z - s.s) / (s.speedKmh / 3.6), z: pk.z, type: pk.type };
      }
      expect(first).not.toBeNull();
      expect(first!.type).toBe('glide');
      expect(first!.z).toBeGreaterThan(firstObstacleZ);
      arrivals.push(first!.t); dists.push(first!.z);
    }
    expect(Math.min(...dists)).toBeGreaterThanOrEqual(550);
    expect(Math.max(...dists)).toBeLessThanOrEqual(900);
    expect(Math.min(...arrivals)).toBeGreaterThanOrEqual(7);
    expect(Math.max(...arrivals)).toBeLessThanOrEqual(12.5);
  });
});

describe('Hindernisfolgen sind ohne Power-up fair lösbar', () => {
  it('60 Seeds · 120 s ohne Power-ups: der Testfahrer überlebt', () => {
    let failed = 0; const bad: number[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const r = drive(seed, 120, { strip: true });
      if (r.sim.crashed) { failed++; bad.push(seed); }
    }
    expect(bad).toEqual([]);
    expect(failed).toBe(0);
  });
  it('Vorwarnzeit: jedes Hindernis ist beim Erscheinen mindestens 2 s (Einstieg) bzw. 1,25 s (Höchsttempo) entfernt', () => {
    for (const startT of [0, 400]) {
      let minWarn = Infinity;
      for (let seed = 1; seed <= 12; seed++) {
        const s = new Sim(seed, { startT });
        const known = new Set<number>();
        const rec = () => { for (const o of s.obstacles) if (!known.has(o.id)) { known.add(o.id); minWarn = Math.min(minWarn, (o.z - s.s) / Math.max(1, s.speedKmh / 3.6 - o.vz)); } };
        rec();
        for (let i = 0; i < 120 * 60 && !s.crashed; i++) { s.pickups = []; s.step(DT, { dir: 0, target: botTarget(s, null) ?? s.q }); rec(); }
      }
      expect(minWarn).toBeGreaterThanOrEqual(startT === 0 ? 2 : 1.25);
    }
  });
  it('Verkehr bleibt langsamer als der Spieler; Hindernisse sind statisch oder langsamer Verkehr', () => {
    const s = new Sim(12);
    for (let i = 0; i < 120 * 40; i++) { s.pickups = []; s.step(DT, { dir: 0, target: botTarget(s, null) ?? s.q }); for (const o of s.obstacles) expect(o.vz * 3.6).toBeLessThan(s.speedKmh); }
  });
});

describe('Power-ups im Spiel', () => {
  it('Pickups erscheinen als Mix aller vier Typen und sind anfahrbar (Testfahrer sammelt ≥ 85 %)', () => {
    let offered = 0, collected = 0, deaths = 0; const all = new Set<PickupType>();
    for (let seed = 1; seed <= 24; seed++) {
      const r = drive(seed, 90, { collect: true });
      offered += r.offered; collected += r.collected; if (r.sim.crashed) deaths++;
      r.types.forEach((t) => all.add(t));
    }
    expect(all.size).toBe(PICKUP_TYPES.length);
    expect(offered).toBeGreaterThan(24 * 4);
    expect(collected / offered).toBeGreaterThan(0.85);
    expect(deaths).toBe(0);
  });
  it('Spurblitz trifft beim Einsammeln mindestens ein Hindernis (Platzierung vor einem Ziel in Reichweite)', () => {
    let taken = 0, hit = 0;
    for (let seed = 1; seed <= 24; seed++) { const r = drive(seed, 90, { collect: true }); taken += r.clearTaken; hit += r.clearedHit > 0 ? r.clearTaken : 0; }
    expect(taken).toBeGreaterThan(10);
    expect(hit / taken).toBeGreaterThan(0.8);
  });
});

describe('Verkehrstypen', () => {
  it('Taxi, Cabrio, Limousine und Lkw erscheinen; der Lkw ist lang, breit und der langsamste Verkehr', () => {
    const seen = new Set<string>(); let truckV = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = new Sim(seed);
      for (let i = 0; i < 120 * 90 && !s.crashed; i++) {
        s.pickups = []; s.step(DT, { dir: 0, target: botTarget(s, null) ?? s.q });
        for (const o of s.obstacles) if (KINDS[o.kind].moving) { seen.add(o.kind); if (o.kind === 'truck') truckV = Math.max(truckV, o.vz); }
      }
    }
    expect([...seen].sort()).toEqual(['cabrio', 'sedan', 'taxi', 'truck']);
    expect(KINDS.truck.len).toBeGreaterThanOrEqual(9);
    expect(KINDS.truck.w).toBeGreaterThan(KINDS.sedan.w + 0.4);
    expect(truckV).toBeLessThanOrEqual(B.traffic.slow / 3.6 + 1e-9);
  });
  it('Lkw: Kontakt an der Rückseite beendet den Lauf, Vorbeifahren in der Nachbarspur nicht', () => {
    const run = (q: number) => {
      const s = new Sim(12, { startS: 20, startT: 8 }); (s.gen as unknown as { update: () => void }).update = () => {};
      s.pickups = []; s.obstacles = [mkObs('truck', 0, s.s + 60, 9)];
      s.q = q;
      for (let i = 0; i < 120 * 8 && !s.crashed; i++) { s.pickups = []; s.step(DT, { dir: 0, target: q }); }
      return s.crashed;
    };
    expect(run(0)).toBe(true);
    expect(run(3.6)).toBe(false);
  });
  it('Lkw braucht beim Überholen länger als eine Limousine', () => {
    const span = (kind: 'truck' | 'sedan') => (B.player.len + KINDS[kind].len) / (60 / 3.6 - 10);
    expect(span('truck')).toBeGreaterThan(span('sedan') * 1.5);
  });
});

describe('Wirkung der Power-ups', () => {
  const base = () => { const s = new Sim(12, { startS: 20, startT: 8 }); (s.gen as unknown as { update: () => void }).update = () => {}; s.obstacles = []; s.pickups = []; return s; };
  it('Impulsschild: fängt genau einen Treffer ab, stößt das Hindernis seitlich weg und ist danach verbraucht', () => {
    const s = base(); s.shieldT = B.effects.shield;
    s.obstacles = [mkObs('baken', 0, s.s + 30), mkObs('baken', 0, s.s + 90)];
    let pushed = 0;
    for (let i = 0; i < 120 * 6 && !s.crashed; i++) { s.pickups = []; s.step(DT, { dir: 0, target: 0 }); const o = s.obstacles.find((x) => x.impulse); if (o && !pushed) pushed = Math.abs(o.knockVx); }
    expect(s.events.filter((e) => e.type === 'shieldHit')).toHaveLength(1);
    expect(pushed).toBeGreaterThanOrEqual(10);
    expect(s.shieldT).toBe(0);
    expect(s.crashed).toBe(true);
    expect(s.crash!.z).toBeGreaterThan(80);
  });
  it('Impulsschild stößt auch ein fahrendes Fahrzeug aus der Bahn', () => {
    const s = base(); s.shieldT = B.effects.shield;
    s.obstacles = [mkObs('taxi', 0, s.s + 40, 12)];
    for (let i = 0; i < 120 * 3 && !s.crashed; i++) { s.pickups = []; s.step(DT, { dir: 0, target: 0 }); }
    expect(s.crashed).toBe(false);
    expect(s.obstacles.length === 0 || s.obstacles[0].hit).toBe(true);
  });
  it('Schild läuft nach 10 s ab', () => {
    const s = base(); s.shieldT = B.effects.shield;
    for (let i = 0; i < 120 * 9.9; i++) { s.step(DT, { dir: 0 }); s.obstacles = []; }
    expect(s.shieldT).toBeGreaterThan(0);
    for (let i = 0; i < 120 * 0.3; i++) { s.step(DT, { dir: 0 }); s.obstacles = []; }
    expect(s.shieldT).toBe(0);
  });
  it('Hindernis ohne Schild beendet den Lauf', () => {
    const s = base(); s.obstacles = [mkObs('barrier', 0, s.s + 40)];
    for (let i = 0; i < 120 * 3 && !s.crashed; i++) { s.pickups = []; s.step(DT, { dir: 0 }); }
    expect(s.crashed).toBe(true);
  });
  it('Spurblitz: räumt bis zu zwei Hindernisse der nächsten 90 m in der Pickup-Spur, nicht weiter und nicht in anderen Spuren', () => {
    const s = base();
    s.obstacles = [mkObs('baken', 0, s.s + 120), mkObs('barrier', 0, s.s + 40), mkObs('baken', 0, s.s + 70), mkObs('baken', 3.6, s.s + 30), mkObs('baken', 0, s.s + 300)];
    s.pickups = [{ id: 5, type: 'clear', x: 0, z: s.s + 10, taken: false }];
    for (let i = 0; i < 40; i++) s.step(DT, { dir: 0, target: 0 });
    expect(s.events.some((e) => e.type === 'blitz')).toBe(true);
    expect(s.events.filter((e) => e.type === 'cleared')).toHaveLength(2);
    const alive = s.obstacles.filter((o) => !o.hit);
    expect(alive.map((o) => `${o.kind}:${o.x}:${Math.round(o.z - s.s) > 60 ? 'far' : 'near'}`).sort()).toEqual(['baken:0:far', 'baken:0:far', 'baken:3.6:near']);
    expect(s.crashed).toBe(false);
  });
  it('Spurblitz ohne Ziel ist harmlos', () => {
    const s = base();
    s.pickups = [{ id: 5, type: 'clear', x: 0, z: s.s + 10, taken: false }];
    for (let i = 0; i < 40; i++) s.step(DT, { dir: 0, target: 0 });
    expect(s.events.some((e) => e.type === 'pickup')).toBe(true);
    expect(s.events.some((e) => e.type === 'cleared')).toBe(false);
  });
  it('Magnetfeld: zieht innerhalb von 12 s genau einmal einen Pickup aus der Nachbarspur heran und löst ihn genau einmal aus', () => {
    const s = base();
    s.pickups = [{ id: 5, type: 'magnet', x: 0, z: s.s + 10, taken: false }];
    for (let i = 0; i < 40; i++) s.step(DT, { dir: 0, target: 0 });
    expect(s.magnetT).toBeGreaterThan(B.effects.magnet - 0.6);
    s.pickups.push({ id: 6, type: 'shield', x: 3.6, z: s.s + 70, taken: false }, { id: 7, type: 'slow', x: -3.6, z: s.s + 110, taken: false });
    s.events.length = 0;
    for (let i = 0; i < 120 * 2; i++) s.step(DT, { dir: 0, target: 0 });
    expect(s.q).toBe(0);                                              // der Wagen wurde nicht gelenkt
    expect(s.events.filter((e) => e.type === 'magnetPull')).toHaveLength(1);
    expect(s.events.filter((e) => e.type === 'pickup')).toHaveLength(1);
    expect(s.shieldT).toBeGreaterThan(0);
    expect(s.slowT).toBe(0);                                          // zweiter Nachbar-Pickup bleibt liegen
    expect(s.magnetT).toBe(0);                                        // Magnet nach dem Einsatz verbraucht
  });
  it('ohne Magnet wird ein Pickup in der Nachbarspur nicht eingesammelt', () => {
    const s = base();
    s.pickups = [{ id: 6, type: 'shield', x: 3.6, z: s.s + 60, taken: false }];
    for (let i = 0; i < 120 * 2; i++) s.step(DT, { dir: 0, target: 0 });
    expect(s.shieldT).toBe(0);
  });
  it('Magnetfeld läuft nach 15 s ungenutzt ab; Zeitblase 7 s', () => {
    const s = base();
    s.pickups = [{ id: 5, type: 'magnet', x: 0, z: s.s + 10, taken: false }, { id: 6, type: 'slow', x: 0, z: s.s + 12, taken: false }];
    for (let i = 0; i < 60; i++) s.step(DT, { dir: 0, target: 0 });
    expect(s.magnetT).toBeLessThanOrEqual(B.effects.magnet);
    expect(s.slowT).toBeGreaterThan(6.4);
    expect(s.slowT).toBeLessThanOrEqual(7);
    for (let i = 0; i < 120 * 15; i++) { s.obstacles = []; s.step(DT, { dir: 0, target: 0 }); }
    expect(s.magnetT).toBe(0);
  });
});

describe('Platzierung: Umweg für den Effekt und einfache Linie bleiben fahrbar', () => {
  it('Magnetfeld steht nur mit einem Folge-Pickup in einer Nachbarspur', { timeout: 60000 }, () => {
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = new Sim(seed); const checked = new Set<number>();
      for (let i = 0; i < 120 * 100 && !s.crashed; i++) {
        s.step(DT, { dir: 0, target: botTarget(s, null) ?? s.q });
        for (const p of s.pickups) {
          if (p.type !== 'magnet' || checked.has(p.id)) continue;
          checked.add(p.id); n++;
          expect(s.pickups.some((o) => o.id !== p.id && o.type !== 'magnet' && Math.abs(o.x - p.x) > 3 && Math.abs(o.x - p.x) < 4 && o.z > p.z && o.z - p.z < 200)).toBe(true);
        }
      }
    }
    expect(n).toBeGreaterThan(3);
  });
});

describe('Gleitflug', () => {
  const base = () => { const s = new Sim(12, { startS: 20, startT: 8 }); (s.gen as unknown as { update: () => void }).update = () => {}; s.obstacles = []; s.pickups = []; return s; };
  const collect = (s: Sim, type: PickupType) => { s.pickups = [{ id: 5, type, x: 0, z: s.s + 4, taken: false }]; for (let i = 0; i < 12; i++) s.step(DT, { dir: 0, target: 0 }); };
  it('Ablauf: ≈ 0,5 s Abheben, Reiseflug, 1 s Sinken, insgesamt 8 s; Start und Landung je einmal', () => {
    const s = base(); collect(s, 'glide');
    expect(s.glideT).toBeGreaterThan(B.effects.glide - 0.2);
    const starts = s.events.filter((e) => e.type === 'glideStart').length;
    let hMid = 0, hAt05 = 0, hDown = 1e9, ends = 0;
    for (let i = 0; i < 120 * 9; i++) {
      s.obstacles = []; s.step(DT, { dir: 0, target: 0 });
      const el = B.effects.glide - s.glideT;
      if (Math.abs(el - 0.55) < DT && s.glideT > 0) hAt05 = s.height;
      if (Math.abs(el - 3) < DT) hMid = s.height;
      if (s.glideT > 0 && s.glideT < 0.5) hDown = Math.min(hDown, s.height);
      ends += s.events.filter((e) => e.type === 'glideEnd').length; s.events.length = 0;
    }
    expect(starts).toBe(1); expect(ends).toBe(1);
    expect(hAt05).toBeGreaterThan(B.glide.height * 0.97);
    expect(hMid).toBeCloseTo(B.glide.height, 6);
    expect(hDown).toBeLessThan(B.glide.height * 0.6);
    expect(s.glideT).toBe(0); expect(s.height).toBe(0);
  });
  it('Flughöhe reicht über den höchsten Lkw (3,6 m) und Absperrungen', () => { expect(B.glide.height).toBeGreaterThan(3.6 + 0.5); });
  it('Überflug: Lkw und Absperrung können den Wagen vom Abheben bis zum Aufsetzen nicht treffen', () => {
    const s = base(); collect(s, 'glide');
    s.obstacles = [mkObs('truck', 0, s.s + 40, 10), mkObs('barrier', 0, s.s + 140), mkObs('taxi', 0, s.s + 200, 15)];
    for (let i = 0; i < 120 * 4 && !s.crashed; i++) { s.step(DT, { dir: 0, target: 0 }); s.pickups = []; }
    expect(s.crashed).toBe(false);
    expect(s.airborne).toBe(true);
  });
  it('Luftlenkung funktioniert weiter', () => {
    const s = base(); collect(s, 'glide');
    for (let i = 0; i < 120; i++) { s.obstacles = []; s.step(DT, { dir: 0, target: 3.6 }); }
    expect(s.q).toBeCloseTo(3.6, 1);
    expect(s.airborne).toBe(true);
  });
  it('Boden-Pickups werden in der Luft nicht eingesammelt, ab dem Aufsetzen wieder', () => {
    const s = base(); collect(s, 'glide');
    s.pickups = [{ id: 8, type: 'shield', x: 0, z: s.s + 60, taken: false }];
    for (let i = 0; i < 120 * 2; i++) s.step(DT, { dir: 0, target: 0 });
    expect(s.shieldT).toBe(0);
    s.pickups = [];
    s.glideT = 0.02;
    for (let i = 0; i < 30; i++) s.step(DT, { dir: 0, target: 0 });
    s.pickups = [{ id: 9, type: 'shield', x: 0, z: s.s + 40, taken: false }];
    for (let i = 0; i < 120 * 2; i++) s.step(DT, { dir: 0, target: 0 });
    expect(s.shieldT).toBeGreaterThan(0);
  });
  for (const withSlow of [false, true]) {
    it(`Landung auf einem langen Lkw${withSlow ? ' bei aktiver Zeitblase' : ''}: nur dieses Objekt gilt bis zur Trennung als passiert, neue Kontakte zählen danach regulär`, () => {
      const s = base();
      if (withSlow) { s.slowT = B.effects.slow; s.slowF = B.speed.slowFactor; }
      s.glideT = 0.03;
      s.obstacles = [mkObs('truck', 0, s.s - 6, 10)];                  // überlappt den Wagen beim Aufsetzen
      let landed = false;
      for (let i = 0; i < 120 * 3 && !s.crashed; i++) {
        s.step(DT, { dir: 0, target: 0 });
        if (s.events.some((e) => e.type === 'glideEnd')) landed = true;
        s.events.length = 0;
        if (landed && i === 20) s.obstacles.push(mkObs('baken', 0, s.s + 30));   // neues Objekt danach
      }
      expect(landed).toBe(true);
      expect(s.crashed).toBe(true);
      expect(s.crash!.kind).toBe('baken');                              // der Lkw selbst hat nicht getroffen
    });
  }
  it('Landung ohne Überlappung: Lkw direkt davor trifft regulär', () => {
    const s = base(); s.glideT = 0.03;
    s.obstacles = [mkObs('truck', 0, s.s + 12, 10)];
    for (let i = 0; i < 120 * 2 && !s.crashed; i++) { s.step(DT, { dir: 0, target: 0 }); s.pickups = []; }
    expect(s.crashed).toBe(true);
  });
  it('Schild beim Abheben bleibt aktiv (aktive Spielzeit) und fängt nach der Landung einen Treffer ab', () => {
    const s = base(); s.shieldT = B.effects.shield;
    collect(s, 'glide');
    for (let i = 0; i < 120 * 8.2; i++) { s.obstacles = []; s.step(DT, { dir: 0, target: 0 }); s.pickups = []; }
    expect(s.airborne).toBe(false);
    expect(s.shieldT).toBeGreaterThan(0);
    s.obstacles = [mkObs('barrier', 0, s.s + 20)];
    for (let i = 0; i < 120 * 2 && !s.crashed; i++) { s.step(DT, { dir: 0, target: 0 }); s.pickups = []; }
    expect(s.crashed).toBe(false);
    expect(s.events.some((e) => e.type === 'shieldHit')).toBe(true);
  });
  it('später ist Fliegen selten und erscheint erst ab ≈ 25 s (nur das erste Angebot ist garantiert)', () => {
    let glides = 0, others = 0, early = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const s = new Sim(seed); const seen = new Set<number>(); let firstZ = -1;
      for (let i = 0; i < 120 * 90 && !s.crashed; i++) {
        s.step(DT, { dir: 0, target: botTarget(s, null) ?? s.q });
        for (const p of s.pickups) if (!seen.has(p.id)) { seen.add(p.id); if (firstZ < 0) firstZ = p.z; if (Math.abs(p.z - firstZ) < 1) continue; if (p.type === 'glide') { glides++; if (s.t < 20) early++; } else others++; }
      }
    }
    expect(glides).toBeGreaterThan(0);
    expect(glides).toBeLessThan(others * 0.25);
    expect(early).toBe(0);
  });
});

describe('Spurblitz-Zeitfenster', () => {
  it('räumt innerhalb von 6 s insgesamt höchstens zwei Hindernisse seiner Spur, sobald sie in Reichweite kommen', () => {
    const s = new Sim(12, { startS: 20, startT: 8 }); (s.gen as unknown as { update: () => void }).update = () => {};
    s.pickups = [{ id: 5, type: 'clear', x: 0, z: s.s + 4, taken: false }];
    s.obstacles = [mkObs('baken', 0, s.s + 160), mkObs('baken', 0, s.s + 230), mkObs('baken', 0, s.s + 300), mkObs('baken', 3.6, s.s + 120)];
    let cleared = 0;
    for (let i = 0; i < 120 * 6 && !s.crashed; i++) { s.step(DT, { dir: 0, target: 0 }); cleared += s.events.filter((e) => e.type === 'cleared').length; s.events.length = 0; }
    expect(cleared).toBe(2);
    expect(s.blitzLeft).toBe(0);
    expect(s.crashed).toBe(true);                                      // das dritte Hindernis bleibt
  });
  it('Fenster endet nach 6 s', () => {
    const s = new Sim(12, { startS: 20, startT: 8 }); (s.gen as unknown as { update: () => void }).update = () => {};
    s.pickups = [{ id: 5, type: 'clear', x: 0, z: s.s + 4, taken: false }];
    for (let i = 0; i < 12; i++) s.step(DT, { dir: 0, target: 0 });
    expect(s.blitzT).toBeGreaterThan(B.effects.blitz - 0.2);
    for (let i = 0; i < 120 * 6.2; i++) { s.obstacles = []; s.step(DT, { dir: 0, target: 0 }); }
    expect(s.blitzT).toBe(0);
  });
});

describe('Phantom-Turbo und Pfadfinder', () => {
  const base = () => { const s = new Sim(12, { startS: 3000, startT: 8 }); (s.gen as unknown as { update: () => void }).update = () => {}; s.obstacles = []; s.pickups = []; return s; };
  it('Phantom-Turbo: Tempo wird weich um 20 % angehoben, hält 6 s und fällt weich zurück; der Tacho zeigt das effektive Tempo', () => {
    const s = base();
    s.pickups = [{ id: 5, type: 'boost', x: 0, z: s.s + 4, taken: false }];
    for (let i = 0; i < 12; i++) s.step(DT, { dir: 0, target: 0 });
    expect(s.boostT).toBeGreaterThan(B.effects.boost - 0.2);
    let prev = s.speedKmh, maxStep = 0;
    for (let i = 0; i < 120 * 2; i++) { s.obstacles = []; s.step(DT, { dir: 0, target: 0 }); maxStep = Math.max(maxStep, Math.abs(s.speedKmh - prev)); prev = s.speedKmh; }
    expect(s.speedKmh / speedAtDist(s.s)).toBeGreaterThan(1.19);
    expect(maxStep).toBeLessThan(2.5);                                  // keine Sprünge
    for (let i = 0; i < 120 * 5; i++) { s.obstacles = []; s.step(DT, { dir: 0, target: 0 }); }
    expect(s.boostT).toBe(0);
    expect(s.speedKmh / speedAtDist(s.s)).toBeLessThan(1.02);
  });
  it('Phantom-Turbo erhöht die Lenkgeschwindigkeit mit dem Tempo', () => {
    const a = base(), b = base(); b.boostT = 6; b.boostF = B.speed.boostFactor;
    for (let i = 0; i < 12; i++) { a.obstacles = []; b.obstacles = []; a.step(DT, { dir: 1 }); b.step(DT, { dir: 1 }); }
    expect(b.vq).toBeGreaterThan(a.vq);
  });
  it('Pfadfinder zeigt die freie, erreichbare Spur und endet nach 10 s', () => {
    const s = base(); s.guideT = B.effects.guide;
    s.obstacles = [mkObs('barrier', 0, s.s + 150), mkObs('baken', -3.6, s.s + 150)];
    s.step(DT, { dir: 0, target: 0 });
    expect(s.guideQ).toBe(3.6);
    s.obstacles = [mkObs('barrier', 3.6, s.s + 150), mkObs('baken', 0, s.s + 150)];
    for (let i = 0; i < 8; i++) s.step(DT, { dir: 0, target: 0 });
    expect(s.guideQ).toBe(-3.6);
    for (let i = 0; i < 120 * 10.2; i++) { s.obstacles = []; s.step(DT, { dir: 0, target: 0 }); }
    expect(s.guideT).toBe(0);
    expect(s.guideQ).toBeNull();
  });
  it('Die Pfadfinder-Spur führt den Testfahrer ohne Treffer durch 40 s Verkehr', () => {
    const s = new Sim(7);
    for (let i = 0; i < 120 * 40 && !s.crashed; i++) { s.pickups = []; s.guideT = 5; s.step(DT, { dir: 0, target: s.guideQ ?? s.q }); }
    expect(s.crashed).toBe(false);
  });
});

describe('Erstes Angebot: Fliegen-Tor über drei Spuren', () => {
  it('in jedem Versuch drei gleiche Fliegen-Pickups in drei Spuren auf gleicher Höhe, ab 550 m', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = new Sim(seed);
      let found: Sim['pickups'] = [];
      for (let i = 0; i < 120 * 14 && found.length === 0; i++) { s.step(DT, { dir: 0, target: botTarget(s, null) ?? s.q }); if (s.pickups.length) found = [...s.pickups]; }
      expect(found.filter((p) => p.type === 'glide')).toHaveLength(3);
      expect(new Set(found.map((p) => Math.round(p.x))).size).toBe(3);
      expect(Math.max(...found.map((p) => Math.abs(p.z - found[0].z)))).toBeLessThan(1);
      expect(found[0].z).toBeGreaterThanOrEqual(550);
    }
  });
});
