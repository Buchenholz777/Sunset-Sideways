import { DEFAULT_CONFIG, clone, diffConfigs, normalize, validate, type GameConfig, type Issue } from '../src/config/runtime';
import { analyze, type Analysis } from '../src/config/analyze';
import { kvGet, kvSet, type Db } from './db';

export interface Version {
  id: number; label: string | null; publishedAt: number;
  eventStart: number | null; eventEnd: number | null;
  config: GameConfig;
}

const rowToVersion = (r: { id: number; label: string | null; published_at: number; event_start: number | null; event_end: number | null; config: string }): Version => ({
  id: r.id, label: r.label, publishedAt: r.published_at, eventStart: r.event_start, eventEnd: r.event_end, config: normalize(JSON.parse(r.config)),
});

export function listVersions(db: Db, limit = 50): Version[] {
  return (db.prepare('SELECT * FROM config_versions ORDER BY id DESC LIMIT ?').all(limit) as never[]).map(rowToVersion);
}
export function getVersion(db: Db, id: number): Version | null {
  const r = db.prepare('SELECT * FROM config_versions WHERE id = ?').get(id) as never;
  return r ? rowToVersion(r) : null;
}
export function currentVersion(db: Db): Version | null {
  const id = kvGet(db, 'current_version');
  return id ? getVersion(db, Number(id)) : null;
}

export function getDraft(db: Db): GameConfig {
  const raw = kvGet(db, 'draft');
  if (raw) return normalize(JSON.parse(raw));
  return clone(currentVersion(db)?.config ?? DEFAULT_CONFIG);
}
export function saveDraft(db: Db, cfg: unknown): GameConfig {
  const n = normalize(cfg);
  kvSet(db, 'draft', JSON.stringify(n));
  return n;
}

/** Ereignisfenster einer Version zum Zeitpunkt `now` (nur solange es läuft). */
export function activeEvent(v: Version | null, now: number): { id: string; endsAt: number } | null {
  if (!v || !v.config.event.on || v.eventEnd === null || v.eventStart === null || now >= v.eventEnd || now < v.eventStart) return null;
  return { id: `flugwoche-${v.eventStart}`, endsAt: v.eventEnd };
}

/** Öffentliche Antwort für das Spiel: veröffentlichte Version, ohne Entwurf. */
export function publicConfig(db: Db, now: number): { id: string; config: GameConfig; event: { id: string; endsAt: number } | null } {
  const v = currentVersion(db);
  if (!v) return { id: 'builtin', config: DEFAULT_CONFIG, event: null };
  return { id: String(v.id), config: v.config, event: activeEvent(v, now) };
}

export interface Checked { issues: Issue[]; analysis: Analysis; blocking: Issue[] }
/** Bereichs-, Kombinations- und Generatorprüfung. Fehler (level 'error') blockieren das Veröffentlichen. */
export function check(cfg: unknown): Checked {
  const issues = validate(cfg);
  const analysis = analyze(cfg);
  const all = [...issues, ...analysis.issues];
  return { issues: all, analysis, blocking: all.filter((i) => i.level === 'error') };
}

export function publish(db: Db, now: number, label: string | null): { ok: true; version: Version } | { ok: false; blocking: Issue[] } {
  const draft = getDraft(db);
  const c = check(draft);
  if (c.blocking.length) return { ok: false, blocking: c.blocking };
  const prev = currentVersion(db);
  let evStart: number | null = null, evEnd: number | null = null;
  if (draft.event.on) {
    const same = prev && prev.config.event.on && activeEvent(prev, now) && prev.config.event.glideBoost === draft.event.glideBoost && prev.config.event.days === draft.event.days;
    if (same && prev) { evStart = prev.eventStart; evEnd = prev.eventEnd; }                  // laufendes Ereignis wird durch andere Änderungen nicht neu gestartet
    else { evStart = now; evEnd = now + draft.event.days * 86400_000; }
  }
  const r = db.prepare('INSERT INTO config_versions (config, label, published_at, event_start, event_end) VALUES (?, ?, ?, ?, ?)').run(JSON.stringify(draft), label ? label.slice(0, 80) : null, now, evStart, evEnd);
  kvSet(db, 'current_version', String(r.lastInsertRowid));
  return { ok: true, version: getVersion(db, Number(r.lastInsertRowid))! };
}

export function isDirty(db: Db): boolean {
  const cur = currentVersion(db)?.config ?? DEFAULT_CONFIG;
  return diffConfigs(cur, getDraft(db)).length > 0;
}
export function draftDiff(db: Db) { return diffConfigs(currentVersion(db)?.config ?? DEFAULT_CONFIG, getDraft(db)); }
