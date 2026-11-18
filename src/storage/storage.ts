const KEY = 'sunset-sideways:v1';
/** Alter Schlüssel (Glimmer Mile): wird gelesen und migriert, nie überschrieben oder gelöscht. */
const OLD_KEY = 'glimmer-mile:v1';

export interface Saved {
  best: number; muted: boolean;
  /** Erstes Hindernis schon einmal erfolgreich umfahren (Hinweis entfällt). */ dodged: boolean;
  /** Sunset Sprint: weiteste Sprintstrecke (m, Ziel = Zielstrecke) und Anzahl erreichter Ziele; eigener Schlüssel, nie mit der Endless-Bestweite vermischt. */
  sprintBest: number; sprintDone: number;
  /**
   * Stil-Rekord (P1): höchste Stilpunktzahl eines Laufs (Near Miss, Combo, Neon Rush). Eigenes Feld, getrennt von der Bestweite (`best`, Meter): alte
   * Speicherstände ohne dieses Feld laden mit 0, die Bestweite wird nie als Stil-Rekord gelesen und umgekehrt.
   */
  styleBest: number;
}
const DEFAULTS: Saved = { best: 0, muted: false, dodged: false, sprintBest: 0, sprintDone: 0, styleBest: 0 };

let memory: Saved = { ...DEFAULTS };

/** Validiert gelesene Werte; fällt bei Fehlern auf Standardwerte zurück. */
export function parseSaved(raw: string | null): Saved {
  if (!raw) return { ...DEFAULTS };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o.v !== 1) return { ...DEFAULTS };
    const best = typeof o.best === 'number' && Number.isFinite(o.best) && o.best >= 0 ? Math.floor(o.best) : 0;
    const nat = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return { best, muted: o.muted === true, dodged: o.dodged === true, sprintBest: nat(o.sprintBest), sprintDone: nat(o.sprintDone), styleBest: nat(o.styleBest) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function load(): Saved {
  try {
    let raw = localStorage.getItem(KEY);
    if (raw === null) {
      raw = localStorage.getItem(OLD_KEY);
      if (raw !== null) { try { localStorage.setItem(KEY, raw); } catch { /* gesperrt */ } }
    }
    memory = parseSaved(raw);
  } catch {
    /* gesperrt: Sitzungswerte behalten */
  }
  return { ...memory };
}

export function save(patch: Partial<Saved>): Saved {
  memory = { ...memory, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, ...memory }));
  } catch {
    /* gesperrt: nur Sitzung */
  }
  return { ...memory };
}
