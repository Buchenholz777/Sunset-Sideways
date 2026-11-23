import { B_HALF } from './lotsconst';
import { clipNear, type Item, type LotEnv } from './lots';
import { hash, mixHex } from './scenery';
import type { RouteEvent } from '../sim/route';
import * as A from './themeart';

/**
 * Räumliche Streckenabschnitte aus der Straßenprojektion: Themen-Tunnel (Cosmic Highway, Atlantis, Neon Kingdom, Midnight Jazz) und Casino-Durchfahrten
 * (Cosmic, Atlantis, Royal Castle, Midnight Jazz). Wände, Decke, Rippen und Portale sind echte Weltpolygone und werden wie Verkehr und Grundstücke nach Tiefe
 * sortiert; Neonmotive, Figuren und Szenen liegen als Vektorpfade auf Wand- oder Frontflächen. Nichts davon hat Spiellogik: keine Hitbox, keine Spurwirkung.
 */
export const CELL = 12;
/** Innenkante der Wände (m seitlich der Straßenmitte): hinter Fahrbahn und Gehweg, damit Spuren und Verkehr frei bleiben. Der Tunnel ist weiter (Platz für Pylone). */
export const TUNNEL_WX = B_HALF + 6.4;
export const CASINO_WX = B_HALF + 4.4;
/** Höhe der Decke über dem Boden (m): immer über der Kamera, damit die Decke nie die Fahrbahn verdeckt (Hochformat: Kamera ≈ 7,5 m hoch). */
export const roofHeight = (camH: number): number => Math.max(7.2, camH + 2.6);

type V3 = [number, number, number];

export const CASINO_NAMES = ['COSMIC CASINO', 'ATLANTIS PALACE', 'ROYAL CASTLE', 'MIDNIGHT JAZZ'];
export const TUNNEL_NAMES = ['COSMIC HIGHWAY', 'ATLANTIS', 'NEON KINGDOM', 'MIDNIGHT JAZZ'];

interface Look { wall: string; wall2: string; pilaster: string; roof: string; rib: string; led1: string; led2: string; trim: string; portal: string }
/** Farbwelten der Tunnel (0 Cosmic, 1 Atlantis, 2 Kingdom, 3 Jazz). */
const TUNNEL_LOOK: Look[] = [
  { wall: '#0a0a2c', wall2: '#0f0f3a', pilaster: '#1f2a6a', roof: '#04041a', rib: '#1a1a58', led1: '#2ee6ff', led2: '#ff4fd8', trim: '#7fe9ff', portal: '#070724' },
  { wall: '#0a3a4a', wall2: '#0c4456', pilaster: '#c9a23a', roof: '#06303c', rib: '#0f5a6e', led1: '#4cf2e0', led2: '#ffe08a', trim: '#4cf2e0', portal: '#07323f' },
  { wall: '#2a1f3e', wall2: '#33264a', pilaster: '#6a5a8c', roof: '#140c24', rib: '#3a2a5c', led1: '#ffb04a', led2: '#4ee8ff', trim: '#ffcf6b', portal: '#1c1230' },
  { wall: '#160608', wall2: '#1e0a0e', pilaster: '#d9a93a', roof: '#0a0305', rib: '#3a0f16', led1: '#ffcf6b', led2: '#b46bff', trim: '#ffcf6b', portal: '#12060a' },
];
/** Farbwelten der Casinos (0 Cosmic, 1 Atlantis, 2 Royal Castle, 3 Midnight Jazz). */
const CASINO_LOOK: Look[] = [
  { wall: '#120a3a', wall2: '#180e46', pilaster: '#7fe9ff', roof: '#08062a', rib: '#2a1a70', led1: '#2ee6ff', led2: '#ff4fd8', trim: '#7fe9ff', portal: '#0e0830' },
  { wall: '#0a4350', wall2: '#0e4e5c', pilaster: '#e2b64a', roof: '#073a46', rib: '#14707e', led1: '#4cf2e0', led2: '#ffe08a', trim: '#ffe08a', portal: '#08404c' },
  { wall: '#3a0e16', wall2: '#46121c', pilaster: '#e8c25a', roof: '#200610', rib: '#561a24', led1: '#ffd98a', led2: '#ff5a7a', trim: '#ffd98a', portal: '#300a12' },
  { wall: '#150608', wall2: '#1e0a0e', pilaster: '#dcae3c', roof: '#0c0306', rib: '#47184a', led1: '#ffcf6b', led2: '#b46bff', trim: '#ffcf6b', portal: '#12060a' },
];
/** Spielautomaten-Gehäuse je Casino-Thema: Körper, Aufsatz, Akzent. */
const SLOT_SKIN = [
  { body: '#2a2f8a', top: '#0e1a4a', edge: '#7fe9ff', panel: '#5a1f7a' },
  { body: '#1f8a8a', top: '#0a4a5a', edge: '#ffe08a', panel: '#0a5a6a' },
  { body: '#c9962e', top: '#7a1f3a', edge: '#e8c25a', panel: '#7a1f3a' },
  { body: '#1a1418', top: '#4a1a8a', edge: '#ffcf6b', panel: '#6a1f2a' },
];

