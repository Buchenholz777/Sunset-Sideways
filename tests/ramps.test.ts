import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { RAMP, RampPlan } from '../src/sim/ramps';
import { Sim } from '../src/sim/sim';
import { planRoute } from '../src/sim/route';

const DT = B.dt;
const run = (sim: Sim, sec: number, target: number | null = 0): void => { for (let i = 0; i < sec / DT && !sim.crashed; i++) sim.step(DT, { dir: 0, target }); };

describe('Rampen', () => {
  it('der Plan ist je Seed reproduzierbar, liegt außerhalb von Tunneln und Casinos und hat Mindestabstände', () => {
    for (const seed of [1, 12, 777]) {
      const a = new RampPlan(seed).upTo(60_000), b = new RampPlan(seed).upTo(60_000);
      expect(a).toEqual(b);
      expect(a.length).toBeGreaterThan(20);
      expect(a[0].z).toBeGreaterThanOrEqual(RAMP.first);
      for (let i = 1; i < a.length; i++) expect(a[i].z - a[i - 1].z).toBeGreaterThanOrEqual(RAMP.gapMin);
      const ev = planRoute(seed);
      for (const r of a) for (const e of ev) expect(r.z > e.start - 300 && r.z < e.end + 200, `Seed ${seed} Rampe ${r.z}`).toBe(false);
      expect(a.every((r) => r.truck)).toBe(true);        // nur Autotransporter, keine einzelnen Rampen
    }
  });
  it('ohne Option gibt es keine Rampen (Tests, Sprint)', () => {
    const sim = new Sim(12, { ghost: true, startS: 900 }); run(sim, 5);
    expect(sim.ramps.length).toBe(0);
  });
  it('Fahren über eine Rampe hebt ab, der Flug dauert RAMP.fly, danach wieder am Boden', () => {
    const sim = new Sim(12, { ramps: true, startS: 700, noDynamic: true });
    sim.obstacles = [];
    let took = false, maxH = 0, flew = 0;
    for (let i = 0; i < 40 / DT && !sim.crashed && !took; i++) {
      sim.obstacles = sim.obstacles.filter((o) => o.carrier);
      const r = sim.ramps.find((x) => x.z > sim.s);
      sim.step(DT, { dir: 0, target: r ? r.x : 0 });
      if (sim.glideT > 0) took = true;
    }
    expect(took).toBe(true);
    for (let i = 0; i < 4 / DT && !sim.crashed; i++) { sim.obstacles = []; sim.step(DT, { dir: 0, target: 0 }); if (sim.glideT > 0) { flew += DT; maxH = Math.max(maxH, sim.height); } }
    expect(flew).toBeGreaterThan(RAMP.fly - 0.6); expect(flew).toBeLessThan(RAMP.fly + 0.5);
    expect(maxH).toBeCloseTo(RAMP.jumpH, 0); expect(sim.jump).toBe(false);
    expect(sim.glideT).toBe(0); expect(sim.height).toBe(0);
  });
  it('im Flug lässt sich lenken, Verkehr darunter verursacht keinen Treffer', () => {
    const sim = new Sim(12, { ramps: true, startS: 700, noDynamic: true });
    sim.ramps = [{ id: 9001, x: 0, z: sim.s + 60, vz: 0, truck: false, taken: false }];
    sim.obstacles = [{ id: 9002, kind: 'barrier', x: 0, z: sim.s + 140, vz: 0, hit: false, knockT: 0, knockVx: 0 }];
    run(sim, 1.0, 0);
    expect(sim.glideT).toBeGreaterThan(0);
    const q0 = sim.q; run(sim, 0.6, 6.4);
    expect(sim.q).toBeGreaterThan(q0 + 2);
    expect(sim.crashed).toBe(false);
  });
  it('Lkw-Rampe: Rampe liegt am Heck, der Aufbau lässt sich überfliegen', () => {
    const sim = new Sim(12, { ramps: true, startS: 700, noDynamic: true });
    sim.obstacles = [];
    sim.ramps = [{ id: 9101, x: 0, z: sim.s + 90, vz: RAMP.truckV, truck: true, taken: false }];
    sim.obstacles.push({ id: 9102, kind: 'truck', x: 0, z: sim.s + 90 + RAMP.len / 2, vz: RAMP.truckV, hit: false, knockT: 0, knockVx: 0 });
    run(sim, 2.0, 0);
    expect(sim.crashed).toBe(false);
    expect(sim.ramps.some((r) => r.taken) || sim.glideT > 0 || sim.s > 900).toBe(true);
  });
  it('Ohne Rampe trifft derselbe Lkw (Kontrolle)', () => {
    const sim = new Sim(12, { ramps: true, startS: 700, noDynamic: true });
    sim.obstacles = [{ id: 9102, kind: 'truck', x: 0, z: sim.s + 90, vz: RAMP.truckV, hit: false, knockT: 0, knockVx: 0 }];
    run(sim, 2.0, 0);
    expect(sim.crashed).toBe(true);
  });
  it('in Rampennähe stehen keine anderen Hindernisse in der Rampenspur', () => {
    const sim = new Sim(12, { ramps: true, startS: 700, noDynamic: true });
    for (let i = 0; i < 60 / DT && !sim.crashed; i++) {
      sim.step(DT, { dir: 0, target: null }); if (sim.glideT > 0) continue;
      for (const r of sim.ramps) for (const o of sim.obstacles) {
        if (r.truck && o.kind === 'truck' && Math.abs(o.z - r.z - RAMP.len / 2) < 0.5) continue;
        if (Math.abs(o.x - r.x) < 2.4 && o.z > r.z - RAMP.len / 2 - 4 && o.z < r.z + RAMP.len / 2 + 4 && o.z > sim.s + 130) throw new Error(`Hindernis ${o.kind} auf Rampe bei ${r.z}`);
      }
    }
  });
});

