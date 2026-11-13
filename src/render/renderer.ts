import { BALANCE as B } from '../config/balance';
import { footprintCorners, obstacleFootprint, pickupFootprint, playerFootprint, type Footprint } from '../sim/contacts';
import type { Road } from '../sim/road';
import { KINDS, type Obstacle, type Pickup, type PickupType } from '../sim/world';

import { CAM_BACK, DRAW, chaseSlope, depthEff, makeLayout, type Layout } from './projection';
import { applyLight, decoType, drawDeco, drawMoon, drawMountains, drawPlane, drawPortal, drawSkyline, drawSky, drawSun, hash, lightT, mixHex, PORTAL_Z, stageAt } from './scenery';
import { CHUNK, drawPed, pedsInChunk } from './people';
import { computeRows } from './rows';
import { PAL, drawObstacle, drawPickup, drawShieldArc, gfx, rect } from './sprites';
import { drawCar } from './car3d';

/** Alles, was zum Zeichnen eines Bildes nötig ist (Vorschau oder Lauf). */
export interface View {
  s: number; x: number; /** Weltposition quer */ X: number; bodyYaw: number; phi: number; /** Winkel Nase–Straße */ rel: number; speedKmh: number;
  shield: boolean; shieldFrac: number; slow: boolean; magnet: boolean; blitz: boolean; boost: boolean; /** Pfadfinder: Spurmitte oder null */ guide: number | null; /** Flughöhe (m) und Restzeit des Gleitflugs (s) */ lift: number; glideLeft: number; /** Sekunden seit dem Einsammeln der Zeitblase, sonst −1 */ slowAge: number;
  obstacles: readonly Obstacle[]; pickups: readonly Pickup[];
  crash: { id: number } | null; running: boolean;
  /** Aktive Szenenzeit (s) für Mond und Flugzeuge, Seed des Laufs für den Flugplan. */
  sceneT: number; seed: number;
  road: Road;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string }
interface Drawable { d: number; draw: () => void }

const smoothStep = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

export type BurstKind = 'crash' | PickupType | 'shieldHit' | 'land';

const MAX_PARTICLES = 120;

