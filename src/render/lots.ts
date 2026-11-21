import { B_HALF } from './lotsconst';
import { BALANCE } from '../config/balance';
import { rect } from './sprites';
import { drawDeco, hash, landmarkInLot, mixHex } from './scenery';

/**
 * Grundstücke am Straßenrand: feste, ortsgebundene Anordnung (nur aus Streckenabschnitt und Seite abgeleitet, nie aus dem Spielseed),
 * als räumliche Körper (Breite × Höhe × Tiefe) und Bodenflächen. Alles wird mit der Straßenprojektion gezeichnet und macht Kurven,
 * Kuppen und Kamerabewegung mit. Koordinaten je Grundstück: u = Abstand ab Bordstein nach außen (m), z = Streckenposition (m).
 */
export const LOT = 72;
/** Ab hier gilt die Nacht für Casino-Gebäude (Blaue Stunde, Licht ≈ 0,7 – derselbe Zustand, der Fenster, Sterne und Neon steuert). */
const CASINO_NIGHT_Z = BALANCE.scenery.keys[2] + 1200;
export const CASINO_BLDG = ['NEON PALACE', 'SUNSET ROYALE', 'MIDNIGHT CLUB', 'LUCKY LIGHTS'];
export interface PP { sx: number; sy: number; d: number; k: number }
export interface LotEnv {
  ctx: CanvasRenderingContext2D;
  /** Weltpunkt (seitlich relativ zur Straßenmitte, Strecke, Höhe über Gelände) → Bild. */
  P: (x: number, z: number, h?: number) => PP;
  zc: number;
  /** Kamerahöhe über der Bezugsebene (m): oberhalb davon sieht man Dächer von oben, darunter Unterseiten. */
  camH: number;
  lt: number; lights: number; quality: number; clock: number; reduced: boolean;
  haze: string; fade: (d: number, extra?: number) => number;
  /** Geländehöhe relativ zur Kamerabezugsebene an der Stelle z. */
  ground: (z: number) => number;
}
export interface Item { d: number; draw: () => void }

type Prim =
  | { t: 'box'; u0: number; u1: number; z0: number; z1: number; h0: number; h1: number; col: string; trim?: string; win?: 'motel' | 'car' | 'shed' | 'tower' | 'garage' | 'casino'; neon?: string; skip?: 'top'; /** senkrechte Lisenen auf der Straßenseite (gliedern große helle Flächen) */ bands?: number }
  | { t: 'gnd'; pts: Array<[number, number]>; col: string; a: number; glow?: boolean }
  | { t: 'line'; u0: number; u1: number; z: number; w: number; col: string; a: number }
  | { t: 'bush'; u: number; z: number; s: number }
  | { t: 'palm'; u: number; z: number; s: number; ph: number }
  | { t: 'sign'; u: number; z: number; h: number; txt: string; col: string; /** Breite des Schildes (m), Standard 3,2 */ w?: number };

export interface Lot { prims: Prim[]; detail: boolean }

const CAR_COLS = ['#f2c21a', '#d8453f', '#3f6fb5', '#2fb7a8', '#f0ece0', '#8b93a8'];

// ------------------------------------------------------------------ Grundstücke
/** Welche Art von Grundstück liegt in Abschnitt i auf dieser Seite? (nur Wüstenrand/Motels und Art-déco-Boulevard) */
export type LotKind = 'casino' | 'motel' | 'open' | 'shed' | 'pocket' | 'deco' | 'court' | 'garage' | 'plaza' | 'tower' | 'neon' | 'hotel' | 'show' | 'fair' | 'quiet';

export function lotKind(i: number, side: number, stage: number): LotKind {
  const r = (i % 4 + 4) % 4;
  const right = side > 0;
  // Wahrzeichen stehen auf einem offenen Vorplatz ihres Grundstücks (kein Turm davor, Fußpunkt sichtbar)
  if (stage >= 2 && landmarkInLot(i, side, LOT)) return 'fair';
  if (stage === 0) {
    // Muster mit Wiederholung nur alle vier Abschnitte, Seiten gegenläufig
    if (r === 0) return right ? 'motel' : 'open';
    if (r === 1) return right ? 'shed' : 'pocket';
    if (r === 2) return right ? 'open' : 'motel';
    return right ? 'pocket' : 'shed';
  }
  if (stage === 1) {
    if (r === 0) return right ? 'deco' : 'court';
    if (r === 1) return right ? 'court' : 'deco';
    if (r === 2) return right ? 'deco' : 'open';
    return right ? 'open' : 'deco';
  }
  // Rhythmus je Viertel, Seiten gegenläufig versetzt:
  // Hotelviertel – Türme unterschiedlicher Breite mit gestaffelten Dächern, niedriger Hotelriegel mit Vorbau, offene Lücke, Parkhaus;
  // Unterhaltungsviertel – Showhalle mit Vorplatz, offene Lücke mit Blick in den Mittelgrund, Turm;
  // Neonmeile – einzelne helle Fassade, danach ruhiger Abschnitt.
  const q = (r + (right ? 0 : 2)) % 4;
  // Casino-Boulevard: erst in der Nachtphase (vorhandener Licht-Stützpunkt, Blaue Stunde) ersetzen Casinos einzelne Showhallen, Plätze und Neonblöcke
  if (stage >= 3 && i * LOT + LOT / 2 >= CASINO_NIGHT_Z && ((stage === 3 && (q === 0 || q === 3)) || (stage >= 4 && q === 0))) return 'casino';
  if (stage === 2) return q === 0 ? 'tower' : q === 1 ? 'hotel' : q === 2 ? 'open' : 'garage';
  if (stage === 3) return q === 0 ? 'show' : q === 1 ? 'open' : q === 2 ? 'tower' : 'plaza';
  return q === 0 ? 'neon' : q === 1 ? 'quiet' : q === 2 ? 'tower' : 'quiet';
}

/** Farbstimmung je Viertel (Fassade, Zierleiste, Neon): Hotelviertel kühles Weiß und Gold, Unterhaltung Violett, Neonmeile dunkle Körper. */
const DISTRICT = [
  { body: '#b8aacb', alt: '#c4b4d4', trim: '#2ee6d6', neon: '#2ee6d6' },
  { body: '#b8aacb', alt: '#c4b4d4', trim: '#2ee6d6', neon: '#2ee6d6' },
  { body: '#cfd5e2', alt: '#e2dccb', trim: '#ffcf6b', neon: '#9fe8ff' },
  { body: '#a99ac4', alt: '#b9a2c8', trim: '#ff4fd8', neon: '#ff4fd8' },
  { body: '#6f6596', alt: '#5e5582', trim: '#2ee6d6', neon: '#2ee6d6' },
];

const cache = new Map<number, Lot>();

