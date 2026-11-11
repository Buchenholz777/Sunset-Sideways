/**
 * Datenbank-Schicht, asynchron und für zwei Backends gedacht: Cloudflare D1 (Produktion) und node:sqlite (lokal/Tests, siehe sqlite.ts).
 * Dieses Modul darf keine Node-Importe enthalten, weil es in Cloudflare Pages Functions läuft.
 */
export interface Db {
  all<T = Record<string, unknown>>(sql: string, ...args: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, ...args: unknown[]): Promise<T | undefined>;
  run(sql: string, ...args: unknown[]): Promise<{ changes: number; lastId: number }>;
  /** Mehrere Anweisungen atomar; liefert je Anweisung die Zahl geänderter Zeilen. */
  batch(stmts: Array<[string, ...unknown[]]>): Promise<number[]>;
}

// ---- Minimal-Typen für D1 (kein @cloudflare/workers-types nötig)
interface D1Stmt { bind(...a: unknown[]): D1Stmt; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<{ meta: { changes: number; last_row_id: number } }> }
export interface D1Like { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<Array<{ meta: { changes: number } }>> }

export function d1Db(d1: D1Like): Db {
  const st = (sql: string, args: unknown[]): D1Stmt => d1.prepare(sql).bind(...args);
  return {
    async all<T>(sql: string, ...args: unknown[]) { return (await st(sql, args).all<T>()).results; },
    async get<T>(sql: string, ...args: unknown[]) { return (await st(sql, args).first<T>()) ?? undefined; },
    async run(sql: string, ...args: unknown[]) { const r = await st(sql, args).run(); return { changes: r.meta.changes, lastId: r.meta.last_row_id }; },
    async batch(stmts) { return (await d1.batch(stmts.map(([sql, ...a]) => st(sql, a)))).map((r) => r.meta.changes); },
  };
}

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK (id = 1), pw_hash TEXT NOT NULL, env_fp TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, pwfp TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, ua TEXT)`,
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS config_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, config TEXT NOT NULL, label TEXT, published_at INTEGER NOT NULL, event_start INTEGER, event_end INTEGER)`,
  `CREATE TABLE IF NOT EXISTS visits (visit TEXT PRIMARY KEY, ts INTEGER NOT NULL, dev TEXT NOT NULL, ver TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS visits_ts ON visits (ts)`,
  `CREATE TABLE IF NOT EXISTS runs (run TEXT PRIMARY KEY, visit TEXT NOT NULL, ts INTEGER NOT NULL, dev TEXT NOT NULL, ver TEXT NOT NULL, cfg TEXT NOT NULL, ev TEXT, miles INTEGER NOT NULL DEFAULT 0, end_ts INTEGER, end_dist INTEGER, end_reason TEXT, cause TEXT)`,
  `CREATE INDEX IF NOT EXISTS runs_ts ON runs (ts)`,
  `CREATE INDEX IF NOT EXISTS runs_visit ON runs (visit)`,
  `CREATE TABLE IF NOT EXISTS pickups (run TEXT NOT NULL, k TEXT NOT NULL, type TEXT NOT NULL, seen_s INTEGER NOT NULL, taken INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL, PRIMARY KEY (run, k))`,
  `CREATE INDEX IF NOT EXISTS pickups_ts ON pickups (ts)`,
  `CREATE TABLE IF NOT EXISTS attempts (k TEXT NOT NULL, ts INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS attempts_k ON attempts (k, ts)`,
];

const ready = new WeakSet<object>();
/** Legt fehlende Tabellen an (einmal je Instanz); so braucht die Einrichtung in Cloudflare keine Migrations-Befehle. */
export async function ensureSchema(db: Db, key: object): Promise<void> {
  if (ready.has(key)) return;
  await db.batch(SCHEMA.map((s) => [s] as [string]));
  ready.add(key);
}

export const kvGet = async (db: Db, key: string): Promise<string | null> => (await db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key))?.value ?? null;
export const kvSet = async (db: Db, key: string, value: string): Promise<void> => { await db.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value); };
export const kvDel = async (db: Db, key: string): Promise<void> => { await db.run('DELETE FROM kv WHERE key = ?', key); };

/** Rohdaten älter als `days` Tage löschen (Standard 30). */
export async function purge(db: Db, now: number, days: number): Promise<void> {
  const cutoff = now - days * 86400_000;
  await db.batch([
    ['DELETE FROM pickups WHERE run IN (SELECT run FROM runs WHERE ts < ?)', cutoff],
    ['DELETE FROM runs WHERE ts < ?', cutoff],
    ['DELETE FROM visits WHERE ts < ?', cutoff],
    ['DELETE FROM sessions WHERE expires_at < ? OR revoked = 1', now - 86400_000],
    ['DELETE FROM attempts WHERE ts < ?', now - 86400_000],
  ]);
}
