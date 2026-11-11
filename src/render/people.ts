import { hash } from './scenery';
import { gfx, rect } from './sprites';

/** Passanten auf den Gehwegen: reine Kulisse, deterministisch aus dem Streckenabschnitt (kein Spielzustand). */
export const CHUNK = 20;

export interface Ped { x: number; z: number; type: number; pose: 0 | 1 | 2; phase: number; h: number; side: number }

const OUTFIT = [
  { top: '#d94fa8', pants: '#2a2a50', hair: '#2a1a30', skin: '#e0a882' },
  { top: '#2fb7a8', pants: '#403050', hair: '#c98a3a', skin: '#f0c8a0' },
  { top: '#f2c21a', pants: '#1e2a4a', hair: '#1a1a22', skin: '#a8704a' },
  { top: '#f0ece0', pants: '#5a3a7a', hair: '#5a2a1a', skin: '#d89a78' },
  { top: '#e8861a', pants: '#223050', hair: '#101018', skin: '#7a4a30' },
  { top: '#3f6fb5', pants: '#2a1f3a', hair: '#c8c8d8', skin: '#e8b890' },
];

/**
 * Kleine Gruppen (1–3) mit freien Abschnitten dazwischen. Seitlich liegen sie auf dem Gehweg
 * (zwischen Bordstein und Fassadenlinie). pose: 0 geht, 1 steht, 2 steht am Schaufenster (zur Fassade gedreht).
 */
export function pedsInChunk(k: number, side: number): Ped[] {
  const key = k * 13 + (side > 0 ? 7 : 3);
  const h0 = hash(key);
  if (h0 < 0.42) return [];
  const n = h0 < 0.64 ? 1 : h0 < 0.86 ? 2 : 3;
  const z0 = k * CHUNK + 2 + hash(key + 1) * 9;
  const x0 = 6.25 + hash(key + 2) * 1.5;
  const out: Ped[] = [];
  for (let i = 0; i < n; i++) {
    const r = hash(key * 7 + i * 5 + 11);
    out.push({
      x: side * (x0 + hash(key + 20 + i) * 0.7), z: z0 + i * (0.9 + hash(key + 30 + i) * 0.7),
      type: Math.floor(hash(key + 40 + i) * 6), pose: r < 0.55 ? 0 : r < 0.85 ? 1 : 2,
      phase: hash(key + 50 + i) * 6.28, h: 1.55 + hash(key + 60 + i) * 0.3, side,
    });
  }
  return out;
}

/** Zeichnet eine Person am Bodenpunkt (sx, sy); k = Pixel pro Meter. */
export function drawPed(ctx: CanvasRenderingContext2D, sx: number, sy: number, k: number, p: Ped, clock: number): void {
  const o = OUTFIT[p.type];
  const kk = Math.max(k, (2.4 * gfx.u) / 0.42);
  const H = p.h;
  const wm = p.type % 3 === 1 ? 1.2 : p.type % 3 === 2 ? 0.92 : 1;
  const L = (x0: number, top: number, w: number, h: number, c: string) => rect(ctx, sx + x0 * kk, sy - top * kk, Math.max(1, w * kk), Math.max(1, h * kk), c);
  const walk = p.pose === 0;
  const sw = walk ? Math.sin(clock * 5.2 + p.phase) : 0;
  const bob = walk ? Math.abs(sw) * 0.03 : Math.sin(clock * 1.4 + p.phase) * 0.008;
  // flacher Bodenschatten
  ctx.globalAlpha = 0.35;
  L(-0.3, 0.05, 0.6, 0.1, '#000');
  ctx.globalAlpha = 1;
  const legTop = 0.46 * H + bob;
  L(-0.14 * wm + sw * 0.07, legTop, 0.12 * wm, legTop, o.pants);
  L(0.02 * wm - sw * 0.07, legTop, 0.12 * wm, legTop - (walk ? Math.max(0, -sw) * 0.06 : 0), o.pants);
  const long = p.type === 1;
  L(-0.2 * wm, 0.84 * H + bob, 0.4 * wm, (long ? 0.54 : 0.4) * H, o.top);
  L(-0.2 * wm, 0.84 * H + bob, 0.4 * wm, 0.05, '#ffffff22');
  L(-0.27 * wm, 0.8 * H + bob + sw * 0.03, 0.07, 0.3 * H, o.top);
  L(0.2 * wm, 0.8 * H + bob - sw * 0.03, 0.07, 0.3 * H, o.top);
  if (p.type === 4) L(0.18 * wm, 0.62 * H + bob, 0.16, 0.2, '#2a1a30');            // Tasche
  L(-0.09, H + bob, 0.18, 0.2, p.pose === 2 ? o.hair : o.skin);
  L(-0.1, H + 0.02 + bob, 0.2, 0.08, o.hair);                                      // Haar bzw. Mütze
  if (p.type === 2) L(-0.12, H + 0.04 + bob, 0.28, 0.04, '#e8461a');
  if (gfx.lights > 0.1) {
    // Licht der Fassaden: warmer Randreflex auf der Gehwegseite zur Fassade hin
    ctx.globalAlpha = 0.45 * gfx.lights;
    const fx = p.side > 0 ? 0.12 * wm : -0.2 * wm;
    L(fx, 0.84 * H + bob, 0.08, 0.4 * H, '#ffd9a0');
    L(p.side > 0 ? 0.06 : -0.12, H + bob, 0.06, 0.18, '#ffd9a0');
    ctx.globalAlpha = 1;
  }
}
