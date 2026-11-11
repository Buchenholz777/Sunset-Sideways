import { DEFAULT_CONFIG, clone, diffConfigs, normalize, validate, type GameConfig, type Issue } from '../src/config/runtime';
import { analyze, type Analysis } from '../src/config/analyze';
import { kvGet, kvSet, type Db } from './db';

export interface Version {
  id: number; label: string | null; publishedAt: number;
  eventStart: number | null; eventEnd: number | null;
  config: GameConfig;
}

interface Row { id: number; label: string | null; published_at: number; event_start: number | null; event_end: number | null; config: string }
const rowToVersion = (r: Row): Version => ({ id: r.id, label: r.label, publishedAt: r.published_at, eventStart: r.event_start, eventEnd: r.event_end, config: normalize(JSON.parse(r.config)) });

export async function listVersions(db: Db, limit = 50): Promise<Version[]> {
  return (await db.all<Row>('SELECT * FROM config_versions ORDER BY id DESC LIMIT ?', limit)).map(rowToVersion);
}
export async function getVersion(db: Db, id: number): Promise<Version | null> {
  const r = await db.get<Row>('SELECT * FROM config_versions WHERE id = ?', id);
  return r ? rowToVersion(r) : null;
}
export async function currentVersion(db: Db): Promise<Version | null> {
  const id = await kvGet(db, 'current_version');
  return id ? getVersion(db, Number(id)) : null;
}

export async function getDraft(db: Db): Promise<GameConfig> {
  const raw = await kvGet(db, 'draft');
  if (raw) return normalize(JSON.parse(raw));
  return clone((await currentVersion(db))?.config ?? DEFAULT_CONFIG);
}
export async function saveDraft(db: Db, cfg: unknown): Promise<GameConfig> {
  const n = normalize(cfg);
  await kvSet(db, 'draft', JSON.stringify(n));
  return n;
}

/** Ereignisfenster einer Version zum Zeitpunkt `now` (nur solange es läuft). */
export function activeEvent(v: Version | null, now: number): { id: string; endsAt: number } | null {
  if (!v || !v.config.event.on || v.eventEnd === null || v.eventStart === null || now >= v.eventEnd || now < v.eventStart) return null;
  return { id: `flugwoche-${v.eventStart}`, endsAt: v.eventEnd };
}

/** Öffentliche Antwort für das Spiel: veröffentlichte Version, ohne Entwurf. */
export async function publicConfig(db: Db, now: number): Promise<{ id: string; config: GameConfig; event: { id: string; endsAt: number } | null }> {
  const v = await currentVersion(db);
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

export async function publish(db: Db, now: number, label: string | null): Promise<{ ok: true; version: Version } | { ok: false; blocking: Issue[] }> {
  const draft = await getDraft(db);
  const c = check(draft);
  if (c.blocking.length) return { ok: false, blocking: c.blocking };
  const prev = await currentVersion(db);
  let evStart: number | null = null, evEnd: number | null = null;
  if (draft.event.on) {
    const same = prev && prev.config.event.on && activeEvent(prev, now) && prev.config.event.glideBoost === draft.event.glideBoost && prev.config.event.days === draft.event.days;
    if (same && prev) { evStart = prev.eventStart; evEnd = prev.eventEnd; }                  // laufendes Ereignis wird durch andere Änderungen nicht neu gestartet
    else { evStart = now; evEnd = now + draft.event.days * 86400_000; }
  }
  const r = await db.run('INSERT INTO config_versions (config, label, published_at, event_start, event_end) VALUES (?, ?, ?, ?, ?)', JSON.stringify(draft), label ? label.slice(0, 80) : null, now, evStart, evEnd);
  await kvSet(db, 'current_version', String(r.lastId));
  return { ok: true, version: (await getVersion(db, r.lastId))! };
}

export async function draftDiff(db: Db) { return diffConfigs((await currentVersion(db))?.config ?? DEFAULT_CONFIG, await getDraft(db)); }
export async function isDirty(db: Db): Promise<boolean> { return (await draftDiff(db)).length > 0; }