describe('Rampen im Dauerlauf', () => {
  it('ein einfacher Testfahrer hat mit Rampen keine häufigeren Abstürze als ohne (60 s, 6 Seeds)', async () => {
    const { botTarget } = await import('./helpers/bot');
    const crashes = (ramps: boolean): number => {
      let n = 0;
      for (const seed of [1, 2, 3, 12, 777, 4242]) {
        const sim = new Sim(seed, { ramps }); let target: number | null = null;
        for (let i = 0; i < 60 / DT && !sim.crashed; i++) { if (i % 4 === 0) target = botTarget(sim, target); sim.step(DT, { dir: 0, target }); }
        if (sim.crashed) n++;
      }
      return n;
    };
    expect(crashes(true)).toBeLessThanOrEqual(crashes(false) + 1);
  });
});

describe('Rampensprung', () => {
  it('ist ein hoher Bogen mit steilem Anstieg und Scheitel RAMP.jumpH und ohne Düsenflug', () => {
    const sim = new Sim(12, { ramps: true, startS: 700, noDynamic: true });
    sim.ramps = [{ id: 9301, x: 0, z: sim.s + 40, vz: 0, truck: false, taken: false }]; sim.obstacles = [];
    const hs: number[] = [];
    for (let i = 0; i < 4 / DT && !sim.crashed; i++) { sim.step(DT, { dir: 0, target: 0 }); if (sim.glideT > 0) { expect(sim.jump).toBe(true); hs.push(sim.height); } }
    expect(hs.length * DT).toBeGreaterThan(RAMP.fly - 0.1);
    const mx = Math.max(...hs);
    expect(mx).toBeCloseTo(RAMP.jumpH, 1);
    expect(hs.indexOf(mx)).toBeLessThan(hs.length * 0.45);
    expect(hs[hs.length - 1]).toBeLessThan(0.3);
    for (let i = 1; i < hs.indexOf(mx) - 3; i++) expect(hs[i]).toBeGreaterThanOrEqual(hs[i - 1] - 1e-9);
  });
  it('Rampen-Lkw sind Autotransporter', () => {
    const sim = new Sim(12, { ramps: true, startS: 900, noDynamic: true });
    for (let i = 0; i < 6 / DT && !sim.crashed; i++) sim.step(DT, { dir: 0, target: null });
    const t = sim.obstacles.find((o) => o.carrier); expect(t?.kind).toBe('truck');
  });
});
