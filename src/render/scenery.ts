import { BALANCE as B } from '../config/balance';
import { PAL, gfx, rect } from './sprites';
import type { Layout } from './projection';

/** Reine, zustandslose Hash-Zufallsquelle für die Kulisse (verbraucht nie den Fahrkern-Generator). */
export const hash = (n: number): number => {
  let h = (n | 0) * 374761393 + 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Streckenabschnitte (Meter): Wüste mit Motels, Art déco, Hoteltürme, Stadtzentrum, ab 20 km der Strip. */
export const STAGES = [0, 1500, 5000, 10000, 20000] as const;
export const stageAt = (z: number): number => {
  let s = 0;
  for (let i = 1; i < STAGES.length; i++) if (z >= STAGES[i]) s = i;
  return s;
};

const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ Licht nach Distanz
/** Stützpunkte (m): 0–15 km langer warmer Sunset, 15–17 km Sonne sinkt (Gold/Koralle → Violett), 17–20 km blaue Stunde, ab 20 km Nacht. */
export const LIGHT_KEYS: number[] = B.scenery.keys;
/** Lichtwerte an den Stützpunkten (0 = Sonne … 1 = Nacht). */
export const LIGHT_VALS = [0, 0.14, 0.5, 1] as const;
/** Lichtfortschritt 0 (Sonne) … 1 (Nacht), je Abschnitt weich interpoliert. */
export function lightT(s: number): number {
  if (s <= 0) return 0;
  for (let i = 1; i < LIGHT_KEYS.length; i++) {
    if (s < LIGHT_KEYS[i]) { const u = (s - LIGHT_KEYS[i - 1]) / (LIGHT_KEYS[i] - LIGHT_KEYS[i - 1]); return LIGHT_VALS[i - 1] + (LIGHT_VALS[i] - LIGHT_VALS[i - 1]) * smooth(u); }
  }
  return 1;
}
const toRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export function mixHex(a: string, b: string, t: number): string {
  const x = toRgb(a), y = toRgb(b);
  const c = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0');
  return '#' + c(0) + c(1) + c(2);
}
/** Mehrstufige Palette: Position lt (0..1) über n Schlüsselfarben. */
export function keyMix(keys: readonly string[], lt: number): string {
  const f = Math.max(0, Math.min(1, lt)) * (keys.length - 1);
  const i = Math.min(keys.length - 2, Math.floor(f));
  return mixHex(keys[i], keys[i + 1], f - i);
}
const SKY_TOP = ['#2d2b7d', '#27236e', '#111a5a', '#060820'];
const SKY_MID = ['#c45a7e', '#7c3c8a', '#3a2b7c', '#1a0f4e'];
const SKY_HOR = ['#ffb86a', '#e9795e', '#a34f74', '#5a1c68'];
/** Setzt die globalen Lichtgrößen für Sprites und Kulisse. */
export function applyLight(lt: number): void { gfx.sun = 1 - lt; gfx.lights = smooth((lt - 0.2) / 0.55); }

export function drawSky(ctx: CanvasRenderingContext2D, L: Layout, lt: number, clock = 0, reduced = false): void {
  const g = ctx.createLinearGradient(0, 0, 0, L.hy);
  g.addColorStop(0, keyMix(SKY_TOP, lt));
  g.addColorStop(0.6, keyMix(SKY_MID, lt));
  g.addColorStop(1, keyMix(SKY_HOR, lt));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L.w, L.hy + 1);
  const star = smooth((lt - 0.5) / 0.45);
  if (star <= 0) return;
  const n = 60 + Math.round(70 * star);
  for (let i = 0; i < n; i++) {
    // Sterne erscheinen nach und nach und werden dichter, heller und größer; viele funkeln (feste Positionen)
    const tw = !reduced && i % 3 === 0 ? 0.55 + 0.45 * Math.sin(clock * (0.5 + hash(i + 11) * 1.2) + hash(i + 5) * 6.28) : 1;
    ctx.globalAlpha = Math.min(1, star * (0.45 + 0.6 * hash(i + 300))) * (hash(i + 7) < star + 0.3 ? 1 : 0) * tw;
    const big = star > 0.5 && hash(i + 55) > 0.88;
    rect(ctx, hash(i) * L.w, hash(i + 99) * L.hy * 0.85, big ? 2 : 1, big ? 2 : 1, big ? '#fff6d8' : '#ffffff');
  }
  ctx.globalAlpha = 1;
}

