import { describe, expect, it } from 'vitest';
import { WEATHER, planWeather, rainAt } from '../src/sim/weather';

describe('Wetter', () => {
  it('bleibt bis ≈ 16 km trocken und ist reproduzierbar', () => {
    for (const seed of [1, 12, 777, 4242]) {
      for (let s = 0; s < WEATHER.from - WEATHER.fade; s += 50) expect(rainAt(seed, s), `Seed ${seed} bei ${s} m`).toBe(0);
      expect(planWeather(seed)).toEqual(planWeather(seed));
    }
  });
  it('Schauer: erster frühestens ab 16 km, Länge 1,5–3,2 km, trockene Abstände, Stärke 0…1 und stetig', () => {
    for (const seed of [1, 12, 777, 4242]) {
      const w = planWeather(seed);
      expect(w.length).toBeGreaterThan(10);
      expect(w[0].start).toBeGreaterThanOrEqual(WEATHER.from);
      for (let i = 0; i < w.length; i++) {
        expect(w[i].end - w[i].start).toBeGreaterThanOrEqual(WEATHER.len[0] - 1); expect(w[i].end - w[i].start).toBeLessThanOrEqual(WEATHER.len[1] + 1);
        if (i) expect(w[i].start - w[i - 1].end).toBeGreaterThanOrEqual(WEATHER.gap[0] - 1);
      }
      let prev = 0, rainy = 0, n = 0;
      for (let s = 15_000; s < 60_000; s += 5) { const r = rainAt(seed, s); expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(1); expect(Math.abs(r - prev)).toBeLessThan(0.05); prev = r; n++; if (r > 0.05) rainy++; }
      expect(rainy / n).toBeGreaterThan(0.1); expect(rainy / n).toBeLessThan(0.6);     // meistens trocken, aber spürbar Regen
    }
  });
});
