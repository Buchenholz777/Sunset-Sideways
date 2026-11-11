const KEY = 'sunset-sideways:v1';
/** Alter Schlüssel (Glimmer Mile): wird gelesen und migriert, nie überschrieben oder gelöscht. */
const OLD_KEY = 'glimmer-mile:v1';

export interface Saved { best: number; muted: boolean }
const DEFAULTS: Saved = { best: 0, muted: false };

let memory: Saved = { ...DEFAULTS };

/** Validiert gelesene Werte; fällt bei Fehlern auf Standardwerte zurück. */
export function parseSaved(raw: string | null): Saved {
  if (!raw) return { ...DEFAULTS };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o.v !== 1) return { ...DEFAULTS };
    const best = typeof o.best === 'number' && Number.isFinite(o.best) && o.best >= 0 ? Math.floor(o.best) : 0;
    return { best, muted: o.muted === true };
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
