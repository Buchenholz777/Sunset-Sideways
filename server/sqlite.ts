import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Db } from './db';

/** node:sqlite-Backend mit derselben asynchronen Schnittstelle wie D1 – für lokale Entwicklung, Tests und die Abnahme. */
export function sqliteDb(path: string): Db & { close(): void } {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 4000;');
  const norm = (a: unknown[]) => a.map((x) => (x === undefined ? null : x)) as Array<string | number | null>;
  return {
    async all<T>(sql: string, ...args: unknown[]) { return db.prepare(sql).all(...norm(args)) as T[]; },
    async get<T>(sql: string, ...args: unknown[]) { return db.prepare(sql).get(...norm(args)) as T | undefined; },
    async run(sql: string, ...args: unknown[]) { const r = db.prepare(sql).run(...norm(args)); return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) }; },
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = stmts.map(([sql, ...a]) => Number(db.prepare(sql).run(...norm(a)).changes));
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    close() { db.close(); },
  };
}
