import { BALANCE } from './balance';
import { setSpeedKnots } from '../core/speed';

/**
 * Laufzeit-Konfiguration des Spiels (im Admin-Bereich einstellbar). Reine Daten + reine Funktionen, kein DOM:
 * läuft im Spiel, im Server (Validierung/Analyse) und in der Admin-Oberfläche.
 */
export const PICKUPS = ['shield', 'slow', 'clear', 'magnet', 'glide', 'boost', 'guide'] as const;
export type PickupKey = (typeof PICKUPS)[number];
export const PICKUP_LABEL: Record<PickupKey, string> = { shield: 'Impulsschild', slow: 'Zeitblase', clear: 'Spurblitz', magnet: 'Magnetfeld', glide: 'Fliegen', boost: 'Phantom-Turbo', guide: 'Pfadfinder' };
export const TIMED: readonly PickupKey[] = ['shield', 'slow', 'magnet', 'glide', 'boost', 'guide', 'clear'];
export const KINDS_LABEL = { taxi: 'Taxi', cabrio: 'Cabrio', sedan: 'Limousine', truck: 'Lkw' } as const;
export type VehicleKey = keyof typeof KINDS_LABEL;

export interface GameConfig {
  profile: 'relaxed' | 'arcade' | 'hard' | 'custom';
  tempo: { startKmh: number; maxKmh: number; distToMaxKm: number; density: number };
  traffic: { taxi: number; cabrio: number; sedan: number; truck: number; baken: boolean; barrier: boolean; minGap: number };
  pickups: {
    freq: number;
    on: Record<PickupKey, boolean>;
    share: Record<PickupKey, number>;
    dur: Record<PickupKey, number>;
    glideFirstM: number;
  };
  controls: { key: number; touch: number };
  scenery: { duskKm: number; nightKm: number; moonHighKm: number; neon: number; planes: boolean; peds: boolean; fountains: boolean };
  audio: { music: number; engine: number; sfx: number };
  /** Zeitlich begrenztes Ereignis „Flugwoche“: startet mit dem Veröffentlichen, endet nach `days` Tagen. */
  event: { on: boolean; glideBoost: number; days: number };
}

const rec = <T>(v: T): Record<PickupKey, T> => ({ shield: v, slow: v, clear: v, magnet: v, glide: v, boost: v, guide: v });

/** Standardwerte = bisheriges Spielverhalten (Profil „Arcade“). */
export const DEFAULT_CONFIG: GameConfig = {
  profile: 'arcade',
  tempo: { startKmh: 210, maxKmh: 600, distToMaxKm: 27, density: 1 },
  traffic: { taxi: 1, cabrio: 1, sedan: 1, truck: 1, baken: true, barrier: true, minGap: 0.6 },
  pickups: {
    freq: 1,
    on: rec(true),
    share: { shield: 1, slow: 1, clear: 1, magnet: 1, glide: 0.3, boost: 1, guide: 1 },
    dur: { shield: 10, slow: 7, clear: 6, magnet: 15, glide: 8, boost: 6, guide: 10 },
    glideFirstM: 550,
  },
  controls: { key: 1, touch: 1 },
  scenery: { duskKm: 15, nightKm: 20, moonHighKm: 31, neon: 1, planes: true, peds: true, fountains: true },
  audio: { music: 1, engine: 1, sfx: 1 },
  event: { on: false, glideBoost: 0.7, days: 3 },
};

/** Ursprüngliche Tempostützpunkte (Form der Kurve). */
export const BASE_KNOTS: ReadonlyArray<readonly [number, number]> = [[0, 210], [1000, 325], [2000, 370], [6000, 430], [12000, 480], [16000, 520], [20000, 550], [27000, 600]];

/** Tempostützpunkte der Konfiguration: Form der Standardkurve, gestreckt auf Start-/Höchsttempo und Strecke bis zum Maximum. */
export function knotsFor(t: GameConfig['tempo']): Array<[number, number]> {
  const [, y0] = BASE_KNOTS[0], [x1, y1] = BASE_KNOTS[BASE_KNOTS.length - 1];
  return BASE_KNOTS.map(([x, y]) => [Math.round((x / x1) * t.distToMaxKm * 1000), t.startKmh + ((y - y0) / (y1 - y0)) * (t.maxKmh - t.startKmh)] as [number, number]);
}

