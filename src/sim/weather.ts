import { createRng } from '../core/rng';

/**
 * Wetter (nur Darstellung und Klang, keine Spielmechanik): Grundsätzlich trocken. Frühestens ab ≈ 16 km kann es regnen, danach in einzelnen Schauern von
 * 1,5–3,2 km Länge mit trockenen Strecken (2,5–6 km) dazwischen. Stärke hängt nur von Seed und Strecke ab (reproduzierbar, bildratenunabhängig).
 */
export const WEATHER = {
  from: 16_000,
  firstJitter: [300, 2_500] as const,
  len: [1_500, 3_200] as const,
  gap: [2_500, 6_000] as const,
  /** Länge des weichen Ein- und Ausblendens (m). */
  fade: 300,
  horizon: 400_000,
} as const;

export interface Shower { start: number; end: number; peak: number }

const cache = new Map<number, Shower[]>();

export function planWeather(seed: number): Shower[] {
  const hit = cache.get(seed >>> 0);
  if (hit) return hit;
  const rnd = createRng((seed ^ 0x3c9e57) >>> 0);
  const between = (a: number, b: number): number => a + (b - a) * rnd();
  const out: Shower[] = [];
  let at = WEATHER.from + between(WEATHER.firstJitter[0], WEATHER.firstJitter[1]);
  while (at < WEATHER.horizon) {
    const len = between(WEATHER.len[0], WEATHER.len[1]);
    out.push({ start: Math.round(at), end: Math.round(at + len), peak: 0.55 + 0.45 * rnd() });
    at += len + between(WEATHER.gap[0], WEATHER.gap[1]);
  }
  if (cache.size > 8) cache.clear();
  cache.set(seed >>> 0, out);
  return out;
}

const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** Regenstärke 0…1 an der Strecke s. */
export function rainAt(seed: number, s: number): number {
  if (s < WEATHER.from - WEATHER.fade) return 0;
  for (const w of planWeather(seed)) {
    if (s < w.start - WEATHER.fade) return 0;
    if (s > w.end + WEATHER.fade) continue;
    return w.peak * smooth((s - (w.start - WEATHER.fade * 0.5)) / WEATHER.fade) * (1 - smooth((s - (w.end - WEATHER.fade * 0.5)) / WEATHER.fade));
  }
  return 0;
}
