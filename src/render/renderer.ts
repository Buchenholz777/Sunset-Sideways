import { BALANCE as B } from '../config/balance';
import { footprintCorners, obstacleFootprint, pickupFootprint, playerFootprint, type Footprint } from '../sim/contacts';
import type { Road } from '../sim/road';
import { RAMP, type Ramp } from '../sim/ramps';
import { rainAt } from '../sim/weather';
import { KINDS, type Gate, type Obstacle, type Pickup, type PickupType } from '../sim/world';

import { CAM_BACK, DRAW, RENDER, chaseSlope, gammaBoost, depthEff, isCrispScale, makeLayout, type Layout } from './projection';
import { applyLight, decoType, decoX, drawDeco, LANDMARK_FAR, LANDMARK_SCALE, LANDMARK_TYPES, landmarksAhead, drawMoon, drawMountains, drawPlane, drawPortal, drawSkyline, drawSky, drawSun, hash, lightT, mixHex, PORTAL_Z, stageAt } from './scenery';
import { CHUNK, drawPed, pedsInChunk } from './people';
import { computeRows } from './rows';
import { LOT, lotItems, type LotEnv } from './lots';
import { encState, enclosureItems, starFlash } from './enclosure';
import { eventsIn, planRoute, routeStrength, type RouteEvent } from '../sim/route';
import { PAL, blinkerIntensity, blinkerLight, drawBlinkerLight, drawObstacle, drawPickup, drawShieldArc, gfx, rect, type Blinker, type BlinkerLight } from './sprites';
import { drawCar } from './car3d';

/** Alles, was zum Zeichnen eines Bildes nötig ist (Vorschau oder Lauf). */
export interface View {
  s: number; x: number; /** Weltposition quer */ X: number; bodyYaw: number; phi: number; /** Winkel Nase–Straße */ rel: number; speedKmh: number;
  shield: boolean; shieldFrac: number; slow: boolean; magnet: boolean; blitz: boolean; boost: boolean; /** Pfadfinder: Spurmitte oder null */ guide: number | null; /** Flughöhe (m) und Restzeit des Gleitflugs (s) */ lift: number; glideLeft: number; /** Gesamtdauer des laufenden Flugs (Power-up oder Rampe) */ glideTotal?: number; /** Rampen und Rampen-Lkw */ ramps?: readonly Ramp[]; /** Sekunden seit dem Einsammeln der Zeitblase, sonst −1 */ slowAge: number;
  obstacles: readonly Obstacle[]; pickups: readonly Pickup[];
  /** Neon Rush aktiv (nur Darstellung: Leuchten, betonte Tempolinien – keine Änderung der Physik). */
  rush?: boolean;
  /** Neon Gates des laufenden Rushs. */
  gates?: readonly Gate[];
  crash: { id: number } | null; running: boolean;
  /** Aktive Szenenzeit (s) für Mond und Flugzeuge, Seed des Laufs für den Flugplan. */
  sceneT: number; seed: number;
  road: Road;
  /** Sunset Sprint: Streckenposition (m) des Zieltors, sonst nicht gesetzt. */
  finishZ?: number;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string }
interface Drawable { d: number; draw: () => void }

const smoothStep = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

export type BurstKind = 'crash' | PickupType | 'shieldHit' | 'land';

const MAX_PARTICLES = 120;

const NO_ROUTE: readonly RouteEvent[] = [];