export const PROFILES: Record<'relaxed' | 'arcade' | 'hard', { label: string; text: string; patch: Partial<GameConfig['tempo']> & { minGap?: number } }> = {
  relaxed: { label: 'Entspannt', text: 'Langsamer Anstieg, weniger Verkehr, mehr Zeit zum Reagieren.', patch: { startKmh: 180, maxKmh: 520, distToMaxKm: 32, density: 0.8, minGap: 1 } },
  arcade: { label: 'Arcade', text: 'Das bisherige Spielgefühl.', patch: { startKmh: 210, maxKmh: 600, distToMaxKm: 27, density: 1, minGap: 0.6 } },
  hard: { label: 'Anspruchsvoll', text: 'Schneller Start, hohes Tempo früh, dichtere Begegnungen.', patch: { startKmh: 240, maxKmh: 640, distToMaxKm: 20, density: 1.25, minGap: 0.8 } },
};

export function withProfile(cfg: GameConfig, p: 'relaxed' | 'arcade' | 'hard'): GameConfig {
  const c = clone(cfg);
  const { minGap, ...tempo } = PROFILES[p].patch;
  c.tempo = { ...c.tempo, ...tempo };
  if (minGap !== undefined) c.traffic.minGap = minGap;
  c.profile = p;
  return normalize(c);
}

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ---------------------------------------------------------------- Schema (Bereiche für Validierung und Oberfläche)
export interface Field {
  path: string;
  label: string;
  unit: string;
  min: number; max: number; step: number;
  /** Anzeige: Faktor/Offset nur für die Beschriftung (z. B. Anteil → Prozent). */
  scale?: number;
  effect: string;
  group: string;
  important?: boolean;
  /** Nur sichtbar, wenn der Pfad (Schalter) aktiv ist. */
  detail?: boolean;
}