// -------------------------------------------------------------------------- Zeichenhilfen
const shadeCache = new Map<string, string>();
/** Farbe mit Dunst nach Tiefe (in 12 Stufen zwischengespeichert: keine Zeichenfolgen pro Bild). */
function shade(col: string, d: number): string {
  const b = Math.min(11, Math.max(0, Math.floor((d / 460) * 12)));
  const key = col + b;
  let c = shadeCache.get(key);
  if (!c) { c = mixHex(col, '#0a0520', b * 0.045); if (shadeCache.size > 800) shadeCache.clear(); shadeCache.set(key, c); }
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
/** Querstreifen auf einer zur Fahrtrichtung senkrechten Wand (z = const). */
const strip2 = (env: LotEnv, x0: number, x1: number, z: number, h0: number, h1: number, col: string, a = 1): void => { poly(env, [[x0, z, h0], [x1, z, h0], [x1, z, h1], [x0, z, h1]], col, a); };

type Mat = [number, number, number, number, number, number];
/** Meter-Koordinatensystem auf einer Wand: Ursprung am Punkt (x, z, h), X nach rechts (Leserichtung), Y nach unten. Nur Näherung der Perspektive (lokal affin). */
function frame(env: LotEnv, x: number, z: number, h: number, side: number): Mat | null {
  const o = env.P(x, z, h);
  if (o.d < 4) return null;
  const ez = env.P(x, z + 1, h), eh = env.P(x, z, h - 1);
  const s = side > 0 ? -1 : 1;
  return [(ez.sx - o.sx) * s, (ez.sy - o.sy) * s, eh.sx - o.sx, eh.sy - o.sy, o.sx, o.sy];
}
/** Meter-Koordinatensystem auf einer zur Fahrtrichtung senkrechten Fläche (z = const): X nach rechts, Y nach unten, Ursprung bei (x, z, h). */
function faceFrame(env: LotEnv, x: number, z: number, h: number): Mat | null {
  const o = env.P(x, z, h);
  if (o.d < 4) return null;
  const ex = env.P(x + 1, z, h), eh = env.P(x, z, h - 1);
  return [ex.sx - o.sx, ex.sy - o.sy, eh.sx - o.sx, eh.sy - o.sy, o.sx, o.sy];
}
function onWall(env: LotEnv, x: number, z: number, h: number, side: number, draw: () => void): void {
  const f = frame(env, x, z, h, side);
  if (!f) return;
  const c = env.ctx; c.save(); c.transform(f[0], f[1], f[2], f[3], f[4], f[5]); draw(); c.restore();
}
function onFace(env: LotEnv, x: number, z: number, h: number, draw: () => void): void {
  const f = faceFrame(env, x, z, h);
  if (!f) return;
  const c = env.ctx; c.save(); c.transform(f[0], f[1], f[2], f[3], f[4], f[5]); draw(); c.restore();
}

/** Querschnitt des Raums (abgeschrägte Ecken) als Linienzug – Ringe, Bögen und Rahmen. */
function section(st: EncState, z: number, inset = 0, gothic = false): V3[] {
  const WX = st.wx - inset, H = st.roofH - inset * 0.5;
  if (gothic) {
    const pts: V3[] = [[-WX, z, 0.3], [-WX, z, H * 0.5]];
    for (let k = 1; k <= 7; k++) { const t = k / 7; pts.push([-WX * (1 - t) ** 1.6 * (1 - 0.0), z, H * 0.5 + (H * 0.5 + 0.2) * Math.sin(t * Math.PI / 2) ** 0.9]); }
    for (let k = 6; k >= 0; k--) { const t = k / 7; pts.push([WX * (1 - t) ** 1.6, z, H * 0.5 + (H * 0.5 + 0.2) * Math.sin(t * Math.PI / 2) ** 0.9]); }
    pts.push([WX, z, H * 0.5], [WX, z, 0.3]);
    return pts;
  }
  const c = Math.min(2.6, H * 0.34);
  return [[-WX, z, 0.3], [-WX, z, H - c], [-WX + c, z, H], [WX - c, z, H], [WX, z, H - c], [WX, z, 0.3]];
}
function strokeSection(env: LotEnv, pts: V3[], col: string, w: number, glow: boolean, a = 1): void {
  const q = pts.map((p) => env.P(p[0], p[1], p[2]));
  if (q.some((p) => p.d < 3)) return;
  const ctx = env.ctx, k = q[0].k;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)));
  const base = ctx.globalAlpha;
  if (glow) { ctx.globalAlpha = base * 0.28 * a; ctx.strokeStyle = col; ctx.lineWidth = Math.max(2.2, w * k * 3); ctx.stroke(); }
  ctx.globalAlpha = base * a; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w * k); ctx.stroke();
  ctx.globalAlpha = base;
}