/** Tiefe Sonne links der Fahrtachse; sinkt zwischen 15 und 17 km hinter den Bergrücken (ferne Himmelsebene). */
export function drawSun(ctx: CanvasRenderingContext2D, L: Layout, s: number): void {
  const R = Math.max(6, Math.round(0.06 * L.h));
  // 0–15 km nur langsam tiefer (bleibt sichtbar), 15–17 km sinkt sie hinter den Bergrücken
  const u = s < 15000 ? 0.2 * (s / 15000) : 0.2 + 0.8 * smooth((s - 15000) / 2000);
  if (u >= 1) return;
  const x = L.w * 0.3;
  const y = L.hy - R * 0.55 + u * R * 1.9;
  const glow = ctx.createRadialGradient(x, y, R * 0.4, x, y, R * 4.2);
  glow.addColorStop(0, 'rgba(255,190,110,0.55)');
  glow.addColorStop(1, 'rgba(255,120,90,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - R * 4.2, y - R * 4.2, R * 8.4, R * 8.4);
  for (let dy = -R; dy <= R; dy++) {
    const half = Math.round(Math.sqrt(R * R - dy * dy));
    const k = (dy + R) / (2 * R); // Farbverlauf: oben Gelb, unten Orange/Koralle, mit Streifen
    const band = dy > R * 0.1 && (dy % 4) < 1.2;
    if (band) continue;
    rect(ctx, Math.round(x) - half, Math.round(y) + dy, half * 2 + 1, 1, mixHex('#fff0a8', '#ff6a4a', k));
  }
}

// ------------------------------------------------------------------ Himmelszeit: Mond & Flugzeuge
/** Mondposition (Mittelpunkt, Radius) nach der Strecke s: knapp über dem Horizont bei 17–20 km, danach stetig höher (deutlich hoch ab ≈ 27 km). */
export function moonAt(s: number, L: Layout) {
  const R = Math.max(5, Math.round(0.045 * L.h));
  const q = smooth((s - B.scenery.moonFrom) / B.scenery.moonSpan);
  const yStart = L.hy - R * 0.5, yEnd = Math.max(L.hy * 0.2, 0.1 * L.h + R + 2);   // bleibt unter den HUD-Buttons
  const px = smooth((s - B.scenery.moonFrom) / B.scenery.moonSpan);
  return { x: L.w * (0.62 + 0.1 * px), y: yStart + (yEnd - yStart) * q, R };
}

export interface PlaneFlight { start: number; dur: number; alt: number; climb: number }
const flightCache = new Map<number, PlaneFlight[]>();

/** Flugplan je Seed: erster Überflug nach 8–14 s, danach 25–45 s Abstand, Dauer 8–14 s, nie zwei gleichzeitig. */
export function planeFlight(seed: number, i: number): PlaneFlight {
  let list = flightCache.get(seed);
  if (!list) { list = []; flightCache.set(seed, list); if (flightCache.size > 8) flightCache.delete(flightCache.keys().next().value as number); }
  while (list.length <= i) {
    const n = list.length;
    const h = (j: number) => hash(seed * 131 + n * 17 + j);
    const prevEnd = n === 0 ? 0 : list[n - 1].start + list[n - 1].dur;
    const start = n === 0 ? 8 + 6 * h(1) : prevEnd + 25 + 20 * h(1);
    list.push({ start, dur: 8 + 6 * h(2), alt: h(3), climb: h(4) < 0.5 ? 0 : 1 });
  }
  return list[i];
}

/** Aktuelles Flugzeug (Fortschritt 0..1) oder null. */
export function planeAt(seed: number, t: number): { f: PlaneFlight; p: number } | null {
  for (let i = 0; i < 400; i++) {
    const f = planeFlight(seed, i);
    if (t < f.start) return null;
    if (t <= f.start + f.dur) return { f, p: (t - f.start) / f.dur };
  }
  return null;
}

// ------------------------------------------------------------------ statischer Hintergrund (gecacht)
export function paintBackground(ctx: CanvasRenderingContext2D, L: Layout): void {
  const g = ctx.createLinearGradient(0, 0, 0, L.hy);
  g.addColorStop(0, '#060820');
  g.addColorStop(0.6, '#1a0f4e');
  g.addColorStop(1, '#5a1c68');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L.w, L.hy + 1);
  for (let i = 0; i < 60; i++) {
    ctx.globalAlpha = 0.35 + 0.5 * hash(i + 300);
    rect(ctx, hash(i) * L.w, hash(i + 99) * L.hy * 0.8, 1, 1, '#ffffff');
  }
  ctx.globalAlpha = 1;
}