const pk = (k: PickupKey) => PICKUP_LABEL[k];
export const FIELDS: Field[] = [
  { path: 'tempo.startKmh', label: 'Starttempo', unit: 'km/h', min: 120, max: 320, step: 5, group: 'tempo', important: true, effect: 'So schnell fährt der Wagen beim Losfahren.' },
  { path: 'tempo.maxKmh', label: 'Höchstes Grundtempo', unit: 'km/h', min: 300, max: 700, step: 10, group: 'tempo', important: true, effect: 'Das Tempo, bei dem die Kurve endet und die Fahrt gleichmäßig weitergeht.' },
  { path: 'tempo.distToMaxKm', label: 'Strecke bis zum Höchsttempo', unit: 'km', min: 8, max: 45, step: 1, group: 'tempo', important: true, effect: 'Kürzere Strecke = das Spiel wird schneller schwer.' },
  { path: 'tempo.density', label: 'Begegnungsdichte', unit: '×', min: 0.6, max: 1.6, step: 0.05, group: 'tempo', important: true, effect: 'Wie dicht Ausweichstellen aufeinander folgen (1 = bisher).' },
  { path: 'traffic.minGap', label: 'Mindestabstand dichter Ausweichstellen', unit: 's', min: 0.4, max: 2.5, step: 0.05, group: 'traffic', effect: 'Kleinster zeitlicher Abstand zwischen zwei Ausweichstellen.' },
  ...(['taxi', 'cabrio', 'sedan', 'truck'] as VehicleKey[]).map((k): Field => ({ path: `traffic.${k}`, label: `Häufigkeit ${KINDS_LABEL[k]}`, unit: '×', min: 0, max: 3, step: 0.1, group: 'traffic', detail: true, effect: `Relative Häufigkeit des Typs ${KINDS_LABEL[k]} (0 = kommt nicht vor).` })),
  { path: 'pickups.freq', label: 'Power-up-Angebot gesamt', unit: '×', min: 0, max: 3, step: 0.1, group: 'pickups', important: true, effect: 'Wie oft Power-ups angeboten werden (0 = gar nicht, 1 = bisher).' },
  { path: 'pickups.glideFirstM', label: 'Fliegen: frühestes erstes Angebot', unit: 'm', min: 200, max: 4000, step: 50, group: 'pickups', effect: 'Frühestens ab dieser Strecke erscheint das erste Fliegen-Angebot.' },
  ...PICKUPS.map((k): Field => ({ path: `pickups.share.${k}`, label: `Anteil ${pk(k)}`, unit: '×', min: 0, max: 3, step: 0.1, group: 'pickups', detail: true, effect: `Relativer Anteil von ${pk(k)} am Angebot.` })),
  ...PICKUPS.map((k): Field => ({ path: `pickups.dur.${k}`, label: `Dauer ${pk(k)}`, unit: 's', min: k === 'glide' ? 4 : 3, max: 40, step: 1, group: 'pickups', detail: true, effect: `Wie lange ${pk(k)} wirkt.` })),
  { path: 'controls.key', label: 'Tastatur-Empfindlichkeit', unit: '×', min: 0.5, max: 1.5, step: 0.05, group: 'controls', important: true, effect: 'Wie schnell der Wagen auf Pfeiltasten quer zieht.' },
  { path: 'controls.touch', label: 'Touch-Empfindlichkeit', unit: '×', min: 0.5, max: 1.5, step: 0.05, group: 'controls', important: true, effect: 'Wie weit der Wagen pro Fingerweg wandert.' },
  { path: 'scenery.duskKm', label: 'Dämmerung ab', unit: 'km', min: 3, max: 30, step: 0.5, group: 'scenery', important: true, effect: 'Ab hier sinkt die Sonne, das Licht wird violett.' },
  { path: 'scenery.nightKm', label: 'Nacht ab', unit: 'km', min: 6, max: 40, step: 0.5, group: 'scenery', important: true, effect: 'Ab hier ist es Nacht; die Strip-Kulisse blendet ein.' },
  { path: 'scenery.moonHighKm', label: 'Mond hoch am Himmel ab', unit: 'km', min: 8, max: 50, step: 0.5, group: 'scenery', effect: 'Bis hier steigt der Mond auf seine höchste Position.' },
  { path: 'scenery.neon', label: 'Neon-Intensität der Strip-Kulisse', unit: '%', min: 0, max: 1, step: 0.05, scale: 100, group: 'scenery', effect: 'Sichtbarkeit der Neon-Kulisse ab der Nacht.' },
  { path: 'audio.music', label: 'Synthwave-Musik (Standard)', unit: '%', min: 0, max: 1.5, step: 0.05, scale: 100, group: 'audio', effect: 'Standardlautstärke der Musik; persönliche Stummschaltung hat Vorrang.' },
  { path: 'audio.engine', label: 'Motor (Standard)', unit: '%', min: 0, max: 1.5, step: 0.05, scale: 100, group: 'audio', effect: 'Standardlautstärke des Motors.' },
  { path: 'audio.sfx', label: 'Effekte (Standard)', unit: '%', min: 0.4, max: 1.5, step: 0.05, scale: 100, group: 'audio', effect: 'Standardpegel von Kollisions- und Power-up-Signalen (nie unter 40 %, damit sie hörbar bleiben).' },
  { path: 'event.glideBoost', label: 'Flugwoche: zusätzlicher Fliegen-Anteil', unit: '×', min: 0, max: 2, step: 0.1, group: 'event', effect: 'Wird zum Fliegen-Anteil addiert, solange das Ereignis läuft.' },
  { path: 'event.days', label: 'Flugwoche: Dauer', unit: 'Tage', min: 1, max: 7, step: 1, group: 'event', effect: 'Das Ereignis endet automatisch nach dieser Dauer.' },
];

export const FIELD_BY_PATH: Record<string, Field> = Object.fromEntries(FIELDS.map((f) => [f.path, f]));