// -------------------------------------------------------------------------- Spielautomat (Meter, Ursprung Mitte, 1,3 × 2,3 m; reine Dekoration)
const REEL = ['#ff3b3b', '#ffd23a', '#2ee6d6', '#ff4fd8', '#ffffff', '#7fe36a'];
const slotSprites: Array<HTMLCanvasElement | null> = [null, null, null, null];
const SLOT_PX = 56;
/** Gehäuse, Fenster, Bedienfeld und Hebel einmal in ein kleines Bild gezeichnet und wiederverwendet (statt ~30 Zeichenaufrufe je Automat und Bild). */
function slotBody(c: CanvasRenderingContext2D, sk: (typeof SLOT_SKIN)[number]): void {
  c.fillStyle = sk.body; c.fillRect(-0.65, -1.15, 1.3, 2.3);
  c.fillStyle = sk.edge; c.fillRect(-0.65, -1.15, 1.3, 0.08); c.fillRect(-0.65, -1.15, 0.07, 2.3); c.fillRect(0.58, -1.15, 0.07, 2.3);
  c.fillStyle = sk.top; c.fillRect(-0.55, -1.05, 1.1, 0.42);
  c.fillStyle = '#0c0a1e'; c.fillRect(-0.5, -0.5, 1, 0.78);
  c.fillStyle = '#fff3d0'; c.globalAlpha = 0.2; c.fillRect(-0.5, -0.5, 1, 0.78); c.globalAlpha = 1;
  for (let r = 0; r < 3; r++) { c.fillStyle = '#0c0a1e'; c.fillRect(-0.47 + r * 0.32, -0.47, 0.3, 0.72); }
  c.fillStyle = sk.panel; c.fillRect(-0.55, 0.36, 1.1, 0.26);
  c.fillStyle = '#ff3b3b'; c.fillRect(-0.4, 0.43, 0.2, 0.12); c.fillStyle = '#2ee6d6'; c.fillRect(-0.1, 0.43, 0.2, 0.12); c.fillStyle = '#ffd23a'; c.fillRect(0.2, 0.43, 0.2, 0.12);
  c.fillStyle = '#12091f'; c.fillRect(-0.45, 0.72, 0.9, 0.32);
  c.strokeStyle = '#d8d8e8'; c.lineWidth = 0.07; c.lineCap = 'round';
  c.beginPath(); c.moveTo(0.65, -0.1); c.lineTo(0.88, -0.55); c.stroke();
  c.fillStyle = '#ff2a2a'; c.beginPath(); c.arc(0.88, -0.58, 0.1, 0, 6.3); c.fill();
  c.globalAlpha = 0.18; c.fillStyle = '#ffffff'; c.fillRect(-0.55, -0.5, 0.18, 0.78); c.globalAlpha = 1;
}
function getSlotSprite(skin: number): HTMLCanvasElement | null {
  const hit = slotSprites[skin];
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = Math.round(1.8 * SLOT_PX); cv.height = Math.round(2.4 * SLOT_PX);
  const c = cv.getContext('2d');
  if (!c) return null;
  c.translate(0.5 * SLOT_PX + 0.65 * SLOT_PX, 1.2 * SLOT_PX); c.scale(SLOT_PX, SLOT_PX);
  slotBody(c, SLOT_SKIN[skin]);
  slotSprites[skin] = cv;
  return cv;
}
/** Spielautomat: nah mit laufenden Walzen und blinkendem Aufsatz (je Automat eigener Takt, manche stehen still), fern nur das Gehäusebild. Reine Dekoration. */
function drawSlot(ctx: CanvasRenderingContext2D, seed: number, near: boolean, clock: number, reduced: boolean, skin: number): void {
  const sp = getSlotSprite(skin);
  if (sp) ctx.drawImage(sp, -0.65 - 0.5, -1.2, 1.8, 2.4); else { ctx.save(); slotBody(ctx, SLOT_SKIN[skin]); ctx.restore(); }
  if (!near) return;
  const on = reduced ? 0 : Math.floor(clock * 3 + seed) % 3;
  ctx.fillStyle = '#ffe27a'; for (let i = 0; i < 3; i++) { ctx.globalAlpha = i === on ? 1 : 0.45; ctx.fillRect(-0.4 + i * 0.4, -0.93, 0.2, 0.16); } ctx.globalAlpha = 1;
  // Ein Teil der Automaten dreht gerade (Phase je Automat), die anderen zeigen ruhende Symbole
  const spinning = !reduced && ((clock * 0.22 + seed * 0.37) % 1) < 0.45;
  for (let r = 0; r < 3; r++) {
    const rx = -0.5 + 0.03 + r * 0.32;
    const ph = spinning ? ((clock * (1.4 + 0.3 * r) + seed * 0.37 + r * 0.31) % 1) : 0.45;
    ctx.fillStyle = REEL[(seed + r * 2 + (spinning ? Math.floor(clock * 6 + r) : 0)) % REEL.length];
    ctx.beginPath(); ctx.arc(rx + 0.15, -0.4 + ph * 0.55, 0.11, 0, 6.3); ctx.fill();
  }
}
export { drawSlot };

// -------------------------------------------------------------------------- Zustand
export interface EncState { ev: RouteEvent; look: Look; roofH: number; casino: boolean; wx: number; theme: number; mid: number }

export function encState(ev: RouteEvent, camH: number): EncState {
  const casino = ev.kind === 'CASINO_INTERIOR';
  return { ev, look: (casino ? CASINO_LOOK : TUNNEL_LOOK)[ev.theme % 4], roofH: roofHeight(camH), casino, wx: casino ? CASINO_WX : TUNNEL_WX, theme: ev.theme % 4, mid: Math.floor((ev.start + ev.end) / 2 / CELL) };
}

/** Stärke 0…1 des kurzen Energieimpulses beim Durchfahren des Sternenbogens (Cosmic Highway), sonst 0. Reine Darstellung. */
export function starFlash(ev: RouteEvent | null, s: number): number {
  if (!ev || ev.kind !== 'PALM_TUNNEL' || ev.theme % 4 !== 0) return 0;
  const d = Math.abs(s - (ev.start + ev.end) / 2);
  return d > 28 ? 0 : (1 - d / 28) ** 2;
}

// -------------------------------------------------------------------------- Himmel-/Wasser-/Sterneffekte der Decke (je Zelle, nur nah)
function roofStars(env: LotEnv, st: EncState, i: number, z0: number, z1: number, dN: number): void {
  if (dN > 260) return;
  const ctx = env.ctx, WX = st.wx;
  for (let n = 0; n < 9; n++) {
    const x = (hash(i * 9 + n) - 0.5) * 2 * (WX - 1), z = z0 + hash(i * 13 + n * 3) * (z1 - z0);
    const q = env.P(x, z, st.roofH - 0.03);
    if (q.d < 3) continue;
    const tw = env.reduced ? 1 : 0.55 + 0.45 * Math.sin(env.clock * (1 + hash(n + i) * 2) + n);
    ctx.globalAlpha *= tw; ctx.fillStyle = n % 4 === 0 ? '#ff9af0' : n % 3 === 0 ? '#7fe9ff' : '#ffffff';
    const s = Math.max(1, q.k * 0.07 * (1 + hash(n * 7 + i)));
    ctx.fillRect(q.sx, q.sy, s, s); ctx.globalAlpha /= tw;
  }
}
function waterRoof(env: LotEnv, st: EncState, i: number, z0: number, z1: number, dN: number): void {
  if (dN > 200) return;
  const WX = st.wx, H = st.roofH, ctx = env.ctx;
  // Lichtbahnen von der Wasseroberfläche (langsam wandernd) und Wellenlinien
  for (let n = 0; n < 3; n++) {
    const sh = env.reduced ? 0 : Math.sin(env.clock * 0.35 + n + i) * 1.6;
    const x = (n - 1) * 7 + sh;
    poly(env, [[x - 0.8, z0, H - 0.02], [x + 0.8, z0, H - 0.02], [x + 1.6, z1, H - 0.02], [x - 0.0, z1, H - 0.02]], '#aefcff', 0.1);
  }
  if (dN < 120) {
    ctx.strokeStyle = '#bffcff'; ctx.lineWidth = Math.max(1, 0.05 * env.P(0, z0 + 6, H).k);
    const base = ctx.globalAlpha; ctx.globalAlpha = base * 0.3;
    for (let w = 0; w < 2; w++) {
      ctx.beginPath();
      for (let s = 0; s <= 8; s++) { const x = -WX + (s / 8) * 2 * WX, z = z0 + 3 + w * 6 + Math.sin(s * 0.9 + (env.reduced ? 0 : env.clock * 0.8) + i * 1.3) * 0.7; const q = env.P(x, z, H - 0.03); if (s) ctx.lineTo(q.sx, q.sy); else ctx.moveTo(q.sx, q.sy); }
      ctx.stroke();
    }
    ctx.globalAlpha = base;
  }
}
function bubbles(env: LotEnv, st: EncState, i: number, z0: number, dN: number): void {
  if (dN > 150 || env.quality > 1) return;
  const ctx = env.ctx, WX = st.wx;
  for (let n = 0; n < 6; n++) {
    const side = n & 1 ? 1 : -1, u = ((env.reduced ? 0.3 : env.clock * (0.07 + hash(n + i) * 0.05)) + hash(i * 5 + n)) % 1;
    const q = env.P(side * (WX - 0.4 - hash(n * 3 + i) * 1.4), z0 + hash(i * 3 + n * 2) * 12, 0.5 + u * (st.roofH - 1));
    if (q.d < 3) continue;
    ctx.globalAlpha *= 0.55; ctx.strokeStyle = '#d9ffff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q.sx, q.sy, Math.max(1, q.k * (0.07 + 0.08 * hash(n + i * 7))), 0, 6.3); ctx.stroke(); ctx.globalAlpha /= 0.55;
  }
}

