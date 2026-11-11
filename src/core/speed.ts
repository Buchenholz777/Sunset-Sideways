import { BALANCE } from '../config/balance';

/**
 * Grundtempo nach der gefahrenen Strecke des aktuellen Versuchs: Stützpunkte (m, km/h) aus der Balancing-Tabelle,
 * dazwischen monotone kubische Hermite-Interpolation (Fritsch–Carlson): stetig, ohne Überschwinger und ohne Sprünge.
 * Hinter dem letzten Stützpunkt bleibt das Tempo konstant (600 km/h).
 */
let X: number[] = [];
let Y: number[] = [];
let TAN: number[] = [];

/** Baut Stützpunkte und Tangenten neu auf (Start, Admin-Konfiguration). */
export function setSpeedKnots(knots: ReadonlyArray<readonly [number, number]>): void {
  X = knots.map((k) => k[0]);
  Y = knots.map((k) => k[1]);
  const n = X.length;
  const d = Array.from({ length: n - 1 }, (_, i) => (Y[i + 1] - Y[i]) / (X[i + 1] - X[i]));
  const m = new Array<number>(n).fill(0);
  m[0] = d[0]; m[n - 1] = 0;                       // sanfter Auslauf am Ende
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const aa = m[i] / d[i], bb = m[i + 1] / d[i], h = Math.hypot(aa, bb);
    if (h > 3) { m[i] = (3 * aa * d[i]) / h; m[i + 1] = (3 * bb * d[i]) / h; }
  }
  TAN = m;
}
setSpeedKnots(BALANCE.speed.knots);

/** Maximales Grundtempo (km/h) der aktuellen Konfiguration. */
export const maxKmh = (): number => Y[Y.length - 1];

/** Grundtempo in km/h nach s Metern gefahrener Strecke. */
export function speedAtDist(s: number): number {
  if (s <= X[0]) return Y[0];
  if (s >= X[X.length - 1]) return Y[Y.length - 1];
  let i = 0;
  while (s > X[i + 1]) i++;
  const h = X[i + 1] - X[i], t = (s - X[i]) / h;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * Y[i] + (t3 - 2 * t2 + t) * h * TAN[i] + (-2 * t3 + 3 * t2) * Y[i + 1] + (t3 - t2) * h * TAN[i + 1];
}

/** Fahrzeit (s) von Streckenmeter s0 bis s1 mit dem Grundtempo (Simpson-Integration). */
export function travelTime(s0: number, s1: number): number {
  if (s1 <= s0) return 0;
  const n = Math.max(2, 2 * Math.ceil((s1 - s0) / 20));
  const h = (s1 - s0) / n;
  const f = (s: number) => 3.6 / speedAtDist(s);
  let sum = f(s0) + f(s1);
  for (let i = 1; i < n; i++) sum += f(s0 + i * h) * (i % 2 ? 4 : 2);
  return (sum * h) / 3;
}

/** Tempo mit Zeitblasenfaktor f (1 = normal, sonst ≈ 0,78) in km/h. */
export function effectiveSpeedKmh(s: number, slowFactor = 1): number {
  return speedAtDist(s) * slowFactor;
}

export const kmhToMps = (v: number): number => v / 3.6;

/** Lenkparameter nach Tempo: Querzielgeschwindigkeit, Anstieg, Auslaufen (Tasten) sowie Folgegeschwindigkeit und Glättung (Touch). */
export interface SteerParams { vKey: number; tauUp: number; tauStop: number; vTouch: number; tauTouch: number; lag: number }
export function steerAt(kmh: number): SteerParams {
  const S = BALANCE.steer;
  const f = Math.max(0, Math.min(1.25, (kmh - S.vLo) / (S.vHi - S.vLo)));
  const mix = (a: number, b: number) => a + (b - a) * f;
  return {
    vKey: mix(S.base.vKey, S.fast.vKey), tauUp: mix(S.base.tauUp, S.fast.tauUp), tauStop: mix(S.base.tauStop, S.fast.tauStop),
    vTouch: mix(S.base.vTouch, S.fast.vTouch), tauTouch: mix(S.base.tauTouch, S.fast.tauTouch), lag: mix(S.base.lag, S.fast.lag),
  };
}