export function getPath(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o);
}
export function setPath(o: unknown, path: string, v: unknown): void {
  const ks = path.split('.');
  let a = o as Record<string, unknown>;
  for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]] as Record<string, unknown>;
  a[ks[ks.length - 1]] = v;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

/** Füllt fehlende Felder mit Standardwerten, begrenzt Zahlen auf ihren Bereich und rundet auf die Schrittweite. Unbekannte Felder fallen weg. */
export function normalize(input: unknown): GameConfig {
  const c = clone(DEFAULT_CONFIG);
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  for (const f of FIELDS) {
    const d = getPath(DEFAULT_CONFIG, f.path) as number;
    const raw = num(getPath(src, f.path), d);
    const q = Math.round(raw / f.step) * f.step;
    setPath(c, f.path, Math.min(f.max, Math.max(f.min, Math.round(q * 1000) / 1000)));
  }
  const s = src as { traffic?: Record<string, unknown>; pickups?: { on?: Record<string, unknown> }; scenery?: Record<string, unknown>; event?: Record<string, unknown>; profile?: unknown };
  c.traffic.baken = bool(s.traffic?.baken, true);
  c.traffic.barrier = bool(s.traffic?.barrier, true);
  for (const k of PICKUPS) c.pickups.on[k] = bool(s.pickups?.on?.[k], true);
  c.scenery.planes = bool(s.scenery?.planes, true);
  c.scenery.peds = bool(s.scenery?.peds, true);
  c.scenery.fountains = bool(s.scenery?.fountains, true);
  c.event.on = bool(s.event?.on, false);
  c.profile = s.profile === 'relaxed' || s.profile === 'hard' || s.profile === 'custom' ? s.profile : 'arcade';
  return c;
}

export interface Issue { path: string; level: 'error' | 'warn'; msg: string }

/** Prüft Bereiche (Rohwerte, vor `normalize`) und Kombinationen, die ohne Analyse erkennbar sind. */
export function validate(input: unknown): Issue[] {
  const out: Issue[] = [];
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  for (const f of FIELDS) {
    const v = getPath(src, f.path);
    if (typeof v !== 'number' || !Number.isFinite(v)) out.push({ path: f.path, level: 'error', msg: 'Zahl erwartet.' });
    else if (v < f.min - 1e-9 || v > f.max + 1e-9) out.push({ path: f.path, level: 'error', msg: `Erlaubt sind ${f.min * (f.scale ?? 1)} bis ${f.max * (f.scale ?? 1)} ${f.unit}.` });
  }
  const c = normalize(src);
  if (c.tempo.maxKmh - c.tempo.startKmh < 100) out.push({ path: 'tempo.maxKmh', level: 'error', msg: 'Höchsttempo muss mindestens 100 km/h über dem Starttempo liegen.' });
  if (c.scenery.nightKm < c.scenery.duskKm + 2) out.push({ path: 'scenery.nightKm', level: 'error', msg: 'Die Nacht muss mindestens 2 km nach der Dämmerung beginnen.' });
  if (c.scenery.moonHighKm < c.scenery.nightKm) out.push({ path: 'scenery.moonHighKm', level: 'error', msg: 'Der Mond kann erst ab Nachtbeginn ganz oben stehen.' });
  const movers = c.traffic.taxi + c.traffic.cabrio + c.traffic.sedan + c.traffic.truck;
  if (movers <= 0 && !c.traffic.baken && !c.traffic.barrier) out.push({ path: 'traffic.baken', level: 'error', msg: 'Mindestens ein Hindernistyp muss aktiv sein.' });
  if (!c.pickups.on.glide && c.pickups.glideFirstM !== DEFAULT_CONFIG.pickups.glideFirstM) out.push({ path: 'pickups.glideFirstM', level: 'warn', msg: 'Fliegen ist ausgeschaltet – dieser Wert hat keine Wirkung.' });
  if (c.pickups.freq === 0) out.push({ path: 'pickups.freq', level: 'warn', msg: 'Es werden keine Power-ups angeboten.' });
  if (c.event.on && !c.pickups.on.glide) out.push({ path: 'event.glideBoost', level: 'warn', msg: 'Fliegen ist ausgeschaltet – die Flugwoche hat keine Wirkung.' });
  return out;
}