export function lotAt(i: number, side: number, stage: number): Lot {
  const key = (i * 2 + (side > 0 ? 1 : 0)) * 8 + stage;
  const hit = cache.get(key);
  if (hit) return hit;
  const lot = buildLot(i, side, stage);
  cache.set(key, lot);
  if (cache.size > 400) for (const k of cache.keys()) { cache.delete(k); if (cache.size < 300) break; }
  return lot;
}

function buildLot(i: number, side: number, stage: number): Lot {
  const z0 = i * LOT;
  const h = (n: number): number => hash(i * 977 + (side > 0 ? 131 : 17) + n * 31);
  const kind = lotKind(i, side, stage);
  const prims: Prim[] = [];
  const asph = '#4a4258';
  switch (kind) {
    case 'motel': {
      const dz = 12 + Math.floor(h(1) * 6);                       // Einfahrt: Lage im Abschnitt
      // Einfahrt über Bordstein und Gehweg, Bordsteinkante unterbrochen
      prims.push({ t: 'gnd', pts: [[-0.25, z0 + dz], [-0.25, z0 + dz + 6.4], [5, z0 + dz + 6.4], [5, z0 + dz]], col: asph, a: 1 });
      prims.push({ t: 'gnd', pts: [[4, z0 + dz - 0.6], [4, z0 + dz + 7], [15, z0 + dz + 7], [15, z0 + dz - 0.6]], col: asph, a: 1 });
      // Parkplatz
      const pz0 = z0 + dz + 7, pz1 = z0 + LOT - 5;
      prims.push({ t: 'gnd', pts: [[4, pz0], [4, pz1], [14.5, pz1], [14.5, pz0]], col: '#443d52', a: 1 });
      for (let z = pz0 + 1.2; z < pz1 - 0.5; z += 2.7) prims.push({ t: 'line', u0: 5, u1: 9.6, z, w: 0.12, col: '#efe9d8', a: 0.7 });
      let cars = 0;
      for (let z = pz0 + 1.2, n = 0; z + 2.7 < pz1; z += 2.7, n++) {
        if (h(10 + n) < 0.42 && cars < 4) { cars++; prims.push(...car(5.4, z + 0.45, CAR_COLS[Math.floor(h(20 + n) * CAR_COLS.length)])); }
      }
      // Niedrige Mauer / Pflanzinsel entlang des Gehwegs, ohne Einfahrt
      prims.push({ t: 'box', u0: 3.5, u1: 4.2, z0: z0 + 2, z1: z0 + dz - 0.4, h0: 0, h1: 0.6, col: '#a98b78', trim: '#c7ab96' });
      prims.push({ t: 'box', u0: 3.5, u1: 4.2, z0: z0 + dz + 6.8, z1: z0 + LOT - 3, h0: 0, h1: 0.6, col: '#a98b78', trim: '#c7ab96' });
      prims.push({ t: 'palm', u: 3.85, z: z0 + dz - 2.5, s: 1.0, ph: h(30) * 6 });
      prims.push({ t: 'palm', u: 3.85, z: z0 + dz + 9.5, s: 0.9, ph: h(31) * 6 });
      prims.push({ t: 'sign', u: 1.2, z: z0 + dz - 1.4, h: 6.2, txt: 'MOTEL', col: h(2) > 0.5 ? '#ff4fd8' : '#2ee6d6' });
      // Hauptbau mit Vordach, zurückgesetzter Anbau, Lichtfleck am Eingang
      const bz0 = z0 + dz + 9, bz1 = Math.min(z0 + LOT - 4, bz0 + 40);
      prims.push({ t: 'box', u0: 15.5, u1: 27, z0: bz0, z1: bz1, h0: 0, h1: 4.4, col: h(3) > 0.5 ? '#e9c8b8' : '#d9e0d2', trim: '#2ee6d6', win: 'motel', neon: '#ff4fd8' });
      prims.push({ t: 'box', u0: 12.6, u1: 15.5, z0: bz0 + 6, z1: bz1 - 6, h0: 3.1, h1: 3.45, col: '#f4efe2', trim: '#ff4fd8' });            // Vordach
      for (let z = bz0 + 6.5; z < bz1 - 5; z += 6.2) prims.push({ t: 'box', u0: 12.7, u1: 13, z0: z, z1: z + 0.3, h0: 0, h1: 3.1, col: '#8d8a9c' });   // Pfosten
      prims.push({ t: 'box', u0: 19, u1: 25.5, z0: z0 + 3, z1: bz0 - 2, h0: 0, h1: 3.0, col: '#cfc0b0', trim: '#ffb45a', win: 'shed' });                   // zurückgesetzter Anbau
      prims.push({ t: 'gnd', pts: [[10, bz0 + 12], [10, bz0 + 19], [15.4, bz0 + 19], [15.4, bz0 + 12]], col: '#ffb45a', a: 0.28, glow: true });
      break;
    }
    case 'open': {
      prims.push({ t: 'gnd', pts: [[3.4, z0], [3.4, z0 + LOT], [5.3, z0 + LOT], [5.3, z0]], col: '#2c2030', a: 0.8 });                                  // trockener Graben
      prims.push({ t: 'gnd', pts: [[5.3, z0], [5.3, z0 + LOT], [5.9, z0 + LOT], [5.9, z0]], col: '#a88a78', a: 0.55 });                                  // Böschungskante
      for (let n = 0; n < 3; n++) {
        const gz = z0 + 6 + h(40 + n) * (LOT - 30), gu = 7 + h(50 + n) * 9, gw = 6 + h(60 + n) * 8, gl = 5 + h(70 + n) * 9;
        prims.push({ t: 'gnd', pts: [[gu, gz], [gu + gw * 0.3, gz + gl], [gu + gw, gz + gl * 0.7], [gu + gw * 0.8, gz + 1]], col: n % 2 ? '#7d6670' : '#4a3340', a: 0.7 });  // Schotterflecken
      }
      for (let n = 0; n < 7; n++) prims.push({ t: 'bush', u: 6.5 + h(80 + n) * 14, z: z0 + 4 + h(90 + n) * (LOT - 8), s: 0.7 + h(100 + n) * 0.8 });
      break;
    }
    case 'shed': {
      prims.push({ t: 'gnd', pts: [[3.4, z0], [3.4, z0 + LOT], [4.6, z0 + LOT], [4.6, z0]], col: '#2c2030', a: 0.7 });
      prims.push({ t: 'gnd', pts: [[7, z0 + 14], [7, z0 + 34], [20, z0 + 34], [20, z0 + 14]], col: '#6a5560', a: 0.6 });                                // Hof des Nebenbaus
      prims.push({ t: 'box', u0: 14, u1: 21, z0: z0 + 17, z1: z0 + 27, h0: 0, h1: 2.8, col: '#c9b8a2', trim: '#ff8a1f', win: 'shed' });                // zurückgesetzter Nebenbau
      prims.push({ t: 'box', u0: 11, u1: 13.2, z0: z0 + 20, z1: z0 + 23, h0: 0, h1: 1.7, col: '#8b93a8', trim: '#d4daea', win: 'car' });
      for (let n = 0; n < 5; n++) prims.push({ t: 'bush', u: 6 + h(110 + n) * 16, z: z0 + 3 + h(120 + n) * (LOT - 6), s: 0.7 + h(130 + n) * 0.7 });
      prims.push({ t: 'sign', u: 2.6, z: z0 + 40, h: 4.4, txt: 'OPEN', col: '#ffe27a' });
      break;
    }
    case 'pocket': {
      prims.push({ t: 'gnd', pts: [[-0.25, z0 + 22], [-0.25, z0 + 32], [10, z0 + 32], [10, z0 + 22]], col: '#443d52', a: 1 });                           // Parkbucht
      for (let z = z0 + 23; z < z0 + 31; z += 2.7) prims.push({ t: 'line', u0: 0.8, u1: 5.4, z, w: 0.12, col: '#efe9d8', a: 0.7 });
      prims.push(...car(1.2, z0 + 24.6, CAR_COLS[Math.floor(h(5) * CAR_COLS.length)]));
      prims.push({ t: 'box', u0: 12, u1: 18, z0: z0 + 8, z1: z0 + 19, h0: 0, h1: 3.2, col: '#d9e0d2', trim: '#2ee6d6', win: 'shed' });
      prims.push({ t: 'palm', u: 4.2, z: z0 + 12, s: 1.1, ph: h(6) * 6 });
      for (let n = 0; n < 4; n++) prims.push({ t: 'bush', u: 8 + h(140 + n) * 14, z: z0 + 36 + h(150 + n) * 30, s: 0.7 + h(160 + n) * 0.6 });
      break;
    }
    case 'deco': {
      // Art-déco-Boulevard: gestufte Fassade mit Vordach; Lücke daneben gibt den Blick auf flachere Hofgebäude frei
      const gap = 14 + Math.floor(h(8) * 8);
      prims.push({ t: 'box', u0: 3.6, u1: 12, z0: z0 + 2, z1: z0 + LOT - gap - 4, h0: 0, h1: 8.5, col: h(9) > 0.5 ? '#e8cdd4' : '#cfe4e0', trim: '#ff4fd8', win: 'motel', neon: '#2ee6d6' });
      prims.push({ t: 'box', u0: 6.2, u1: 12, z0: z0 + 6, z1: z0 + LOT - gap - 8, h0: 8.5, h1: 11.6, col: '#f1dfd2', trim: '#2ee6d6', win: 'motel' });
      prims.push({ t: 'box', u0: 1.4, u1: 3.6, z0: z0 + 12, z1: z0 + LOT - gap - 14, h0: 3.2, h1: 3.6, col: '#f4efe2', trim: '#ffb45a' });
      prims.push({ t: 'box', u0: 14, u1: 24, z0: z0 + LOT - gap, z1: z0 + LOT - 1, h0: 0, h1: 4.6, col: '#c8b4a8', trim: '#ffb45a', win: 'shed' });   // Hof- und Rückgebäude in der Lücke
      prims.push({ t: 'gnd', pts: [[3.4, z0 + LOT - gap], [3.4, z0 + LOT], [14, z0 + LOT], [14, z0 + LOT - gap]], col: '#4a4258', a: 1 });
      break;
    }
    case 'court': {
      prims.push({ t: 'gnd', pts: [[3.4, z0 + 8], [3.4, z0 + 40], [20, z0 + 40], [20, z0 + 8]], col: '#5a4f66', a: 0.9 });                                 // Vorplatz
      prims.push({ t: 'box', u0: 18, u1: 30, z0: z0 + 6, z1: z0 + 44, h0: 0, h1: 6.4, col: '#d9ccd8', trim: '#ff4fd8', win: 'motel', neon: '#ffe27a' });
      prims.push({ t: 'palm', u: 5, z: z0 + 14, s: 1.2, ph: h(11) * 6 }); prims.push({ t: 'palm', u: 5, z: z0 + 34, s: 1.1, ph: h(12) * 6 });
      break;
    }
    case 'garage': {
      // Parkhaus: offene Decks mit beleuchteten Wagenreihen, Rampe und Vordach an der Einfahrt, davor ein Vorplatz
      prims.push({ t: 'gnd', pts: [[3.4, z0 + 6], [3.4, z0 + 40], [22, z0 + 40], [22, z0 + 6]], col: '#4f4660', a: 0.9 });
      prims.push({ t: 'box', u0: 22, u1: 40, z0: z0 + 4, z1: z0 + 46, h0: 0, h1: 10 + h(13) * 8, col: '#bfb4c4', trim: '#ffe27a', win: 'garage', neon: '#2ee6d6' });
      prims.push({ t: 'box', u0: 14, u1: 22, z0: z0 + 18, z1: z0 + 30, h0: 3.6, h1: 4.0, col: '#f4efe2', trim: '#ff4fd8' });
      for (let z = z0 + 18.5; z < z0 + 30; z += 5.5) prims.push({ t: 'box', u0: 14.1, u1: 14.4, z0: z, z1: z + 0.3, h0: 0, h1: 3.6, col: '#8d8a9c' });
      prims.push({ t: 'palm', u: 6, z: z0 + 12, s: 1.2, ph: h(14) * 6 });
      break;
    }
    case 'plaza': {
      const D = DISTRICT[Math.min(4, stage)];
      prims.push({ t: 'gnd', pts: [[3.4, z0 + 6], [3.4, z0 + 50], [30, z0 + 50], [30, z0 + 6]], col: '#6a5a78', a: 0.85 });
      prims.push({ t: 'gnd', pts: [[8, z0 + 22], [8, z0 + 34], [16, z0 + 34], [16, z0 + 22]], col: '#2a6a8a', a: 0.7 });                                    // Brunnenbecken
      prims.push({ t: 'palm', u: 6, z: z0 + 14, s: 1.2, ph: h(14) * 6 }); prims.push({ t: 'palm', u: 6, z: z0 + 42, s: 1.2, ph: h(15) * 6 });
      prims.push({ t: 'box', u0: 30, u1: 46, z0: z0 + 8, z1: z0 + 52, h0: 0, h1: 16 + h(16) * 12, col: D.alt, trim: D.trim, win: 'tower', neon: D.neon, bands: 3 });
      if (stage >= 3) prims.push({ t: 'gnd', pts: [[9, z0 + 23], [9, z0 + 33], [15, z0 + 33], [15, z0 + 23]], col: '#2ee6d6', a: 0.35, glow: true });
      break;
    }
    case 'tower': {
      // Hotelturm mit zurückgesetztem Eingang: Sockel, Vordach, Vorplatz, darüber ein Turm mit eigener Breite und gestaffeltem Dach
      const D = DISTRICT[Math.min(4, stage)];
      const tw = 10 + Math.floor(h(21) * 4) * 3, tz0 = z0 + 8 + h(22) * 6, tz1 = Math.min(z0 + 40, tz0 + 18 + h(23) * 14);   // Breite 10–19 m, Länge 18–32 m
      const th = 24 + h(17) * 18;
      prims.push({ t: 'gnd', pts: [[3.4, z0 + 4], [3.4, z0 + 42], [22, z0 + 42], [22, z0 + 4]], col: '#55496a', a: 0.9 });
      prims.push({ t: 'box', u0: 18, u1: 38, z0: z0 + 6, z1: z0 + 40, h0: 0, h1: 6.5, col: mixHex(D.alt, '#f4efe2', 0.3), trim: '#ff4fd8', win: 'motel', neon: '#ff4fd8' });
      prims.push({ t: 'box', u0: 24, u1: 24 + tw, z0: tz0, z1: tz1, h0: 6.5, h1: th, col: D.body, trim: D.trim, win: 'tower', neon: D.neon, bands: stage === 2 ? 2 : 0 });
      // Dachstufe (zurückgesetzt) und bei jedem zweiten Turm eine schlanke Spitze: unterscheidbare Silhouetten statt gleicher Quader
      prims.push({ t: 'box', u0: 24 + tw * 0.3, u1: 24 + tw, z0: tz0 + (tz1 - tz0) * 0.2, z1: tz1 - (tz1 - tz0) * 0.2, h0: th, h1: th + 4 + h(24) * 4, col: D.alt, trim: D.trim, neon: D.neon });
      if (h(25) > 0.5) prims.push({ t: 'box', u0: 24 + tw * 0.6, u1: 24 + tw * 0.6 + 0.8, z0: (tz0 + tz1) / 2 - 0.4, z1: (tz0 + tz1) / 2 + 0.4, h0: th + 4, h1: th + 13, col: '#f4efe2', trim: D.neon });
      prims.push({ t: 'box', u0: 10, u1: 18, z0: z0 + 16, z1: z0 + 30, h0: 3.6, h1: 4.0, col: '#f4efe2', trim: '#ffe27a' });
      prims.push({ t: 'gnd', pts: [[11, z0 + 17], [11, z0 + 29], [18, z0 + 29], [18, z0 + 17]], col: '#ffcf6b', a: 0.3, glow: true });                      // Licht unter dem Vordach
      prims.push({ t: 'palm', u: 5, z: z0 + 10, s: 1.2, ph: h(18) * 6 });
      break;
    }
    case 'hotel': {
      // Hotelviertel: breiter, niedriger Riegel mit zurückgesetztem Obergeschoss und Vorbau am Eingang – bricht die Reihe hoher Türme
      const D = DISTRICT[Math.min(4, stage)];
      const hb = 10 + h(26) * 5, len = 30 + h(27) * 20;
      prims.push({ t: 'gnd', pts: [[3.4, z0 + 4], [3.4, z0 + 8 + len], [16, z0 + 8 + len], [16, z0 + 4]], col: '#5b5070', a: 0.9 });
      prims.push({ t: 'box', u0: 16, u1: 34, z0: z0 + 6, z1: z0 + 6 + len, h0: 0, h1: hb, col: D.alt, trim: D.trim, neon: D.neon, bands: 3 });   // große Fläche, nur durch Lisenen gegliedert (kein Fensterraster: ruhiger und günstiger)
      prims.push({ t: 'box', u0: 21, u1: 34, z0: z0 + 9, z1: z0 + 3 + len, h0: hb, h1: hb + 5, col: D.body, trim: D.trim, win: 'motel' });
      prims.push({ t: 'box', u0: 9, u1: 16, z0: z0 + 6 + len * 0.35, z1: z0 + 6 + len * 0.65, h0: 0, h1: 4.2, col: mixHex(D.alt, '#2a2638', 0.25), trim: '#ffcf6b', win: 'shed' });   // Vorbau mit Eingang
      prims.push({ t: 'sign', u: 2.6, z: z0 + 6 + len * 0.5, h: 5.2, txt: 'HOTEL', col: '#ffcf6b' });
      prims.push({ t: 'palm', u: 5, z: z0 + 8, s: 1.0, ph: h(28) * 6 });
      break;
    }
    case 'show': {
      // Unterhaltungsviertel: Showhalle weit hinten, davor ein heller Vorplatz mit Leuchtmarkise und senkrechtem Schild
      prims.push({ t: 'gnd', pts: [[3.4, z0 + 2], [3.4, z0 + 58], [22, z0 + 58], [22, z0 + 2]], col: '#5e4f78', a: 0.9 });
      prims.push({ t: 'gnd', pts: [[6, z0 + 18], [6, z0 + 42], [21, z0 + 42], [21, z0 + 18]], col: '#ff4fd8', a: 0.35, glow: true });
      prims.push({ t: 'box', u0: 22, u1: 44, z0: z0 + 4, z1: z0 + 56, h0: 0, h1: 11 + h(29) * 4, col: '#8a6aa8', trim: '#ffcf6b', neon: '#ff4fd8', bands: 3 });   // ruhige Wand: Markise und Schild tragen das Licht (günstiger als ein Lichtraster)
      prims.push({ t: 'box', u0: 17, u1: 22, z0: z0 + 16, z1: z0 + 44, h0: 4.2, h1: 5.2, col: '#ffcf6b', trim: '#fff2b0' });                       // Leuchtmarkise
      prims.push({ t: 'box', u0: 21.4, u1: 22, z0: z0 + 28, z1: z0 + 31, h0: 5.2, h1: 17, col: '#2a1d4a', trim: '#2ee6d6', neon: '#2ee6d6' });   // senkrechtes Schild
      prims.push({ t: 'palm', u: 5, z: z0 + 8, s: 1.2, ph: h(30) * 6 }); prims.push({ t: 'palm', u: 5, z: z0 + 52, s: 1.1, ph: h(31) * 6 });
      break;
    }
    case 'fair': {
      // Vorplatz eines Wahrzeichens: offene Fläche, Kassenhäuschen, Lichterketten-Masten – nichts Hohes davor
      prims.push({ t: 'gnd', pts: [[3.4, z0], [3.4, z0 + LOT], [64, z0 + LOT], [64, z0]], col: '#5a4c74', a: 0.9 });
      prims.push({ t: 'gnd', pts: [[8, z0 + 10], [8, z0 + LOT - 10], [30, z0 + LOT - 10], [30, z0 + 10]], col: '#ffcf6b', a: 0.22, glow: true });
      prims.push({ t: 'box', u0: 5, u1: 8, z0: z0 + 6, z1: z0 + 10, h0: 0, h1: 3, col: '#e8d8c8', trim: '#ff4fd8', win: 'shed' });
      prims.push({ t: 'box', u0: 5, u1: 8, z0: z0 + LOT - 10, z1: z0 + LOT - 6, h0: 0, h1: 3, col: '#e8d8c8', trim: '#2ee6d6', win: 'shed' });
      for (let z = z0 + 14; z < z0 + LOT - 12; z += 11) prims.push({ t: 'box', u0: 4.2, u1: 4.5, z0: z, z1: z + 0.3, h0: 0, h1: 5.5, col: '#3b3f6e', trim: '#fff2b0', neon: '#fff2b0' });
      break;
    }
    case 'quiet': {
      // Neonmeile, ruhiger Abschnitt: dunkler, niedriger Block ohne Reklame, Palmen – Atempause zwischen den hellen Fassaden
      prims.push({ t: 'gnd', pts: [[3.4, z0 + 4], [3.4, z0 + LOT - 4], [18, z0 + LOT - 4], [18, z0 + 4]], col: '#3a3354', a: 0.85 });
      prims.push({ t: 'box', u0: 20, u1: 34, z0: z0 + 10, z1: z0 + 54, h0: 0, h1: 7 + h(32) * 3, col: '#4a4266', trim: '#2a2448', win: 'motel' });
      for (let n = 0; n < 3; n++) prims.push({ t: 'palm', u: 5 + h(33 + n) * 6, z: z0 + 10 + n * 22, s: 1.1, ph: h(36 + n) * 6 });
      break;
    }
    case 'casino': {
      // Casino am Boulevard: Vorplatz mit rotem Teppich zum Eingang, goldene Fassade mit großen Fenstern (Spielautomaten dahinter), Neonname, Palmen
      const nm = CASINO_BLDG[Math.floor(h(5) * CASINO_BLDG.length)];
      prims.push({ t: 'gnd', pts: [[3.4, z0 + 4], [3.4, z0 + 62], [30, z0 + 62], [30, z0 + 4]], col: '#3a2a52', a: 0.95 });
      prims.push({ t: 'gnd', pts: [[3.4, z0 + 30], [3.4, z0 + 36], [25, z0 + 36], [25, z0 + 30]], col: '#8a1830', a: 0.95 });                      // roter Teppich zum Eingang
      prims.push({ t: 'gnd', pts: [[3.4, z0 + 29.6], [3.4, z0 + 30], [25, z0 + 30], [25, z0 + 29.6]], col: '#ffcf6b', a: 0.9 });
      prims.push({ t: 'gnd', pts: [[3.4, z0 + 36], [3.4, z0 + 36.4], [25, z0 + 36.4], [25, z0 + 36]], col: '#ffcf6b', a: 0.9 });
      prims.push({ t: 'gnd', pts: [[5, z0 + 12], [5, z0 + 28], [22, z0 + 28], [22, z0 + 12]], col: '#ffcf6b', a: 0.3, glow: true });
      prims.push({ t: 'gnd', pts: [[5, z0 + 38], [5, z0 + 56], [22, z0 + 56], [22, z0 + 38]], col: '#b46bff', a: 0.3, glow: true });
      prims.push({ t: 'box', u0: 24, u1: 42, z0: z0 + 6, z1: z0 + 60, h0: 0, h1: 12, col: '#c9a86a', trim: '#ffcf6b', win: 'casino', neon: '#ff4fd8' });
      prims.push({ t: 'box', u0: 22.4, u1: 24, z0: z0 + 28.6, z1: z0 + 29.8, h0: 0, h1: 8.5, col: '#e8c25a' });                                       // Eingangssäulen
      prims.push({ t: 'box', u0: 22.4, u1: 24, z0: z0 + 36.2, z1: z0 + 37.4, h0: 0, h1: 8.5, col: '#e8c25a' });
      prims.push({ t: 'box', u0: 22.2, u1: 24.2, z0: z0 + 28.4, z1: z0 + 37.6, h0: 8.5, h1: 9.2, col: '#ffcf6b', trim: '#ff4fd8' });                  // Vordach
      prims.push({ t: 'sign', u: 2.2, z: z0 + 33, h: 8.4, txt: nm, col: '#ffcf6b', w: 9.4 });
      prims.push({ t: 'palm', u: 4.6, z: z0 + 24, s: 1.0, ph: h(30) * 6 });
      prims.push({ t: 'palm', u: 4.6, z: z0 + 43, s: 0.95, ph: h(31) * 6 });
      prims.push({ t: 'palm', u: 4.6, z: z0 + 10, s: 0.9, ph: h(32) * 6 });
      break;
    }
    case 'neon': {
      // Neonmeile: Vorplatz mit farbigen Lichtinseln, niedriger Casino-Block mit leuchtender Dachkante, dahinter ein Turm
      prims.push({ t: 'gnd', pts: [[3.4, z0 + 4], [3.4, z0 + 46], [28, z0 + 46], [28, z0 + 4]], col: '#4a3f68', a: 0.9 });
      prims.push({ t: 'gnd', pts: [[4, z0 + 8], [4, z0 + 22], [18, z0 + 22], [18, z0 + 8]], col: '#ff4fd8', a: 0.4, glow: true });
      prims.push({ t: 'gnd', pts: [[6, z0 + 28], [6, z0 + 42], [20, z0 + 42], [20, z0 + 28]], col: '#2ee6d6', a: 0.4, glow: true });
      prims.push({ t: 'box', u0: 24, u1: 40, z0: z0 + 6, z1: z0 + 44, h0: 0, h1: 9.5, col: '#cdb4d8', trim: '#ffe27a', win: 'motel', neon: '#ff4fd8' });
      prims.push({ t: 'box', u0: 34, u1: 48, z0: z0 + 14, z1: z0 + 40, h0: 9.5, h1: 30 + h(19) * 14, col: '#a99bc0', trim: '#2ee6d6', win: 'tower', neon: '#2ee6d6' });
      prims.push({ t: 'sign', u: 2.6, z: z0 + 26, h: 7, txt: 'CASINO', col: '#ffe27a' });
      break;
    }
  }
  // Neonschilder färben nachts ihren Eingangsbereich (örtliches Licht auf Gehweg und Vorplatz)
  for (const p of [...prims]) if (p.t === 'sign') prims.push({ t: 'gnd', pts: [[0.4, p.z - 3.5], [0.4, p.z + 3.5], [5.5, p.z + 3.5], [5.5, p.z - 3.5]], col: p.col, a: 0.22, glow: true });
  // Zweite räumliche Ebene hinter der ersten Reihe: niedrige Baukörper mit größerem Abstand, ruhiger im Kontrast
  const back = kind === 'fair' ? 0 : stage <= 1 ? 3 : 4;            // Vorplatz eines Wahrzeichens bleibt bis hinten frei
  for (let n = 0; n < back; n++) {
    if (h(200 + n) < 0.35) continue;
    const bz = z0 + 4 + h(210 + n) * (LOT - 22), bw = 8 + h(220 + n) * 12, bh = (stage <= 1 ? 3 : 7) + h(230 + n) * (stage <= 1 ? 3 : 14);
    prims.push({ t: 'box', u0: 32 + h(240 + n) * 14, u1: 32 + h(240 + n) * 14 + 9 + h(250 + n) * 8, z0: bz, z1: bz + bw, h0: 0, h1: bh, col: stage <= 1 ? '#bba7a8' : '#a99bc0', win: 'shed' });
  }
  return { prims, detail: kind === 'motel' || kind === 'pocket' };
}

