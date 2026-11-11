import { afterEach, describe, expect, it, vi } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { FixedLoop } from '../src/core/loop';
import { Sim } from '../src/sim/sim';

afterEach(() => vi.unstubAllGlobals());

/** Treibt die echte FixedLoop mit einer künstlichen Bildrate; gibt den Simulationszustand nach genau N Schritten zurück. */
function runAtFps(fps: number, steps: number, stall = false) {
  let now = 0;
  let cb = null as ((t: number) => void) | null;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => { cb = f; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { cb = null; });
  const seed = 12;
  const sim = new Sim(seed, { startS: 330, startT: 8 });
  let n = 0, stalls = 0;
  // Eingabe ist eine Funktion des Schrittindex (nicht der Bildzeit): Drift, Gegenlenken, Loslassen, Spurwechsel
  const input = (i: number) => ({ dir: i < 240 ? 1 : i < 300 ? -1 : i < 420 ? 0 : 1 });
  sim.shieldT = 100; sim.slowT = 3; sim.magnetT = 5;
  const loop = new FixedLoop(() => { if (n < steps) { sim.obstacles = []; sim.step(B.dt, input(n)); n++; } }, () => {}, () => { stalls++; });
  loop.start();
  let frames = 0;
  while (n < steps && frames++ < 100000) {
    now += 1000 / fps;
    if (stall && frames === 50) now += 1000; // 1-s-Unterbrechung (Hintergrundwechsel)
    const f = cb as ((t: number) => void) | null; cb = null; f?.(now);
  }
  return { sim, stalls, state: [sim.t, sim.s, sim.q, sim.vq, sim.speedKmh, sim.slowT, sim.slowF, sim.magnetT] };
}

describe('Spielverlauf unabhängig von der Renderfrequenz (30 / 60 / 120 FPS)', () => {
  it('gleiche Eingabefolge ⇒ identischer Zustand inkl. Zeitlupe und Radar', () => {
    const a = runAtFps(30, 600).state, b = runAtFps(60, 600).state, c = runAtFps(120, 600).state;
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
  it('große Unterbrechung wird gemeldet (Pause) und holt keine Weltzeit nach', () => {
    const r = runAtFps(60, 300, true);
    expect(r.stalls).toBeGreaterThanOrEqual(1);
    expect(r.sim.t - 8).toBeCloseTo(300 * B.dt, 9); // nur tatsächlich simulierte Schritte
  });
});
