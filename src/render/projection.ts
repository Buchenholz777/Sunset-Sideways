import { BALANCE as B } from '../config/balance';

/** Abstand Kamera → Heck des Spielerwagens (m). */
export const CAM_BACK = 6;
/** Bis hierher lineare Perspektive; dahinter wird die Tiefe gestaucht (geöffnete Fernsicht). */
export const D0 = 12;
/** Renderdistanz der Kulisse und Objekte (m). */
export const DRAW = 460;

/** Ruhiger Straßenblick, mit begrenztem Einfluss von Lenken und Kurvenvorschau. */
export function chaseSlope(road: number, course: number, ahead: number): number {
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  return road + clamp((course - road) * 0.12, 0.03) + clamp((ahead - road) * 0.35, 0.055);
}

export interface Layout {
  w: number; h: number; scale: number; portrait: boolean; cx: number;
  hy: number; gy: number; Hv: number; fx: number; gamma: number;
  /** Faktor für Mindestgrößen in Pixeln (2 / Skalierung). */
  u: number;
}

/**
 * Interne Pixelauflösung (ganzzahlig skaliert) und Projektionsparameter. Quer- und Hochformat
 * werden getrennt komponiert; im Hochformat bestimmt die Breite die Brennweite.
 */

/** Zielgröße der kurzen Seite des Zeichenpuffers (Bildpunkte) und Obergrenze der Gesamtpixel (Welt-Canvas). */
export const RENDER = { shortLandscape: 540, shortPortrait: 480, maxPixels: 520_000, fxMaxPixels: 4_200_000 } as const;

/**
 * Verhältnis CSS-Pixel : Puffer-Pixel (stufenlos, ≥ 1). Kleine Displays laufen 1:1; große Fenster rendern bis ca. 960 × 540 (statt zuvor
 * ganzzahlig 640 × 360) und bleiben unter dem Pixelbudget. Kontinuierlich in der Fenstergröße: keine Sprünge an Schwellen.
 */
export function renderScale(cssW: number, cssH: number): number {
  const portrait = cssH > cssW;
  const short = Math.min(cssW, cssH);
  let s = Math.max(1, short / (portrait ? RENDER.shortPortrait : RENDER.shortLandscape));
  const px = (cssW * cssH) / (s * s);
  if (px > RENDER.maxPixels) s *= Math.sqrt(px / RENDER.maxPixels);
  return Math.round(s * 1000) / 1000;
}

/** true, wenn das Verhältnis (fast) ganzzahlig ist → scharfe Pixelkanten ohne Schwebungen; sonst weiche Skalierung. */
export const isCrispScale = (s: number): boolean => Math.abs(s - Math.round(s)) < 0.02;

export function makeLayout(cssW: number, cssH: number): Layout {
  const portrait = cssH > cssW;
  const scale = renderScale(cssW, cssH);
  const w = Math.max(80, Math.round(cssW / scale));
  const h = Math.max(80, Math.round(cssH / scale));
  // Hochformat: Horizont etwas tiefer → weniger Tiefenstreckung nahe am Wagen (Wagen und Hindernisse wirken nicht in die Länge gezogen, Abstände stimmen mit der Kollisionsbox überein)
  const hy = Math.round(h * ((portrait ? 0.49 : 0.34)));
  const gy = Math.round(h * ((portrait ? 0.81 : 0.82)));
  const Hv = (gy - hy) * CAM_BACK;
  // Hochformat: Straße füllt die Bildbreite (Ränder leicht angeschnitten) – sonst wirkt alles schmal und in die Länge gezogen
  const fx = Math.min(0.87 * h, ((portrait ? 1.0 : 0.85) * w * CAM_BACK) / (2 * B.road.halfWidth));
  // Fernsicht: stärkere Stauchung im schmalen Hochformat, damit alle Spuren früh unterscheidbar bleiben.
  return { w, h, scale, portrait, cx: w / 2, hy, gy, Hv, fx, gamma: portrait ? 0.4 : 0.58, u: 2 / scale };
}

/**
 * Mehr Fernsicht-Stauchung ab 600 km/h: ferne Fahrzeuge rücken im Bild näher und bleiben damit auch bei 1000 km/h lange genug erkennbar
 * (Warnzeit ≥ 0,8 s). Stetig in der Geschwindigkeit; die Tiefe bis 12 m (Nahbereich, Wagen) ist davon nicht betroffen.
 */
export function gammaBoost(kmh: number): number {
  const t = Math.max(0, Math.min(1, (kmh - 600) / 400));
  return 0.1 * t * t * (3 - 2 * t);
}

/** Effektive Tiefe: identisch bis D0, dahinter D0·(d/D0)^γ. */
export const depthEff = (d: number, L: Layout): number => (d <= D0 ? d : D0 * Math.pow(d / D0, L.gamma));
export const depthInv = (de: number, L: Layout): number => (de <= D0 ? de : D0 * Math.pow(de / D0, 1 / L.gamma));
/** Pixel pro Meter in Tiefe d. */
export const scaleAt = (d: number, L: Layout): number => L.fx / depthEff(d, L);
/** Bildzeile des Bodenpunkts in Tiefe d. */
export const groundY = (d: number, L: Layout): number => L.hy + L.Hv / depthEff(d, L);

/** Größte Tiefe, in der ein Objekt der Breite `widthM` noch mindestens `minCssPx` CSS-Pixel breit ist. */
export function readableDistance(widthM: number, minCssPx: number, L: Layout): number {
  const minPx = minCssPx / L.scale;
  let lo = 1, hi = 5000;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (scaleAt(mid, L) * widthM >= minPx) lo = mid; else hi = mid;
  }
  return lo;
}

/** Mindestbreite (Pixel) einer Spur bzw. eines Hindernisses, ab der sie als lesbar gelten. */
export const READ_LANE_PX = 12;
export const READ_OBJECT_PX = 10;