/** Geparktes Auto (Heck zur Straße): Karosserie + Kabine + Rückleuchten. */
function car(u: number, z: number, col: string): Prim[] {
  return [
    { t: 'box', u0: u, u1: u + 4.2, z0: z, z1: z + 1.8, h0: 0.25, h1: 1.0, col, win: 'car' },
    { t: 'box', u0: u + 0.9, u1: u + 3.0, z0: z + 0.12, z1: z + 1.68, h0: 1.0, h1: 1.55, col: mixHex(col, '#14122a', 0.35) },
  ];
}

// ------------------------------------------------------------------ Zeichnen
type V3 = [number, number, number];                           // x (seitlich relativ zur Straßenmitte), z, Höhe
const sideX = (side: number, u: number): number => side * (B_HALF + 0.4 + u);

/** Polygon gegen die Nahebene (z ≥ zMin) beschneiden, damit nichts hinter der Kamera projiziert wird. */
export function clipNear(poly: V3[], zMin: number): V3[] {
  const out: V3[] = [];
  for (let a = 0; a < poly.length; a++) {
    const p = poly[a], q = poly[(a + 1) % poly.length];
    const pin = p[1] >= zMin, qin = q[1] >= zMin;
    if (pin) out.push(p);
    if (pin !== qin) { const t = (zMin - p[1]) / (q[1] - p[1]); out.push([p[0] + (q[0] - p[0]) * t, zMin, p[2] + (q[2] - p[2]) * t]); }
  }
  return out;
}

