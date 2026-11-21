import { B_HALF } from './lotsconst';
import { clipNear, type Item, type LotEnv } from './lots';
import { hash, mixHex } from './scenery';
import type { RouteEvent } from '../sim/route';

/**
 * Räumliche Streckenabschnitte aus der Straßenprojektion: Neon-Palmen-Tunnel und Casino-Durchfahrt.
 * Alle Flächen sind echte Weltpolygone (Wände, Decke, Rippen, Portale) und werden wie Verkehr und Grundstücke nach Tiefe sortiert, Neonmotive
 * (Palmen, Schriftzüge, Spielautomaten) liegen als Vektorpfade auf der Wandebene. Nichts davon hat eine Spiellogik: keine Hitbox, keine Spurwirkung.
 */
export const CELL = 12;
/** Innenkante der Wände (m seitlich der Straßenmitte): hinter Fahrbahn und Gehweg, damit Spuren und Verkehr frei bleiben. Der Tunnel ist weiter (Platz für Leuchtpylone mit Palmen). */
export const TUNNEL_WX = B_HALF + 6.4;
export const CASINO_WX = B_HALF + 4.4;
/** Höhe der Decke über dem Boden (m): immer über der Kamera, damit die Decke nie die Fahrbahn verdeckt (Hochformat: Kamera ≈ 7,5 m hoch). */
export const roofHeight = (camH: number): number => Math.max(7.2, camH + 2.6);

type V3 = [number, number, number];

const NEON = [
  { a: '#2ee6d6', b: '#ff4fd8' },
  { a: '#7fe9ff', b: '#ff79e6' },
  { a: '#4cf2c0', b: '#ff2bd0' },
];
export const CASINO_NAMES = ['NEON PALACE', 'SUNSET ROYALE', 'MIDNIGHT CLUB', 'LUCKY LIGHTS'];

interface Look { wall: string; wall2: string; pilaster: string; roof: string; rib: string; led1: string; led2: string; trim: string; floorTint: string; portal: string }
const TUNNEL: Look = { wall: '#150a38', wall2: '#1a0d42', pilaster: '#2a1561', roof: '#0a0522', rib: '#241258', led1: '#2ee6d6', led2: '#ff4fd8', trim: '#2ee6d6', floorTint: '#7a5cff', portal: '#0e0729' };
const CASINO: Look[] = [
  { wall: '#2e0b1c', wall2: '#380e22', pilaster: '#d9a93a', roof: '#1a0610', rib: '#4a1530', led1: '#ffcf6b', led2: '#b46bff', trim: '#ffcf6b', floorTint: '#ff6a5a', portal: '#2a0a18' },
  { wall: '#26103a', wall2: '#2e1448', pilaster: '#e2b64a', roof: '#140826', rib: '#3d1a5e', led1: '#ffcf6b', led2: '#ff4fd8', trim: '#ffcf6b', floorTint: '#d06bff', portal: '#1e0b30' },
  { wall: '#3a0e16', wall2: '#46121c', pilaster: '#e8c25a', roof: '#200610', rib: '#561a24', led1: '#ffd98a', led2: '#ff5a7a', trim: '#ffd98a', floorTint: '#ff5a5a', portal: '#300a12' },
  { wall: '#2a0f2e', wall2: '#331236', pilaster: '#dcae3c', roof: '#180a1c', rib: '#47184a', led1: '#ffcf6b', led2: '#b46bff', trim: '#ffcf6b', floorTint: '#ff7ad0', portal: '#240a28' },
];

// -------------------------------------------------------------------------- Zeichenhilfen
const shadeCache = new Map<string, string>();
/** Farbe mit Dunst nach Tiefe (in 12 Stufen zwischengespeichert: keine Zeichenfolgen pro Bild). */
function shade(col: string, d: number): string {
  const b = Math.min(11, Math.max(0, Math.floor((d / 460) * 12)));
  const key = col + b;
  let c = shadeCache.get(key);
  if (!c) { c = mixHex(col, '#0a0520', b * 0.045); if (shadeCache.size > 600) shadeCache.clear(); shadeCache.set(key, c); }
  return c;
}