/** Abstand der Streckenschilder (m). */
export const KM_SIGN_EVERY = 5000;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  L: Layout = makeLayout(320, 568);
  private lt = 0;
  private pal = { g1: '#1b1033', g2: '#21143c', s1: '#3a2a66', s2: '#30235a', a1: '#262944', a2: '#2b2e4c', haze: '#4a2070', w1: '#443a66', w2: '#3e355e', curb: '#7c6ca8', seam: '#271f40' };
  /** Darstellungswinkel des Wagens gegenüber der Kamera: dezent beim Lenken, sonst 0 (Heck waagerecht). */
  private dtLast = 1 / 60;
  private elev0 = 0;
  /** Geländekante: je Tiefenstufe die höchste Bildzeile (kleinstes y) aller näheren Geländepunkte – Objekte dahinter werden verdeckt. */
  private occD: number[] = [];
  private occY: number[] = [];
  private hilly = false;
  private rowD = new Float32Array(0);
  private stealth = 0;
  private visYaw = 0; private carBx = 0; private carBz = 0;
  private camXw = 0; private camHead = 0; private snap = true; private clock = 0; private flash = 0; private shake = 0;
  private brake = 0; private prevSpeed = 0; private prevS = 0;
  private carSx = 0; private lastZc = 0;
    private flashes: { x: number; z: number; age: number }[] = [];
  /** Spurblitz: Lichtimpuls entlang einer Spur ab z. */
  laneFlash(x: number, z: number): void { this.flashes.push({ x, z, age: 0 }); }
  private sparkAcc = 0;
  private arcFlash = 0; private iconFlash = 0; private iconType: PickupType = 'slow';
  private firstSeen = new Map<number, number>();
  private particles: Particle[] = [];
  private road!: Road;
  /** Grafikprofil: 0 voll, 1 reduziert (Fassadendetails, Rauch, Glow), 2 minimal. Spielregeln bleiben unberührt. */
  quality = 0;
  private costAvg = 0; private costN = 0; private fastN = 0;
  reducedMotion = false;
  /** Entwicklungsansicht (nur per Test-URL ?qa=1&debug=1): Mittellinie, Ränder, Trefferflächen. */
  debug = false;
  ghost = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = mq.matches;
    mq.addEventListener?.('change', (e) => { this.reducedMotion = e.matches; });
  }

  resize(cssW: number, cssH: number): void {
    const L = makeLayout(cssW, cssH);
    if (this.canvas.width !== L.w || this.canvas.height !== L.h) { this.canvas.width = L.w; this.canvas.height = L.h; }
    this.L = L;
    gfx.u = L.u;
  }

  /** Lokales Feedback am Wagen (Partikel begrenzt). */
  burst(kind: BurstKind): void {
    if (kind === 'shield' || kind === 'shieldHit') this.arcFlash = 1;
    if (kind === 'slow' || kind === 'magnet' || kind === 'clear') { this.iconFlash = 1; this.iconType = kind; }
    if (this.reducedMotion && kind !== 'crash') return;
    const L = this.L;
    const k0 = L.fx / CAM_BACK;
    const py = L.gy - 0.8 * k0;
    const n = kind === 'crash' ? 36 : 14;
    const cols = kind === 'shield' || kind === 'shieldHit' ? [PAL.mint, '#fff'] : kind === 'boost' ? ['#ff3b3b', '#ffb0a0', '#fff'] : kind === 'guide' ? ['#6bffa8', '#fff'] : kind === 'glide' ? ['#ff9ae0', '#9ae8ff', '#fff'] : kind === 'land' ? ['#c9a8ff', '#fff'] : kind === 'magnet' ? ['#6bb8ff', '#fff'] : kind === 'clear' ? ['#ffe95a', '#fff'] : kind === 'slow' ? ['#f4e9c8', '#fff'] : [PAL.orange, '#fff', PAL.magenta];
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (20 + Math.random() * (kind === 'crash' ? 90 : 50)) / (L.scale > 1 ? 1 : 0.5);
      this.particles.push({ x: this.carSx || L.cx, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: 0, max: 0.4 + Math.random() * 0.4, c: cols[i % cols.length] });
    }
    if (kind === 'glide') this.flash = Math.max(this.flash, 0.3);
    if (kind === 'crash') { this.flash = 1; this.shake = this.reducedMotion ? 0 : 1; }
  }

  private proj(zc: number, x: number, z: number) {
    return this.projectWorld(zc, this.road.center(z) + x, z);
  }

  private projectWorld(zc: number, x: number, z: number, height = 0) {
    const d = z - zc;
    const de = depthEff(d, this.L);
    const k = this.L.fx / de;
    // Hügel: Höhe des Punktes relativ zur Kamera (Fahrzeughöhe) verschiebt ihn in der Bildhöhe
    const dh = height + (this.road ? this.road.height(z) - this.elev0 : 0);
    return { d, k, sx: this.L.cx + (x - this.camXw - this.camHead * d) * k, sy: this.L.hy + this.L.Hv / de - dh * k };
  }

  private footprintPath(zc: number, body: Footprint): void {
    const ctx = this.ctx;
    ctx.beginPath();
    footprintCorners(body).forEach(([x, z], i) => {
      const p = this.projectWorld(zc, x, z);
      if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
    });
    ctx.closePath();
  }

  /** Testmessung: Bildspalte (px) der Straßenmitte bzw. Randlinien in Tiefe d und der Wagenmitte des letzten Bildes. */
  probe(d: number): { center: number; left: number; right: number; car: number; head: number } {
    const L = this.L, zc = this.lastZc;
    const k = L.fx / depthEff(d, L);
    const base = L.cx + this.lat(zc + d, zc) * k;
    return { center: base, left: base - B.road.halfWidth * k, right: base + B.road.halfWidth * k, car: this.carSx, head: this.camHead };
  }

  /** Seitlicher Versatz der Mittellinie im Kamerabild (Weltposition der Kamera und Blickrichtung). */
  private lat(z: number, zc: number): number { return this.road.center(z) - this.camXw - this.camHead * (z - zc); }

  private fade(d: number, extra = 1): number {
    return Math.max(0, Math.min(1, (DRAW - d) / 110)) * extra;
  }

  draw(v: View, dt: number): void {
    const L = this.L;
    if (!L.w) return;
    const t0 = performance.now();
    const ctx = this.ctx;
    this.road = v.road;
    if (v.running) this.clock += dt;
    if (v.s < this.prevS - 1) { this.brake = 0; this.prevSpeed = 0; this.firstSeen.clear(); this.snap = true; this.visYaw = 0; this.stealth = 0; this.particles.length = 0; this.flashes.length = 0; this.iconFlash = 0; this.arcFlash = 0; this.flash = 0; }
    this.prevS = v.s;
    // Bremslicht nur bei tatsächlicher Verzögerung (z. B. Tempo fällt nach Turbo oder Zeitlupe)
    if (v.running && this.prevSpeed > 0 && v.speedKmh < this.prevSpeed - 0.02) this.brake = 1;
    else this.brake = Math.max(0, this.brake - dt * 2);
    if (v.running) this.prevSpeed = v.speedKmh;

    const zc = v.s - B.player.len - CAM_BACK;
    this.lastZc = zc;
    const headT = chaseSlope(v.road.heading(v.s), v.phi, v.road.heading(v.s + 70));
    if (this.snap) { this.camHead = headT; this.snap = false; }
    this.camHead += (headT - this.camHead) * (1 - Math.exp(-dt / 0.16));
    this.elev0 = v.road.height(v.s - B.player.len / 2);
    this.buildRows(zc);
    // Der Blick dreht sich um den Wagen. Ohne Rückversatz schert der gesamte Vordergrund seitlich weg.
    this.dtLast = dt;
    const relT = Math.max(-0.09, Math.min(0.09, v.rel * 0.55));
    this.visYaw += (relT - this.visYaw) * (1 - Math.exp(-dt / 0.11));
    // Das Auto wird in Kamerakoordinaten gezeichnet: Heck waagerecht, Achse entlang des Kamerablicks (Scherung),
    // Mittelpunkt exakt über der tatsächlichen Fahrzeugposition.
    this.carBx = v.X - this.camHead * (B.player.len / 2);
    this.carBz = v.s - B.player.len / 2;
    this.camXw = this.carBx - this.camHead * (this.carBz - zc);
    ctx.save();
    if (this.shake > 0) {
      ctx.translate(Math.round((Math.random() - 0.5) * 4 * this.shake), Math.round((Math.random() - 0.5) * 3 * this.shake));
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    // Himmel (fern, unabhängig von Tempo, Lenkung und Drift): Sterne, Mond, Flugzeug – dahinter Berge und Skyline
    const lt = lightT(v.s);
    this.lt = lt;
    applyLight(lt);
    const P = this.pal;
    P.g1 = mixHex('#5b3a48', '#1b1033', lt); P.g2 = mixHex('#664350', '#21143c', lt);
    P.s1 = mixHex('#7a5468', '#3a2a66', lt); P.s2 = mixHex('#6c4a5f', '#30235a', lt);
    P.w1 = mixHex('#8a6a78', '#443a66', lt); P.w2 = mixHex('#7e5f6e', '#3e355e', lt);
    P.curb = mixHex('#b99a9c', '#7c6ca8', lt); P.seam = mixHex('#5a4452', '#271f40', lt);
    P.a1 = mixHex('#4f465e', '#262944', lt); P.a2 = mixHex('#554b63', '#2b2e4c', lt);
    P.haze = mixHex('#c27a8a', '#4a2070', lt);
    drawSky(ctx, L, lt, this.clock, this.reducedMotion);
    drawSun(ctx, L, v.s);
    drawMoon(ctx, v.s, L, lt);
    if (B.scenery.planes) drawPlane(ctx, v.seed, v.sceneT, L, !this.reducedMotion);
    const pan = -this.camHead * 40;
    drawMountains(ctx, L, pan, lt);
    drawSkyline(ctx, L, v.s, pan, this.clock, this.reducedMotion || this.quality > 0, lt);
    this.haze();
    this.road2(zc, v);
    this.markers(zc, v);
    this.scene(v, zc);
    if (this.debug) this.debugLayer(v, zc);
    this.player(v, zc);
    this.fxLayer(v, dt);
    ctx.restore();
    if (this.flash > 0) {
      ctx.globalAlpha = Math.min(0.7, this.flash);
      rect(ctx, 0, 0, L.w, L.h, '#fff');
      ctx.globalAlpha = 1;
      this.flash = Math.max(0, this.flash - dt * 4);
    }
    this.adapt(performance.now() - t0, v.running);
  }

  /** Grafikprofil nach gemessener Zeichenzeit anpassen (Dekor zuerst); Simulation und Fernsicht bleiben unberührt. */
  private adapt(cost: number, running: boolean): void {
    if (!running) return;
    this.costAvg = this.costAvg * 0.95 + cost * 0.05;
    if (++this.costN < 90) return;
    if (this.costAvg > 11 && this.quality < 2) { this.quality++; this.costN = 0; this.fastN = 0; }
    else if (this.costAvg < 4 && this.quality > 0 && ++this.fastN > 8) { this.quality--; this.costN = 0; this.fastN = 0; }
  }

  private haze(): void {
    const { ctx, L } = this;
    const hz = ctx.createLinearGradient(0, L.hy - 12 / L.scale, 0, L.hy + 10 / L.scale);
    const hc = this.lt < 0.5 ? '255,170,110' : '180,50,140';
    hz.addColorStop(0, `rgba(${hc},0)`);
    hz.addColorStop(0.6, `rgba(${hc},0.3)`);
    hz.addColorStop(1, `rgba(${hc},0)`);
    ctx.fillStyle = hz;
    ctx.fillRect(0, L.hy - 12 / L.scale, L.w, 22 / L.scale);
  }

  private buildRows(zc: number): void {
    const L = this.L;
    if (this.rowD.length !== L.h) this.rowD = new Float32Array(L.h);
    this.hilly = computeRows((z) => this.road.height(z), zc, this.elev0, L, this.rowD, this.occD, this.occY);
  }

  /** Höchste Bildzeile des Geländes, das Objekte in Tiefe d verdecken kann (nur nähere Geländepunkte zählen). */
  private occlusionY(d: number): number {
    const D = this.occD, Y = this.occY;
    if (!this.hilly || D.length === 0) return this.L.h;
    const dq = d - 1.5;
    if (dq <= D[0]) return this.L.h;
    let lo = 0, hi = D.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (D[m] <= dq) lo = m; else hi = m - 1; }
    return Y[lo] + 2;
  }

  // ---------- Straße (Zeile für Zeile, mit geöffneter Fernsicht, Kurven aus der gemeinsamen Streckenreferenz) ----------
  private road2(zc: number, v: View): void {
    const { ctx, L } = this;
    const hwR = B.road.halfWidth;
    for (let y = 0; y < L.h; y++) {
      const dRow = this.rowD[y];
      if (dRow < 0 && y <= L.hy) continue;                  // Himmel / Ferne: kein Gelände in dieser Zeile
      if (dRow < 0) { rect(ctx, 0, y, L.w, 1, this.pal.g2); ctx.globalAlpha = 0.55; rect(ctx, 0, y, L.w, 1, this.pal.haze); ctx.globalAlpha = 1; continue; }   // hinter der Kuppe
      const d = dRow;
      const de = depthEff(d, L);
      const z = zc + d;
      const k = L.fx / de;
      const rcx = L.cx + this.lat(z, zc) * k;
      const far = Math.max(0, Math.min(1, (d - 60) / 240));
      const seg = far < 0.7 ? Math.floor(z / 8) & 1 : 0;
      const l = rcx - hwR * k, r = rcx + hwR * k;
      const P = this.pal;
      rect(ctx, 0, y, L.w, 1, seg ? P.g1 : P.g2);
      // Gehwege beidseitig: Bordstein, Pflasterung mit Fugen, Lichtinseln unter den Laternen (gleiche Streckengeometrie wie die Fahrbahn)
      const cw = 0.4 * k, ww = 2.9 * k;
      const tile = (Math.floor(z / 1.6) & 1) ? P.w1 : P.w2;
      rect(ctx, l - cw, y, cw, 1, P.curb); rect(ctx, r, y, cw, 1, P.curb);
      rect(ctx, l - cw - ww, y, ww, 1, tile); rect(ctx, r + cw, y, ww, 1, tile);
      if (far < 0.7) {
        const fz = (z / 1.6) % 1;
        if (fz < 0.06) { ctx.globalAlpha = 0.5; rect(ctx, l - cw - ww, y, ww, 1, P.seam); rect(ctx, r + cw, y, ww, 1, P.seam); ctx.globalAlpha = 1; }
        const m = (((z - 11) % 22) + 22) % 22, dl = Math.min(m, 22 - m);
        if (dl < 4.5) {
          ctx.globalAlpha = (1 - dl / 4.5) * 0.4 * (0.25 + 0.75 * gfx.lights) * (1 - far);
          rect(ctx, l - cw - ww, y, ww, 1, '#ffe7a1'); rect(ctx, r + cw, y, ww, 1, '#ffe7a1');
          ctx.globalAlpha = 1;
        }
      }
      rect(ctx, l, y, r - l, 1, seg ? P.a1 : P.a2);
      // Zeitblase: Welle läuft vom Wagen über den Asphalt
      if (v.slowAge >= 0 && v.slowAge < 1.8) {
        const dd = Math.abs(d - (10 + v.slowAge * 95));
        if (dd < 7) { ctx.globalAlpha = (1 - dd / 7) * 0.5 * (1 - v.slowAge / 1.8); rect(ctx, l, y, r - l, 1, '#b9e6ff'); ctx.globalAlpha = 1; }
      }
      // Details (Kanten, Spurtrenner) werden mit der Entfernung gedimmt: ruhiger Sichtkorridor
      ctx.globalAlpha = 1 - 0.7 * far;
      const ew = Math.max(1, 0.3 * k);
      rect(ctx, l, y, ew, 1, '#2ee6d6');
      rect(ctx, r - ew, y, ew, 1, PAL.magenta);
      // dichtere Markierungsfolge (Bodenfluss): 6-m-Takt
      if ((((z / 6) % 2) + 2) % 2 < 1) {
        const lw = Math.max(1, 0.16 * k);
        const sx = B.road.laneWidth / 2;
        rect(ctx, rcx - sx * k - lw / 2, y, lw, 1, '#e9e2c6');
        rect(ctx, rcx + sx * k - lw / 2, y, lw, 1, '#e9e2c6');
      }
      if (!this.reducedMotion && this.quality < 2 && far < 0.35 && hash(y * 13 + Math.floor(this.clock * 6)) > 0.992) {
        rect(ctx, l + hash(y) * (r - l), y, 1, 1, '#9aa0ff');
      }
      ctx.globalAlpha = 0.55 * far;
      rect(ctx, 0, y, L.w, 1, this.pal.haze);
      ctx.globalAlpha = 1;
    }
  }

  /** Spurgebundener Warnhinweis: schraffierte Fläche auf der belegten Breite eines tatsächlich vorhandenen Hindernisses. */
  private markers(zc: number, v: View): void {
    const { ctx, L } = this;
    for (const o of v.obstacles) {
      if (o.hit) continue;
      const d0 = o.z - zc;
      if (d0 < 8 || d0 > DRAW) continue;
      const def = KINDS[o.kind];
      const kObj = L.fx / depthEff(d0, L);
      const px = def.w * kObj;
      const age = this.clock - (this.firstSeen.get(o.id) ?? this.clock);
      const a = Math.min(1, age / 0.35) * (1 - Math.max(0, Math.min(1, (px - 6 * gfx.u) / (6 * gfx.u)))) * 0.9;
      if (a <= 0.02) continue;
      const yFar = Math.round(this.projectWorld(zc, 0, o.z).sy);
      const yNear = Math.min(L.h - 1, Math.max(yFar + Math.round(7 * gfx.u), Math.round(this.projectWorld(zc, 0, zc + Math.max(8, d0 - 20)).sy)));
      for (let y = Math.max(0, yFar); y <= yNear; y++) {
        const dRow = this.rowD[y];
        if (dRow < 0 || Math.abs(dRow - d0) > Math.max(30, d0 * 0.3)) continue;   // Zeile gehört zu anderem Gelände (Kuppe/Verdeckung)
        const de = depthEff(dRow, L);
        const z = zc + dRow;
        const k = L.fx / de;
        const cx = L.cx + (o.x + this.lat(z, zc)) * k;
        const half = Math.max((def.w / 2) * k, 2 * gfx.u);
        const x0 = Math.round(cx - half), x1 = Math.round(cx + half);
        ctx.globalAlpha = a * 0.7; ctx.fillStyle = '#0a0620'; ctx.fillRect(x0 - 1, y, x1 - x0 + 3, 1);
        ctx.globalAlpha = a; ctx.fillStyle = '#ffb040';
        for (let x = x0; x <= x1; x++) if (((x + y) >> 1) & 1) ctx.fillRect(x, y, 1, 1);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Kulisse, Verkehr, Pickups ----------
  private scene(v: View, zc: number): void {
    const { ctx, L } = this;
    const items: Drawable[] = [];
    const STEP = 22;
    const k0 = Math.ceil((zc + 4) / STEP);
    const k1 = Math.floor((zc + DRAW) / STEP);
    const lod = this.quality > 0;
    for (let k = k0; k <= k1; k++) {
      const z = k * STEP;
      for (const side of [-1, 1]) {
        let type = decoType(k, side, z);
        if (type === 'fountain' && !B.scenery.fountains) type = 'none';
        if (type === 'none' || (this.quality > 1 && k % 2)) continue;
        if (hash(k * 5 + (side > 0 ? 2 : 3)) < 0.18) type = 'none'; // Luft zwischen den Silhouetten
        if (type === 'none') continue;
        const hs = hash(k * 2 + (side > 0 ? 1 : 0));
        const big = type === 'tower' || type === 'show' || type === 'wheel' || type === 'deco' || type === 'casino' || type === 'lake' || type === 'eiffel';
        const strip = type === 'casino' || type === 'lake' || type === 'eiffel' || stageAt(z) >= 4;
        const x = side * (B.road.halfWidth + 6 + hs * 4 + (big ? 5 : 0));
        const p = this.proj(zc, x, z);
        if (p.d < 4 || p.k * 3 < 0.4) continue;
        items.push({
          d: p.d, draw: () => {
            ctx.save();
            // Clip an der projizierten Fahrbahnkante der jeweiligen Tiefe
            const edge = L.cx + (this.lat(z, zc) + side * (B.road.halfWidth + 1.6)) * p.k;
            ctx.beginPath();
            if (side > 0) ctx.rect(edge, 0, L.w, L.h); else ctx.rect(0, 0, edge, L.h);
            ctx.clip();
            ctx.globalAlpha = this.fade(p.d, p.d > 140 ? 0.65 : 1) * (strip ? smoothStep((v.s - (B.scenery.keys[3] - 200)) / 900) * Math.min(1, B.scenery.neon) : 1);   // Strip kommt ab 20 km weich ins Bild
            drawDeco(type, { ctx, sx: p.sx, sy: p.sy, sc: p.k, side, hs, k, clock: this.clock, reduced: this.reducedMotion, lod });
            ctx.restore();
          },
        });
      }
      const zl = z + 11;
      for (const side of [-1, 1]) {
        const p = this.proj(zc, side * (B.road.halfWidth + 1.4), zl);
        if (p.d < 4) continue;
        items.push({ d: p.d + (side > 0 ? 0 : 0.01), draw: () => { ctx.globalAlpha = this.fade(p.d, p.d > 140 ? 0.6 : 1); this.lamp(p, side); ctx.globalAlpha = 1; } });
      }
    }
    // Streckenschilder: alle 5 km ein Straßenschild mit der geschafften Reichweite am rechten Straßenrand
    for (let m = Math.ceil((zc + 4) / KM_SIGN_EVERY) * KM_SIGN_EVERY; m <= zc + DRAW; m += KM_SIGN_EVERY) {
      const p = this.proj(zc, B.road.halfWidth + 1.25, m);
      if (p.d < 3) continue;
      items.push({ d: p.d, draw: () => { ctx.globalAlpha = this.fade(p.d); this.kmSign(p, m / 1000); ctx.globalAlpha = 1; } });
    }
    if (stageAt(v.s) === 0 || v.s < PORTAL_Z + 40) {
      const p = this.proj(zc, 0, PORTAL_Z);
      if (p.d > 5 && p.d < DRAW) items.push({ d: p.d, draw: () => { ctx.globalAlpha = this.fade(p.d); drawPortal(ctx, p.sx, p.sy, p.k, this.clock, this.reducedMotion); ctx.globalAlpha = 1; } });
    }
    const seen = new Set<number>();
    for (const o of v.obstacles) {
      const d = o.z - zc;
      if (d < 2 || d > DRAW) continue;
      seen.add(o.id);
      if (!this.firstSeen.has(o.id)) this.firstSeen.set(o.id, this.clock);
      const p = this.proj(zc, o.x, o.z);
      items.push({
        d, draw: () => {
          const age = this.clock - (this.firstSeen.get(o.id) ?? this.clock);
          let a = this.fade(d) * Math.min(1, age / 0.35);
          if (o.hit) a *= Math.max(0, 1 - o.knockT / 0.9);
          ctx.globalAlpha = a;
          const lift = o.hit ? Math.sin(Math.min(1, o.knockT * 3) * Math.PI) * 1.2 : 0;
          drawObstacle(ctx, o.kind, p.sx, p.sy - lift * p.k, p.k, this.clock, o.id);
          ctx.globalAlpha = 1;
          if (v.crash?.id === o.id) this.culprit(p.sx, p.sy, p.k, o);
        },
      });
    }
    if (this.firstSeen.size > 80) for (const id of this.firstSeen.keys()) if (!seen.has(id)) this.firstSeen.delete(id);
    for (const pk of v.pickups) {
      const d = pk.z - zc;
      if (d < 2 || d > DRAW) continue;
      const p = this.proj(zc, pk.x, pk.z);
      items.push({ d, draw: () => {
        this.footprintPath(zc, pickupFootprint(this.road, pk));
        ctx.fillStyle = 'rgba(151, 255, 238, 0.36)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(183, 255, 245, 0.85)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = this.fade(d);
        drawPickup(ctx, pk.type, p.sx, p.sy, p.k, this.clock, d < 90 && !this.reducedMotion, false);
        ctx.globalAlpha = 1;
      } });
    }
    // Passanten: Kulisse auf den Gehwegen (Anzahl auf kleinen Geräten begrenzt)
    {
      const cap = this.quality > 0 || L.w < 340 ? 10 : 24;
      let n = 0;
      const c0 = Math.floor((zc + 5) / CHUNK), c1 = Math.floor((zc + 210) / CHUNK);
      for (let c = c0; c <= c1 && n < cap && B.scenery.peds; c++) for (const side of [-1, 1]) for (const ped of pedsInChunk(c, side)) {
        const p = this.proj(zc, ped.x, ped.z);
        if (p.d < 5 || p.d > 210 || n >= cap) continue;
        n++;
        items.push({ d: p.d, draw: () => { ctx.globalAlpha = this.fade(p.d, 1); drawPed(ctx, p.sx, p.sy, p.k, ped, this.clock); ctx.globalAlpha = 1; } });
      }
    }
    // Pfadfinder: leuchtende Chevrons weisen die freie Spur
    if (v.guide !== null) {
      for (let dd = 30; dd <= 300; dd += 24) {
        const z = v.s + dd, gx = v.guide;
        const p = this.proj(zc, gx, z);
        if (p.d < 6 || p.d > DRAW) continue;
        items.push({ d: p.d - 0.3, draw: () => {
          const a = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.clock * 9 - dd / 22))) * this.fade(p.d);
          const p1 = this.proj(zc, gx - 1.2, z - 0.9), p2 = this.proj(zc, gx, z + 0.9), p3 = this.proj(zc, gx + 1.2, z - 0.9);
          ctx.globalAlpha = a; ctx.strokeStyle = '#6bffa8'; ctx.lineWidth = Math.max(1.2, 0.28 * p.k);
          ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.lineTo(p3.sx, p3.sy); ctx.stroke();
          ctx.globalAlpha = 1;
        } });
      }
    }
    // Gleitflug: Landepunkt in der letzten Flugsekunde (folgt der Querposition)
    if (v.glideLeft > 0 && v.glideLeft < 1.4) {
      const zl = v.s + (v.speedKmh / 3.6) * v.glideLeft;
      const fp = { x: this.road.center(zl) + v.x, z: zl - 4, yaw: Math.atan(this.road.heading(zl)), halfWidth: B.player.width / 2 + 0.3, halfLength: 5 };
      items.push({ d: Math.max(3, zl - zc), draw: () => {
        this.footprintPath(zc, fp);
        ctx.globalAlpha = 0.28 + 0.22 * Math.sin(this.clock * (v.glideLeft < 0.6 ? 20 : 12));
        ctx.fillStyle = '#ffd36b'; ctx.fill();
        ctx.globalAlpha = 0.9; ctx.strokeStyle = '#fff3c0'; ctx.lineWidth = 1; ctx.stroke();
        const pp = this.proj(zc, v.x, zl - 4);
        ctx.globalAlpha = 0.55; ctx.fillStyle = '#ffd36b';
        ctx.fillRect(Math.round(pp.sx - Math.max(1, 0.12 * pp.k)), Math.round(pp.sy - 3.2 * pp.k), Math.max(2, 0.24 * pp.k), Math.round(3.2 * pp.k));   // Lichtsäule über dem Landepunkt
        ctx.globalAlpha = 1;
      } });
    }
    // Impulsschild / Spurblitz: Ring am entfernten Hindernis
    for (const o of v.obstacles) {
      if (!o.hit || o.knockT > 0.6 || !(o.cleared || o.impulse)) continue;
      const d = o.z - zc;
      if (d < 2 || d > DRAW) continue;
      const p = this.proj(zc, o.x, o.z);
      items.push({ d: d - 0.2, draw: () => {
        const r = (0.6 + o.knockT * (o.impulse ? 10 : 7)) * p.k;
        ctx.globalAlpha = Math.max(0, 1 - o.knockT / 0.6);
        ctx.strokeStyle = o.impulse ? '#7fe3c4' : '#ffe95a';
        ctx.lineWidth = Math.max(1, 0.14 * p.k);
        ctx.beginPath(); ctx.ellipse(p.sx, p.sy - 0.9 * p.k, r, r * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      } });
    }
    // Spurblitz: heller Streifen läuft die Spur entlang
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i];
      if (v.running) fl.age += 1 / 60;
      if (fl.age > 0.5) { this.flashes.splice(i, 1); continue; }
      const d = fl.z - zc;
      const reach = Math.min(B.powers.blitzRange, fl.age * 450);
      items.push({ d: Math.max(2.5, d) + 0.5, draw: () => {
        const half = B.road.laneWidth / 2 - 0.2;
        ctx.beginPath();
        const pts: [number, number][] = [[-half, 0], [half, 0], [half, reach], [-half, reach]];
        pts.forEach(([dx, dz], j) => { const pp = this.proj(zc, fl.x + dx, Math.max(zc + 2.5, fl.z + dz)); if (j) ctx.lineTo(pp.sx, pp.sy); else ctx.moveTo(pp.sx, pp.sy); });
        ctx.closePath();
        ctx.globalAlpha = (1 - fl.age / 0.5) * 0.6;
        ctx.fillStyle = '#fff6a8'; ctx.fill();
        ctx.strokeStyle = '#ffe95a'; ctx.stroke();
        ctx.globalAlpha = 1;
      } });
    }
    items.sort((a, b) => b.d - a.d);
    for (const it of items) {
      // Hügelkuppen verdecken alles dahinter: Objekte werden an der Geländekante der näheren Tiefen abgeschnitten
      const cy = this.occlusionY(it.d);
      if (cy < L.h) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, L.w, Math.max(0, cy)); ctx.clip(); it.draw(); ctx.restore(); }
      else it.draw();
    }
    ctx.globalAlpha = 1;
  }

  private debugLayer(v: View, zc: number): void {
    const { ctx } = this;
    ctx.lineWidth = 1;
    const line = (x: number, col: string) => {
      ctx.strokeStyle = col; ctx.beginPath();
      for (let d = 8; d <= 240; d += 4) { const p = this.proj(zc, x, zc + d); if (d === 8) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy); }
      ctx.stroke();
    };
    line(0, '#ffff00'); line(-B.road.halfWidth, '#00ff00'); line(B.road.halfWidth, '#00ff00');
    const outline = (body: Footprint, color: string) => {
      if (body.z - zc < 3 || body.z - zc > DRAW) return;
      this.footprintPath(zc, body);
      ctx.strokeStyle = color;
      ctx.stroke();
    };
    for (const o of v.obstacles) if (!o.hit) outline(obstacleFootprint(this.road, o), '#ff4040');
    for (const pk of v.pickups) outline(pickupFootprint(this.road, pk), '#40ffff');
    outline(playerFootprint(v.X, v.s, v.bodyYaw), '#ff00ff');
    if (this.ghost) {
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#190f25';
      ctx.fillRect(7, this.L.h - 22, 112, 15);
      ctx.fillStyle = '#fff';
      ctx.fillText('QA Ghost · Treffer aus', 10, this.L.h - 11);
    }
  }

  private lamp(p: { k: number; sx: number; sy: number }, side: number): void {
    const { ctx } = this;
    const { k, sx, sy } = p;
    rect(ctx, sx - 0.1 * k, sy - 5.2 * k, 0.2 * k, 5.2 * k, '#3b3f6e');
    rect(ctx, sx - (side > 0 ? 1.1 : -0.1) * k, sy - 5.3 * k, 1.0 * k, 0.25 * k, '#3b3f6e');
    ctx.globalAlpha *= 0.3 + 0.7 * gfx.lights;
    if (gfx.lights > 0.2) {
      // Lichthof der Laterne bei Nacht
      const hx = sx - (side > 0 ? 1.2 : -0.5) * k, hy2 = sy - 5.1 * k;
      const a0 = ctx.globalAlpha; ctx.globalAlpha = a0 * 0.3 * gfx.lights; rect(ctx, hx - 0.5 * k, hy2 - 0.4 * k, 1.7 * k, 1.2 * k, '#ffe7a1'); ctx.globalAlpha = a0;
    }
    rect(ctx, sx - (side > 0 ? 1.2 : -0.5) * k, sy - 5.1 * k, 0.7 * k, 0.35 * k, '#ffe7a1');
  }

  /** Straßenschild „N km – geschafft“: Pfosten, grüne Tafel mit weißem Rand und Schrift (Nachts leicht beleuchtet). */
  private kmSign(p: { k: number; sx: number; sy: number }, km: number): void {
    const { ctx } = this;
    const { k, sx, sy } = p;
    rect(ctx, sx - 0.07 * k, sy - 3.4 * k, 0.14 * k, 3.4 * k, '#7e84b4');
    const bx = sx - 1.1 * k, by = sy - 4.4 * k, bw = 2.2 * k, bh = 1.5 * k;
    rect(ctx, bx - 0.08 * k, by - 0.08 * k, bw + 0.16 * k, bh + 0.16 * k, '#f2f0e4');      // weißer Rand
    rect(ctx, bx, by, bw, bh, '#0d6b4a');
    ctx.globalAlpha *= 0.3 + 0.7 * gfx.lights;                                            // nachts angestrahlt
    rect(ctx, bx, by, bw, bh * 0.08, '#ffffff22');
    ctx.globalAlpha /= 0.3 + 0.7 * gfx.lights;
    if (k < 3) return;                                                                    // zu weit weg für Schrift
    ctx.save();
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.max(5, 0.62 * k)}px system-ui, sans-serif`;
    ctx.fillText(`${km} km`, sx, by + bh * 0.4);
    if (k >= 10) { ctx.font = `700 ${Math.max(4, 0.24 * k)}px system-ui, sans-serif`; ctx.fillStyle = '#bff3dc'; ctx.fillText('geschafft', sx, by + bh * 0.8); }
    ctx.restore();
  }

  private culprit(sx: number, sy: number, k: number, o: Obstacle): void {
    const { ctx } = this;
    const def = KINDS[o.kind];
    const h = o.kind === 'baken' ? 1.7 : o.kind === 'barrier' ? 1.5 : o.kind === 'truck' ? 3.6 : o.kind === 'taxi' ? 1.8 : o.kind === 'sedan' ? 1.5 : 1.3;
    ctx.strokeStyle = `rgba(255,70,70,${0.65 + 0.35 * Math.sin(this.clock * 12)})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(sx - (def.w / 2 + 0.3) * k) + 0.5, Math.round(sy - (h + 0.2) * k) + 0.5, Math.round((def.w + 0.6) * k), Math.round((h + 0.3) * k));
  }

  // ---------- Spielerwagen ----------
  private player(v: View, zc: number): void {
    const { ctx, L } = this;
    const k = L.fx / CAM_BACK;
    this.stealth += ((v.boost ? 1 : 0) - this.stealth) * (1 - Math.exp(-this.dtLast / 0.3));
    const sx = this.projectWorld(zc, this.carBx, this.carBz).sx;
    this.carSx = sx;
    const steer = Math.max(-1, Math.min(1, v.rel * 6));
    const yaw = this.visYaw;
    const liftPx = v.lift * k;
    const c = Math.cos(this.visYaw), s = Math.sin(this.visYaw);
    drawCar(ctx, (x, y, z) => {
      const xr = x * c + z * s, zr = -x * s + z * c;
      const p = this.projectWorld(zc, this.carBx + xr + this.camHead * zr, this.carBz + zr, y * 0.8);
      return [Math.round(p.sx), Math.round(p.sy)];
    }, k, { turbo: false, grip: false, brake: this.brake, steer, running: v.running, yaw, lift: v.lift / 0.8, stealth: this.stealth });
    if (v.shield || this.arcFlash > 0) {
      const base = v.shield ? (v.shieldFrac < 0.25 ? (Math.floor(this.clock * 6) % 2 ? 0.45 : 0.95) : 0.9) : 0;
      drawShieldArc(ctx, sx, L.gy - liftPx, k, Math.min(1, base + this.arcFlash * 0.6), this.clock);
    }
    this.arcFlash = Math.max(0, this.arcFlash - 1 / 30);
    if (v.magnet) {
      // Magnetfeld: zwei pulsierende Feldbögen um den Wagen
      const pulse = Math.sin(this.clock * 8);
      ctx.save();
      ctx.translate(Math.round(sx), Math.round(L.gy - 0.7 * k - liftPx));
      ctx.strokeStyle = '#6bb8ff';
      ctx.lineWidth = Math.max(1, k * 0.06);
      for (const [a0, w0] of [[Math.PI * 0.62, 0.65], [Math.PI * 1.72, 0.65]] as const) {
        ctx.globalAlpha = 0.55 + 0.3 * pulse;
        ctx.beginPath(); ctx.ellipse(0, 0, (1.9 + 0.1 * pulse) * k, 1.45 * k, 0, a0, a0 + Math.PI * w0); ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    if (this.iconFlash > 0 && v.running) {
      // Zeitlupe/Kurvengrip: kurzer, lokal begrenzter Übergang am Wagen (Symbol über dem Heck)
      ctx.globalAlpha = Math.min(1, this.iconFlash);
      drawPickup(ctx, this.iconType, sx, L.gy - 1.6 * k, k * 0.55, this.clock, false);
      ctx.globalAlpha = 1;
      this.iconFlash = Math.max(0, this.iconFlash - 1 / 60);
    }
  }

  // ---------- Partikel, Tempo-Effekte ----------
  private fxLayer(v: View, dt: number): void {
    const { ctx, L } = this;
    if (this.stealth > 0.05 && v.running) {
      // Phantom-Turbo: rote Lichtschlieren hinter den Rückleuchten
      const k0 = L.fx / CAM_BACK, y0 = L.gy - (0.55 * 0.8 + v.lift) * k0;
      for (const off of [-0.5, 0.5]) {
        const x0 = this.carSx + off * k0, len = Math.min(L.h - y0, 2.6 * k0 * this.stealth);
        const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
        g.addColorStop(0, 'rgba(255,40,40,0.85)'); g.addColorStop(1, 'rgba(255,40,40,0)');
        ctx.globalAlpha = this.stealth; ctx.fillStyle = g;
        ctx.fillRect(Math.round(x0 - Math.max(1, 0.09 * k0)), y0, Math.max(2, 0.18 * k0), len);
      }
      ctx.globalAlpha = 1;
    }
    if (v.glideLeft > 0 && v.running) {
      // Gleitflug: Lichtschweif hinter dem Wagen (läuft beim Sinken aus) und Glitzerpartikel
      const k0 = L.fx / CAM_BACK;
      const el = B.effects.glide - v.glideLeft;
      const inten = Math.min(1, el / 0.3) * Math.min(1, v.glideLeft / B.glide.down);
      const y0 = L.gy - (0.45 * 0.8 + v.lift) * k0;
      for (const off of [-0.62, 0, 0.62]) {
        const x0 = this.carSx + off * k0;
        const len = Math.max(0, Math.min(L.h - y0, (1.5 + 0.4 * v.lift) * k0 * (0.4 + 0.6 * inten)));
        const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
        g.addColorStop(0, 'rgba(255,154,224,0.9)'); g.addColorStop(0.5, 'rgba(107,184,255,0.45)'); g.addColorStop(1, 'rgba(107,184,255,0)');
        ctx.globalAlpha = inten;
        ctx.fillStyle = g;
        ctx.fillRect(Math.round(x0 - Math.max(1, 0.07 * k0)), y0, Math.max(2, 0.14 * k0), len);
      }
      ctx.globalAlpha = 1;
      if (!this.reducedMotion) {
        this.sparkAcc += dt * 60 * inten * (this.quality > 0 ? 0.5 : 1);
        const COLS = ['#ff9ae0', '#9ae8ff', '#ffffff', '#ffe95a'];
        while (this.sparkAcc >= 1 && this.particles.length < MAX_PARTICLES) {
          this.sparkAcc -= 1;
          this.particles.push({ x: this.carSx + (Math.random() - 0.5) * 1.7 * k0, y: y0 + Math.random() * 6, vx: (Math.random() - 0.5) * 50, vy: 15 + Math.random() * 50, life: 0, max: 0.35 + Math.random() * 0.35, c: COLS[Math.floor(Math.random() * 4)] });
        }
      }
    }
    if (v.running && !this.reducedMotion && this.quality < 2) {
      // Tempolinien: Zahl, Länge und Deckkraft wachsen von 200 bis 600 km/h stetig (360 / 500 / 600 sind klar unterscheidbar)
      const vn = Math.max(0, Math.min(1, (v.speedKmh - 200) / 400));
      const n = 6 + Math.round(22 * vn);
      const sp = v.speedKmh / 260;
      ctx.globalAlpha = 0.18 + 0.3 * vn;
      for (let i = 0; i < n; i++) {
        const ph = (this.clock * (1.2 + sp * 1.6) + hash(i * 3)) % 1;
        const side = hash(i) > 0.5 ? 1 : -1;
        const xx = L.cx + side * (L.cx * (0.4 + 0.6 * ph) * (0.6 + hash(i + 40) * 0.5));
        const yy = L.hy + (L.h - L.hy) * ph;
        rect(ctx, xx, yy, 1, (2 + ph * 10 * (0.5 + sp)) * gfx.u, '#9aa0ff');
      }
      ctx.globalAlpha = 1;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      p.vy += 160 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.globalAlpha = 1 - p.life / p.max;
      rect(ctx, p.x, p.y, 2 * gfx.u, 2 * gfx.u, p.c);
    }
    ctx.globalAlpha = 1;
  }
}
