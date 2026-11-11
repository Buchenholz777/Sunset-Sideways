import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE admin (id INTEGER PRIMARY KEY CHECK (id = 1), pw_hash TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,            -- SHA-256 des Cookie-Tokens (das Token selbst wird nie gespeichert)
    csrf TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    ua TEXT
  );
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE config_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config TEXT NOT NULL,
    label TEXT,
    published_at INTEGER NOT NULL,
    event_start INTEGER,
    event_end INTEGER
  );
  CREATE TABLE visits (visit TEXT PRIMARY KEY, ts INTEGER NOT NULL, dev TEXT NOT NULL, ver TEXT NOT NULL);
  CREATE INDEX visits_ts ON visits (ts);
  CREATE TABLE runs (
    run TEXT PRIMARY KEY, visit TEXT NOT NULL, ts INTEGER NOT NULL, dev TEXT NOT NULL, ver TEXT NOT NULL,
    cfg TEXT NOT NULL, ev TEXT, miles INTEGER NOT NULL DEFAULT 0,
    end_ts INTEGER, end_dist INTEGER, end_reason TEXT, cause TEXT
  );
  CREATE INDEX runs_ts ON runs (ts);
  CREATE INDEX runs_visit ON runs (visit);
  CREATE TABLE pickups (
    run TEXT NOT NULL, k TEXT NOT NULL, type TEXT NOT NULL, seen_s INTEGER NOT NULL, taken INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL,
    PRIMARY KEY (run, k)
  );
  CREATE INDEX pickups_ts ON pickups (ts);
  `,
];

/** Öffnet (und migriert) die SQLite-Datenbank. `:memory:` ist für Tests erlaubt. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 4000;');
  const cur = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = cur; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}

export const kvGet = (db: Db, key: string): string | null => {
  const r = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return r ? r.value : null;
};
export const kvSet = (db: Db, key: string, value: string): void => { db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value); };
export const kvDel = (db: Db, key: string): void => { db.prepare('DELETE FROM kv WHERE key = ?').run(key); };

/** Rohdaten älter als `days` Tage löschen (Standard 30). */
export function purge(db: Db, now: number, days: number): { runs: number; visits: number } {
  const cutoff = now - days * 86400_000;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM pickups WHERE run IN (SELECT run FROM runs WHERE ts < ?)').run(cutoff);
    const r = db.prepare('DELETE FROM runs WHERE ts < ?').run(cutoff);
    const v = db.prepare('DELETE FROM visits WHERE ts < ?').run(cutoff);
    db.prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked = 1').run(now - 86400_000);
    db.exec('COMMIT');
    return { runs: Number(r.changes), visits: Number(v.changes) };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