// -------------------------------------------------------------------------- Tunnelzelle
function tunnelDecor(env: LotEnv, st: EncState, i: number, z0: number, _z1: number, dN: number, detail: boolean, glow: boolean): void {
  const { roofH, look } = st, WX = st.wx, ctx = env.ctx, th = st.theme;
  const ph = ((i % 10) + 10) % 10;
  const art: A.Art = { clock: env.clock, detail, glow, v: 0, reduced: env.reduced };
  const isMid = i === st.mid;
  const zp = z0 + CELL / 2 - 0.3;
  // --- Raumringe / Bögen quer zur Fahrtrichtung (Zellgrenze), Takt je Thema
  if (th === 0 && i % 2 === 0) strokeSection(env, section(st, z0 + 0.05, 0.6), (i / 2) % 2 ? look.led2 : look.led1, 0.22, glow && dN < 200, 0.95);
  if (th === 2 && i % 2 === 0) { strokeSection(env, section(st, z0 + 0.05, 0.4, true), '#ffcf6b', 0.2, glow && dN < 180, 0.9); if (dN < 140) strokeSection(env, section(st, z0 + 0.05, 1.3, true), '#4ee8ff', 0.1, false, 0.55); }
  if (th === 3 && i % 3 === 0) strokeSection(env, section(st, z0 + 0.05, 0.5), '#ffcf6b', 0.2, glow && dN < 200, 0.9);
  if (th === 1 && i % 3 === 0) strokeSection(env, section(st, z0 + 0.05, 0.5), '#e2b64a', 0.18, glow && dN < 180, 0.85);
  // --- Wandkunst je Thema
  for (const side of [-1, 1]) {
    const x = side * (WX - 0.02);
    const seed = i * 2 + (side > 0 ? 1 : 0);
    if (th === 0) {
      if (ph === 3 + (side > 0 ? 1 : 0) && dN < 280) onWall(env, x, z0 + CELL / 2, 0.8, side, () => { ctx.scale(1.5, 1.5); art.v = seed; A.cosmicWindow(ctx, art); });
      if (!env.reduced && dN < 200 && hash(seed + 41) > 0.93) {          // dezenter Meteor entlang der Wand
        const t = (env.clock * 0.6 + hash(seed)) % 1, zz = z0 + t * CELL, hh = roofH - 1.3 - t * 3.4;
        const a = env.P(x, zz, hh), b = env.P(x, zz + 2.6, hh + 0.7);
        if (a.d > 3 && b.d > 3) { ctx.globalAlpha *= 0.8; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, a.k * 0.06); ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); ctx.globalAlpha /= 0.8; }
      }
    } else if (th === 1) {
      if ((ph === 3 || ph === 8) && dN < 300) onWall(env, side * (WX + 7), z0 + CELL / 2, 0.6, side, () => { ctx.scale(1.6, 1.6); art.v = seed; A.atlantisTemple(ctx, art); });
      if (ph === 1 || ph === 6) onWall(env, side * (WX + 4), z0 + CELL / 2, 0.3, side, () => { art.v = seed; ctx.scale(1.4, 1.4); A.fishSchool(ctx, art, seed, side); });
    } else if (th === 2) {
      if ((ph === 3 || ph === 8) && dN < 260) onWall(env, x, z0 + CELL / 2, 0.8, side, () => { ctx.scale(1.35, 1.35); art.v = seed; A.gothicWindow(ctx, art); });
      if ((ph === 1 || ph === 6) && dN < 200) onWall(env, x, z0 + CELL / 2, 1.5, side, () => { for (let k = 0; k < 3; k++) A.rune(ctx, art, -1.5 + k * 1.5, -1.5, seed + k); });
      if (dN < 100 && (ph === 2 || ph === 7)) onWall(env, x, z0 + CELL / 2, 1.1, side, () => { for (let k = 0; k < 2; k++) A.flame(ctx, { ...art, v: seed + k }, -1.6 + k * 3.2, -2.2, 1.1); });
    } else {
      if (ph === 3 + (side > 0 ? 1 : 0) && dN < 260) onWall(env, x, z0 + CELL / 2, 1.6, side, () => { ctx.scale(2.0, 2.0); art.v = seed; A.decoFan(ctx, art, 1.6); });
      if ((ph === 1 || ph === 6) && side === (i % 2 ? 1 : -1) && dN < 200) onWall(env, x, z0 + CELL / 2, 1.8, side, () => { ctx.scale(1.4, 1.4); const t = env.reduced ? 0 : Math.sin(env.clock * 2.2 + seed); A.note(ctx, '#ff8a3a', -1.2, -0.5 + t * 0.15, 1.2, true); A.note(ctx, '#b46bff', 1.0, -1.4 - t * 0.15, 1.1, false); });
      if (dN < 90 && env.quality < 1) onWall(env, x, z0 + CELL / 2, 0.55, side, () => { A.pianoKeys(ctx, 6.4, 0.45); });
    }
  }
  // --- Pylone (frontal, sehr gut lesbar): alle ~120 m beide Wände, dazwischen eine Sonderfigur
  if (ph === 0 || ph === 5) for (const side of [-1, 1]) {
    if (zp - env.zc < 8) continue;
    if (ph === 5 && side !== (((i / 10) | 0) & 1 ? 1 : -1)) continue;
    const x0 = side * (WX - 3.1), x1 = side * WX;
    const fin = th === 1 ? '#0b4a5a' : th === 2 ? '#2a2046' : th === 3 ? '#1a0a0e' : '#0c0c40';
    poly(env, [[x0, zp, 0], [x1, zp, 0], [x1, zp, roofH], [x0, zp, roofH]], shade(fin, dN));
    poly(env, [[x0, zp, 0], [x0, zp + 0.7, 0], [x0, zp + 0.7, roofH], [x0, zp, roofH]], shade(look.pilaster, dN));
    strip(env, x0, zp - 0.001, zp + 0.08, 0, roofH, shade(side > 0 ? look.led2 : look.led1, dN * 0.7));
    const v = Math.floor(hash(i * 3 + (side > 0 ? 1 : 2)) * 9);
    onFace(env, (x0 + x1) / 2, zp - 0.02, 0.3, () => {
      art.v = v;
      if (th === 0) { if (ph === 0) A.cosmicPlanet(ctx, art); else if (v % 2) A.cosmicGalaxy(ctx, art); else A.cosmicHolo(ctx, art); }
      else if (th === 1) { ctx.translate(0, 0); A.atlantisPylon(ctx, art); }
      else if (th === 2) A.kingdomPylon(ctx, art);
      else A.jazzPylon(ctx, art);
    });
  }
  // --- Höhepunkt in der Tunnelmitte
  if (isMid) {
    const zm = z0 + CELL / 2;
    if (th === 0) {                                                             // leuchtender Sternenbogen
      for (let k = 0; k < 3; k++) strokeSection(env, section(st, zm + k * 2.2, 0.2 + k * 0.5), k % 2 ? look.led2 : look.led1, 0.55 - k * 0.1, glow, 1);
      if (dN < 200) for (let n = 0; n < 18; n++) { const an = (n / 18) * Math.PI, r = WX * 0.9, x = Math.cos(an) * r, h = 0.5 + Math.sin(an) * (roofH - 1.2); const q = env.P(x, zm + 1, h); if (q.d > 3) { ctx.globalAlpha *= env.reduced ? 0.8 : 0.4 + 0.6 * Math.abs(Math.sin(env.clock * 3 + n)); ctx.fillStyle = '#ffffff'; ctx.fillRect(q.sx - 1, q.sy - 1, Math.max(2, q.k * 0.12), Math.max(2, q.k * 0.12)); ctx.globalAlpha = 1; } }
    } else if (th === 2) {                                                      // großer magischer Burgbogen
      for (let k = 0; k < 3; k++) strokeSection(env, section(st, zm + k * 1.6, 0.0 + k * 0.7, true), k === 1 ? '#4ee8ff' : '#ffcf6b', 0.5 - k * 0.1, glow, 1);
      if (dN < 200 && !env.reduced) for (let n = 0; n < 10; n++) { const u = (env.clock * 0.25 + n / 10) % 1, q = env.P((hash(n) - 0.5) * 2 * WX * 0.8, zm + 1.5, 1 + u * (roofH - 2)); if (q.d > 3) { ctx.globalAlpha *= 1 - u; ctx.fillStyle = '#9ff4ff'; ctx.fillRect(q.sx, q.sy, Math.max(1.5, q.k * 0.09), Math.max(1.5, q.k * 0.09)); ctx.globalAlpha = 1; } }
    } else if (th === 3) {                                                      // Jazzclub mit Bühne seitlich
      const side = st.ev.variant % 2 ? 1 : -1;
      onWall(env, side * (WX - 0.03), zm, 0.9, side, () => { art.v = 0; ctx.scale(1.0, 1.0); A.jazzStage(ctx, art); });
      poly(env, [[side * WX, zm - 6, 0], [side * WX, zm + 6, 0], [side * WX, zm + 6, 0.35], [side * WX, zm - 6, 0.35]], '#ffcf6b', 0.9);
    }
  }
}