function poly(env: LotEnv, pts: V3[], col: string, alpha = 1): number {
  const clipped = clipNear(pts, env.zc + 0.4);
  if (clipped.length < 3) return 0;
  const ctx = env.ctx;
  ctx.beginPath();
  let minD = 1e9;
  clipped.forEach((p, i) => { const q = env.P(p[0], p[1], p[2]); minD = Math.min(minD, q.d); if (i) ctx.lineTo(q.sx, q.sy); else ctx.moveTo(q.sx, q.sy); });
  ctx.closePath();
  const base = ctx.globalAlpha;
  ctx.fillStyle = col; ctx.globalAlpha = base * alpha; ctx.fill();
  ctx.globalAlpha = base;
  return minD;
}

/** Streifen auf der Wandebene (z0…z1, h0…h1) bei seitlichem Abstand x. */
const strip = (env: LotEnv, x: number, z0: number, z1: number, h0: number, h1: number, col: string, a = 1): void => { poly(env, [[x, z0, h0], [x, z1, h0], [x, z1, h1], [x, z0, h1]], col, a); };

/** Meter-Koordinatensystem auf einer Wand: Ursprung am Punkt (x, z, h), X nach rechts (Leserichtung), Y nach unten. Nur Näherung der Perspektive (lokal affin). */
function frame(env: LotEnv, x: number, z: number, h: number, side: number): [number, number, number, number, number, number] | null {
  const o = env.P(x, z, h);
  if (o.d < 4) return null;
  const ez = env.P(x, z + 1, h), eh = env.P(x, z, h - 1);
  const s = side > 0 ? -1 : 1;
  return [(ez.sx - o.sx) * s, (ez.sy - o.sy) * s, eh.sx - o.sx, eh.sy - o.sy, o.sx, o.sy];
}

/** Meter-Koordinatensystem auf einer zur Fahrtrichtung senkrechten Fläche (z = const): X nach rechts, Y nach unten, Ursprung bei (x, z, h). */
function faceFrame(env: LotEnv, x: number, z: number, h: number): [number, number, number, number, number, number] | null {
  const o = env.P(x, z, h);
  if (o.d < 4) return null;
  const ex = env.P(x + 1, z, h), eh = env.P(x, z, h - 1);
  return [ex.sx - o.sx, ex.sy - o.sy, eh.sx - o.sx, eh.sy - o.sy, o.sx, o.sy];
}

const lerpQ = (p0: number, p1: number, p2: number, t: number): number => (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;

// -------------------------------------------------------------------------- Neon-Palme (Meter, Ursprung Stammfuß, Y nach unten)
function drawPalm(ctx: CanvasRenderingContext2D, ca: string, cb: string, variant: number, detail: number, glow: number, clock: number): void {
  const h = 4.6 + (variant % 3) * 0.5;
  const bend = [-0.7, 0.6, -0.4][variant % 3];
  const cx = 0.35 * Math.sign(bend), cy = -h;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // Stamm: zwei Linien (Kontur) mit Ringen
  const trunk = (): void => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(bend, -h * 0.5, cx, cy); };
  if (glow) { ctx.globalAlpha *= 0.25; ctx.strokeStyle = cb; ctx.lineWidth = 0.5; trunk(); ctx.stroke(); ctx.globalAlpha /= 0.25; }
  ctx.strokeStyle = cb; ctx.lineWidth = 0.17; trunk(); ctx.stroke();
  if (detail) {
    ctx.lineWidth = 0.06; ctx.strokeStyle = '#ffffff'; ctx.globalAlpha *= 0.55; ctx.beginPath();
    for (let i = 1; i < 7; i++) { const t = i / 7, px = lerpQ(0, bend, cx, t), py = lerpQ(0, -h * 0.5, cy, t); ctx.moveTo(px - 0.14, py); ctx.lineTo(px + 0.14, py - 0.04); }
    ctx.stroke(); ctx.globalAlpha /= 0.55;
  }
  // Wedel: gebogene Hauptrippen mit feinen Fiedern
  const n = detail ? 8 : 6;
  const sway = Math.sin(clock * 1.1 + variant) * 0.06;
  for (let j = 0; j < n; j++) {
    const u = (j + 0.5) / n;                          // 0…1 von links nach rechts
    const a = Math.PI * (1.04 + 0.92 * u);            // oberer Halbkreis
    const len = 1.5 + 0.55 * Math.sin(Math.PI * u) + ((variant + j) % 3) * 0.12;
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len * 0.62;
    const ex = cx + dx * 1.05 + sway, ey = cy + dy * 0.5 + 0.55 + Math.abs(Math.cos(a)) * 0.75;
    const qx = cx + dx * 0.55, qy = cy + dy * 1.15 - 0.2;
    const col = j % 2 ? ca : cb;
    const rib = (): void => { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.quadraticCurveTo(qx, qy, ex, ey); };
    if (glow) { ctx.globalAlpha *= 0.22; ctx.strokeStyle = col; ctx.lineWidth = 0.42; rib(); ctx.stroke(); ctx.globalAlpha /= 0.22; }
    ctx.strokeStyle = col; ctx.lineWidth = 0.12; rib(); ctx.stroke();
    if (detail) {
      ctx.lineWidth = 0.05; ctx.beginPath();
      for (let i = 2; i <= 9; i++) {
        const t = i / 10, px = lerpQ(cx, qx, ex, t), py = lerpQ(cy, qy, ey, t);
        const tx = 2 * (1 - t) * (qx - cx) + 2 * t * (ex - qx), ty = 2 * (1 - t) * (qy - cy) + 2 * t * (ey - qy);
        const tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl, fl = 0.42 * (1 - t * 0.55);
        ctx.moveTo(px, py); ctx.lineTo(px + nx * fl + (tx / tl) * 0.14, py + ny * fl + (ty / tl) * 0.14);
        ctx.moveTo(px, py); ctx.lineTo(px - nx * fl + (tx / tl) * 0.14, py - ny * fl + (ty / tl) * 0.14);
      }
      ctx.stroke();
    }
  }
  // Kokosnüsse / Krone
  ctx.fillStyle = '#ffd9a0'; ctx.beginPath(); ctx.arc(cx - 0.1, cy + 0.1, 0.1, 0, 6.3); ctx.arc(cx + 0.12, cy + 0.14, 0.1, 0, 6.3); ctx.fill();
}