/** Abstand der Streckenschilder (m). */
export const KM_SIGN_EVERY = 5000;
/** Grundstücke (räumliche Körper) gelten für die Abschnitte bis zu dieser Stufe; darüber bleiben die bisherigen Straßenrand-Motive. */
const LOT_STAGE_MAX = 9;
/** Wahrzeichen bleiben als eigene Motive (Riesenrad, Turm, Fontänensee), alles andere kommt aus den Grundstücken. */
const LANDMARKS = new Set(['wheel', 'eiffel', 'lake', 'fountain']);

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  L: Layout = makeLayout(320, 568);
  private gamma0 = this.L.gamma;
  private lt = 0;
  /** Nur QA/Vergleich: Grundstücke abschalten (alte Straßenrand-Motive), um Kosten und Bild zu vergleichen. */
  lotsOn = true;
  private plan: readonly RouteEvent[] = NO_ROUTE;
  private rs: { kind: RouteEvent['kind'] | null; k: number; theme: number } = { kind: null, k: 0, theme: 0 };
  private edgeA = '#2ee6d6';
  private edgeB: string = PAL.magenta;
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
  /** Neon Rush: weich ein-/ausgeblendete Stärke 0…1; Near-Miss-Lichtimpuls am Bildrand (Seite und Rest). */
  private rushK = 0;
  private nmPulse = 0; private nmSide = 1;
  /** Dezenter Lichtimpuls an der Seite, an der ein Near Miss passiert ist (nicht bei reduzierter Bewegung). */
  nearMissPulse(side: number): void { if (!this.reducedMotion) { this.nmPulse = 1; this.nmSide = side >= 0 ? 1 : -1; } }
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
    const fx = canvas.parentElement?.querySelector<HTMLCanvasElement>('#stage-fx') ?? null;
    if (fx) { this.fxCanvas = fx; this.fxCtx = fx.getContext('2d'); }
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = mq.matches;
    mq.addEventListener?.('change', (e) => { this.reducedMotion = e.matches; });
  }

  /** Hochaufgelöste Ebene für Lichtelemente (Blinker): eigene Zeichenfläche in physikalischen Pixeln über der Spielfläche. */
  private fxCanvas: HTMLCanvasElement | null = null;
  private fxCtx: CanvasRenderingContext2D | null = null;
  private lightQ: { light: BlinkerLight; a: number; occ: number; sy: number }[] = [];
  private fxDirty = false; private cssW = 0;
  /** Mindestbreite des Blinkers in Bildpunkten der Spielfläche (technisches Minimum: B.blinker.minPx CSS-Pixel). */
  private blinkerMinW(): number { return B.blinker.minPx * (this.L.w / Math.max(1, this.cssW || this.L.w)); }

  /** Zeichnet die gesammelten Blinker auf die hochaufgelöste Ebene (Bildpunkte der Spielfläche → physikalische Pixel). */
  private flushLights(): void {
    const fc = this.fxCtx, cv = this.fxCanvas;
    if (!fc || !cv) { this.lightQ.length = 0; return; }
    if (!this.lightQ.length && !this.fxDirty) return;
    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.clearRect(0, 0, cv.width, cv.height);
    this.fxDirty = this.lightQ.length > 0;
    if (!this.fxDirty) return;
    const L = this.L;
    fc.setTransform(cv.width / L.w, 0, 0, cv.height / L.h, 0, 0);
    for (const q of this.lightQ) {
      if (q.sy < q.occ || q.light.cx < -20 || q.light.cx > L.w + 20) continue;      // hinter einer Hügelkuppe oder außerhalb des Bildes
      drawBlinkerLight(fc, q.light, blinkerIntensity(this.clock, B.blinker.frequency, this.reducedMotion), B.blinker.glowIntensity, B.blinker.color, Math.min(1, q.a));
    }
    this.lightQ.length = 0;
  }

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    let dpr = Math.min(3, Math.max(1, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)));
    dpr = Math.min(dpr, Math.max(1, Math.sqrt(RENDER.fxMaxPixels / Math.max(1, cssW * cssH))));      // Pixelbudget der Effektebene
    if (this.fxCanvas) { const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr); if (this.fxCanvas.width !== w || this.fxCanvas.height !== h) { this.fxCanvas.width = w; this.fxCanvas.height = h; this.fxDirty = true; } }
    const L = makeLayout(cssW, cssH);
    if (this.canvas.width !== L.w || this.canvas.height !== L.h) { this.canvas.width = L.w; this.canvas.height = L.h; }
    this.L = L;
    this.gamma0 = L.gamma;
    gfx.u = L.u;
    this.canvas.style.imageRendering = isCrispScale(L.scale) ? 'pixelated' : 'auto';      // gebrochene Skalierung weich, ganzzahlige scharf
  }

  /** Lokales Feedback am Wagen (Partikel begrenzt). */
  /** Bodenring beim Aufsetzen nach dem Fliegen (0…1, klingt ab). */
  private landRing = 0;
  private lean = 0;
  /** Projektion der Wagenpunkte des letzten Bildes (Modellkoordinaten → Bild); Düsenstrahl und Wagen teilen sie und bleiben so synchron. */
  private carPt: ((x: number, y: number, z: number) => [number, number]) | null = null;
  private carZs = 0.6;
  /** Stoßring an der Stelle, an der das Impulsschild einen Treffer abgefangen hat (Bildposition, Fortschritt 0…1). */
  private impact: { sx: number; sy: number; t: number } | null = null;

  /** Impulsschild hat einen Treffer abgefangen: sichtbarer Stoßring am Hindernis. */
  shieldImpact(x: number, z: number): void {
    const p = this.screenAt(x, z, 0.8);
    if (p) this.impact = { sx: p.sx, sy: p.sy, t: 0 };
  }

  /** Effektende: Schild läuft ohne Treffer ab (Bogen zerfällt), Phantom-Turbo endet (violette Lichtkante kehrt zurück). */
  private prevShield = false; private shieldUsed = false; private shieldEnd = 0;
  private prevBoost = false; private boostEnd = 0;

  burst(kind: BurstKind): void {
    if (kind === 'shieldHit') this.shieldUsed = true;
    if (kind === 'land') this.landRing = 1;
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

  /** Regen: Stärke (0…1, weich geblendet); nur Darstellung. `forceRain` überschreibt den Plan (QA). */
  private wet = 0;
  forceRain: number | null = null;
  get rainNow(): number { return this.wet; }

  /**
   * Regenstimmung: etwas dunklere, kühlere Umgebung, dafür kräftiger leuchtende Straßenränder (Neon) und feine Regenfäden.
   * Fehlt in Tunneln und Casinos (dort geschlossen). Mit reduzierter Bewegung stehen die Fäden still und sind weniger.
   */
  private weatherLayer(v: View, zc: number, dt: number): void {
    const L = this.L, ctx = this.ctx;
    const target = (this.forceRain ?? rainAt(v.seed, v.s)) * (1 - this.rs.k);
    this.wet += (target - this.wet) * (1 - Math.exp(-Math.min(0.1, dt) / 0.6));
    const w = this.wet;
    if (w < 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${Math.round(255 - 70 * w)},${Math.round(255 - 62 * w)},${Math.round(255 - 30 * w)})`;
    ctx.fillRect(0, 0, L.w, L.h);
    // Neon kräftiger: die Randlinien der Straße glühen heller, die Farben wirken satter
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'butt';
    const edge = B.road.halfWidth + 0.15;
    for (const [sx, col] of [[-edge, '95,224,255'], [edge, '255,79,216']] as const) {
      let z0 = zc + 3;
      while (z0 < zc + 320) {
        const z1 = z0 * 1.0 + Math.max(3, (z0 - zc) * 0.22);
        const a = this.proj(zc, sx, z0), b = this.proj(zc, sx, z1);
        if (a.d > 1.5 && a.sy < L.h) {
          ctx.strokeStyle = `rgba(${col},${(0.5 * w).toFixed(2)})`; ctx.lineWidth = Math.max(1, 0.34 * a.k);
          ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
        }
        z0 = z1;
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // Regenfäden (stehend bei reduzierter Bewegung)
    const n = Math.round((this.reducedMotion ? 22 : this.quality > 0 ? 38 : 78) * w);
    const spd = Math.min(1, v.speedKmh / 500);
    ctx.strokeStyle = `rgba(200,222,255,${(0.34 * w).toFixed(2)})`; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const h1 = hash(i * 12.9898 + 1), h2 = hash(i * 78.233 + 2);
      const y = this.reducedMotion ? h2 * L.h : ((this.clock * (L.h * (1.1 + 0.8 * h1)) + h2 * L.h) % (L.h + 24)) - 12;
      const x = h1 * (L.w + 20) - 10 + y * 0.12;
      const len = (6 + 10 * h2) * (0.7 + 0.6 * spd);
      ctx.moveTo(x, y); ctx.lineTo(x + len * 0.12, y + len);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Rampe: keilförmige Auffahrt in Neonfarben mit Warnstreifen; die Oberkante schließt beim Lkw an die Ladefläche an. */
  private drawRamp(zc: number, r: Ramp, v: View): void {
    const ctx = this.ctx, hw = RAMP.width / 2, z0 = r.z - RAMP.len / 2, z1 = r.z + RAMP.len / 2, H = RAMP.height;
    const P = (x: number, z: number, h: number) => this.projectWorld(zc, this.road.center(z) + r.x + x, z, h);
    const nl = P(-hw, z0, 0), nr = P(hw, z0, 0), fl = P(-hw, z1, H), fr = P(hw, z1, H), gl = P(-hw, z1, 0), gr = P(hw, z1, 0);
    if (nl.d < 0.3) return;
    const night = lightT(v.s), glow = 0.55 + 0.45 * night;
    const quad = (a: { sx: number; sy: number }[], fill: string): void => { ctx.beginPath(); a.forEach((p, i) => { if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
    quad([nl, fl, gl], 'rgba(18,14,42,0.95)');                                  // linke Seitenfläche
    quad([nr, fr, gr], 'rgba(18,14,42,0.95)');                                  // rechte Seitenfläche
    quad([nl, nr, fr, fl], '#2a2252');                                         // Oberseite
    // Warnstreifen quer zur Fahrtrichtung
    const n = 5;
    for (let i = 0; i < n; i += 2) {
      const t0 = i / n, t1 = (i + 1) / n, zA = z0 + (z1 - z0) * t0, zB = z0 + (z1 - z0) * t1;
      quad([P(-hw, zA, H * t0), P(hw, zA, H * t0), P(hw, zB, H * t1), P(-hw, zB, H * t1)], '#ffd23f');
    }
    ctx.lineWidth = Math.max(1, 0.07 * nl.k); ctx.strokeStyle = `rgba(95,224,255,${glow.toFixed(2)})`;
    ctx.beginPath(); ctx.moveTo(nl.sx, nl.sy); ctx.lineTo(fl.sx, fl.sy); ctx.moveTo(nr.sx, nr.sy); ctx.lineTo(fr.sx, fr.sy); ctx.moveTo(nl.sx, nl.sy); ctx.lineTo(nr.sx, nr.sy); ctx.stroke();
    ctx.strokeStyle = `rgba(255,79,216,${glow.toFixed(2)})`; ctx.beginPath(); ctx.moveTo(fl.sx, fl.sy); ctx.lineTo(fr.sx, fr.sy); ctx.stroke();
  }

  /** Landemarke: zeigt im Flug die Stelle und Spur, an der der Wagen aufsetzt (folgt der Lenkung). */
  private landMark(zc: number, sL: number, v: View): void {
    const ctx = this.ctx, hw = 1.5, hl = 3.4;
    const P = (x: number, z: number, h = 0) => this.projectWorld(zc, this.road.center(sL + z) + v.x + x, sL + z, h);
    const a = P(-hw, -hl), b = P(hw, -hl), c = P(hw, hl), d = P(-hw, hl);
    if (a.d < 1) return;
    const pulse = this.reducedMotion ? 0.85 : 0.65 + 0.35 * Math.sin(this.clock * 10);
    ctx.save();
    // Lichtsäule über der Landestelle: auch aus großer Entfernung als Ziel erkennbar
    const t0 = P(0, 0, 0), t1 = P(0, 0, 9), gx = Math.max(3, 1.1 * a.k);
    const gr = ctx.createLinearGradient(0, t0.sy, 0, t1.sy); gr.addColorStop(0, `rgba(255,226,122,${(0.55 * pulse).toFixed(2)})`); gr.addColorStop(1, 'rgba(255,226,122,0)');
    ctx.fillStyle = gr; ctx.fillRect(t0.sx - gx, t1.sy, gx * 2, t0.sy - t1.sy);
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.closePath();
    ctx.globalAlpha = 0.32 * pulse; ctx.fillStyle = '#ffe27a'; ctx.fill();
    ctx.globalAlpha = 0.95; ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = Math.max(1.5, 0.09 * a.k); ctx.setLineDash([Math.max(3, 0.4 * a.k), Math.max(2, 0.22 * a.k)]); ctx.stroke();
    // zwei Pfeile in Fahrtrichtung
    ctx.setLineDash([]); ctx.lineWidth = Math.max(1.5, 0.12 * a.k);
    for (const zz of [-1.4, 1.2]) { const l = P(-1.0, zz - 0.7), m = P(0, zz + 0.7), r = P(1.0, zz - 0.7); ctx.beginPath(); ctx.moveTo(l.sx, l.sy); ctx.lineTo(m.sx, m.sy); ctx.lineTo(r.sx, r.sy); ctx.stroke(); }
    ctx.restore();
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
  /** Umgebung für Grundstücke: Projektion mit Straßenverlauf und Hügeln, Kamerahöhe, Licht und Qualitätsstufe. */
  private lotEnv(zc: number): LotEnv {
    return {
      ctx: this.ctx, zc, lt: this.lt, lights: gfx.lights, quality: this.quality, clock: this.clock, reduced: this.reducedMotion, haze: this.pal.haze,
      camH: this.L.Hv / this.L.fx,
      P: (x, z, h = 0) => { const p = this.projectWorld(zc, this.road.center(z) + x, z, h); return { sx: p.sx, sy: p.sy, d: p.d, k: p.k }; },
      fade: (d, extra = 1) => this.fade(d, extra),
      ground: (z) => this.road.height(z) - this.elev0,
    };
  }

  /** Bildposition (CSS-Pixel) eines Streckenpunkts im letzten Bild, z. B. um Hinweise an ein Hindernis zu heften. */
  screenAt(x: number, z: number, h = 0): { sx: number; sy: number } | null {
    if (!this.L.w || !this.road) return null;
    const p = this.projectWorld(this.lastZc, this.road.center(z) + x, z, h);
    return { sx: p.sx, sy: p.sy };
  }

  /** Aktuelle Streckenumgebung (Art und Stärke 0…1) für Klang und Anzeige. */
  get routeNow(): { kind: RouteEvent['kind'] | null; k: number; theme: number } { return this.rs; }
  get viewSize(): { w: number; h: number; hy: number } { return { w: this.L.w, h: this.L.h, hy: this.L.hy }; }

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
    if (v.s < this.prevS - 1) { this.brake = 0; this.prevSpeed = 0; this.firstSeen.clear(); this.snap = true; this.visYaw = 0; this.stealth = 0; this.particles.length = 0; this.flashes.length = 0; this.iconFlash = 0; this.arcFlash = 0; this.flash = 0; this.shieldEnd = 0; this.boostEnd = 0; this.prevShield = false; this.prevBoost = false; this.shieldUsed = false; this.rushK = 0; this.nmPulse = 0; this.rushReset(); }
    this.prevS = v.s;
    // Bremslicht nur bei tatsächlicher Verzögerung (z. B. Tempo fällt nach Turbo oder Zeitlupe)
    if (v.running && this.prevSpeed > 0 && v.speedKmh < this.prevSpeed - 0.02) this.brake = 1;
    else this.brake = Math.max(0, this.brake - dt * 2);
    if (v.running) this.prevSpeed = v.speedKmh;

    this.L.gamma = this.gamma0 - gammaBoost(v.speedKmh);
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
    if (this.kick > 0.01) { ctx.translate(0, Math.round(this.kick * 2)); this.kick = Math.max(0, this.kick - dt * 5); }
    if (this.shake > 0) {
      ctx.translate(Math.round((Math.random() - 0.5) * 4 * this.shake), Math.round((Math.random() - 0.5) * 3 * this.shake));
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    // Himmel (fern, unabhängig von Tempo, Lenkung und Drift): Sterne, Mond, Flugzeug – dahinter Berge und Skyline
    // Streckenereignis (Tunnel/Casino) nach Distanz: weiche Ein- und Ausblendung der Stimmung; im Tunnel gelten Nachtlichter, im Casino Teppich und Gold
    const plan = v.finishZ === undefined ? planRoute(v.seed) : NO_ROUTE;
    const rs = routeStrength(plan, v.s);
    this.plan = plan; this.rs = rs;
    const lt = rs.kind === 'PALM_TUNNEL' ? Math.max(lightT(v.s), 0.9 * rs.k) : lightT(v.s);
    this.lt = lt;
    applyLight(lt);
    const P = this.pal;
    P.g1 = mixHex('#5b3a48', '#1b1033', lt); P.g2 = mixHex('#664350', '#21143c', lt);
    P.s1 = mixHex('#7a5468', '#3a2a66', lt); P.s2 = mixHex('#6c4a5f', '#30235a', lt);
    P.w1 = mixHex('#8a6a78', '#443a66', lt); P.w2 = mixHex('#7e5f6e', '#3e355e', lt);
    P.curb = mixHex('#b99a9c', '#7c6ca8', lt); P.seam = mixHex('#5a4452', '#271f40', lt);
    P.a1 = mixHex('#4f465e', '#262944', lt); P.a2 = mixHex('#554b63', '#2b2e4c', lt);
    P.haze = mixHex('#c27a8a', '#4a2070', lt);
    this.carpet(P, rs.kind === 'CASINO_INTERIOR' ? rs.k : 0);
    // ruhigerer Bodenfluss: die Wechselfarben von Gelände, Gehweg und Asphalt liegen enger beieinander (weniger auffällige Querbänder)
    P.g2 = mixHex(P.g1, P.g2, 0.4); P.w2 = mixHex(P.w1, P.w2, 0.45); P.a2 = mixHex(P.a1, P.a2, 0.45);
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
    this.weatherLayer(v, zc, dt);
    ctx.restore();
    if (!this.reducedMotion) {
      // Cosmic Highway, Sternenbogen in der Tunnelmitte: kurzer, weicher Cyan-/Magenta-Impuls an den Bildrändern (nur Darstellung, höchstens 0,26 Deckkraft, kein Blitz)
      const sf = starFlash(this.plan.find((e) => v.s >= e.start && v.s < e.end) ?? null, v.s);
      if (sf > 0.01) {
        const g = ctx.createLinearGradient(0, 0, L.w, 0);
        g.addColorStop(0, `rgba(95,224,255,${(0.26 * sf).toFixed(3)})`); g.addColorStop(0.28, 'rgba(95,224,255,0)'); g.addColorStop(0.72, 'rgba(255,79,216,0)'); g.addColorStop(1, `rgba(255,79,216,${(0.26 * sf).toFixed(3)})`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, L.w, L.h);
      }
    }
    if (this.nmPulse > 0) {
      // Near Miss: weicher Lichtstreifen am Rand der Seite, an der das Fahrzeug vorbeiging (≈ 0,3 s, nur Darstellung)
      const w = L.w * 0.22, x0 = this.nmSide > 0 ? L.w - w : 0;
      const g = ctx.createLinearGradient(this.nmSide > 0 ? L.w : 0, 0, this.nmSide > 0 ? L.w - w : w, 0);
      const c = this.rushK > 0.3 ? '255,79,216' : '95,224,255';
      g.addColorStop(0, `rgba(${c},${(0.38 * this.nmPulse).toFixed(3)})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g; ctx.fillRect(x0, L.hy * 0.8, w, L.h - L.hy * 0.8);
      this.nmPulse = Math.max(0, this.nmPulse - dt * 3.3);
    }
    if (this.flash > 0) {
      ctx.globalAlpha = Math.min(0.7, this.flash);
      rect(ctx, 0, 0, L.w, L.h, '#fff');
      ctx.globalAlpha = 1;
      this.flash = Math.max(0, this.flash - dt * 4);
    }
    this.flushLights();
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

  /** Casino-Durchfahrt: roter Teppich als Fahrbahnbelag (nur Farbe), goldene Ränder und Bordsteine. */
  private carpet(P: { a1: string; a2: string; w1: string; w2: string; curb: string; g1: string; g2: string }, k: number): void {
    this.edgeA = k > 0 ? mixHex('#2ee6d6', '#ffcf6b', k) : '#2ee6d6';
    this.edgeB = k > 0 ? mixHex(PAL.magenta, '#ffcf6b', k) : PAL.magenta;
    if (k <= 0) return;
    P.a1 = mixHex(P.a1, '#7c1228', 0.92 * k); P.a2 = mixHex(P.a2, '#8e1a32', 0.92 * k);
    P.w1 = mixHex(P.w1, '#4c1c26', k); P.w2 = mixHex(P.w2, '#421620', k);
    P.curb = mixHex(P.curb, '#d9a93a', k); P.g1 = mixHex(P.g1, '#1a0a12', k); P.g2 = mixHex(P.g2, '#1e0c16', k);
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
      // Bodenfluss: Querfugen im Asphalt alle 18 m – genau eine Bildzeile je Fuge (Fugengrenze liegt zwischen dieser und der nächstnäheren Zeile), nur im Nahbereich
      if (far < 0.4 && y + 1 < L.h) {
        const dn = this.rowD[y + 1];
        if (dn >= 0 && dn < d && Math.floor((zc + d) / 18) !== Math.floor((zc + dn) / 18)) {
          ctx.globalAlpha = 0.32 * (1 - far / 0.4); rect(ctx, l, y, r - l, 1, '#17132a'); ctx.globalAlpha = 1;
        }
      }
      // Zeitblase: Welle läuft vom Wagen über den Asphalt
      if (v.slowAge >= 0 && v.slowAge < 1.8) {
        const dd = Math.abs(d - (10 + v.slowAge * 95));
        if (dd < 7) { ctx.globalAlpha = (1 - dd / 7) * 0.5 * (1 - v.slowAge / 1.8); rect(ctx, l, y, r - l, 1, '#b9e6ff'); ctx.globalAlpha = 1; }
      }
      // Details (Kanten, Spurtrenner) werden mit der Entfernung gedimmt: ruhiger Sichtkorridor
      ctx.globalAlpha = 1 - 0.7 * far;
      const ew = Math.max(1, 0.3 * k);
      rect(ctx, l, y, ew, 1, this.edgeA);
      rect(ctx, r - ew, y, ew, 1, this.edgeB);
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
    const evs = eventsIn(this.plan, zc, zc + DRAW);
    const inEv = (z: number): boolean => { for (const e of evs) if (z >= e.start - 2 && z <= e.end + 2) return true; return false; };
    const blockZ = (a: number, b: number): boolean => { for (const e of evs) if (b > e.start && a < e.end) return true; return false; };
    const STEP = 22;
    const k0 = Math.ceil((zc + 4) / STEP);
    const k1 = Math.floor((zc + DRAW) / STEP);
    const lod = this.quality > 0;
    for (let k = k0; k <= k1; k++) {
      const z = k * STEP;
      if (inEv(z) || inEv(z + 11)) continue;                          // im Tunnel / Casino: Wände statt Straßenrand
      for (const side of [-1, 1]) {
        let type = decoType(k, side, z);
        if (LANDMARK_TYPES.has(type)) continue;                       // Wahrzeichen: eigene Schleife mit Fernsicht (unten)
        if (this.lotsOn && !LANDMARKS.has(type)) continue;           // ersetzt durch Grundstücke (lots.ts); Wahrzeichen bleiben
        if (type === 'fountain' && !B.scenery.fountains) type = 'none';
        if (type === 'none' || (this.quality > 1 && k % 2)) continue;
        if (hash(k * 5 + (side > 0 ? 2 : 3)) < 0.18) type = 'none'; // Luft zwischen den Silhouetten
        if (type === 'none') continue;
        const hs = hash(k * 2 + (side > 0 ? 1 : 0));
        const strip = type === 'casino' || type === 'lake' || type === 'eiffel' || stageAt(z) >= 4;
        const x = decoX(type, k, side);
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
    // Wahrzeichen: eine Weltposition für Fern- und Nahsicht. Schon ab ≈ 1,7 km sichtbar (gedämpft), wachsen an derselben Stelle,
    // werden von näheren Grundstücken und Kuppen verdeckt (Zeichenreihenfolge, occlusionY) und ziehen auf ihrer Straßenseite vorbei.
    for (const m of landmarksAhead(zc + 4, zc + LANDMARK_FAR)) {
      const p = this.proj(zc, m.x, m.z);
      if (p.d < 4 || inEv(m.z)) continue;
      const stripIn = m.type === 'eiffel' ? smoothStep((v.s - (B.scenery.keys[3] - 200)) / 900) * Math.min(1, B.scenery.neon) : 1;
      const near = 1 - smoothStep((p.d - 380) / 700);                            // fern: in Dunst getaucht, nah: volle Farbe
      const aIn = smoothStep((LANDMARK_FAR - p.d) / 250);                          // weiches Auftauchen am Rand der Sichtweite
      items.push({
        d: p.d, draw: () => {
          ctx.save();
          const edge = L.cx + (this.lat(m.z, zc) + m.side * (B.road.halfWidth + 1.6)) * p.k;
          ctx.beginPath();
          if (m.side > 0) ctx.rect(edge, 0, L.w, L.h); else ctx.rect(0, 0, edge, L.h);
          ctx.clip();
          ctx.globalAlpha = aIn * stripIn * (0.55 + 0.45 * near);
          drawDeco(m.type, { ctx, sx: p.sx, sy: p.sy, sc: p.k * (LANDMARK_SCALE[m.type] ?? 1), side: m.side, hs: m.hs, k: m.k, clock: this.clock, reduced: this.reducedMotion, lod: this.quality > 0 || p.d > 500 });
          ctx.restore();
        },
      });
    }
    // Grundstücke am Straßenrand (Wüstenrand, Motels, Art-déco-Boulevard) als räumliche Körper und Bodenflächen
    if (this.lotsOn) {
      const env = this.lotEnv(zc);
      for (let i = Math.floor((zc + 2) / LOT) - 1; i <= Math.floor((zc + DRAW) / LOT); i++) {
        const mid = i * LOT + LOT / 2;
        if (stageAt(mid) > LOT_STAGE_MAX || mid < 40) continue;
        for (const side of [-1, 1]) lotItems(env, i, side, stageAt(mid), items, evs.length ? blockZ : undefined);
      }
    }
    // Neon-Palmen-Tunnel und Casino-Durchfahrt (Wände, Decke, Portale, Dekoration)
    if (evs.length) { const envE = this.lotEnv(zc); for (const e of evs) enclosureItems(envE, encState(e, envE.camH), zc, DRAW, items); }
    // Zieltor (Sunset Sprint)
    if (v.finishZ !== undefined && v.finishZ - zc > 4 && v.finishZ - zc < DRAW) {
      const pl = this.proj(zc, -(B.road.halfWidth + 0.9), v.finishZ), pr = this.proj(zc, B.road.halfWidth + 0.9, v.finishZ);
      items.push({ d: pl.d, draw: () => { ctx.globalAlpha = this.fade(pl.d); this.finishGate(pl, pr); ctx.globalAlpha = 1; } });
    }
    // Streckenschilder: alle 5 km ein Straßenschild mit der geschafften Reichweite am rechten Straßenrand
    for (let m = Math.ceil((zc + 4) / KM_SIGN_EVERY) * KM_SIGN_EVERY; m <= zc + DRAW; m += KM_SIGN_EVERY) {
      const p = this.proj(zc, B.road.halfWidth + 1.25, m);
      if (p.d < 3 || inEv(m)) continue;
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
          const lc = o.lc;
          const blink: Blinker | undefined = lc && !o.hit && (lc.stage === 'warn' || lc.stage === 'move') ? { side: lc.toX > lc.fromX ? 1 : -1 } : undefined;
          drawObstacle(ctx, o.kind, p.sx, p.sy - lift * p.k, p.k, this.clock, o.id);
          // Blinker: wird nach dem Bild als scharfes Vektorelement auf der hochaufgelösten Ebene gezeichnet (die Spielfläche selbst ist grob gerastert)
          if (blink) this.lightQ.push({ light: blinkerLight(o.kind, p.sx, p.sy - lift * p.k, p.k, blink.side, B.blinker.scale, this.blinkerMinW()), a, occ: this.occlusionY(d), sy: p.sy });
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
    // Rampen (Auffahrt auf der Straße, Laderampe am Lkw-Heck) und die Landemarke im Flug
    for (const r of v.ramps ?? []) {
      const d = r.z - zc;
      if (d < -RAMP.len || d > DRAW || inEv(r.z)) continue;
      items.push({ d: Math.max(0.5, d), draw: () => { ctx.globalAlpha = this.fade(Math.max(2, d)); this.drawRamp(zc, r, v); ctx.globalAlpha = 1; } });
    }
    if (v.glideLeft > 0 && v.running) {
      const sL = Math.min(v.s + (v.speedKmh / 3.6) * v.glideLeft, zc + DRAW * 0.92);
      items.push({ d: sL - zc, draw: () => this.landMark(zc, sL, v) });
    }
    // Passanten: Kulisse auf den Gehwegen (Anzahl auf kleinen Geräten begrenzt)
    {
      const cap = this.quality > 0 || L.w < 340 ? 10 : 24;
      let n = 0;
      const c0 = Math.floor((zc + 5) / CHUNK), c1 = Math.floor((zc + 210) / CHUNK);
      for (let c = c0; c <= c1 && n < cap && B.scenery.peds; c++) for (const side of [-1, 1]) for (const ped of pedsInChunk(c, side)) {
        const walkDz = ped.pose === 0 && !this.reducedMotion ? Math.sin(this.clock * 0.32 + ped.phase) * 2.4 : 0;        // kurzer Weg auf dem Gehweg
        const p = this.proj(zc, ped.x, ped.z + walkDz);
        if (p.d < 5 || p.d > 210 || n >= cap || inEv(ped.z)) continue;
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
      const reach = Math.min(B.powers.magnetRange, fl.age * 450);
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
    this.rushItems(v, zc, items);
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

  /** Zieltor: zwei Neonpfosten, Zielbanner mit Karomuster und der Aufschrift ZIEL. */
  private finishGate(a: { k: number; sx: number; sy: number }, b: { k: number; sx: number; sy: number }): void {
    const { ctx } = this;
    const k = a.k, h = 6.2 * k, bh = 1.6 * k;
    for (const p of [a, b]) { rect(ctx, p.sx - 0.18 * k, p.sy - h, 0.36 * k, h, '#2ee6d6'); rect(ctx, p.sx - 0.1 * k, p.sy - h, 0.2 * k, h, '#d7fff9'); }
    const x0 = a.sx, w = b.sx - a.sx, y0 = a.sy - h;
    rect(ctx, x0, y0, w, bh, '#0b0d26');
    const cols = Math.max(4, Math.round(w / Math.max(3, 0.7 * k)));
    const cw = w / cols;
    for (let i = 0; i < cols; i++) for (let j = 0; j < 2; j++) rect(ctx, x0 + i * cw, y0 + j * (bh / 2), cw, bh / 2, (i + j) % 2 ? '#ffffff' : '#ff3fa4');
    if (k >= 2.5) {
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `900 ${Math.max(6, 1.1 * k)}px system-ui, sans-serif`;
      ctx.lineWidth = Math.max(1, 0.12 * k); ctx.strokeStyle = '#0b0d26'; ctx.fillStyle = '#ffe27a';
      ctx.strokeText('ZIEL', (a.sx + b.sx) / 2, y0 + bh / 2); ctx.fillText('ZIEL', (a.sx + b.sx) / 2, y0 + bh / 2);
      ctx.restore();
    }
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
    this.rushK += ((v.rush ? 1 : 0) - this.rushK) * (1 - Math.exp(-this.dtLast / 0.12));
    const sx = this.projectWorld(zc, this.carBx, this.carBz).sx;
    this.carSx = sx;
    const steer = Math.max(-1, Math.min(1, v.rel * 6));
    const yaw = this.visYaw;
    const liftPx = v.lift * k;
    const c = Math.cos(this.visYaw), s = Math.sin(this.visYaw);
    // Seitliche Neigung: Aufbau lehnt zur Außenseite der Querbewegung (v.rel folgt der echten Quergeschwindigkeit); der Bodenschatten bleibt auf der Spur
    const leanT = this.reducedMotion ? 0 : Math.max(-1, Math.min(1, v.rel * 7)) * 0.2;
    this.lean += (leanT - this.lean) * (1 - Math.exp(-this.dtLast / 0.07));
    const lean = this.lean;
    const carPt = (x: number, y: number, z: number): [number, number] => {
      const xr = x * c + z * s, zr = -x * s + z * c;
      const p = this.projectWorld(zc, this.carBx + xr - y * lean + this.camHead * zr, this.carBz + zr, y * 0.8);
      return [p.sx, p.sy];
    };
    this.carPt = carPt; this.carZs = L.portrait ? 0.78 : 0.6;
    // Überschlag beim Abheben: eine volle Drehung um die Längsachse in 0,9 s (sanft an- und auslaufend), nur mit normaler Bewegung
    const elG = (v.glideTotal || B.effects.glide) - v.glideLeft;
    const spinT = v.glideLeft > 0 && elG < 0.9 && !this.reducedMotion ? Math.max(0, elG) / 0.9 : 0;
    const spin = spinT > 0 ? Math.PI * 2 * (spinT < 0.5 ? 4 * spinT ** 3 : 1 - (-2 * spinT + 2) ** 3 / 2) : 0;
    const scan = this.reducedMotion ? 0 : Math.sin(this.clock * 5.2);
    if (this.rushK > 0.02) {
      // Neon Rush: magentafarbener Lichthof mit cyanfarbenem Kern hinter dem Wagen (auffällig, aber transparent genug für Straße und Hindernisse)
      const cy = L.gy - 0.85 * k - liftPx, pulse = this.reducedMotion ? 0.8 : 0.8 + 0.2 * Math.sin(this.clock * 9);
      const g = ctx.createRadialGradient(sx, cy, k * 0.4, sx, cy, k * 3.1);
      g.addColorStop(0, `rgba(255,79,216,${(0.34 * this.rushK * pulse).toFixed(3)})`); g.addColorStop(0.55, `rgba(95,224,255,${(0.13 * this.rushK * pulse).toFixed(3)})`); g.addColorStop(1, 'rgba(255,79,216,0)');
      ctx.fillStyle = g; ctx.fillRect(sx - k * 3.2, cy - k * 2.2, k * 6.4, k * 4.4);
    }
    drawCar(ctx, (x, y, z) => { const q = carPt(x, y, z); return [Math.round(q[0]), Math.round(q[1])]; }, k, { turbo: false, grip: false, brake: this.brake, steer, running: v.running, yaw, lift: v.lift / 0.8, stealth: this.stealth, zs: L.portrait ? 0.78 : undefined, spin, scan, neon: this.rushK });
    this.rushPlayerFx(v, zc, sx, k, liftPx);
    // Effektende erkennen (Zustandswechsel), unabhängig von Toasts
    if (v.running) {
      if (this.prevShield && !v.shield && !this.shieldUsed) this.shieldEnd = 1;
      if (!v.shield) this.shieldUsed = false;
      if (this.prevBoost && !v.boost) this.boostEnd = 1;
      this.prevShield = v.shield; this.prevBoost = v.boost;
    }
    if (this.boostEnd > 0) {
      // Turbo-Ende: kurze violette Lichtkante um den Wagen – „Farbe kehrt zurück“
      ctx.save(); ctx.globalAlpha = 0.8 * this.boostEnd; ctx.strokeStyle = '#c9a8ff'; ctx.lineWidth = Math.max(1, 0.08 * k);
      const r = (1.25 + (this.reducedMotion ? 0 : 0.5 * (1 - this.boostEnd))) * k;
      ctx.beginPath(); ctx.ellipse(sx, L.gy - 0.55 * k - liftPx, r, r * 0.62, 0, Math.PI, Math.PI * 2); ctx.stroke(); ctx.restore();
      this.boostEnd = Math.max(0, this.boostEnd - this.dtLast / 0.5);
    }
    if (this.shieldEnd > 0) {
      // Schild läuft ab: der Bogen zerfällt in Splitter, die nach außen treiben und verblassen (eigene Form statt Blinken)
      const t = 1 - this.shieldEnd;
      ctx.save(); ctx.translate(Math.round(sx), Math.round(L.gy - 0.7 * k - liftPx));
      ctx.strokeStyle = PAL.mint; ctx.lineWidth = Math.max(1.5, k * 0.11); ctx.globalAlpha = Math.min(1, 1.3 * this.shieldEnd);
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * (1.1 + i * 0.135), out = this.reducedMotion ? 0 : t * 0.9;
        const rx = (1.55 + out) * k, ry = (1.25 + out * 0.8) * k;
        ctx.beginPath(); ctx.ellipse(Math.cos(a) * out * k * 0.6, Math.sin(a) * out * k * 0.6 + (this.reducedMotion ? 0 : t * 0.6 * k), rx, ry, 0, a, a + 0.15 * (1 - 0.5 * t)); ctx.stroke();
      }
      ctx.restore();
      this.shieldEnd = Math.max(0, this.shieldEnd - this.dtLast / 0.55);
    }
    if (this.landRing > 0) {
      const t = 1 - this.landRing;
      ctx.save(); ctx.globalAlpha = 0.65 * this.landRing; ctx.strokeStyle = '#bff3dc'; ctx.lineWidth = Math.max(1, 0.1 * k);
      ctx.beginPath(); ctx.ellipse(sx, L.gy - 0.05 * k, (1.3 + 3.4 * t) * k, (0.2 + 0.5 * t) * k, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      this.landRing = Math.max(0, this.landRing - this.dtLast * (this.reducedMotion ? 6 : 2.4));
    }
    if (v.glideLeft > 0 && v.glideLeft < B.glide.down + 0.9 && v.running) {
      // Landespur: Rechteck am Boden unter dem Wagen – blinkt in der letzten Sekunde vor dem Aufsetzen und zeigt, in welcher Spur er landet
      const hw = 1.05, hl = 2.1;
      const q = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].map(([dx, dz]) => this.projectWorld(zc, this.carBx + dx + this.camHead * dz, this.carBz + dz, 0));
      const pulse = this.reducedMotion ? 0.85 : 0.6 + 0.4 * Math.sin(this.clock * 14);
      ctx.save(); ctx.globalAlpha = pulse; ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = Math.max(1.5, 0.07 * k); ctx.setLineDash([Math.max(3, 0.35 * k), Math.max(2, 0.2 * k)]);
      ctx.beginPath(); q.forEach((p, i) => { if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy); }); ctx.closePath(); ctx.stroke(); ctx.restore();
    }
    if (this.impact) {
      const im = this.impact; const t = im.t;
      ctx.save(); ctx.globalAlpha = 0.85 * (1 - t); ctx.strokeStyle = PAL.mint; ctx.lineWidth = Math.max(2, 0.12 * k);
      const r = (0.5 + (this.reducedMotion ? 0.6 : 2.4 * t)) * k;
      ctx.beginPath(); ctx.ellipse(im.sx, im.sy, r, r * 0.6, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      im.t += this.dtLast / (this.reducedMotion ? 0.25 : 0.45);
      if (im.t >= 1) this.impact = null;
    }
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
    this.rushScreenFx(v, dt);
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
    if (v.glideLeft > 0 && v.running && this.carPt) {
      // Gleitflug: zwei Düsenstrahlen, die vom Heck nach hinten (zur Kamera) ausströmen wie bei einem Jet. Sie nutzen dieselbe Projektion wie der Wagen
      // (Höhe, Neigung, Kurvenversatz) und laufen deshalb ohne Nachziehen mit.
      const el = (v.glideTotal || B.effects.glide) - v.glideLeft;
      const inten = Math.min(1, el / 0.3) * Math.min(1, v.glideLeft / B.glide.down);
      const lift = v.lift / 0.8, ZR = -2.1, zs = this.carZs;
      const flick = this.reducedMotion ? 1 : 0.92 + 0.08 * Math.sin(this.clock * 48);
      const len = (3.4 + 1.2 * Math.min(1, v.lift / 3)) * inten * flick;
      const mz = (z: number): number => ZR + (z - ZR) * zs;
      const yN = 0.52 + lift;
      let sparkX = this.carSx, sparkY = L.gy;
      for (const sg of [-1, 1]) {
        const x0 = sg * 0.55;
        const a1 = this.carPt(x0 - 0.16, yN, mz(ZR)), a2 = this.carPt(x0 + 0.16, yN, mz(ZR));
        const b1 = this.carPt(x0 - 0.04, yN, mz(ZR - len)), b2 = this.carPt(x0 + 0.04, yN, mz(ZR - len));
        const am: [number, number] = [(a1[0] + a2[0]) / 2, (a1[1] + a2[1]) / 2], bm: [number, number] = [(b1[0] + b2[0]) / 2, (b1[1] + b2[1]) / 2];
        const g = ctx.createLinearGradient(am[0], am[1], bm[0], bm[1]);
        g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.25, 'rgba(255,200,240,0.85)'); g.addColorStop(0.6, 'rgba(107,184,255,0.5)'); g.addColorStop(1, 'rgba(107,184,255,0)');
        ctx.globalAlpha = inten; ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(Math.round(a1[0]), Math.round(a1[1])); ctx.lineTo(Math.round(a2[0]), Math.round(a2[1])); ctx.lineTo(Math.round(b2[0]), Math.round(b2[1])); ctx.lineTo(Math.round(b1[0]), Math.round(b1[1])); ctx.closePath(); ctx.fill();
        // heller Kern und Glut an der Düse
        const c1 = this.carPt(x0 - 0.06, yN, mz(ZR - 0.05)), c2 = this.carPt(x0 + 0.06, yN, mz(ZR - 0.05)), d1 = this.carPt(x0, yN, mz(ZR - len * 0.55));
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.moveTo(Math.round(c1[0]), Math.round(c1[1])); ctx.lineTo(Math.round(c2[0]), Math.round(c2[1])); ctx.lineTo(Math.round(d1[0]), Math.round(d1[1])); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = inten * 0.5; ctx.fillStyle = '#ffd0f0';
        ctx.beginPath(); ctx.arc(am[0], am[1], Math.max(2, 0.3 * (L.fx / CAM_BACK)), 0, Math.PI * 2); ctx.fill();
        if (sg > 0) { sparkX = am[0]; sparkY = am[1]; }
      }
      ctx.globalAlpha = 1;
      if (!this.reducedMotion) {
        this.sparkAcc += dt * 60 * inten * (this.quality > 0 ? 0.5 : 1);
        const COLS = ['#ff9ae0', '#9ae8ff', '#ffffff', '#ffe95a'];
        const k0 = L.fx / CAM_BACK;
        while (this.sparkAcc >= 1 && this.particles.length < MAX_PARTICLES) {
          this.sparkAcc -= 1;
          this.particles.push({ x: sparkX - (Math.random() > 0.5 ? 1.1 : 0) * k0 + (Math.random() - 0.5) * 0.3 * k0, y: sparkY + Math.random() * 6, vx: (Math.random() - 0.5) * 30, vy: 30 + Math.random() * 60, life: 0, max: 0.3 + Math.random() * 0.3, c: COLS[Math.floor(Math.random() * 4)] });
        }
      }
    }
    if (v.running && !this.reducedMotion && this.quality < 2) {
      // Tempolinien: Zahl, Länge und Deckkraft wachsen von 200 bis 600 km/h stetig (360 / 500 / 600 sind klar unterscheidbar)
      // Neon Rush betont das Tempo nur optisch (mehr und hellere Linien); die tatsächliche Geschwindigkeit bleibt unverändert
      const vn = Math.max(0, Math.min(1, (v.speedKmh - 200) / 400 + 0.6 * this.rushK));
      const n = 8 + Math.round(30 * vn);                 // etwa die Hälfte fällt auf die Fahrbahn und entfällt
      const sp = v.speedKmh / 260;
      ctx.globalAlpha = 0.18 + 0.3 * vn;
      const lineCol = '#9aa0ff';
      for (let i = 0; i < n; i++) {
        const ph = (this.clock * (1.2 + sp * 1.6) + hash(i * 3)) % 1;
        const side = hash(i) > 0.5 ? 1 : -1;
        const xx = L.cx + side * (L.cx * (0.4 + 0.6 * ph) * (0.6 + hash(i + 40) * 0.5));
        const yy = L.hy + (L.h - L.hy) * ph;
        // nie über der Fahrbahn: der Blick bleibt ruhig auf Spur und Hindernissen, das Tempo zeigt sich an Rand und Gehweg
        const dRow = this.rowD[Math.min(L.h - 1, Math.max(0, Math.round(yy)))];
        if (dRow > 0) { const kk = L.fx / depthEff(dRow, L), rcx = L.cx + this.lat(this.lastZc + dRow, this.lastZc) * kk; if (Math.abs(xx - rcx) < (B.road.halfWidth + 0.5) * kk) continue; }
        rect(ctx, xx, yy, 1, (2 + ph * 10 * (0.5 + sp) * (1 + 0.5 * this.rushK)) * gfx.u, this.rushK > 0.3 ? (i & 1 ? '#7fe9ff' : '#ff9af0') : lineCol);
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

  // ---------- Neon Rush 2.0: Tore, Slash, Schockwelle, Wagen-Effekte ----------
  private slashFx: { age: number; dir: number; x0: number }[] = [];
  private waveFx: { age: number }[] = [];
  private gateFx: { x: number; z: number; age: number }[] = [];
  private passK = 0; private startK = 0; private endK = 0; private kick = 0; private lastPassT = -1;

  private rushReset(): void {
    this.slashFx.length = 0; this.waveFx.length = 0; this.gateFx.length = 0; this.passK = 0; this.startK = 0; this.endK = 0; this.kick = 0;
  }

  /** Partikel aus dem Pool (gedeckelt; auf schwächeren Profilen weniger). */
  private spark(x: number, y: number, n: number, cols: string[], speed = 50, up = -30): void {
    if (this.reducedMotion) return;
    const cap = this.quality > 0 ? MAX_PARTICLES * 0.5 : MAX_PARTICLES;
    const m = this.quality > 0 ? Math.ceil(n / 2) : n;
    for (let i = 0; i < m && this.particles.length < cap; i++) {
      const a = Math.random() * Math.PI * 2, sp = (0.35 + Math.random() * 0.65) * speed;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + up, life: 0, max: 0.25 + Math.random() * 0.3, c: cols[i % cols.length] });
    }
  }

  /** Neon Rush beginnt: kurzer Aktivierungsimpuls (≤ 0,3 s) mit Ring und Kamerastoß. */
  rushStarted(): void { this.startK = 1; this.endK = 0; if (!this.reducedMotion) this.kick = 1; this.spark(this.carSx || this.L.cx, this.L.gy - 0.8 * (this.L.fx / CAM_BACK), 26, ['#5fe0ff', '#ff4fd8', '#ffffff'], 90); }
  /** Neon Rush endet: Konturen klingen kontrolliert aus. */
  rushEnded(): void { this.endK = 1; this.startK = 0; }
  /** Neon Slash: seitlicher Energieschweif von der alten zur neuen Position. */
  slash(dir: number): void {
    this.slashFx.push({ age: 0, dir, x0: this.carSx || this.L.cx });
    if (this.slashFx.length > 3) this.slashFx.shift();
    const k = this.L.fx / CAM_BACK, y = this.L.gy - 0.7 * k;
    this.spark((this.carSx || this.L.cx) - dir * 0.8 * k, y, 10, ['#5fe0ff', '#ff4fd8', '#fff'], 60, -10);
  }
  /** Neon Shockwave am Wagen (Tor eingesammelt). */
  shockwave(): void { this.waveFx.push({ age: 0 }); if (this.waveFx.length > 2) this.waveFx.shift(); }
  /** Neon Gate eingesammelt: Ring am Tor und Funken. */
  gateCollected(x: number, z: number): void {
    this.gateFx.push({ x, z, age: 0 }); if (this.gateFx.length > 3) this.gateFx.shift();
    const p = this.screenAt(x, z, 1.2);
    if (p) this.spark(p.sx, p.sy, 14, ['#5fe0ff', '#ff4fd8', '#fff'], 70);
  }
  /** Phantom-Durchfahrt: kleiner Energieimpuls am Kontaktpunkt (höchstens alle 0,1 s). */
  rushPass(x: number, z: number): void {
    if (this.clock - this.lastPassT < 0.1) return;
    this.lastPassT = this.clock; this.passK = 1;
    const p = this.screenAt(x, z, 0.8);
    if (p) this.spark(p.sx, p.sy, 8, ['#c8f6ff', '#5fe0ff', '#ff9af0'], 55);
  }

  /** Tore (schlanke Neon-Elemente: zwei Pfosten, dünner Balken, leuchtende Durchfahrtszone) und Licht-Dashes auf den Spurgrenzen. */
  private rushItems(v: View, zc: number, items: Drawable[]): void {
    const { ctx } = this;
    for (const g of v.gates ?? []) {
      if (g.taken) continue;
      const d = g.z - zc;
      if (d < 3 || d > DRAW) continue;
      const p = this.proj(zc, g.x, g.z);
      items.push({ d: d - 0.1, draw: () => {
        const half = 1.7, hgt = 3.0, k = p.k;
        const a = this.fade(d) * (g.missed ? 0.35 : 1);
        const pulse = this.reducedMotion ? 0.85 : 0.78 + 0.22 * Math.sin(this.clock * 8 + g.n);
        const f0 = this.proj(zc, g.x - half, g.z - 1.0), f1 = this.proj(zc, g.x + half, g.z - 1.0), f2 = this.proj(zc, g.x + half, g.z + 1.0), f3 = this.proj(zc, g.x - half, g.z + 1.0);
        ctx.globalAlpha = a * (0.16 + 0.1 * pulse);
        ctx.fillStyle = '#5fe0ff';
        ctx.beginPath(); ctx.moveTo(f0.sx, f0.sy); ctx.lineTo(f1.sx, f1.sy); ctx.lineTo(f2.sx, f2.sy); ctx.lineTo(f3.sx, f3.sy); ctx.closePath(); ctx.fill();
        // Leit-Chevrons auf dem Boden vor dem Tor (zeigen die Durchfahrtsrichtung)
        for (let c = 1; c <= 3; c++) {
          const zc0 = g.z - 3 * c, cw = half * 0.55;
          const a0 = this.proj(zc, g.x - cw, zc0 - 1.1), a1 = this.proj(zc, g.x, zc0), a2 = this.proj(zc, g.x + cw, zc0 - 1.1);
          ctx.globalAlpha = a * pulse * (0.7 - 0.18 * c); ctx.strokeStyle = c & 1 ? '#5fe0ff' : '#ff4fd8'; ctx.lineWidth = Math.max(1.2, 0.1 * k);
          ctx.beginPath(); ctx.moveTo(a0.sx, a0.sy); ctx.lineTo(a1.sx, a1.sy); ctx.lineTo(a2.sx, a2.sy); ctx.stroke();
        }
        const wL = Math.max(1.8, 0.12 * k), wH = wL * 3;
        for (const [px, col, glow] of [[-half, '#bff6ff', '#5fe0ff'], [half, '#ffd0f4', '#ff4fd8']] as const) {
          const b = this.proj(zc, g.x + px, g.z);
          ctx.globalAlpha = a * 0.3 * pulse; ctx.strokeStyle = glow; ctx.lineWidth = wH;
          ctx.beginPath(); ctx.moveTo(b.sx, b.sy); ctx.lineTo(b.sx, b.sy - hgt * k); ctx.stroke();
          ctx.globalAlpha = a * pulse; ctx.strokeStyle = col; ctx.lineWidth = wL;
          ctx.beginPath(); ctx.moveTo(b.sx, b.sy); ctx.lineTo(b.sx, b.sy - hgt * k); ctx.stroke();
        }
        const tl = this.proj(zc, g.x - half, g.z), tr = this.proj(zc, g.x + half, g.z);
        const gr = ctx.createLinearGradient(tl.sx, 0, tr.sx, 0); gr.addColorStop(0, '#5fe0ff'); gr.addColorStop(1, '#ff4fd8');
        ctx.globalAlpha = a * 0.35 * pulse; ctx.strokeStyle = gr; ctx.lineWidth = wH;
        ctx.beginPath(); ctx.moveTo(tl.sx, tl.sy - hgt * k); ctx.lineTo(tr.sx, tr.sy - hgt * k); ctx.stroke();
        ctx.globalAlpha = a * pulse; ctx.lineWidth = wL;
        ctx.beginPath(); ctx.moveTo(tl.sx, tl.sy - hgt * k); ctx.lineTo(tr.sx, tr.sy - hgt * k); ctx.stroke();
        ctx.globalAlpha = 1;
      } });
    }
    if (this.rushK > 0.05 && this.quality < 2 && !this.reducedMotion) {
      // Licht-Dashes auf den beiden Spurgrenzen: laufen mit dem Tempo, wechseln Cyan und Magenta (dünn, über dem Asphalt, unter Fahrzeugen)
      const step = 7, z0 = Math.floor(v.s / step) * step;
      for (let i = 1; i < 14; i++) for (const sx of [-1, 1]) {
        const z = z0 + i * step + ((this.clock * 40) % step);
        const d = z - zc;
        if (d < 6 || d > 160) continue;
        const x = sx * B.road.laneWidth / 2;
        const a = this.fade(d) * 0.55 * this.rushK;
        const p = this.proj(zc, x, z), q = this.proj(zc, x, z + 2.4);
        items.push({ d: d - 0.6, draw: () => {
          ctx.globalAlpha = a; ctx.strokeStyle = (i + (sx > 0 ? 1 : 0)) & 1 ? '#5fe0ff' : '#ff4fd8'; ctx.lineWidth = Math.max(1, 0.1 * p.k);
          ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(q.sx, q.sy); ctx.stroke(); ctx.globalAlpha = 1;
        } });
      }
    }
  }

  /** Effekte am Wagen: Aktivierungsring, Slash-Schweife, Schockwelle, Tor-Ringe, Phantom-Ring, Ende. */
  private rushPlayerFx(_v: View, zc: number, sx: number, k: number, liftPx: number): void {
    const { ctx, L } = this;
    const dt = this.dtLast, cy = L.gy - 0.7 * k - liftPx;
    if (this.startK > 0) {
      const t = 1 - this.startK, r = (1.2 + 2.4 * t) * k;
      ctx.save(); ctx.globalAlpha = 0.9 * this.startK; ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = Math.max(1.5, 0.12 * k);
      ctx.beginPath(); ctx.ellipse(sx, cy, r, r * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.5 * this.startK; ctx.strokeStyle = '#ff4fd8'; ctx.lineWidth = Math.max(1, 0.2 * k);
      ctx.beginPath(); ctx.ellipse(sx, cy, r * 0.85, r * 0.6, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      this.startK = Math.max(0, this.startK - dt / 0.3);
    }
    if (this.endK > 0) {
      const t = 1 - this.endK, r = (2.6 - 1.4 * t) * k;
      ctx.save(); ctx.globalAlpha = 0.6 * this.endK; ctx.strokeStyle = '#ff9af0'; ctx.lineWidth = Math.max(1, 0.1 * k);
      ctx.beginPath(); ctx.ellipse(sx, cy, r, r * 0.7, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      this.endK = Math.max(0, this.endK - dt / 0.25);
    }
    if (this.passK > 0) {
      ctx.save(); ctx.globalAlpha = 0.55 * this.passK; ctx.strokeStyle = '#c8f6ff'; ctx.lineWidth = Math.max(1, 0.08 * k);
      const r = (1.5 + 0.5 * (1 - this.passK)) * k;
      ctx.beginPath(); ctx.ellipse(sx, cy, r, r * 0.65, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      this.passK = Math.max(0, this.passK - dt / 0.25);
    }
    for (let i = this.slashFx.length - 1; i >= 0; i--) {
      const s = this.slashFx[i]; s.age += dt;
      const t = s.age / 0.42;
      if (t >= 1) { this.slashFx.splice(i, 1); continue; }
      const x0 = s.x0 + (sx - s.x0) * Math.min(1, t * 0.5), h = (0.55 - 0.4 * t) * k, y = cy - 0.1 * k, mx = (x0 + sx) / 2;
      const gr = ctx.createLinearGradient(x0, 0, sx, 0); gr.addColorStop(0, 'rgba(95,224,255,0)'); gr.addColorStop(0.7, s.dir > 0 ? '#5fe0ff' : '#ff4fd8'); gr.addColorStop(1, '#ffffff');
      ctx.save(); ctx.globalAlpha = 0.9 * (1 - t);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(x0, y); ctx.quadraticCurveTo(mx, y - h * 2, sx, y - 0.05 * k); ctx.quadraticCurveTo(mx, y + h * 0.5, x0, y); ctx.fill();
      ctx.globalAlpha = 0.6 * (1 - t); ctx.strokeStyle = s.dir > 0 ? '#ff9af0' : '#9af0ff'; ctx.lineWidth = Math.max(1, 0.06 * k);
      ctx.beginPath(); ctx.moveTo(x0, y + 0.25 * k); ctx.quadraticCurveTo(mx, y - h * 1.2, sx, y + 0.1 * k); ctx.stroke();
      ctx.restore();
    }
    for (let i = this.waveFx.length - 1; i >= 0; i--) {
      const w = this.waveFx[i]; w.age += dt;
      const t = w.age / 0.4;
      if (t >= 1) { this.waveFx.splice(i, 1); continue; }
      const e = 1 - (1 - t) * (1 - t), r = 1.5 + 12.5 * e;
      const back = this.carBz - zc - 1.5;
      const ring = (rr: number): [number, number][] => Array.from({ length: 28 }, (_, j) => {
        const a = (j / 28) * Math.PI * 2, dz = Math.max(-back, Math.sin(a) * rr), dx = Math.cos(a) * rr;
        const p = this.projectWorld(zc, this.carBx + dx + this.camHead * dz, this.carBz + dz, 0);
        return [p.sx, p.sy];
      });
      const path = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([x, y], j) => { if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); };
      const p1 = ring(r);
      ctx.save();
      path(p1); ctx.globalAlpha = 0.1 * (1 - t); ctx.fillStyle = '#5fe0ff'; ctx.fill();
      ctx.globalAlpha = 0.4 * (1 - t); ctx.strokeStyle = '#5fe0ff'; ctx.lineWidth = Math.max(2, 0.26 * k); path(p1); ctx.stroke();
      ctx.globalAlpha = 0.95 * (1 - t); ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = Math.max(1, 0.07 * k); path(p1); ctx.stroke();
      if (t > 0.12) { ctx.globalAlpha = 0.6 * (1 - t); ctx.strokeStyle = '#ff4fd8'; ctx.lineWidth = Math.max(1, 0.09 * k); path(ring(r * 0.78)); ctx.stroke(); }
      ctx.restore();
    }
    for (let i = this.gateFx.length - 1; i >= 0; i--) {
      const g = this.gateFx[i]; g.age += dt;
      const t = g.age / 0.45;
      if (t >= 1) { this.gateFx.splice(i, 1); continue; }
      const p = this.screenAt(g.x, g.z, 0);
      if (!p) continue;
      const kk = this.L.fx / Math.max(8, depthEff(Math.max(1, g.z - zc), this.L));
      ctx.save(); ctx.globalAlpha = 0.8 * (1 - t); ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = Math.max(1.2, 0.1 * kk);
      ctx.beginPath(); ctx.ellipse(p.sx, p.sy - 0.5 * kk, (1.6 + 2.2 * t) * kk, (1.0 + 1.4 * t) * kk * 0.7, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
  }

  /** Bildschirmeffekte des Rushs: Lichtspuren hinter dem Wagen und Energiepartikel (Tempolinien siehe fxLayer). */
  private rushScreenFx(v: View, dt: number): void {
    if (this.rushK < 0.05 || !v.running) return;
    const { ctx, L } = this;
    const k0 = L.fx / CAM_BACK, y0 = L.gy - (0.5 + v.lift) * k0;
    for (const [off, c0] of [[-0.5, '95,224,255'], [0.5, '255,79,216']] as const) {
      const x0 = this.carSx + off * k0, len = Math.min(L.h - y0, (this.reducedMotion ? 2.2 : 3.6 + 0.6 * Math.sin(this.clock * 12)) * k0 * this.rushK);
      const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
      g.addColorStop(0, `rgba(${c0},0.75)`); g.addColorStop(1, `rgba(${c0},0)`);
      ctx.globalAlpha = this.rushK; ctx.fillStyle = g;
      ctx.fillRect(Math.round(x0 - Math.max(1, 0.07 * k0)), y0, Math.max(2, 0.14 * k0), len);
    }
    ctx.globalAlpha = 1;
    if (!this.reducedMotion) {
      this.sparkAcc += dt * 34 * this.rushK * (this.quality > 0 ? 0.5 : 1);
      const cap = this.quality > 0 ? MAX_PARTICLES * 0.5 : MAX_PARTICLES * 0.85;
      while (this.sparkAcc >= 1 && this.particles.length < cap) {
        this.sparkAcc -= 1;
        const side = Math.random() > 0.5 ? 1 : -1;
        this.particles.push({ x: this.carSx + side * (0.3 + Math.random() * 0.7) * k0, y: y0 + Math.random() * 0.4 * k0, vx: side * (5 + Math.random() * 20), vy: 25 + Math.random() * 70, life: 0, max: 0.25 + Math.random() * 0.25, c: side > 0 ? '#ff4fd8' : '#5fe0ff' });
      }
    }
  }
}