function drawCell(env: LotEnv, st: EncState, i: number, z0: number, z1: number): void {
  const { look, roofH, casino, theme } = st;
  const ctx = env.ctx;
  const dN = z0 - env.zc;
  const alt = i & 1;
  const near = dN < 140, detail = env.quality < 1 && near, glow = env.quality < 1 && dN < 260;
  const wallC = shade(alt ? look.wall2 : look.wall, dN), roofC = shade(look.roof, dN);
  const WX = st.wx;
  const water = theme === 1;                                       // Atlantis: Glaswände, dahinter Unterwasserwelt
  // Szene hinter dem Glas (Atlantis) zuerst
  if (water && !casino && dN < 300) {
    for (const side of [-1, 1]) {
      const seed = i * 2 + (side > 0 ? 1 : 0);
      const ph = ((i % 10) + 10) % 10;
      if (ph === 3 || ph === 8) onWall(env, side * (WX + 7), z0 + CELL / 2, 0.6, side, () => { ctx.scale(1.6, 1.6); A.atlantisTemple(ctx, { clock: env.clock, detail, glow, v: seed, reduced: env.reduced }); });
      if (ph === 1 || ph === 6) onWall(env, side * (WX + 4), z0 + CELL / 2, 0.3, side, () => { ctx.scale(1.4, 1.4); A.fishSchool(ctx, { clock: env.clock, detail, glow, v: seed, reduced: env.reduced }, seed, side); });
      if (dN < 200) for (let c = 0; c < 2; c++) onWall(env, side * (WX + 2.5 + c * 2), z0 + 3 + c * 6 + hash(seed + c) * 2, 0, side, () => A.coral(ctx, c ? '#4cf2e0' : '#ff79c8', seed + c * 5, glow && dN < 120));
    }
  }
  // Decke (reicht weit über die Wände hinaus: kein Außenraum sichtbar), Wände
  poly(env, [[-WX - 70, z0, roofH], [WX + 70, z0, roofH], [WX + 70, z1, roofH], [-WX - 70, z1, roofH]], roofC, water ? 0.9 : 1);
  for (const side of [-1, 1]) {
    const x = side * WX;
    poly(env, [[x, z0, 0], [x, z1, 0], [x, z1, roofH], [x, z0, roofH]], wallC, water && !casino ? 0.5 : 1);
    const led = (i + (side > 0 ? 1 : 0)) % 2 ? look.led1 : look.led2;
    strip(env, x, z0, z1, 0.15, 0.55, shade(led, dN));
    strip(env, x, z0, z1, roofH - 1.15, roofH - 0.85, shade(side > 0 ? look.led2 : look.led1, dN));
    if (casino) strip(env, x, z0, z1, 3.1, 3.3, shade(look.pilaster, dN), 0.9);
    strip(env, x, z0, z0 + 0.7, 0, roofH, shade(look.pilaster, dN), casino || water ? 0.55 : 1);
  }
  if (dN > 200 || (env.quality > 1 && dN > 120)) return;       // ferne Zellen nur als Hülle
  // Deckenrippe und Lichtleisten
  poly(env, [[-WX, z0, roofH - 0.05], [WX, z0, roofH - 0.05], [WX, z0 + 1.6, roofH - 0.05], [-WX, z0 + 1.6, roofH - 0.05]], shade(look.rib, dN), water ? 0.6 : 1);
  poly(env, [[-WX, z0, roofH - 0.06], [WX, z0, roofH - 0.06], [WX, z0 + 0.14, roofH - 0.06], [-WX, z0 + 0.14, roofH - 0.06]], shade(i % 2 ? look.led2 : look.led1, dN * 0.7), 0.85);
  for (let b = -1; b <= 1; b++) {
    const col = (i + b + 3) % 3 === 0 ? look.led1 : (i + b + 3) % 3 === 1 ? look.led2 : look.trim;
    const x = b * 3.9;
    poly(env, [[x - 0.17, z0 + 1.5, roofH - 0.04], [x + 0.17, z0 + 1.5, roofH - 0.04], [x + 0.17, z1 - 1.5, roofH - 0.04], [x - 0.17, z1 - 1.5, roofH - 0.04]], shade(col, dN * 0.6), water ? 0.7 : 1);
    if (dN < 60 && env.quality < 1) poly(env, [[x - 0.7, z0 + 1.2, roofH - 0.04], [x + 0.7, z0 + 1.2, roofH - 0.04], [x + 0.7, z1 - 1.2, roofH - 0.04], [x - 0.7, z1 - 1.2, roofH - 0.04]], col, 0.12);
  }
  if (dN < 90) poly(env, [[-B_HALF, z0, 0], [B_HALF, z0, 0], [B_HALF, z1, 0], [-B_HALF, z1, 0]], (i % 2 ? look.led2 : look.led1), casino ? 0.06 : 0.07);
  // Thema-Details der Decke
  if (theme === 0 || (casino && theme === 0)) roofStars(env, st, i, z0, z1, dN);
  if (water) { waterRoof(env, st, i, z0, z1, dN); bubbles(env, st, i, z0, dN); }

  if (casino) casinoCell(env, st, i, z0, z1, dN, near);
  else tunnelDecor(env, st, i, z0, z1, dN, detail, glow);
  void ctx;
}