/** Lichtrichtung: tiefe Sonne vorn links. Rechts liegende Gebäude zeigen der Straße ihre warm beleuchtete Seite, links liegende die kühle. */
function faceCol(env: LotEnv, base: string, face: 'road' | 'front' | 'top', side: number, shade = 1): string {
  const day = 1 - env.lt;
  const warm = '#ffb878', cool = '#2a2660', night = '#171236';
  let c = base;
  if (face === 'top') c = mixHex(base, warm, 0.22 * day);
  else if (face === 'road') c = side > 0 ? mixHex(base, warm, 0.32 * day) : mixHex(base, cool, 0.3 + 0.1 * day);
  else c = mixHex(base, cool, 0.38 + 0.12 * day);
  c = mixHex(c, night, 0.55 * env.lt * (face === 'top' ? 0.7 : 1));
  return shade < 1 ? mixHex(c, env.haze, 1 - shade) : c;
}

function fillPoly(env: LotEnv, pts: V3[], col: string, alpha = 1): number {
  const clipped = clipNear(pts, env.zc + 2.2);
  if (clipped.length < 3) return 0;
  const ctx = env.ctx;
  ctx.beginPath();
  let minD = 1e9;
  clipped.forEach((p, i) => { const q = env.P(p[0], p[1], p[2]); minD = Math.min(minD, q.d); const x = Math.round(q.sx), y = Math.round(q.sy); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
  const base = ctx.globalAlpha;
  ctx.fillStyle = col; ctx.globalAlpha = base * alpha; ctx.fill();
  ctx.globalAlpha = base;
  return minD;
}

function drawBox(env: LotEnv, side: number, p: Extract<Prim, { t: 'box' }>, dNear: number): void {
  const fog = Math.min(0.55, Math.max(0, (dNear - 120) / 700));      // Luftperspektive: fern gedämpft
  const x0 = sideX(side, p.u0), x1 = sideX(side, p.u1);
  const road: V3[] = [[x0, p.z0, p.h0], [x0, p.z1, p.h0], [x0, p.z1, p.h1], [x0, p.z0, p.h1]];
  const front: V3[] = [[x0, p.z0, p.h0], [x1, p.z0, p.h0], [x1, p.z0, p.h1], [x0, p.z0, p.h1]];
  const top: V3[] = [[x0, p.z0, p.h1], [x0, p.z1, p.h1], [x1, p.z1, p.h1], [x1, p.z0, p.h1]];
  const bottom: V3[] = [[x0, p.z0, p.h0], [x0, p.z1, p.h0], [x1, p.z1, p.h0], [x1, p.z0, p.h0]];
  const g = env.ground((p.z0 + p.z1) / 2);
  const showTop = p.h1 + g < env.camH;
  const showBottom = p.h0 + g > env.camH && p.h0 > 0.5;                            // Unterseite eines Vordachs, wenn die Kamera darunter liegt
  // Reihenfolge: Boden/Oberseite, Front, Straßenseite
  if (showBottom) fillPoly(env, bottom, faceCol(env, mixHex(p.col, '#14122a', 0.35), 'top', side, 1 - fog));
  fillPoly(env, front, faceCol(env, p.col, 'front', side, 1 - fog));
  fillPoly(env, road, faceCol(env, p.col, 'road', side, 1 - fog));
  if (showTop && p.skip !== 'top') fillPoly(env, top, faceCol(env, p.trim && p.h1 - p.h0 < 0.6 ? p.trim : p.col, 'top', side, 1 - fog));
  // Dachkante als Zierleiste
  if (p.trim && p.h1 - p.h0 >= 0.6) {
    const t = Math.min(0.35, (p.h1 - p.h0) * 0.12);
    const edge: V3[] = [[x0, p.z0, p.h1 - t], [x0, p.z1, p.h1 - t], [x0, p.z1, p.h1], [x0, p.z0, p.h1]];
    fillPoly(env, edge, faceCol(env, p.trim, 'road', side, 1 - fog));
    if (env.lights > 0.2 && p.neon) { const glow: V3[] = [[x0, p.z0, p.h1 - t * 2], [x0, p.z1, p.h1 - t * 2], [x0, p.z1, p.h1 - t], [x0, p.z0, p.h1 - t]]; fillPoly(env, glow, p.neon, env.lights); }
  }
  // Tiefe: Schlagschatten unter der Dachkante und dunkler Sockel – gliedern große Flächen in Dach, Wand und Fuß (günstig: zwei Flächen je Baukörper)
  if (p.h1 - p.h0 >= 3 && dNear < 260) {
    const t = p.trim ? Math.min(0.35, (p.h1 - p.h0) * 0.12) : 0, sh = Math.min(0.9, (p.h1 - p.h0) * 0.12);
    fillPoly(env, [[x0, p.z0, p.h1 - t - sh], [x0, p.z1, p.h1 - t - sh], [x0, p.z1, p.h1 - t], [x0, p.z0, p.h1 - t]], '#120d2a', 0.22);
    if (p.h0 < 0.5) fillPoly(env, [[x0, p.z0, p.h0], [x0, p.z1, p.h0], [x0, p.z1, p.h0 + 0.7], [x0, p.z0, p.h0 + 0.7]], '#120d2a', 0.28);
  }
  // Lisenen: wenige dunklere senkrechte Bänder gliedern große Fassaden (nah und nur bei voller Qualität)
  if (p.bands && dNear < 220 && env.quality < 1) {
    const n = p.bands, span = p.z1 - p.z0, bw = Math.min(1.6, span / (n * 4 + 2));
    const bc = faceCol(env, mixHex(p.col, '#2a2448', 0.32), 'road', side, 1 - fog);
    for (let j = 1; j <= n; j++) {
      const zz = p.z0 + (j * span) / (n + 1) - bw / 2;
      fillPoly(env, [[x0, zz, p.h0], [x0, zz + bw, p.h0], [x0, zz + bw, p.h1], [x0, zz, p.h1]], bc);
    }
  }
  // Fenster und Türen auf der Straßenseite (nur nah und bei voller Qualität)
  if (p.win && dNear < 230 && env.quality < 1) {
    const span = p.z1 - p.z0;
    if (p.win === 'garage') {
      // offene Parkdecks: dunkle Bänder mit warm beleuchteten Wagenreihen
      const decks = Math.max(2, Math.floor((p.h1 - p.h0) / 3.2));
      for (let r = 0; r < decks; r++) {
        const hb = p.h0 + 0.5 + r * 3.2;
        fillPoly(env, [[x0, p.z0 + 1, hb], [x0, p.z1 - 1, hb], [x0, p.z1 - 1, hb + 2.0], [x0, p.z0 + 1, hb + 2.0]], faceCol(env, '#2a2638', 'road', side, 1 - fog));
        if (env.lights > 0.25) for (let z = p.z0 + 2; z < p.z1 - 3; z += 4.2) fillPoly(env, [[x0, z, hb + 0.2], [x0, z + 1.6, hb + 0.2], [x0, z + 1.6, hb + 0.8], [x0, z, hb + 0.8]], '#ffb45a', 0.9);
      }
    } else if (p.win === 'casino') {
      // Große Panoramafenster in Gold, dahinter Spielautomaten (Dekoration): nur nah und bei voller Qualität
      const cols = Math.max(2, Math.floor(span / 5.2)), cw = span / cols;
      for (const [hb, hh] of [[1.4, 3.2], [6.2, 3.2]]) for (let c = 0; c < cols; c++) {
        const zz = p.z0 + c * cw + cw * 0.12, zw = cw * 0.76;
        fillPoly(env, [[x0, zz, hb], [x0, zz + zw, hb], [x0, zz + zw, hb + hh], [x0, zz, hb + hh]], '#2a0f2e');
        fillPoly(env, [[x0, zz, hb], [x0, zz + zw, hb], [x0, zz + zw, hb + hh], [x0, zz, hb + hh]], '#ffcf6b', 0.16 + 0.5 * env.lights);
        if (dNear < 150) for (let m = 0; m < 3; m++) {
          const zm = zz + zw * (0.12 + m * 0.3), mw = zw * 0.22;
          fillPoly(env, [[x0, zm, hb + 0.2], [x0, zm + mw, hb + 0.2], [x0, zm + mw, hb + hh - 0.5], [x0, zm, hb + hh - 0.5]], hash(c * 9 + m * 5 + Math.floor(p.z0)) > 0.5 ? '#b8862a' : '#7a3fc0');
          fillPoly(env, [[x0, zm + mw * 0.15, hb + hh * 0.42], [x0, zm + mw * 0.85, hb + hh * 0.42], [x0, zm + mw * 0.85, hb + hh * 0.7], [x0, zm + mw * 0.15, hb + hh * 0.7]], ['#ff3b3b', '#2ee6d6', '#ffd23a', '#ff4fd8'][(c + m + Math.floor(env.clock * 2)) & 3]);
        }
      }
    } else if (p.win === 'car') {
      for (const zz of [p.z0 + 0.12, p.z1 - 0.52]) fillPoly(env, [[x0, zz, p.h0 + 0.4], [x0, zz + 0.4, p.h0 + 0.4], [x0, zz + 0.4, p.h0 + 0.6], [x0, zz, p.h0 + 0.6]], '#ff2a2a');
    } else {
      const wh = (p.h1 - p.h0), rows = wh > 7 ? Math.min(p.win === 'tower' ? 12 : 6, Math.floor(wh / (p.win === 'tower' ? 2.4 : 2.8))) : 1;
      const cols = Math.max(1, Math.floor(span / 4));
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const zz = p.z0 + (c + 0.28) * (span / cols), zw = (span / cols) * 0.44;
        const hb = p.h0 + (r + (rows === 1 ? 0.28 : 0.35)) * (wh / rows), hh = (wh / rows) * (rows === 1 ? 0.4 : 0.36);
        const lit = env.lights > 0.3 && hash(Math.floor(p.z0 * 3) + c * 7 + r * 13 + Math.floor(p.u0)) > 0.4;
        fillPoly(env, [[x0, zz, hb], [x0, zz + zw, hb], [x0, zz + zw, hb + hh], [x0, zz, hb + hh]], lit ? '#ffd36b' : faceCol(env, '#2a2a52', 'road', side, 1 - fog));
        if (dNear < 120) {   // Fensterbank (helle Unterkante) und Laibungsschatten oben: Fenster wirken eingelassen
          fillPoly(env, [[x0, zz - 0.15, hb - 0.14], [x0, zz + zw + 0.15, hb - 0.14], [x0, zz + zw + 0.15, hb], [x0, zz - 0.15, hb]], faceCol(env, mixHex(p.col, '#ffffff', 0.35), 'road', side, 1 - fog));
          fillPoly(env, [[x0, zz, hb + hh], [x0, zz + zw, hb + hh], [x0, zz + zw, hb + hh + 0.12], [x0, zz, hb + hh + 0.12]], '#120d2a', 0.3);
        }
      }
    }
  }
}

function groundShadow(env: LotEnv, side: number, p: Extract<Prim, { t: 'box' }>): void {
  if (p.h1 < 0.5) return;
  // Schatten fällt von der Sonne (vorn links) weg: nach rechts und leicht nach hinten
  const sh = Math.min(5, p.h1 * 0.55);
  const x0 = sideX(side, p.u0), x1 = sideX(side, p.u1);
  const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
  const a = 0.26 * (1 - env.lt * 0.5);
  fillPoly(env, [[lo, p.z0 - 0.6, 0], [lo, p.z1, 0], [hi + sh, p.z1 - sh * 0.4, 0], [hi + sh, p.z0 - 0.6, 0]], '#0b0820', a);
}

/** Grundstücke eines Abschnitts als sortierbare Zeichenobjekte. */
export function lotItems(env: LotEnv, i: number, side: number, stage: number, out: Item[], block?: (z0: number, z1: number) => boolean): void {
  const lot = lotAt(i, side, stage);
  const { ctx } = env;
  for (const pr of lot.prims) {
    if (block) {
      // Teile, die in einen Tunnel oder ein Casino hineinragen würden, entfallen (die Wände begrenzen den Raum)
      const z0 = pr.t === 'gnd' ? Math.min(...pr.pts.map((q) => q[1])) : pr.t === 'box' ? pr.z0 : pr.z, z1 = pr.t === 'gnd' ? Math.max(...pr.pts.map((q) => q[1])) : pr.t === 'box' ? pr.z1 : pr.t === 'line' ? pr.z + pr.w : pr.z;
      if (block(z0, z1)) continue;
    }
    switch (pr.t) {
      case 'gnd': {
        const far = Math.max(...pr.pts.map((q) => q[1])) - env.zc;
        if (far < 3) break;
        out.push({ d: far + 0.4, draw: () => {
          ctx.globalAlpha = env.fade(far);
          const pts: V3[] = pr.pts.map(([u, z]) => [sideX(side, u), z, 0]);
          if (pr.glow && env.lights < 0.15) { ctx.globalAlpha = 1; return; }
          fillPoly(env, pts, pr.col, pr.a * (pr.glow ? env.lights : 1));
          ctx.globalAlpha = 1;
        } });
        break;
      }
      case 'line': {
        const d = pr.z - env.zc;
        if (d < 3 || d > 220 || env.quality > 1) break;
        out.push({ d: d + 0.3, draw: () => { ctx.globalAlpha = env.fade(d); fillPoly(env, [[sideX(side, pr.u0), pr.z, 0], [sideX(side, pr.u1), pr.z, 0], [sideX(side, pr.u1), pr.z + pr.w, 0], [sideX(side, pr.u0), pr.z + pr.w, 0]], pr.col, pr.a); ctx.globalAlpha = 1; } });
        break;
      }
      case 'box': {
        const dNear = Math.max(2.5, pr.z0 - env.zc);
        if (pr.z1 - env.zc < 2.5) break;
        if (dNear > 440) break;
        const small = pr.h1 < 0.9 && pr.z1 - pr.z0 < 3;
        if (small && (dNear > 170 || env.quality > 1)) break;
        out.push({ d: dNear + (pr.z1 - pr.z0) * 0.001, draw: () => {
          ctx.globalAlpha = env.fade(dNear, 1);
          if (env.quality < 1 && dNear < 300) groundShadow(env, side, pr);
          drawBox(env, side, pr, dNear);
          ctx.globalAlpha = 1;
        } });
        break;
      }
      case 'bush': {
        const d = pr.z - env.zc;
        if (d < 3 || d > 260 || env.quality > 1) break;
        out.push({ d, draw: () => {
          const p = env.P(sideX(side, pr.u), pr.z, 0);
          ctx.globalAlpha = env.fade(d);
          const k = p.k, w = 1.4 * pr.s * k, h = 0.8 * pr.s * k;
          rect(ctx, p.sx - w / 2, p.sy - h, w, h, mixHex('#3a5a46', env.haze, Math.min(0.5, d / 500) + env.lt * 0.15));
          rect(ctx, p.sx - w * 0.3, p.sy - h * 1.35, w * 0.6, h * 0.5, mixHex('#4c7a5c', env.haze, Math.min(0.5, d / 500) + env.lt * 0.15));
          ctx.globalAlpha = 1;
        } });
        break;
      }
      case 'palm': {
        const d = pr.z - env.zc;
        if (d < 3 || d > 300) break;
        out.push({ d, draw: () => {
          const p = env.P(sideX(side, pr.u), pr.z, 0);
          ctx.globalAlpha = env.fade(d);
          drawLotPalm(env, p, pr.s, pr.ph, d);
          ctx.globalAlpha = 1;
        } });
        break;
      }
      case 'sign': {
        const d = pr.z - env.zc;
        if (d < 3 || d > 330) break;
        out.push({ d, draw: () => {
          const p = env.P(sideX(side, pr.u), pr.z, 0);
          ctx.globalAlpha = env.fade(d);
          const k = p.k;
          rect(ctx, p.sx - 0.1 * k, p.sy - pr.h * k, 0.2 * k, pr.h * k, '#3b3f6e');
          const bw = (pr.w ?? 3.2) * k, bh = 1.4 * k, bx = p.sx - bw / 2, by = p.sy - pr.h * k - bh * 0.2;
          rect(ctx, bx - 0.12 * k, by - 0.12 * k, bw + 0.24 * k, bh + 0.24 * k, '#14122a');
          rect(ctx, bx, by, bw, bh, env.lights > 0.25 ? pr.col : mixHex(pr.col, '#14122a', 0.55));
          if (k > 4) {
            ctx.save(); ctx.fillStyle = env.lights > 0.25 ? '#14122a' : '#f4efe2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = `800 ${Math.max(5, 0.6 * k)}px system-ui, sans-serif`; ctx.fillText(pr.txt, p.sx, by + bh / 2); ctx.restore();
          }
          if (env.lights > 0.25) { ctx.globalAlpha *= 0.25 * env.lights; rect(ctx, bx - 0.8 * k, by - 0.6 * k, bw + 1.6 * k, bh + 1.2 * k, pr.col); }
          ctx.globalAlpha = 1;
        } });
        break;
      }
    }
  }
}

/** Palme: das vorhandene Palmen-Sprite (leichte Windbewegung, eigene Phase je Baum), skaliert mit der Entfernung. */
function drawLotPalm(env: LotEnv, p: PP, s: number, ph: number, d: number): void {
  if (p.k * s < 1.2) return;
  drawDeco('palm', { ctx: env.ctx, sx: p.sx, sy: p.sy, sc: p.k * s, side: 1, hs: (ph / 6) % 1, k: Math.floor(ph * 10), clock: env.clock, reduced: env.reduced, lod: d > 160 || env.quality > 0 });
}