/** Bei Schwerstufen-Kombinationen ohne Profil: Beschriftung. */
export function detectProfile(c: GameConfig): GameConfig['profile'] {
  for (const p of ['relaxed', 'arcade', 'hard'] as const) {
    const t = PROFILES[p].patch;
    if (c.tempo.startKmh === t.startKmh && c.tempo.maxKmh === t.maxKmh && c.tempo.distToMaxKm === t.distToMaxKm && c.tempo.density === t.density && c.traffic.minGap === t.minGap) return p;
  }
  return 'custom';
}

// ---------------------------------------------------------------- Wirkung: Anteile
const GROUP_KINDS: Record<'fast' | 'mid' | 'slow', VehicleKey[]> = { fast: ['taxi', 'cabrio'], mid: ['sedan', 'cabrio'], slow: ['truck', 'truck', 'sedan'] };
const GROUP_BASE = { fast: 0.4, mid: 0.35, slow: 0.25 };

/** Ungefähre Verteilung der Hindernisse in Prozent (Fahrzeugtypen + Baken/Absperrung), wie sie der Generator auswürfelt. */
export function trafficShares(t: GameConfig['traffic']): Record<VehicleKey | 'baken' | 'barrier', number> {
  const w = { taxi: t.taxi, cabrio: t.cabrio, sedan: t.sedan, truck: t.truck };
  const gw = { fast: 0, mid: 0, slow: 0 };
  const out: Record<string, number> = { taxi: 0, cabrio: 0, sedan: 0, truck: 0, baken: 0, barrier: 0 };
  let gt = 0;
  for (const g of ['fast', 'mid', 'slow'] as const) { gw[g] = GROUP_BASE[g] * (GROUP_KINDS[g].reduce((a, k) => a + w[k], 0) / GROUP_KINDS[g].length); gt += gw[g]; }
  const st = (t.baken ? 1 : 0) + (t.barrier ? 1 : 0);
  const pStatic = st === 0 ? 0 : gt <= 0 ? 1 : 0.35;
  const pMove = 1 - pStatic;
  if (st) { if (t.baken) out.baken = pStatic / st; if (t.barrier) out.barrier = pStatic / st; }
  if (gt > 0) for (const g of ['fast', 'mid', 'slow'] as const) {
    const ks = GROUP_KINDS[g], tot = ks.reduce((a, k) => a + w[k], 0);
    for (const k of ks) out[k] += pMove * (gw[g] / gt) * (tot > 0 ? w[k] / tot : 1 / ks.length);
  }
  return out as Record<VehicleKey | 'baken' | 'barrier', number>;
}

/** Anteil der Typen am Power-up-Angebot (in %), inkl. Ereignis-Aufschlag für Fliegen. */
export function pickupShares(p: GameConfig['pickups'], glideBoost = 0): Record<PickupKey, number> {
  const raw = {} as Record<PickupKey, number>;
  let tot = 0;
  for (const k of PICKUPS) { raw[k] = p.on[k] ? Math.max(0, p.share[k] + (k === 'glide' ? glideBoost : 0)) : 0; tot += raw[k]; }
  for (const k of PICKUPS) raw[k] = tot > 0 ? raw[k] / tot : 0;
  return raw;
}

/** Wirksames Angebot: Fliegen-Aufschlag der Flugwoche eingerechnet, Gesamtfrequenz bleibt. */
export function effectiveGlideBoost(c: GameConfig, eventActive: boolean): number { return eventActive && c.event.on ? c.event.glideBoost : 0; }