// -------------------------------------------------------------------------- Neon-Buchstaben (Röhrenschrift als Pfade, Einheit: 1 × 1,6 m je Buchstabe)
function glyph(ctx: CanvasRenderingContext2D, ch: string, x0: number): void {
  const X = (u: number): number => x0 + u, Y = (v: number): number => v * 1.5 - 0.75;
  ctx.beginPath();
  if (ch === 'N') { ctx.moveTo(X(0), Y(1)); ctx.lineTo(X(0), Y(0)); ctx.lineTo(X(1), Y(1)); ctx.lineTo(X(1), Y(0)); }
  else if (ch === 'A') { ctx.moveTo(X(0), Y(1)); ctx.lineTo(X(0.5), Y(0)); ctx.lineTo(X(1), Y(1)); ctx.moveTo(X(0.18), Y(0.66)); ctx.lineTo(X(0.82), Y(0.66)); }
  else { // S
    ctx.moveTo(X(0.95), Y(0.14)); ctx.bezierCurveTo(X(0.8), Y(-0.04), X(0.1), Y(-0.06), X(0.04), Y(0.27));
    ctx.bezierCurveTo(X(-0.02), Y(0.56), X(0.96), Y(0.44), X(0.96), Y(0.76)); ctx.bezierCurveTo(X(0.9), Y(1.06), X(0.2), Y(1.06), X(0.02), Y(0.86));
  }
}
function drawSign(ctx: CanvasRenderingContext2D, text: string, col: string, frameCol: string, glow: number, clock: number, reduced: boolean): void {
  const w = text.length * 1.3 + 0.5;
  ctx.fillStyle = '#0a0524'; ctx.fillRect(-w / 2 - 0.45, -1.15, w + 0.9, 2.3);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = frameCol; ctx.lineWidth = 0.09; ctx.strokeRect(-w / 2 - 0.45, -1.15, w + 0.9, 2.3);
  const flick = reduced ? 1 : 0.92 + 0.08 * Math.sin(clock * 3.1 + text.length);
  for (let i = 0; i < text.length; i++) {
    const x0 = -w / 2 + 0.25 + i * 1.3;
    if (glow) { ctx.globalAlpha *= 0.28; ctx.strokeStyle = col; ctx.lineWidth = 0.48; glyph(ctx, text[i], x0); ctx.stroke(); ctx.globalAlpha /= 0.28; }
    ctx.globalAlpha *= flick; ctx.strokeStyle = col; ctx.lineWidth = 0.2; glyph(ctx, text[i], x0); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.06; ctx.globalAlpha *= 0.7; glyph(ctx, text[i], x0); ctx.stroke(); ctx.globalAlpha /= 0.7 * flick;
  }
}

