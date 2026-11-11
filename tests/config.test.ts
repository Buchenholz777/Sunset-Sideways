import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { DEFAULT_CONFIG, FIELDS, applyConfig, applyDefaults, clone, getPath, knotsFor, normalize, pickupShares, setPath, trafficShares, validate, withProfile, type GameConfig } from '../src/config/runtime';
import { analyze } from '../src/config/analyze';
import { speedAtDist } from '../src/core/speed';
import { Generator, type GenWorld } from '../src/gen/generator';
import { Sim } from '../src/sim/sim';
import { botInput } from './helpers/bot';

afterEach(() => applyDefaults());

/** Probelauf des Generators: liefert alle erzeugten Hindernisse und Pickups über die Strecke. */
function gen(seed: number, startS = 0, span = 6000) {
  const g = new Generator(seed, { record: true, startS });
  const w: GenWorld = { s: startS, t: 0, obstacles: [], pickups: [], nextId: 1 };
  const seenO = new Map<number, string>(), seenP = new Map<number, { type: string; z: number }>();
  while (w.s < startS + span) {
    const dt = 20 / ((speedAtDist(w.s) / 3.6) || 1);
    for (const o of w.obstacles) o.z += o.vz * dt;
    w.s += 20; w.t += dt;
    g.update(w);
    for (const o of w.obstacles) seenO.set(o.id, o.kind);
    for (const p of w.pickups) seenP.set(p.id, { type: p.type, z: p.z });
    w.obstacles = w.obstacles.filter((o) => o.z > w.s - 40);
  }
  return { kinds: [...seenO.values()], pickups: [...seenP.values()], log: g.log };
}
const count = (xs: string[]): Record<string, number> => xs.reduce<Record<string, number>>((m, k) => { m[k] = (m[k] ?? 0) + 1; return m; }, {});
const cfg = (f: (c: GameConfig) => void): GameConfig => { const c = clone(DEFAULT_CONFIG); f(c); return normalize(c); };

describe('Konfiguration: Standardwerte und Validierung', () => {
  it('Standardwerte entsprechen exakt dem bisherigen Spielverhalten (BALANCE-Ausgangswerte)', () => {
    applyDefaults();
    expect(B.speed.knots.map((k) => [...k])).toEqual([[0, 210], [1000, 325], [2000, 370], [6000, 430], [12000, 480], [16000, 520], [20000, 550], [27000, 600]]);
    expect(B.effects).toEqual({ shield: 10, slow: 7, magnet: 15, blitz: 6, glide: 8, boost: 6, guide: 10 });
    expect(B.glide.firstFrom).toBe(550);
    expect(B.steer.sens).toEqual({ key: 1, touch: 1 });
    expect(B.scenery.keys).toEqual([0, 15000, 17000, 20000]);
    expect(B.gen.gapScale).toBe(1);
    expect(B.pickups.glideBoost).toBe(0);
  });

  it('jeder Regler: Standardwert liegt im Bereich, Normalisierung rundet und begrenzt', () => {
    for (const f of FIELDS) {
      const d = getPath(DEFAULT_CONFIG, f.path) as number;
      expect(d, f.path).toBeGreaterThanOrEqual(f.min); expect(d, f.path).toBeLessThanOrEqual(f.max);
      const hi = clone(DEFAULT_CONFIG), lo = clone(DEFAULT_CONFIG);
      setPath(hi, f.path, f.max * 10); setPath(lo, f.path, f.min - 100);
      expect(getPath(normalize(hi), f.path), f.path).toBe(f.max);
      expect(getPath(normalize(lo), f.path), f.path).toBe(f.min);
      expect(validate(hi).some((i) => i.path === f.path && i.level === 'error'), f.path).toBe(true);
      expect(f.effect.length, f.path).toBeGreaterThan(10);
    }
    expect(normalize('müll')).toEqual(DEFAULT_CONFIG);
    expect(normalize({ tempo: { startKmh: 'schnell' } }).tempo.startKmh).toBe(210);
  });

  it('Kombinationen: Reihenfolge Dämmerung/Nacht/Mond, mindestens ein Hindernistyp, Tempoabstand', () => {
    expect(validate(cfg((c) => { c.scenery.duskKm = 20; c.scenery.nightKm = 21; })).some((i) => i.path === 'scenery.nightKm')).toBe(true);
    expect(validate(cfg((c) => { c.scenery.nightKm = 30; c.scenery.moonHighKm = 25; })).some((i) => i.path === 'scenery.moonHighKm')).toBe(true);
    expect(validate(cfg((c) => { c.traffic.taxi = c.traffic.cabrio = c.traffic.sedan = c.traffic.truck = 0; c.traffic.baken = false; c.traffic.barrier = false; })).some((i) => i.level === 'error')).toBe(true);
    expect(validate(cfg((c) => { c.tempo.startKmh = 320; c.tempo.maxKmh = 350; })).some((i) => i.path === 'tempo.maxKmh')).toBe(true);
    expect(validate(DEFAULT_CONFIG)).toEqual([]);
  });

  it('Profile: Arcade = Standard; Entspannt langsamer, Anspruchsvoll schneller; danach frei änderbar', () => {
    expect(withProfile(DEFAULT_CONFIG, 'arcade')).toEqual(DEFAULT_CONFIG);
    const r = withProfile(DEFAULT_CONFIG, 'relaxed'), h = withProfile(DEFAULT_CONFIG, 'hard');
    expect(r.tempo.density).toBeLessThan(1); expect(h.tempo.density).toBeGreaterThan(1);
    expect(r.tempo.maxKmh).toBeLessThan(600); expect(h.tempo.maxKmh).toBeGreaterThan(600);
    const edited = clone(r); edited.tempo.maxKmh = 560;
    expect(normalize(edited).tempo.maxKmh).toBe(560);
  });

  it('Alle drei Profile bestehen die Generator-Prüfung ohne Konflikte', () => {
    for (const p of ['relaxed', 'arcade', 'hard'] as const) {
      const a = analyze(withProfile(DEFAULT_CONFIG, p));
      expect(a.issues.filter((i) => i.level === 'error'), p).toEqual([]);
    }
  });
});