export function drawMoon(ctx: CanvasRenderingContext2D, s: number, L: Layout, lt = 1): void {
  const vis = smooth((lt - 0.55) / 0.2);
  if (vis <= 0.01) return;
  ctx.globalAlpha = vis;
  const m = moonAt(s, L);
  for (const [r, a] of [[1.9, 0.05], [1.5, 0.08], [1.2, 0.1]] as const) {
    ctx.globalAlpha = a; ctx.fillStyle = '#cfd2ff';
    ctx.beginPath(); ctx.arc(m.x, m.y, m.R * r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const R = m.R;
  for (let dy = -R; dy <= R; dy++) {
    const half = Math.round(Math.sqrt(R * R - dy * dy));
    const y = Math.round(m.y) + dy;
    const x0 = Math.round(m.x) - half;
    rect(ctx, x0, y, half * 2 + 1, 1, '#ebe7d2');
    // Schattierung: zwei Helligkeitsstufen am unteren rechten Rand
    const shade = Math.max(0, Math.round(half * 0.5 + dy * 0.25));
    if (dy > -R * 0.2) rect(ctx, x0 + half * 2 + 1 - shade, y, shade, 1, '#cfcab6');
  }
  for (const [cx, cy, r] of [[-0.3, -0.25, 0.22], [0.25, 0.1, 0.17], [-0.1, 0.4, 0.13]] as const) {
    ctx.fillStyle = '#c2bfab';
    ctx.beginPath(); ctx.arc(m.x + cx * R, m.y + cy * R, Math.max(1, r * R), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawPlane(ctx: CanvasRenderingContext2D, seed: number, t: number, L: Layout, blink: boolean): void {
  const pl = planeAt(seed, t);
  if (!pl) return;
  const size = Math.max(8, Math.round(0.046 * L.w)); // ≈ 35 % kleiner als zuvor
  const c = size / 11;
  const x = -size + pl.p * (L.w + size * 2);
  const y = L.hy * (0.55 + 0.15 * pl.f.alt) - (pl.f.climb ? 0.04 * L.hy * pl.p : 0);
  const R = (a: number, b: number, w: number, h: number, col: string) => rect(ctx, x + a * c, y + b * c, w * c, h * c, col);
  ctx.globalAlpha = 0.95;
  R(1, 3, 9, 2, '#cfd4ff');           // Rumpf
  R(10, 3.5, 1, 1.5, '#cfd4ff');      // Nase
  R(0, 0.5, 2, 3, '#a9afe8');         // Seitenleitwerk
  R(4, 5, 5, 1, '#a9afe8');           // Tragfläche
  R(5, 2, 3, 1, '#a9afe8');           // zweite Tragfläche (Perspektive)
  R(2, 4, 7, 0.5, '#7a82c8');         // Fensterband
  ctx.globalAlpha = 1;
  // kleiner roter Lichtpunkt unter dem Flugzeug, langsam pulsierend (bei reduzierter Bewegung konstant)
  const pulse = blink ? 0.55 + 0.45 * Math.sin(t * 2.2) : 0.85;
  ctx.globalAlpha = pulse;
  R(5, 7, 1.4, 1.4, '#ff4a4a');
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ Berge und Skyline
export function drawMountains(ctx: CanvasRenderingContext2D, L: Layout, pan: number, lt = 1): void {
  for (let layer = 0; layer < 2; layer++) {
    const k = layer === 0 ? 0.5 : 1.3;
    ctx.fillStyle = layer === 0 ? mixHex('#6a2f66', '#2a1670', lt) : mixHex('#4a2358', '#1c1258', lt);
    ctx.beginPath();
    ctx.moveTo(0, L.hy);
    for (let x = 0; x <= L.w + 6; x += 6) {
      const wx = x - pan * k * 3 + layer * 400;
      const hh = (0.07 + 0.03 * layer) * L.h * (0.55 + 0.45 * Math.sin(wx / 37) * Math.sin(wx / 91 + layer) + 0.25 * Math.sin(wx / 13));
      ctx.lineTo(x, L.hy - Math.max(2, hh));
    }
    ctx.lineTo(L.w + 6, L.hy);
    ctx.fill();
  }
}

type SkyKind = 'low' | 'deco' | 'tower' | 'wheel' | 'show' | 'eiffel';
interface SkyItem { x: number; w: number; h: number; tier: number; kind: SkyKind; a: number }
const SKY: SkyItem[] = (() => {
  const items: SkyItem[] = [];
  const spec: [number, number, SkyKind][] = [[7, 0, 'low'], [8, 1, 'deco'], [10, 2, 'tower'], [14, 3, 'show'], [9, 4, 'show']];
  let n = 0;
  for (const [count, tier, kind] of spec) {
    for (let i = 0; i < count; i++, n++) {
      const hh = [0.03, 0.07, 0.15, 0.1, 0.16][tier];
      items.push({
        x: (hash(n * 3 + 1) + i / count) % 1,
        w: tier >= 3 ? 0.07 + hash(n + 5) * 0.05 : 0.035 + hash(n + 5) * 0.035,
        h: hh * (0.55 + 0.45 * hash(n + 9)) * (tier === 3 ? 1 + 0.5 * (i % 3 === 0 ? 1 : 0) : 1),
        tier, kind, a: hash(n + 40),
      });
    }
  }
  items.push({ x: 0.2, w: 0.1, h: 0.14, tier: 2, kind: 'wheel', a: 0.5 });
  items.push({ x: 0.66, w: 0.075, h: 0.3, tier: 4, kind: 'eiffel', a: 0.3 });
  return items;
})();

const APPEAR = [0, 1500, 5000, 10000, 20000];

export function drawSkyline(ctx: CanvasRenderingContext2D, L: Layout, s: number, pan: number, clock: number, reduced: boolean, lt = 1): void {
  const span = L.w + 60;
  for (const it of SKY) {
    const vis = smooth((s - (APPEAR[it.tier] - 200)) / (it.tier === 4 ? 900 : 1500));
    if (vis <= 0.01) continue;
    const hgt = Math.max(2, Math.round(it.h * L.h * vis * (it.tier >= 3 ? 0.85 + 0.15 * Math.sin(s / 700 + it.a * 6) : 1)));
    const bw = Math.max(5, Math.round(it.w * L.w));
    const bx = Math.round(((it.x * span - pan * 6 + span * 4) % span) - 30);
    const base = L.hy + 1;
    const centerDim = Math.abs(bx + bw / 2 - L.w / 2) < L.w * 0.16 ? 0.55 : 1; // ruhiger Sichtkorridor
    ctx.globalAlpha = centerDim;
    const body = mixHex('#35254f', it.tier === 3 ? '#171446' : '#13123d', Math.min(1, lt * 1.3));
    if (it.kind === 'eiffel') {
      // ferner, beleuchteter Eiffelturm (eigene Arcade-Form): gestufte Silhouette mit warmen Kanten und funkelnden Lichtern
      const cx = bx + bw / 2, top = base - hgt;
      const half = (y: number) => bw * 0.5 * (1 - 0.88 * Math.pow(Math.min(1, (base - y) / hgt), 0.7));
      ctx.fillStyle = '#1a1442';
      ctx.beginPath();
      ctx.moveTo(cx - half(base), base);
      for (let i = 1; i <= 12; i++) { const y = base - (hgt * i) / 12; ctx.lineTo(cx - half(y), y); }
      for (let i = 12; i >= 0; i--) { const y = base - (hgt * i) / 12; ctx.lineTo(cx + half(y), y); }
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.9 * vis;
      ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - half(base), base); ctx.lineTo(cx - half(top), top); ctx.moveTo(cx + half(base), base); ctx.lineTo(cx + half(top), top); ctx.stroke();
      for (const lv of [0.32, 0.6]) rect(ctx, cx - half(base - hgt * lv), base - hgt * lv, half(base - hgt * lv) * 2, 1, '#ffcf6b');
      for (let i = 0; i < 14; i++) {
        const y = base - hgt * (0.1 + 0.85 * hash(i + 77)), tw = reduced ? 1 : 0.5 + 0.5 * Math.sin(clock * 3 + i * 1.7);
        ctx.globalAlpha = 0.7 * vis * tw;
        rect(ctx, cx + (hash(i + 3) - 0.5) * 2 * half(y) * 0.8, y, 1, 1, '#fff2b0');
      }
      ctx.globalAlpha = 1;
      continue;
    }
    if (it.kind === 'wheel') {
      const r = Math.max(6, Math.round(0.07 * L.h));
      const cx = bx + r, cy = base - Math.round(hgt * 0.2) - r - 1;
      ctx.strokeStyle = '#2a2a7a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      const rot = reduced ? 0 : clock * 0.06;
      for (let i = 0; i < 8; i++) {
        const a = rot + (i * Math.PI) / 4;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
        rect(ctx, cx + Math.cos(a) * r - 1, cy + Math.sin(a) * r - 1, 2, 2, i % 2 ? PAL.mint : '#ffcf6b');
      }
      rect(ctx, cx - 1, cy, 2, base - cy, '#1a1a52');
      ctx.globalAlpha = 1;
      continue;
    }
    rect(ctx, bx, base - hgt, bw, hgt, body);
    if (it.kind === 'deco') { rect(ctx, bx + bw * 0.2, base - hgt - 3, bw * 0.6, 3, body); rect(ctx, bx + bw * 0.42, base - hgt - 6, 1, 3, body); }
    if (it.kind === 'tower') rect(ctx, bx + bw * 0.3, base - hgt - 2, bw * 0.4, 2, body);
    const edge = it.tier === 3 ? '#ffcf6b' : it.a > 0.5 ? PAL.magenta : '#2ee6d6';
    ctx.globalAlpha = centerDim * 0.8;
    rect(ctx, bx, base - hgt, bw, 1, edge);
    if (it.kind === 'show') {
      for (let c = 0; c < Math.floor(bw / 3); c++) {
        const ph = reduced ? 0 : Math.floor(clock / 1.6);
        const v = hash(c * 13 + Math.floor(it.a * 100) + ph) ;
        rect(ctx, bx + 1 + c * 3, base - hgt + 3, 2, 2, v > 0.66 ? '#ffcf6b' : v > 0.33 ? '#2ee6d6' : PAL.magenta);
      }
    }
    const rows = Math.floor(hgt / 4);
    ctx.globalAlpha = centerDim * 0.55;
    for (let j = 1; j < rows; j++) {
      for (let c = 0; c < Math.floor(bw / 4); c++) {
        const ph = reduced ? 0 : Math.floor(clock / 5);
        if (hash(Math.floor(it.a * 1000) + j * 31 + c * 7 + ph) > 0.62 - 0.2 * gfx.lights && it.a < gfx.lights + 0.02) rect(ctx, bx + 1 + c * 4, base - hgt + j * 4, 1, 1, '#ffd36b');
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ Straßenrand
export type DecoType = 'none' | 'palm' | 'motel' | 'sign' | 'deco' | 'canopy' | 'tower' | 'show' | 'wheel' | 'fountain' | 'casino' | 'eiffel' | 'lake';

/** Typ aus Streckenposition (z) und Seite; ältere Motive bleiben als Ergänzung im Mix. */
export function decoType(k: number, side: number, z: number): DecoType {
  let stage = stageAt(z);
  const h = hash(k * 7 + side * 3 + 1);
  if (stage > 0 && hash(k * 11 + side) < 0.28) stage -= 1;
  const st = stageAt(z);
  if (st >= 2 && k % 31 === (side > 0 ? 7 : 19)) return 'wheel';
  if (st >= 4) {
    // Strip: Eiffelturm, Fontänensee, mehrstöckige Casino-/Hotelfassaden mit bunten Leuchtdächern
    if (k % 27 === (side > 0 ? 5 : 20)) return 'eiffel';
    if (k % 9 === (side > 0 ? 2 : 6)) return 'lake';
    return h < 0.5 ? 'casino' : h < 0.68 ? 'show' : h < 0.82 ? 'tower' : h < 0.92 ? 'canopy' : 'palm';
  }
  switch (stage) {
    case 0: return h < 0.5 ? 'palm' : h < 0.72 ? 'motel' : h < 0.86 ? 'sign' : 'none';
    case 1: return h < 0.5 ? 'deco' : h < 0.68 ? 'canopy' : h < 0.84 ? 'palm' : 'sign';
    case 2: return h < 0.55 ? 'tower' : h < 0.72 ? 'deco' : h < 0.85 ? 'canopy' : 'palm';
    default: return h < 0.5 ? 'show' : h < 0.78 ? 'tower' : h < 0.9 ? 'canopy' : 'palm';
  }
}

const ICONS: string[][] = [
  ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'], // Stern
  ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'], // Raute
  ['...#...', '..##...', '.######', '#######', '.######', '..##...', '...#...'], // Pfeil
];

export interface DecoCtx { ctx: CanvasRenderingContext2D; sx: number; sy: number; sc: number; side: number; hs: number; k: number; clock: number; reduced: boolean; lod?: boolean }

export function drawDeco(type: DecoType, dc: DecoCtx): void {
  const { ctx, sx, sy, sc, side, hs, k, clock, reduced } = dc;
  const R = (a: number, b: number, w: number, h: number, col: string) => rect(ctx, sx + a * sc, sy - b * sc, w * sc, h * sc, col);
  const pxOK = (m: number) => m * sc >= 1;
  const neon = hs > 0.5 ? PAL.magenta : '#2ee6d6';
  const warm = '#ffcf6b';
  const sway = reduced ? 0 : Math.sin(clock * 0.9 + k) * 0.25;
  /** Fein gerasterte, gedämpfte Fenster; Zustand ist je Fenster fest, nur wenige wechseln sehr selten (kein Flackern beim Vorbeifahren). */
  const win = (ox: number, w: number, h: number, cols: number, tint = '#d9b25a') => {
    if (!pxOK(0.5) || dc.lod) return;
    const rows = Math.floor(h / 1.5);
    const cw = (w - 1.4) / cols;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const id = k * 53 + r * 7 + c;
      const flip = !reduced && hash(id + 900) > 0.96 && Math.floor(clock / 9 + hash(id)) % 2 === 1;
      if ((hash(id) > 0.45 - 0.22 * gfx.lights && hash(k * 3 + 1) < gfx.lights + 0.02) !== flip) {
        // nachts kräftiger: größere, hellere Fenster mit weichem Schein
        const a = 0.8 + 0.2 * gfx.lights;
        ctx.globalAlpha *= 0.18 * gfx.lights; R(ox + 0.5 + c * cw, h - 0.95 - r * 1.5, cw * 0.85, 0.95, tint); ctx.globalAlpha /= (0.18 * gfx.lights) || 1;
        ctx.globalAlpha *= a;
        R(ox + 0.7 + c * cw, h - 0.8 - r * 1.5, cw * (0.55 + 0.2 * gfx.lights), 0.5 + 0.15 * gfx.lights, gfx.lights > 0.6 && hash(id + 5) > 0.7 ? '#fff0b8' : tint);
        ctx.globalAlpha /= a;
      }
    }
  };
  const ox = side > 0 ? 0 : -1; // Gebäude wächst nach außen
  switch (type) {
    case 'none': return;
    case 'palm': {
      const th = 5 + hs * 3;
      // verjüngter, geringelter Stamm
      const seg = 7;
      for (let i = 0; i < seg; i++) {
        const w = 0.36 - 0.14 * (i / seg);
        R(-w / 2 + 0.06 * Math.sin(i * 0.8 + hs * 5), th * ((i + 1) / seg), w, th / seg + 0.05, i % 2 ? '#3a2850' : '#4d3a6e');
      }
      if (sc * th < 6) { R(-0.9, th + 0.4, 1.8, 0.8, '#1f8f6a'); return; }
      // Krone: gebogene Wedel mit Lichtkante
      ctx.lineCap = 'butt';
      for (let j = 0; j < 8; j++) {
        const u = (j - 3.5) / 3.5;
        const dx = u * (2.6 + 0.3 * hs) + sway * 0.5;
        const up = 1.3 - Math.abs(u) * 0.7;
        const drop = 0.2 + Math.abs(u) * Math.abs(u) * 2.4;
        const cx0 = sx, cy0 = sy - th * sc;
        ctx.strokeStyle = j % 2 ? '#1f8f6a' : '#2bb88a';
        ctx.lineWidth = Math.max(1, sc * 0.3);
        ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.quadraticCurveTo(cx0 + dx * 0.55 * sc, cy0 - up * sc, cx0 + dx * sc, cy0 + (drop - 0.3) * sc); ctx.stroke();
        ctx.strokeStyle = '#7fe3a8'; ctx.lineWidth = Math.max(1, sc * 0.08);
        ctx.beginPath(); ctx.moveTo(cx0, cy0 - sc * 0.1); ctx.quadraticCurveTo(cx0 + dx * 0.55 * sc, cy0 - (up + 0.12) * sc, cx0 + dx * sc, cy0 + (drop - 0.45) * sc); ctx.stroke();
      }
      R(-0.22, th + 0.2, 0.44, 0.44, '#5a3a2a');
      return;
    }
    case 'sign': {
      const icon = ICONS[Math.floor(hs * 3) % 3];
      R(-0.12, 5.2, 0.24, 5.2, '#2d2a5a');
      const c = hs > 0.66 ? warm : hs > 0.33 ? PAL.magenta : '#2ee6d6';
      R(-1.5, 6.6, 3, 3, '#14123a');
      const cell = 3 / 7;
      for (let r = 0; r < 7; r++) for (let q = 0; q < 7; q++) if (icon[r][q] === '#') R(-1.5 + q * cell, 6.6 - r * cell, cell, cell, c);
      return;
    }
    case 'motel': {
      const w = 7, h = 3.4;
      R(ox * w, h, w, h, '#241a4a');
      R(ox * w + w * 0.88, h, w * 0.12, h, 'rgba(0,0,20,0.35)'); R(ox * w, h, 0.12 + 0.2 * gfx.sun, h, gfx.sun > 0.15 ? `rgba(255,170,100,${0.12 + 0.5 * gfx.sun})` : 'rgba(255,255,255,0.12)'); for (let i = 1; i < 4; i++) R(ox * w + (i * w) / 4 - 0.1, h, 0.2, h, 'rgba(255,255,255,0.06)');
      R(ox * w + w * 0.42, 1.8, 1.0, 1.8, '#0f0b26'); R(ox * w + w * 0.42, 1.8, 1.0, 0.1, warm);
      for (let i = 0; i < 7; i++) R(ox * w + i, h + 0.45, 1, 0.55, i % 2 ? PAL.white : PAL.magenta); // Vordach (Markise)
      R(ox * w, h - 0.5, w, 0.2, neon);
      win(ox * w, w, h - 0.8, 3);
      return;
    }
    case 'canopy': {
      const w = 9;
      R(ox * w, 4.2, w, 0.5, '#6a4a1c');
      R(ox * w, 3.7, w, 0.25, warm);
      for (let i = 0; i < 9; i++) R(ox * w + 0.4 + i * 1, 3.45, 0.35, 0.35, '#fff1c0');
      R(ox * w + 0.5, 3.7, 0.3, 3.7, '#2d2a5a'); R(ox * w + w - 0.8, 3.7, 0.3, 3.7, '#2d2a5a');
      return;
    }
    case 'deco': {
      const w = 9, h = 8 + hs * 5;
      R(ox * w, h, w, h, '#1d1a4d');
      R(ox * w + w * 0.88, h, w * 0.12, h, 'rgba(0,0,20,0.35)'); R(ox * w, h, 0.12 + 0.2 * gfx.sun, h, gfx.sun > 0.15 ? `rgba(255,170,100,${0.12 + 0.5 * gfx.sun})` : 'rgba(255,255,255,0.12)'); for (let i = 1; i < 4; i++) R(ox * w + (i * w) / 4 - 0.1, h, 0.2, h, 'rgba(255,255,255,0.06)');
      R(ox * w + 1.4, h + 2.6, w - 2.8, 2.6, '#1d1a4d');
      R(ox * w + 3, h + 4.6, w - 6, 2.2, '#1d1a4d');
      R(ox * w + w / 2 - 0.1, h + 8.2, 0.2, 2.6, '#1d1a4d');
      R(ox * w, h, w, 0.3, warm);
      R(ox * w + (side > 0 ? 0.3 : w - 0.8), h * 0.9, 0.5, h * 0.85, neon); // vertikale Leuchtschrift
      R(ox * w, 3.2, w, 0.5, '#6a4a1c'); R(ox * w, 2.9, w, 0.2, warm); // Lichtdach
      win(ox * w, w, h - 3.4, 3);
      return;
    }
    case 'tower': {
      const w = 8 + hs * 3, h = 16 + hs * 14;
      R(ox * w, h, w, h, '#1a1850');
      R(ox * w + w * 0.88, h, w * 0.12, h, 'rgba(0,0,20,0.35)'); R(ox * w, h, 0.12 + 0.2 * gfx.sun, h, gfx.sun > 0.15 ? `rgba(255,170,100,${0.12 + 0.5 * gfx.sun})` : 'rgba(255,255,255,0.12)'); for (let i = 1; i < 4; i++) R(ox * w + (i * w) / 4 - 0.1, h, 0.2, h, 'rgba(255,255,255,0.06)');
      R(ox * w + w * 0.2, h + 1.6, w * 0.6, 1.6, '#1a1850');
      R(ox * w, h, w, 0.35, neon);
      R(ox * w + w * 0.3, h + 1.6, w * 0.4, 0.3, hs > 0.5 ? '#2ee6d6' : PAL.magenta);
      R(ox * w + w * 0.46, h, 0.3, h * 0.7, 'rgba(255,207,107,0.35)');
      win(ox * w, w, h - 1, 4, hs > 0.7 ? '#9fe8ff' : warm);
      return;
    }
    case 'show': {
      const w = 13, h = 8 + hs * 4;
      R(ox * w, h, w, h, '#1c1650');
      R(ox * w + w * 0.88, h, w * 0.12, h, 'rgba(0,0,20,0.35)'); R(ox * w, h, 0.12 + 0.2 * gfx.sun, h, gfx.sun > 0.15 ? `rgba(255,170,100,${0.12 + 0.5 * gfx.sun})` : 'rgba(255,255,255,0.12)'); for (let i = 1; i < 4; i++) R(ox * w + (i * w) / 4 - 0.1, h, 0.2, h, 'rgba(255,255,255,0.06)');
      R(ox * w, h, w, 0.4, warm);
      R(ox * w, 3.0, w, 0.3, '#2ee6d6');
      // Medienwand: animierte Pixelzellen
      const cols = 10, rows = 3;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const v = hash(k * 13 + r * 7 + c + (reduced ? 0 : Math.floor(clock / 1.5)));
        R(ox * w + 1 + c * 1.15, h - 0.8 - r * 1.2, 0.8, 0.8, v > 0.66 ? warm : v > 0.33 ? '#2ee6d6' : PAL.magenta);
      }
      win(ox * w, w, h - 5, 5);
      return;
    }
    case 'wheel': {
      const r = 11, cy = 14;
      const x0 = side > 0 ? 6 : -6;
      R(x0 - 0.3, cy, 0.6, cy, '#2a2a7a');
      ctx.strokeStyle = '#4a4ab0'; ctx.lineWidth = Math.max(1, sc * 0.35);
      ctx.beginPath(); ctx.arc(sx + x0 * sc, sy - cy * sc, r * sc, 0, Math.PI * 2); ctx.stroke();
      const rot = reduced ? 0 : clock * 0.05;
      for (let i = 0; i < 10; i++) {
        const a = rot + (i * Math.PI) / 5;
        const gx = x0 + Math.cos(a) * r, gy = cy + Math.sin(a) * r;
        if (i < 5 || pxOK(0.3)) { ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx + x0 * sc, sy - cy * sc); ctx.lineTo(sx + gx * sc, sy - gy * sc); ctx.stroke(); }
        R(gx - 0.7, gy + 0.7, 1.4, 1.4, i % 2 ? PAL.mint : warm);
      }
      return;
    }
    case 'casino': {
      // mehrstöckige Fassade mit Fensterraster, buntem Leuchtdach und Neonschild
      const w = 13 + hs * 5, h = 15 + hs * 10;
      R(ox * w, h, w, h, '#1c1650');
      R(ox * w + w * 0.86, h, w * 0.14, h, 'rgba(0,0,20,0.35)');
      for (let r = 1; r < Math.floor(h / 3.2); r++) R(ox * w, r * 3.2, w, 0.12, 'rgba(255,255,255,0.08)');
      win(ox * w, w, h - 4, 6);
      const cells = Math.floor(w / 0.9), ph = reduced ? 0 : Math.floor(clock * 3);
      for (let c = 0; c < cells; c++) R(ox * w + c * 0.9, h + 1.0, 0.7, 1.0, (c + ph) % 3 === 0 ? PAL.magenta : (c + ph) % 3 === 1 ? '#2ee6d6' : warm);   // Leuchtdach-Lauflicht
      R(ox * w, h + 0.2, w, 0.4, warm);
      R(ox * w + w * 0.1, 4.2, w * 0.8, 1.5, '#12103a');
      const sc2 = Math.floor(reduced ? 0 : clock * 2) % 2;
      for (let c = 0; c < 8; c++) R(ox * w + w * 0.14 + c * (w * 0.72 / 8), 3.9, w * 0.07, 0.8, (c + sc2) % 2 ? warm : neon);
      for (let c = 0; c < Math.floor(w / 1.2); c++) R(ox * w + 0.3 + c * 1.2, 2.4, 0.4, 0.4, (c + ph) % 2 ? warm : '#fff2b0');   // Vordach mit Glühlampen
      return;
    }
    case 'eiffel': {
      // beleuchteter Eiffelturm (eigene Form): gestufter Gitterturm mit Bogen, Plattformen und funkelnden Lichtern
      const H = 38 + hs * 6, cx = ox * 14 + 7;
      const half = (y: number) => 8.5 * (1 - 0.9 * Math.pow(y / H, 0.72));
      const X = (x: number) => sx + (cx + x) * sc, Y = (y: number) => sy - y * sc;
      ctx.lineWidth = Math.max(1, 0.28 * sc);
      ctx.strokeStyle = 'rgba(255,207,107,0.95)';
      for (const sd of [-1, 1]) { ctx.beginPath(); for (let i = 0; i <= 16; i++) { const y = (H * i) / 16; ctx.lineTo(X(sd * half(y)), Y(y)); } ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,207,107,0.5)';
      for (const sd of [-1, 1]) { ctx.beginPath(); for (let i = 0; i <= 16; i++) { const y = (H * i) / 16; ctx.lineTo(X(sd * (half(y) - 1.1 * (1 - y / H))), Y(y)); } ctx.stroke(); }
      ctx.beginPath(); for (let i = 0; i < 16; i++) { const y0 = (H * i) / 16, y1 = (H * (i + 1)) / 16; ctx.moveTo(X(-half(y0)), Y(y0)); ctx.lineTo(X(half(y1)), Y(y1)); ctx.moveTo(X(half(y0)), Y(y0)); ctx.lineTo(X(-half(y1)), Y(y1)); } ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(-6.2), Y(0)); ctx.quadraticCurveTo(X(0), Y(15), X(6.2), Y(0)); ctx.stroke();
      for (const lv of [0.34, 0.62]) { R(cx - half(H * lv) - 0.6, H * lv, half(H * lv) * 2 + 1.2, 0.9, '#ffcf6b'); }
      R(cx - 0.12, H + 4, 0.24, 4, '#fff2b0');
      for (let i = 0; i < 18; i++) {
        const y = H * (0.06 + 0.9 * hash(k * 7 + i)), tw = reduced ? 1 : 0.4 + 0.6 * Math.sin(clock * 4 + i * 2.3);
        ctx.globalAlpha *= tw;
        R(cx + (hash(k * 5 + i) - 0.5) * 2 * half(y) * 0.85, y, 0.5, 0.5, '#fff6c8');
        ctx.globalAlpha /= tw || 1;
      }
      return;
    }
    case 'lake': {
      // breite Wasserfläche neben der Straße mit beleuchteten, in Farbfolgen tanzenden Fontänen
      const w = 34, dirx = side > 0 ? 1 : -1, x0 = dirx > 0 ? 1 : -w - 1;
      const ph = reduced ? 0 : clock;
      ctx.fillStyle = '#0d5b84';
      ctx.beginPath(); ctx.ellipse(sx + (x0 + w / 2) * sc, sy - 0.3 * sc, (w / 2) * sc, Math.max(1.5, 2.6 * sc), 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(150,230,255,0.45)';
      for (let i = 0; i < 6; i++) R(x0 + 2 + i * 5.4 + Math.sin(ph + i) * 0.6, 0.55, 3.4, 0.15, 'rgba(150,230,255,0.45)');
      const cols = ['#ffe8a0', '#7ff0ff', '#ff9ae8'];
      for (let i = 0; i < 9; i++) {
        const jh = 5 + 5 * (reduced ? 0.6 : 0.5 + 0.5 * Math.sin(ph * 1.8 + i * 0.9 + k));
        const col = cols[(i + Math.floor(ph * 1.2)) % 3];
        const jx = x0 + 2.5 + i * 3.6;
        R(jx, jh + 0.5, 0.45, jh, col);
        R(jx - 0.5, jh * 0.5 + 0.5, 1.45, jh * 0.4, 'rgba(255,255,255,0.18)');
        R(jx - 0.9, 0.5, 2.25, 0.35, col);                                    // Lichtfleck am Düsenfuß
        R(jx, -0.1, 0.45, jh * 0.35, col.replace('#', '#') + '55');            // Spiegelung
      }
      return;
    }
    case 'fountain': {
      const w = 8, x0 = side > 0 ? 3 : -11;
      R(x0, 0.7, w, 0.7, '#1b8aa8');
      R(x0, 0.7, w, 0.15, '#9fe8ff');
      for (let i = 0; i < 5; i++) {
        const jh = 2.5 + 1.5 * (reduced ? 0.5 : 0.5 + 0.5 * Math.sin(clock * 2 + i * 1.7));
        R(x0 + 1 + i * 1.5, 0.7 + jh, 0.3, jh, 'rgba(200,245,255,0.8)');
      }
      R(x0, 0.0, w, 0.3, 'rgba(46,230,214,0.25)'); // Spiegelung
      return;
    }
  }
}

/** Eigenes Neonportal über der Straße (Wüstenzufahrt). */
export const PORTAL_Z = 110;
export function drawPortal(ctx: CanvasRenderingContext2D, sxCenter: number, sy: number, sc: number, clock: number, reduced: boolean): void {
  const hw = B.road.halfWidth + 1.2;
  const R = (a: number, b: number, w: number, h: number, col: string) => rect(ctx, sxCenter + a * sc, sy - b * sc, w * sc, h * sc, col);
  R(-hw - 0.4, 8, 0.8, 8, '#2d2a5a'); R(hw - 0.4, 8, 0.8, 8, '#2d2a5a');
  R(-hw - 0.4, 8.8, hw * 2 + 0.8, 1.6, '#14123a');
  const n = 14;
  for (let i = 0; i < n; i++) {
    const on = reduced ? i % 2 === 0 : ((i + Math.floor(clock * 2)) % 3 !== 0);
    R(-hw + (i * (hw * 2)) / n, 8.4, (hw * 2) / n - 0.15, 0.5, on ? (i % 2 ? '#2ee6d6' : PAL.magenta) : '#4a2a6a');
  }
  R(-0.9, 9.2, 1.8, 1.0, '#ffcf6b'); R(-0.5, 9.0, 1.0, 0.5, '#14123a');
  R(-hw - 0.4, 8.8, 0.3, 8, 'rgba(255,255,255,0.15)');
}