// -------------------------------------------------------------------------- Spielautomat (Meter, Ursprung Mitte, 1,3 × 2,3 m; reine Dekoration)
const REEL = ['#ff3b3b', '#ffd23a', '#2ee6d6', '#ff4fd8', '#ffffff', '#7fe36a'];
/** Gehäuse, Fenster, Bedienfeld und Hebel einmal in ein kleines Bild gezeichnet und wiederverwendet (statt ~30 Zeichenaufrufe je Automat und Bild). */
let slotSprite: HTMLCanvasElement | null = null;
const SLOT_PX = 56;
function slotBody(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#c9962e'; c.fillRect(-0.65, -1.15, 1.3, 2.3);                       // goldenes Gehäuse
  c.fillStyle = '#e8c25a'; c.fillRect(-0.65, -1.15, 1.3, 0.08); c.fillRect(-0.65, -1.15, 0.07, 2.3);
  c.fillStyle = '#4a1a8a'; c.fillRect(-0.55, -1.05, 1.1, 0.42);                       // violetter Aufsatz
  c.fillStyle = '#0c0a1e'; c.fillRect(-0.5, -0.5, 1, 0.78);                           // Walzenfenster
  c.fillStyle = '#fff3d0'; c.globalAlpha = 0.2; c.fillRect(-0.5, -0.5, 1, 0.78); c.globalAlpha = 1;
  for (let r = 0; r < 3; r++) { c.fillStyle = '#0c0a1e'; c.fillRect(-0.47 + r * 0.32, -0.47, 0.3, 0.72); }
  c.fillStyle = '#7a1f3a'; c.fillRect(-0.55, 0.36, 1.1, 0.26);                        // Bedienfeld
  c.fillStyle = '#ff3b3b'; c.fillRect(-0.4, 0.43, 0.2, 0.12); c.fillStyle = '#2ee6d6'; c.fillRect(-0.1, 0.43, 0.2, 0.12); c.fillStyle = '#ffd23a'; c.fillRect(0.2, 0.43, 0.2, 0.12);
  c.fillStyle = '#12091f'; c.fillRect(-0.45, 0.72, 0.9, 0.32);                        // Ausgabefach
  c.strokeStyle = '#d8d8e8'; c.lineWidth = 0.07; c.lineCap = 'round';                // Hebel (Seite zur Straße)
  c.beginPath(); c.moveTo(0.65, -0.1); c.lineTo(0.88, -0.55); c.stroke();
  c.fillStyle = '#ff2a2a'; c.beginPath(); c.arc(0.88, -0.58, 0.1, 0, 6.3); c.fill();
  c.globalAlpha = 0.18; c.fillStyle = '#ffd9a0'; c.fillRect(-0.55, -0.5, 0.18, 0.78); c.globalAlpha = 1;   // Scheibenreflex
}
function getSlotSprite(): HTMLCanvasElement | null {
  if (slotSprite) return slotSprite;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = Math.round(1.8 * SLOT_PX); cv.height = Math.round(2.4 * SLOT_PX);        // Platz für den Hebel rechts
  const c = cv.getContext('2d');
  if (!c) return null;
  c.translate(0.5 * SLOT_PX + 0.65 * SLOT_PX, 1.2 * SLOT_PX); c.scale(SLOT_PX, SLOT_PX);
  slotBody(c);
  slotSprite = cv;
  return cv;
}
/** Spielautomat (Meter, Ursprung Mitte, 1,3 × 2,3 m): nah mit laufenden Walzen und blinkendem Aufsatz, fern nur das Gehäusebild. Reine Dekoration. */
function drawSlot(ctx: CanvasRenderingContext2D, seed: number, near: boolean, clock: number, reduced: boolean): void {
  const sp = getSlotSprite();
  if (sp) ctx.drawImage(sp, -0.65 - 0.5, -1.2, 1.8, 2.4); else { ctx.save(); slotBody(ctx); ctx.restore(); }
  if (!near) return;
  const on = reduced ? 0 : Math.floor(clock * 3 + seed) % 3;
  ctx.fillStyle = '#ffe27a'; for (let i = 0; i < 3; i++) { ctx.globalAlpha = i === on ? 1 : 0.45; ctx.fillRect(-0.4 + i * 0.4, -0.93, 0.2, 0.16); } ctx.globalAlpha = 1;
  for (let r = 0; r < 3; r++) {
    const rx = -0.5 + 0.03 + r * 0.32;
    const ph = reduced ? 0.4 : ((clock * (0.5 + 0.17 * r) + seed * 0.37 + r * 0.31) % 1);
    ctx.fillStyle = REEL[(seed + r * 2) % REEL.length]; ctx.beginPath(); ctx.arc(rx + 0.15, -0.4 + ph * 0.55, 0.11, 0, 6.3); ctx.fill();
  }
}
export { drawSlot };