// -------------------------------------------------------------------------- Casino-Zelle: Säulen, Automaten, Gäste
function billboard(env: LotEnv, x: number, z: number, scale: number, draw: () => void): void {
  const q = env.P(x, z, 0);
  if (q.d < 6) return;
  const c = env.ctx; c.save(); c.translate(q.sx, q.sy); c.scale(q.k * scale, q.k * scale); draw(); c.restore();
}

function casinoCell(env: LotEnv, st: EncState, i: number, z0: number, z1: number, dN: number, near: boolean): void {
  const { look, roofH, theme } = st, WX = st.wx, ctx = env.ctx;
  const jazz = theme === 3;
  for (const side of [-1, 1]) {
    const cx0 = side * (WX - 1.45), cx1 = side * (WX - 0.35);
    const zc0 = z0 + 0.7, zc1 = z0 + 2.1;
    const colL = shade(mixHex(look.pilaster, '#fff2c8', theme === 0 ? 0.0 : 0.25), dN), colF = shade(look.pilaster, dN * 1.2);
    poly(env, [[cx0, zc0, 0], [cx0, zc1, 0], [cx0, zc1, roofH], [cx0, zc0, roofH]], colL);
    poly(env, [[cx0, zc0, 0], [cx1, zc0, 0], [cx1, zc0, roofH], [cx0, zc0, roofH]], colF);
    strip(env, cx0, zc0, zc0 + 0.1, 0, roofH, '#fff7d8', 0.8);
    if (near) poly(env, [[cx0, zc0 - 0.05, 0.9], [cx0, zc1 + 0.05, 0.9], [cx0, zc1 + 0.05, 1.05], [cx0, zc0 - 0.05, 1.05]], look.led2, 0.9);
    if (theme === 2 && near && dN < 110) onFace(env, (cx0 + cx1) / 2, zc0 - 0.03, 2.2, () => { ctx.scale(0.9, 0.9); A.banner(ctx, { clock: env.clock, detail: false, glow: false, v: i + (side > 0 ? 1 : 0), reduced: env.reduced }, 0, -0.4); });
    if (theme === 0 && dN < 120) strokeSection(env, [[cx0, zc0, 2.2], [cx0, zc1, 2.2]], look.led1, 0.08, false, 0.9);
    // Szene dieser Zelle auf dieser Seite (vier Szenen im Wechsel, Seiten versetzt)
    const scene = (i + (side > 0 ? 2 : 0)) % 4;
    const seedBase = i * 31 + (side > 0 ? 7 : 0);
    const mx = side * (WX - 0.85);
    const farGuests = dN > 125 || (env.quality > 0 && dN > 70) || env.quality > 1;
    if (scene === 0 || scene === 2) {
      for (let m = 0; m < 3; m++) {
        const zm = z0 + 3.2 + m * 2.85;
        if (zm + 0.7 > z1 || zm - env.zc < 6) continue;
        const f = frame(env, mx, zm, 1.15, side);
        if (!f) continue;
        if (dN > 190 || (env.quality > 0 && dN > 110)) { if (dN < 330) strip(env, mx, zm - 0.6, zm + 0.6, 0, 2.3, shade(SLOT_SKIN[theme].body, dN)); continue; }
        ctx.save(); ctx.transform(f[0], f[1], f[2], f[3], f[4], f[5]);
        drawSlot(ctx, (i * 7 + m * 3 + (side > 0 ? 1 : 0)) | 0, dN < 70 && env.quality < 2, env.clock, env.reduced, theme);
        ctx.restore();
        // Gast am Automaten: sitzt, zieht gelegentlich den Hebel; nicht an jedem Automaten
        if (!farGuests && scene === 0 && m !== 1 && hash(seedBase + m) > 0.2) billboard(env, side * (WX - 2.2), zm, 1.12, () => A.drawGuest(ctx, 'sit', seedBase + m, env.clock, env.reduced, -side));
      }
      if (scene === 2 && !farGuests) {                                                   // Gäste gehen und unterhalten sich zwischen den Spielbereichen
        const t = env.reduced ? 0.4 : (env.clock * 0.07 + hash(seedBase)) % 1;
        billboard(env, side * (WX - 3.3), z0 + 1.5 + t * 9, 1.12, () => A.drawGuest(ctx, 'walk', seedBase + 5, env.clock, env.reduced, side > 0 ? 1 : -1));
        billboard(env, side * (WX - 3.0), z0 + 9.2, 1.12, () => A.drawGuest(ctx, 'stand', seedBase + 9, env.clock, env.reduced, side));
        billboard(env, side * (WX - 3.0), z0 + 10.2, 1.12, () => A.drawGuest(ctx, 'stand', seedBase + 10, env.clock, env.reduced, -side));
      }
    } else if (scene === 1) {                                                            // Spieltisch mit Croupier und Spielern
      if (!farGuests || dN < 160) {
        const tx = side * (WX - 2.9), tz = z0 + 6.2;
        billboard(env, tx, tz, 1.15, () => A.playTable(ctx, theme === 1 ? '#0e6a6a' : theme === 2 ? '#7a1830' : theme === 3 ? '#1a1a2a' : '#2a1a8a', env.clock, env.reduced, seedBase));
        if (!farGuests) {
          billboard(env, side * (WX - 1.4), tz, 1.12, () => A.drawGuest(ctx, 'deal', seedBase + 1, env.clock, env.reduced, -side));
          billboard(env, tx, tz - 2.0, 1.12, () => A.drawGuest(ctx, 'stand', seedBase + 2, env.clock, env.reduced, side));
          billboard(env, tx, tz + 2.0, 1.12, () => A.drawGuest(ctx, hash(seedBase) > 0.5 ? 'cheer' : 'stand', seedBase + 3, env.clock, env.reduced, side));
          billboard(env, tx - side * 0.2, tz + 3.4, 1.12, () => A.drawGuest(ctx, 'sit', seedBase + 4, env.clock, env.reduced, side));
        }
      }
    } else {                                                                             // Lounge / Bar, im Jazz-Casino mit Band
      const bx = side * (WX - 1.6);
      poly(env, [[bx, z0 + 2.2, 0], [bx, z0 + 10, 0], [bx, z0 + 10, 1.15], [bx, z0 + 2.2, 1.15]], shade('#2a1008', dN));
      poly(env, [[bx - side * 0.5, z0 + 2.2, 1.15], [bx, z0 + 2.2, 1.15], [bx, z0 + 10, 1.15], [bx - side * 0.5, z0 + 10, 1.15]], shade('#ffcf6b', dN), 0.9);
      if (jazz && dN < 130) onWall(env, side * (WX - 0.03), z0 + 6.2, 1.3, side, () => A.jazzStage(ctx, { clock: env.clock, detail: false, glow: false, v: 0, reduced: env.reduced }));
      else strip(env, side * (WX - 0.03), z0 + 2.5, z0 + 9.5, 1.5, 3.2, shade(look.led1, dN), 0.7);
      if (!farGuests) {
        billboard(env, side * (WX - 0.9), z0 + 6.2, 1.12, () => A.drawGuest(ctx, 'deal', seedBase + 20, env.clock, env.reduced, -side));
        billboard(env, side * (WX - 3.0), z0 + 4.3, 1.12, () => A.drawGuest(ctx, 'sit', seedBase + 21, env.clock, env.reduced, -side));
        billboard(env, side * (WX - 3.0), z0 + 8.1, 1.12, () => A.drawGuest(ctx, 'sit', seedBase + 22, env.clock, env.reduced, -side));
      }
    }
  }
  // Kronleuchter-Lichter an der Decke
  if (near) for (const x of [-3.9, 3.9]) {
    const q = env.P(x, z0 + 6, roofH - 0.3);
    if (q.d < 4) continue;
    ctx.globalAlpha *= 0.35; ctx.fillStyle = theme === 0 ? '#7fe9ff' : '#ffcf6b'; ctx.beginPath(); ctx.arc(q.sx, q.sy, Math.max(1.5, q.k * (theme === 2 ? 0.8 : 0.5)), 0, 6.3); ctx.fill();
    ctx.globalAlpha /= 0.35; ctx.fillStyle = '#fff2c8'; ctx.beginPath(); ctx.arc(q.sx, q.sy, Math.max(0.8, q.k * 0.18), 0, 6.3); ctx.fill();
  }
}