// ---------------------------------------------------------------- Anwenden auf das Spiel
/** Schreibt die Konfiguration in BALANCE (Laufzeit). Wird am Start jedes Versuchs aufgerufen; laufende Versuche behalten ihren Stand, weil das Spiel erst vor dem Start anwendet. */
export function applyConfig(cfg: GameConfig, eventActive = false): void {
  const c = normalize(cfg);
  const B = BALANCE as unknown as Record<string, any>;
  const knots = knotsFor(c.tempo);
  B.speed.knots = knots;
  setSpeedKnots(knots);
  B.gen.gapScale = c.tempo.density;
  B.gen.minGap = c.traffic.minGap;
  B.traffic.weights.taxi = c.traffic.taxi; B.traffic.weights.cabrio = c.traffic.cabrio; B.traffic.weights.sedan = c.traffic.sedan; B.traffic.weights.truck = c.traffic.truck;
  B.traffic.baken = c.traffic.baken; B.traffic.barrier = c.traffic.barrier;
  B.pickups.freq = c.pickups.freq;
  for (const k of PICKUPS) { B.pickups.on[k] = c.pickups.on[k]; B.pickups.share[k] = c.pickups.share[k]; }
  B.pickups.glideBoost = effectiveGlideBoost(c, eventActive);
  B.glide.firstFrom = c.pickups.glideFirstM;
  B.effects.shield = c.pickups.dur.shield; B.effects.slow = c.pickups.dur.slow; B.effects.blitz = c.pickups.dur.clear;
  B.effects.magnet = c.pickups.dur.magnet; B.effects.glide = c.pickups.dur.glide; B.effects.boost = c.pickups.dur.boost; B.effects.guide = c.pickups.dur.guide;
  B.steer.sens.key = c.controls.key; B.steer.sens.touch = c.controls.touch;
  const sc = B.scenery;
  const dusk = c.scenery.duskKm * 1000, night = c.scenery.nightKm * 1000;
  sc.keys[0] = 0; sc.keys[1] = dusk; sc.keys[2] = Math.round(dusk + 0.4 * (night - dusk)); sc.keys[3] = night;
  sc.moonFrom = Math.max(dusk, night - 2500);
  sc.moonSpan = Math.max(2000, c.scenery.moonHighKm * 1000 - sc.moonFrom);
  sc.neon = c.scenery.neon; sc.planes = c.scenery.planes; sc.peds = c.scenery.peds; sc.fountains = c.scenery.fountains;
  B.audio.music = c.audio.music; B.audio.engine = c.audio.engine; B.audio.sfx = c.audio.sfx;
}

/** Eingebaute Standardwerte anwenden (Spielstart ohne erreichbare Konfiguration). */
export function applyDefaults(): void { applyConfig(DEFAULT_CONFIG, false); }

/** Zusammenfassung der Unterschiede zweier Konfigurationen (für „Änderungen vor dem Veröffentlichen“). */
export interface Diff { path: string; label: string; from: string; to: string }
export function diffConfigs(a: GameConfig, b: GameConfig): Diff[] {
  const out: Diff[] = [];
  const fmt = (f: Field | undefined, v: unknown): string => (typeof v === 'boolean' ? (v ? 'an' : 'aus') : f ? `${Math.round(Number(v) * (f.scale ?? 1) * 100) / 100} ${f.unit}` : String(v));
  for (const f of FIELDS) {
    const x = getPath(a, f.path), y = getPath(b, f.path);
    if (x !== y) out.push({ path: f.path, label: f.label, from: fmt(f, x), to: fmt(f, y) });
  }
  const sw: Array<[string, string]> = [['traffic.baken', 'Baken'], ['traffic.barrier', 'Absperrung'], ['scenery.planes', 'Flugzeuge'], ['scenery.peds', 'Fußgänger'], ['scenery.fountains', 'Brunnen'], ['event.on', 'Flugwoche'], ...PICKUPS.map((k): [string, string] => [`pickups.on.${k}`, pk(k)])];
  for (const [p, label] of sw) { const x = getPath(a, p), y = getPath(b, p); if (x !== y) out.push({ path: p, label, from: fmt(undefined, x), to: fmt(undefined, y) }); }
  return out;
}

/** Zuordnung Anzeigewert ↔ Rohwert für Eingabefelder. */
export const toDisplay = (f: Field, v: number): number => Math.round(v * (f.scale ?? 1) * 1000) / 1000;
export const fromDisplay = (f: Field, v: number): number => v / (f.scale ?? 1);