describe('Jeder Regler hat beobachtbare Wirkung im Spiel', () => {
  it('Tempo: Start-/Höchsttempo und Strecke bis zum Maximum verändern die Kurve', () => {
    applyConfig(cfg((c) => { c.tempo.startKmh = 150; c.tempo.maxKmh = 500; c.tempo.distToMaxKm = 10; }));
    expect(speedAtDist(0)).toBeCloseTo(150, 5);
    expect(speedAtDist(10000)).toBeCloseTo(500, 5);
    expect(speedAtDist(30000)).toBeCloseTo(500, 5);
    expect(speedAtDist(5000)).toBeGreaterThan(300);
    expect(knotsFor(DEFAULT_CONFIG.tempo)).toEqual([[0, 210], [1000, 325], [2000, 370], [6000, 430], [12000, 480], [16000, 520], [20000, 550], [27000, 600]]);
    const sim = new Sim(7, {});
    expect(sim.speedKmh).toBeCloseTo(150, 0);
  });

  it('Begegnungsdichte und Mindestabstand: mehr/weniger Begegnungen je km', () => {
    const per = (c: GameConfig) => { applyConfig(c); return gen(5, 0, 8000).log.length; };
    const base = per(DEFAULT_CONFIG), dense = per(cfg((c) => { c.tempo.density = 1.6; }));
    const sparse = per(cfg((c) => { c.tempo.density = 0.6; }));
    expect(dense).toBeGreaterThan(base); expect(sparse).toBeLessThan(base);
    const wide = per(cfg((c) => { c.traffic.minGap = 2.5; }));
    expect(wide).toBeLessThan(base);
  });

  it('Verkehr: Gewicht 0 schließt einen Typ aus; Baken/Absperrung abschaltbar; Anteile folgen den Gewichten', () => {
    applyConfig(cfg((c) => { c.traffic.truck = 0; c.traffic.taxi = 0; }));
    const k = count(gen(3, 3000, 8000).kinds);
    expect(k.truck ?? 0).toBe(0); expect(k.taxi ?? 0).toBe(0);
    expect(k.sedan + k.cabrio).toBeGreaterThan(5);
    applyConfig(cfg((c) => { c.traffic.baken = false; c.traffic.barrier = false; }));
    const k2 = count(gen(4, 3000, 8000).kinds);
    expect(k2.baken ?? 0).toBe(0); expect(k2.barrier ?? 0).toBe(0);
    applyConfig(cfg((c) => { c.traffic.taxi = c.traffic.cabrio = c.traffic.sedan = 0; c.traffic.truck = 3; }));
    const k3 = count(gen(6, 3000, 8000).kinds);
    expect(k3.taxi ?? 0).toBe(0); expect(k3.truck).toBeGreaterThan(0);
    const sh = trafficShares(DEFAULT_CONFIG.traffic);
    expect(Object.values(sh).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(trafficShares(cfg((c) => { c.traffic.truck = 3; }).traffic).truck).toBeGreaterThan(sh.truck);
    expect(trafficShares(cfg((c) => { c.traffic.baken = false; c.traffic.barrier = false; }).traffic).baken).toBe(0);
  });

  it('Power-ups: ausgeschaltete Typen erscheinen nie; Gesamthäufigkeit 0 = keine; Häufigkeit skaliert das Angebot', () => {
    for (const off of ['shield', 'slow', 'clear', 'magnet', 'glide', 'boost', 'guide'] as const) {
      applyConfig(cfg((c) => { c.pickups.on[off] = false; }));
      let total = 0, hit = 0;
      for (const seed of [1, 2, 3]) { const p = gen(seed, 0, 12000).pickups; total += p.length; hit += p.filter((x) => x.type === off).length; }
      expect(total, off).toBeGreaterThan(8);
      expect(hit, off).toBe(0);
    }
    applyConfig(cfg((c) => { c.pickups.freq = 0; }));
    expect(gen(1, 0, 12000).pickups.length).toBe(0);
    const n = (f: number) => { applyConfig(cfg((c) => { c.pickups.freq = f; })); return [1, 2, 3, 4].reduce((a, s) => a + gen(s, 0, 12000).pickups.length, 0); };
    expect(n(2.5)).toBeGreaterThan(n(1)); expect(n(0.4)).toBeLessThan(n(1));
    applyConfig(cfg((c) => { for (const k of ['shield', 'slow', 'clear', 'magnet', 'glide', 'boost', 'guide'] as const) c.pickups.on[k] = false; }));
    expect(gen(1, 0, 12000).pickups.length).toBe(0);
  });

  it('Fliegen: erstes Angebot frühestens ab der eingestellten Strecke; Anteil erhöht die Fliegen-Häufigkeit', () => {
    applyConfig(cfg((c) => { c.pickups.glideFirstM = 2500; }));
    for (const seed of [1, 2, 3, 4]) {
      const first = gen(seed, 0, 6000).pickups.filter((p) => p.type === 'glide').map((p) => p.z);
      if (first.length) expect(Math.min(...first), `seed ${seed}`).toBeGreaterThanOrEqual(2500);
    }
    const g = (share: number) => { applyConfig(cfg((c) => { c.pickups.share.glide = share; })); return [1, 2, 3, 4, 5].reduce((a, s) => a + gen(s, 0, 15000).pickups.filter((p) => p.type === 'glide').length, 0); };
    expect(g(3)).toBeGreaterThan(g(0.3));
    expect(pickupShares(DEFAULT_CONFIG.pickups).glide).toBeLessThan(pickupShares(cfg((c) => { c.pickups.share.glide = 2; }).pickups).glide);
  });

  it('Flugwoche: während des Ereignisses mehr Fliegen, danach wieder normal', () => {
    const c = cfg((x) => { x.event.on = true; x.event.glideBoost = 2; });
    const glides = (active: boolean) => { applyConfig(c, active); return [1, 2, 3, 4, 5].reduce((a, s) => a + gen(s, 0, 15000).pickups.filter((p) => p.type === 'glide').length, 0); };
    const on = glides(true), off = glides(false);
    expect(on).toBeGreaterThan(off);
    expect(B.pickups.glideBoost).toBe(0);                                  // nach dem Ereignis: reguläre Konfiguration
    expect(pickupShares(c.pickups, 2).glide).toBeGreaterThan(pickupShares(c.pickups, 0).glide);
  });

  it('Dauer der Power-ups wirkt in der Simulation', () => {
    applyConfig(cfg((c) => { c.pickups.dur.shield = 20; }));
    const sim = new Sim(11, {});
    sim.pickups.push({ id: 9001, type: 'shield', x: sim.q, z: sim.s + 1.5, taken: false });
    for (let i = 0; i < 400 && sim.shieldT === 0; i++) sim.step(B.dt, { dir: 0, target: null });
    expect(sim.shieldT).toBeGreaterThan(19);
  });

  it('Steuerung: Empfindlichkeit verändert Querbewegung (Tastatur und Touch)', () => {
    const run = (c: GameConfig, input: { dir: number; target: number | null }) => {
      applyConfig(c);
      const sim = new Sim(21, {});
      sim.obstacles = []; (sim.gen as unknown as { update: () => void }).update = () => {};
      for (let i = 0; i < 14; i++) sim.step(B.dt, input);
      return Math.abs(sim.q);
    };
    const key = (k: number) => run(cfg((c) => { c.controls.key = k; }), { dir: 1, target: null });
    expect(key(0.5)).toBeLessThan(key(1));
    expect(key(1.5)).toBeGreaterThanOrEqual(key(1) - 1e-6);
    const touch = (k: number) => run(cfg((c) => { c.controls.touch = k; }), { dir: 0, target: 3.6 });
    expect(touch(0.5)).toBeLessThan(touch(1));
  });

  it('Kulisse: Dämmerung/Nacht/Mond verschieben das Licht; Schalter und Neon sind in BALANCE wirksam', async () => {
    const { lightT, moonAt } = await import('../src/render/scenery');
    const at = (c: GameConfig, m: number) => { applyConfig(c); return lightT(m); };
    expect(at(DEFAULT_CONFIG, 10000)).toBeCloseTo(0.104, 2);
    expect(at(cfg((c) => { c.scenery.duskKm = 5; c.scenery.nightKm = 8; }), 10000)).toBe(1);
    expect(at(cfg((c) => { c.scenery.duskKm = 5; c.scenery.nightKm = 12; }), 6000)).toBeGreaterThan(0);
    const L = { w: 800, h: 600, cx: 400, hy: 250 } as never;
    applyConfig(DEFAULT_CONFIG); const m0 = moonAt(24000, L).y;
    applyConfig(cfg((c) => { c.scenery.nightKm = 12; c.scenery.moonHighKm = 20; })); const m1 = moonAt(24000, L).y;
    expect(m1).toBeLessThan(m0);                                                  // früher höher
    applyConfig(cfg((c) => { c.scenery.planes = false; c.scenery.peds = false; c.scenery.fountains = false; c.scenery.neon = 0.3; c.audio.music = 0.4; c.audio.sfx = 0.6; }));
    expect(B.scenery).toMatchObject({ planes: false, peds: false, fountains: false, neon: 0.3 });
    expect(B.audio).toMatchObject({ music: 0.4, engine: 1, sfx: 0.6 });
  });

  it('Hohes Tempo + dichter Verkehr + niedrige Empfindlichkeit: Generator hält die Strecke fair (Bot besteht), Analyse meldet Konflikt', () => {
    const hard = cfg((c) => { c.tempo.maxKmh = 640; c.tempo.startKmh = 240; c.tempo.density = 1.4; c.traffic.minGap = 0.8; c.controls.key = 0.8; c.controls.touch = 0.8; });
    const a = analyze(hard);
    expect(a.issues.filter((i) => i.level === 'error')).toEqual([]);
    applyConfig(hard);
    const sim = new Sim(41, {});
    const cache = { target: null as number | null };
    for (let i = 0; i < 40 * 120 && !sim.crashed; i++) sim.step(B.dt, botInput(sim, i, cache));
    expect(sim.crashed).toBe(false);
    const bad = cfg((c) => { c.tempo.maxKmh = 700; c.controls.key = 0.5; c.controls.touch = 0.5; c.tempo.density = 1.6; });
    expect(analyze(bad).issues.some((i) => i.level === 'error' && (i.path === 'controls.key' || i.path === 'controls.touch'))).toBe(true);
  });
});