// -------------------------------------------------------------------------- Portal
/** Portal: breite Wandfläche mit Öffnung für alle drei Spuren; von außen die Einfahrt, von innen die Ausfahrt. */
function drawPortal(env: LotEnv, st: EncState, z: number, entry: boolean): void {
  const { look, roofH, casino, theme } = st;
  const ctx = env.ctx;
  const d = z - env.zc;
  const WX = st.wx, top = roofH + 4.6, out = WX + 40;
  const col = shade(look.portal, d);
  poly(env, [[-out, z, 0], [-WX, z, 0], [-WX, z, top], [-out, z, top]], col);
  poly(env, [[WX, z, 0], [out, z, 0], [out, z, top], [WX, z, top]], col);
  poly(env, [[-WX, z, roofH], [WX, z, roofH], [WX, z, top], [-WX, z, top]], col);
  strokeSection(env, section(st, z, 0, theme === 2 && !casino), casino ? '#fff2c8' : look.led2, 0.28, true);
  for (const side of [-1, 1]) {
    const xa = side * (WX + 3.6), xb = side * (WX + 18);
    for (let r = 0; r < 4; r++) strip2(env, xa, xb, z, 1.2 + r * 3.3, 1.35 + r * 3.3, shade(r % 2 ? look.led2 : look.led1, d * 0.8), 0.85);
    for (let c = 0; c < 3; c++) { const xs = side * (WX + 6 + c * 4.4); poly(env, [[xs, z, 0.8], [xs + side * 3.4, z, 0.8], [xs + side * 3.4, z, top - 1.2], [xs, z, top - 1.2]], shade(look.rib, d), 0.55); }
    poly(env, [[side * (WX + 2.2), z, 0], [side * (WX + 3.0), z, 0], [side * (WX + 3.0), z, top], [side * (WX + 2.2), z, top]], shade(look.pilaster, d), casino ? 0.9 : 0.5);
  }
  if (!entry || d < 12) return;
  onFace(env, 0, z, roofH + 2.3, () => {
    const art: A.Art = { clock: env.clock, detail: false, glow: false, v: st.ev.variant, reduced: env.reduced };
    ctx.fillStyle = look.portal === '' ? '#000' : '#08051a'; ctx.fillRect(-7.2, -1.6, 14.4, 3.2);
    ctx.strokeStyle = look.trim; ctx.lineWidth = 0.14; ctx.strokeRect(-7.2, -1.6, 14.4, 3.2);
    const name = casino ? CASINO_NAMES[theme] : TUNNEL_NAMES[theme];
    ctx.font = '800 1.45px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha *= 0.35; ctx.strokeStyle = look.trim; ctx.lineWidth = 0.3; ctx.strokeText(name, 0, 0.05); ctx.globalAlpha /= 0.35;
    ctx.fillStyle = '#ffffff'; ctx.fillText(name, 0, 0.05);
    // Zierde je Thema an den Seiten des Schildes
    ctx.save(); ctx.translate(-5.8, 1.2); ctx.scale(0.4, 0.4);
    if (theme === 0) A.cosmicPlanet(ctx, art, 1.0); else if (theme === 1) A.crystal(ctx, art); else if (theme === 2) A.shield(ctx, art, 0, -1.4); else A.sax(ctx, '#ffcf6b', art, 0.55);
    ctx.restore();
    ctx.save(); ctx.translate(5.8, 1.2); ctx.scale(0.4, 0.4);
    if (theme === 0) A.cosmicGalaxy(ctx, art); else if (theme === 1) A.coral(ctx, '#ff79c8', 3, false); else if (theme === 2) A.shield(ctx, { ...art, v: 1 }, 0, -1.4); else A.note(ctx, '#ff8a3a', -0.5, -1.2, 1.4, true);
    ctx.restore();
    if (casino) { const t = env.reduced ? 0 : Math.floor(env.clock * 5); for (let b = 0; b < 17; b++) { ctx.fillStyle = (b + t) % 3 === 0 ? '#fff6c8' : '#b8862a'; ctx.beginPath(); ctx.arc(-6.4 + b * 0.8, -1.38, 0.1, 0, 6.3); ctx.arc(-6.4 + b * 0.8, 1.38, 0.1, 0, 6.3); ctx.fill(); } }
  });
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
  // Atlantis: ein großer Meeresbewohner zieht langsam hinter der Glaswand vorbei (nur Dekoration, weit außerhalb der Fahrbahn)
  if (!st.casino && st.theme === 1) {
    const mid = (ev.start + ev.end) / 2, drift = env.reduced ? 0 : ((env.clock * 14) % 360) - 180, zg = mid + drift, side = ev.variant % 2 ? 1 : -1;
    if (zg > zc + 10 && zg < zc + drawDist && zg > ev.start + 10 && zg < ev.end - 10) {
      out.push({ d: zg - zc + 14, draw: () => onWall(env, side * (st.wx + 11), zg, 0.5, side, () => { env.ctx.scale(1.5, 1.5); A.seaGiant(env.ctx, { clock: env.clock, detail: true, glow: env.quality < 1, v: ev.variant, reduced: env.reduced }); }) });
    }
  }
  if (ev.start > zc + 2.6 && ev.start < zc + drawDist) out.push({ d: ev.start - zc, draw: () => drawPortal(env, st, ev.start, true) });
  if (ev.end > zc + 2.6 && ev.end < zc + drawDist) out.push({ d: ev.end - zc, draw: () => drawPortal(env, st, ev.end, false) });
}