/** Querstreifen auf einer zur Fahrtrichtung senkrechten Wand (z = const). */
const strip2 = (env: LotEnv, x0: number, x1: number, z: number, h0: number, h1: number, col: string, a = 1): void => { poly(env, [[x0, z, h0], [x1, z, h0], [x1, z, h1], [x0, z, h1]], col, a); };

// -------------------------------------------------------------------------- Zellen
export interface EncState { ev: RouteEvent; look: Look; neon: { a: string; b: string }; roofH: number; casino: boolean; wx: number }

export function encState(ev: RouteEvent, camH: number): EncState {
  const casino = ev.kind === 'CASINO_INTERIOR';
  return { ev, look: casino ? CASINO[ev.variant % CASINO.length] : TUNNEL, neon: NEON[ev.variant % NEON.length], roofH: roofHeight(camH), casino, wx: casino ? CASINO_WX : TUNNEL_WX };
}

function drawCell(env: LotEnv, st: EncState, i: number, z0: number, z1: number): void {
  const { look, roofH, casino } = st;
  const ctx = env.ctx;
  const dN = z0 - env.zc;
  const alt = i & 1;
  const near = dN < 140, detail = env.quality < 1 && near;
  const wallC = shade(alt ? look.wall2 : look.wall, dN), roofC = shade(look.roof, dN);
  const WX = st.wx;
  // Decke (reicht weit über die Wände hinaus: kein Außenraum sichtbar), Wände, Bodenlicht
  poly(env, [[-WX - 70, z0, roofH], [WX + 70, z0, roofH], [WX + 70, z1, roofH], [-WX - 70, z1, roofH]], roofC);
  for (const side of [-1, 1]) {
    const x = side * WX;
    poly(env, [[x, z0, 0], [x, z1, 0], [x, z1, roofH], [x, z0, roofH]], wallC);
    // Sockelleuchte und Kehllicht
    const led = (i + (side > 0 ? 1 : 0)) % 2 ? look.led1 : look.led2;
    strip(env, x, z0, z1, 0.15, 0.55, shade(led, dN));
    strip(env, x, z0, z1, roofH - 1.15, roofH - 0.85, shade(side > 0 ? look.led2 : look.led1, dN));
    if (casino) strip(env, x, z0, z1, 3.1, 3.3, shade(look.pilaster, dN), 0.9);               // goldene Zierleiste
    // Pilaster an der Zellgrenze
    strip(env, x, z0, z0 + 0.7, 0, roofH, shade(look.pilaster, dN), casino ? 0.55 : 1);
  }
  // Ferne Zellen (> 200 m) nur als Hülle: Decke, Wände, Lichtlinien – Rippen, Lichtbänder, Säulen und Automaten wären dort nur Flimmern und kosten Zeit
  if (dN > 200 || (env.quality > 1 && dN > 120)) return;
  // Deckenrippe und Lichtleisten (längs, abwechselnd Farben)
  poly(env, [[-WX, z0, roofH - 0.05], [WX, z0, roofH - 0.05], [WX, z0 + 1.6, roofH - 0.05], [-WX, z0 + 1.6, roofH - 0.05]], shade(look.rib, dN));
  poly(env, [[-WX, z0, roofH - 0.06], [WX, z0, roofH - 0.06], [WX, z0 + 0.14, roofH - 0.06], [-WX, z0 + 0.14, roofH - 0.06]], shade(i % 2 ? look.led2 : look.led1, dN * 0.7), 0.85);
  for (let b = -1; b <= 1; b++) {
    const col = (i + b + 3) % 3 === 0 ? look.led1 : (i + b + 3) % 3 === 1 ? look.led2 : st.neon.a;
    const x = b * 3.9;
    poly(env, [[x - 0.17, z0 + 1.5, roofH - 0.04], [x + 0.17, z0 + 1.5, roofH - 0.04], [x + 0.17, z1 - 1.5, roofH - 0.04], [x - 0.17, z1 - 1.5, roofH - 0.04]], shade(col, dN * 0.6));
    if (dN < 60 && env.quality < 1) poly(env, [[x - 0.7, z0 + 1.2, roofH - 0.04], [x + 0.7, z0 + 1.2, roofH - 0.04], [x + 0.7, z1 - 1.2, roofH - 0.04], [x - 0.7, z1 - 1.2, roofH - 0.04]], col, 0.12);
  }
  // Bodenreflexe: dezenter Farbschleier, die Fahrbahnmarkierungen bleiben darunter lesbar
  if (dN < 90) poly(env, [[-B_HALF, z0, 0], [B_HALF, z0, 0], [B_HALF, z1, 0], [-B_HALF, z1, 0]], (i % 2 ? look.led2 : look.led1), casino ? 0.06 : 0.07);

  if (casino) {
    // Säulen vor der Wand (außerhalb der Fahrspuren) und Spielautomaten in den Nischen
    for (const side of [-1, 1]) {
      const cx0 = side * (WX - 1.45), cx1 = side * (WX - 0.35);
      const zc0 = z0 + 0.7, zc1 = z0 + 2.1;
      const colL = shade(mixHex(look.pilaster, '#fff2c8', 0.25), dN), colF = shade(look.pilaster, dN * 1.2);
      poly(env, [[cx0, zc0, 0], [cx0, zc1, 0], [cx0, zc1, roofH], [cx0, zc0, roofH]], colL);                 // Straßenseite der Säule
      poly(env, [[cx0, zc0, 0], [cx1, zc0, 0], [cx1, zc0, roofH], [cx0, zc0, roofH]], colF);                 // Vorderseite
      strip(env, cx0, zc0, zc0 + 0.1, 0, roofH, '#fff7d8', 0.8);
      if (near) poly(env, [[cx0, zc0 - 0.05, 0.9], [cx0, zc1 + 0.05, 0.9], [cx0, zc1 + 0.05, 1.05], [cx0, zc0 - 0.05, 1.05]], look.led2, 0.9);
      // Automaten: drei je Zelle zwischen den Säulen
      const mx = side * (WX - 0.85);
      for (let m = 0; m < 3; m++) {
        const zm = z0 + 3.2 + m * 2.85;
        if (zm + 0.7 > z1 || zm - env.zc < 6) continue;
        const f = frame(env, mx, zm, 1.15, side);
        if (!f) continue;
        const nearM = dN < 70 && env.quality < 2;
        if (dN > 190 || (env.quality > 0 && dN > 110)) { if (dN < 330) strip(env, mx, zm - 0.6, zm + 0.6, 0, 2.3, shade('#c9962e', dN)); continue; }
        ctx.save(); ctx.transform(f[0], f[1], f[2], f[3], f[4], f[5]);
        drawSlot(ctx, (i * 7 + m * 3 + (side > 0 ? 1 : 0)) | 0, nearM, env.clock, env.reduced);
        ctx.restore();
      }
    }
    // Kronleuchter-Lichter an der Decke
    if (near) for (const x of [-3.9, 3.9]) {
      const q = env.P(x, z0 + 6, roofH - 0.3);
      if (q.d < 4) continue;
      ctx.globalAlpha *= 0.35; ctx.fillStyle = '#ffcf6b'; ctx.beginPath(); ctx.arc(q.sx, q.sy, Math.max(1.5, q.k * 0.5), 0, 6.3); ctx.fill();
      ctx.globalAlpha /= 0.35; ctx.fillStyle = '#fff2c8'; ctx.beginPath(); ctx.arc(q.sx, q.sy, Math.max(0.8, q.k * 0.18), 0, 6.3); ctx.fill();
    }
  } else {
    // Leuchtpylone (frontal zur Fahrtrichtung, daher gut lesbar): ≈ alle 120 m Neon-Palmen an beiden Wänden, dazwischen abwechselnd NS (erste Tunnelhälfte) und AS (zweite)
    const ph = ((i % 10) + 10) % 10;
    const glow = env.quality < 1 && dN < 260;
    if (ph === 0 || ph === 5) for (const side of [-1, 1]) {
      const zp = z0 + CELL / 2 - 0.3;
      if (zp - env.zc < 8) continue;
      if (ph === 5 && side !== (((i / 10) | 0) & 1 ? 1 : -1)) continue;
      const x0 = side * (WX - 3.1), x1 = side * WX;
      // Pylon: Vorderseite (zur Kamera), Straßenseite und Leuchtkante
      poly(env, [[x0, zp, 0], [x1, zp, 0], [x1, zp, roofH], [x0, zp, roofH]], shade('#12093a', dN));
      poly(env, [[x0, zp, 0], [x0, zp + 0.7, 0], [x0, zp + 0.7, roofH], [x0, zp, roofH]], shade(look.pilaster, dN));
      strip(env, x0, zp - 0.001, zp + 0.08, 0, roofH, shade(side > 0 ? look.led2 : look.led1, dN * 0.7));
      const fc = faceFrame(env, (x0 + x1) / 2, zp - 0.02, ph === 0 ? 0.55 : 4.3);
      if (!fc) continue;
      ctx.save(); ctx.transform(fc[0], fc[1], fc[2], fc[3], fc[4], fc[5]);
      if (ph === 0) {
        const v = Math.floor(hash(i * 3 + (side > 0 ? 1 : 2)) * 9);
        const pal = NEON[(v + st.ev.variant) % NEON.length];
        const alt2 = (v + (side > 0 ? 1 : 0)) % 2 === 0;
        ctx.strokeStyle = alt2 ? pal.a : pal.b; ctx.lineWidth = 0.1; ctx.globalAlpha *= 0.9; ctx.strokeRect(-1.4, -5.9, 2.8, 5.9); ctx.globalAlpha /= 0.9;
        ctx.scale(0.74, 0.74);
        drawPalm(ctx, alt2 ? pal.a : pal.b, alt2 ? pal.b : pal.a, v, detail ? 1 : 0, glow ? 1 : 0, env.clock);
      } else {
        const frac = (zp - st.ev.start) / (st.ev.end - st.ev.start);
        const txt = frac < 0.5 ? 'NS' : 'AS';
        ctx.scale(0.62, 0.62);
        drawSign(ctx, txt, txt === 'NS' ? '#ff4fd8' : '#2ee6d6', txt === 'NS' ? '#2ee6d6' : '#ff4fd8', glow ? 1 : 0, env.clock, env.reduced);
      }
      ctx.restore();
    }
  }
}

