import { describe, expect, it } from 'vitest';
import { CASINO_THEMES, ROUTE, TUNNEL_THEMES, eventAt, eventsIn, nightFrom, planRoute, routeStrength } from '../src/sim/route';

describe('Streckenereignisse (Plan nach Distanz und Seed)', () => {
  for (const seed of [1, 7, 12, 999, 123456, 4294967295]) {
    const plan = planRoute(seed);
    const tunnels = plan.filter((e) => e.kind === 'PALM_TUNNEL'), casinos = plan.filter((e) => e.kind === 'CASINO_INTERIOR');
    it(`Seed ${seed}: erster Tunnel exakt 10.000–12.500 m, davor nichts`, () => {
      expect(tunnels[0].start).toBe(10_000);
      expect(tunnels[0].end).toBe(12_500);
      expect(plan[0]).toBe(tunnels[0]);
      expect(eventAt(plan, 9_999.9)).toBeNull();
      expect(eventAt(plan, 10_000)?.kind).toBe('PALM_TUNNEL');
      expect(eventAt(plan, 12_499.9)?.kind).toBe('PALM_TUNNEL');
      expect(eventAt(plan, 12_500)).toBeNull();
    });
    it(`Seed ${seed}: weitere Tunnel 2–3 km lang, Einfahrten 8–14 km auseinander`, () => {
      expect(tunnels.length).toBeGreaterThan(10);
      for (let i = 1; i < tunnels.length; i++) {
        const len = tunnels[i].end - tunnels[i].start, gap = tunnels[i].start - tunnels[i - 1].start;
        expect(len).toBeGreaterThanOrEqual(ROUTE.tunnel.lenMin); expect(len).toBeLessThanOrEqual(ROUTE.tunnel.lenMax);
        expect(gap).toBeGreaterThanOrEqual(ROUTE.tunnel.gapMin); expect(gap).toBeLessThanOrEqual(ROUTE.tunnel.gapMax);
      }
    });
    it(`Seed ${seed}: Casinos erst ab 20 km und Nachtbeginn, 700–1400 m, kein Überlapp, ausreichend offene Straße dazwischen`, () => {
      expect(casinos.length).toBeGreaterThan(10);
      expect(casinos[0].start).toBeGreaterThanOrEqual(20_000);
      expect(casinos[0].start).toBeGreaterThanOrEqual(nightFrom());
      for (const c of casinos) { expect(c.end - c.start).toBeGreaterThanOrEqual(700); expect(c.end - c.start).toBeLessThanOrEqual(1_400); expect(c.start).toBeGreaterThanOrEqual(20_000); }
      for (let i = 1; i < plan.length; i++) expect(plan[i].start - plan[i - 1].end).toBeGreaterThanOrEqual(ROUTE.clearance);
    });
    it(`Seed ${seed}: ungefähr 1–2 Casinos je 20 km, keine zwei Ereignisse gleichzeitig`, () => {
      const inWindow = casinos.filter((c) => c.start >= 20_000 && c.start < 220_000).length;       // 10 Fenster à 20 km
      expect(inWindow / 10).toBeGreaterThanOrEqual(1); expect(inWindow / 10).toBeLessThanOrEqual(2.2);
      for (let s = 0; s < 120_000; s += 250) expect(eventsIn(plan, s, s).length).toBeLessThanOrEqual(1);
    });
  }
  it('gleicher Seed = gleicher Plan, anderer Seed = anderer Plan (außer dem festen ersten Tunnel)', () => {
    expect(planRoute(5)).toEqual(planRoute(5));
    expect(planRoute(5)[1]).not.toEqual(planRoute(6)[1]);
  });
  it('Stärke steigt vor der Einfahrt weich an und fällt nach der Ausfahrt ab; mitten im Ereignis voll', () => {
    const plan = planRoute(12);
    expect(routeStrength(plan, 9_500).k).toBe(0);
    expect(routeStrength(plan, 9_990).k).toBeGreaterThan(0); expect(routeStrength(plan, 9_990).k).toBeLessThan(0.5);
    expect(routeStrength(plan, 11_000)).toEqual({ kind: 'PALM_TUNNEL', k: 1, theme: 0 });
    expect(routeStrength(plan, 12_700).k).toBe(0);
    let p = 0; for (let s = 9_900; s <= 10_300; s += 5) { const k = routeStrength(plan, s).k; expect(k).toBeGreaterThanOrEqual(p - 1e-9); expect(k - p).toBeLessThan(0.06); p = k; }
  });
});

describe('Themenwelten', () => {
  it('Tunnel folgen Cosmic → Atlantis → Kingdom → Jazz und wiederholen sich', () => {
    for (const seed of [1, 12, 777]) {
      const t = planRoute(seed).filter((e) => e.kind === 'PALM_TUNNEL');
      expect(t[0].start).toBe(10_000);
      t.slice(0, 12).forEach((e, i) => expect(TUNNEL_THEMES[e.theme], `Seed ${seed} Tunnel ${i}`).toBe(TUNNEL_THEMES[i % 4]));
    }
  });
  it('Casinos nutzen alle vier Themen und liegen nie in Tunneln', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) for (const e of planRoute(seed)) if (e.kind === 'CASINO_INTERIOR') { seen.add(e.theme); expect(e.start).toBeGreaterThanOrEqual(20_000); }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    expect(CASINO_THEMES.length).toBe(4);
  });
  it('NS-/AS-Schriftzüge sind aus dem Tunnelrenderer entfernt', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/render/enclosure.ts', 'utf8') + fs.readFileSync('src/render/themeart.ts', 'utf8');
    expect(src).not.toMatch(/['"`](NS|AS)['"`]/);
    expect(src).not.toMatch(/\b(drawNS|drawAS|signNS|signAS|NS_SIGN|AS_SIGN)\b/);
  });
});