/** Portal: breite Wandfläche mit Öffnung für alle drei Spuren; von außen die Einfahrt, von innen die Ausfahrt. */
function drawPortal(env: LotEnv, st: EncState, z: number, entry: boolean): void {
  const { look, roofH, casino } = st;
  const ctx = env.ctx;
  const d = z - env.zc;
  const WX = st.wx, top = roofH + 4.6, out = WX + 40;
  const col = shade(look.portal, d);
  poly(env, [[-out, z, 0], [-WX, z, 0], [-WX, z, top], [-out, z, top]], col);
  poly(env, [[WX, z, 0], [out, z, 0], [out, z, top], [WX, z, top]], col);
  poly(env, [[-WX, z, roofH], [WX, z, roofH], [WX, z, top], [-WX, z, top]], col);
  // Leuchtkontur der Öffnung (Neon bzw. Gold), mit weichem Lichtsaum
  const pts: V3[] = [[-WX, z, 0], [-WX, z, roofH], [WX, z, roofH], [WX, z, 0]];
  const q = pts.map((p) => env.P(p[0], p[1], p[2]));
  if (q.every((p) => p.d > 2.5)) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)));
    ctx.globalAlpha *= 0.3; ctx.strokeStyle = look.trim; ctx.lineWidth = Math.max(2, q[0].k * 0.9); ctx.stroke(); ctx.globalAlpha /= 0.3;
    ctx.strokeStyle = casino ? '#fff2c8' : st.neon.b; ctx.lineWidth = Math.max(1, q[0].k * 0.28); ctx.stroke();
  }
  // Pfeilerflächen gliedern: Leuchtbänder und dunklere Platten statt einer leeren Fläche
  for (const side of [-1, 1]) {
    const xa = side * (WX + 3.6), xb = side * (WX + 18);
    for (let r = 0; r < 4; r++) strip2(env, xa, xb, z, 1.2 + r * 3.3, 1.35 + r * 3.3, shade(r % 2 ? look.led2 : look.led1, d * 0.8), 0.85);
    for (let c = 0; c < 3; c++) { const xs = side * (WX + 6 + c * 4.4); poly(env, [[xs, z, 0.8], [xs + side * 3.4, z, 0.8], [xs + side * 3.4, z, top - 1.2], [xs, z, top - 1.2]], shade(look.rib, d), 0.55); }
  }
  // Pylone mit Lichtkanten
  for (const side of [-1, 1]) {
    poly(env, [[side * (WX + 2.2), z, 0], [side * (WX + 3.0), z, 0], [side * (WX + 3.0), z, top], [side * (WX + 2.2), z, top]], shade(look.pilaster, d), casino ? 0.9 : 0.5);
  }
  if (!entry) return;
  // Kopfschild: Tunnel „NS · AS“-Palmenzeichen, Casino mit erfundenem Namen und Lichterkette
  const f = faceFrame(env, 0, z, roofH + 2.3);
  if (!f || d < 12) return;
  ctx.save(); ctx.transform(f[0], f[1], f[2], f[3], f[4], f[5]);
  if (casino) {
    const name = CASINO_NAMES[st.ev.variant % CASINO_NAMES.length];
    ctx.fillStyle = '#1a0610'; ctx.fillRect(-7.2, -1.6, 14.4, 3.2);
    ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 0.14; ctx.strokeRect(-7.2, -1.6, 14.4, 3.2);
    ctx.font = '800 1.55px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha *= 0.35; ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 0.32; ctx.strokeText(name, 0, 0.05); ctx.globalAlpha /= 0.35;
    ctx.fillStyle = '#ffe9a8'; ctx.fillText(name, 0, 0.05);
    const t = env.reduced ? 0 : Math.floor(env.clock * 5);
    for (let b = 0; b < 17; b++) { ctx.fillStyle = (b + t) % 3 === 0 ? '#fff6c8' : '#b8862a'; ctx.beginPath(); ctx.arc(-6.4 + b * 0.8, -1.38, 0.1, 0, 6.3); ctx.arc(-6.4 + b * 0.8, 1.38, 0.1, 0, 6.3); ctx.fill(); }
  } else {
    ctx.fillStyle = '#0a0524'; ctx.fillRect(-6, -1.5, 12, 3);
    ctx.strokeStyle = st.neon.a; ctx.lineWidth = 0.12; ctx.strokeRect(-6, -1.5, 12, 3);
    ctx.save(); ctx.translate(-4.6, 1.2); ctx.scale(0.55, 0.55); drawPalm(ctx, st.neon.a, st.neon.b, 1, 0, 0, env.clock); ctx.restore();
    ctx.save(); ctx.translate(4.6, 1.2); ctx.scale(0.55, 0.55); drawPalm(ctx, st.neon.b, st.neon.a, 2, 0, 0, env.clock); ctx.restore();
    ctx.save(); ctx.scale(1.15, 1.15); ctx.translate(-1.55, 0); ctx.lineCap = 'round'; ctx.strokeStyle = '#ff4fd8'; ctx.lineWidth = 0.2; glyph(ctx, 'N', 0); ctx.stroke(); glyph(ctx, 'S', 1.5); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
}

/** Stellt die sichtbaren Teile eines Ereignisses als tiefensortierte Zeichenobjekte bereit. */
export function enclosureItems(env: LotEnv, st: EncState, zc: number, drawDist: number, out: Item[]): void {
  const { ev } = st;
  const a = Math.max(ev.start, zc + 2.2), b = Math.min(ev.end, zc + drawDist);
  if (b <= a) return;
  for (let i = Math.floor(a / CELL); i <= Math.floor((b - 1e-6) / CELL); i++) {
    const z0 = Math.max(i * CELL, ev.start), z1 = Math.min((i + 1) * CELL, ev.end);
    if (z1 <= zc + 2.4) continue;
    out.push({ d: z1 - zc + 0.001, draw: () => drawCell(env, st, i, z0, z1) });
  }
  if (ev.start > zc + 2.6 && ev.start < zc + drawDist) out.push({ d: ev.start - zc, draw: () => drawPortal(env, st, ev.start, true) });
  if (ev.end > zc + 2.6 && ev.end < zc + drawDist) out.push({ d: ev.end - zc, draw: () => drawPortal(env, st, ev.end, false) });
}
