import type { Db } from './db';

const HEX = /^[0-9a-f]{8,32}$/;
const DEVS = new Set(['phone', 'tablet', 'desktop']);
const MILES = [1000, 5000, 15000, 20000, 27000];
const TYPES = new Set(['shield', 'slow', 'clear', 'magnet', 'glide', 'boost', 'guide']);
const CAUSES = new Set(['taxi', 'cabrio', 'sedan', 'truck', 'baken', 'barrier']);
const REASONS = new Set(['crash', 'restart', 'leave']);

export const MAX_BODY = 32 * 1024;
export const MAX_EVENTS = 50;
const MAX_PICKUPS_PER_RUN = 60;

export interface IngestResult { accepted: number; ignored: number }

const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.floor(v) : null);

/**
 * Nimmt gebündelte Spielereignisse an. Alles wird geprüft und gekürzt; Unbekanntes wird verworfen.
 * Doppelte Meldungen ändern nichts: Start/Streckenmarke/Pickup sind idempotent, ein Ende zählt nur einmal.
 */
export function ingest(db: Db, body: unknown, now: number): IngestResult {
  const res: IngestResult = { accepted: 0, ignored: 0 };
  if (!body || typeof body !== 'object') return res;
  const b = body as { v?: unknown; ver?: unknown; dev?: unknown; events?: unknown };
  if (typeof b.v !== 'string' || !HEX.test(b.v) || !Array.isArray(b.events)) return res;
  const dev = typeof b.dev === 'string' && DEVS.has(b.dev) ? b.dev : 'desktop';
  const ver = typeof b.ver === 'string' && /^[\w.+-]{1,24}$/.test(b.ver) ? b.ver : 'unbekannt';
  const visit = b.v;
  db.prepare('INSERT OR IGNORE INTO visits (visit, ts, dev, ver) VALUES (?, ?, ?, ?)').run(visit, now, dev, ver);
  const knownCfg = (id: string): boolean => id === 'builtin' || (/^\d{1,9}$/.test(id) && !!db.prepare('SELECT 1 FROM config_versions WHERE id = ?').get(Number(id)));
  db.exec('BEGIN');
  try {
    for (const raw of b.events.slice(0, MAX_EVENTS)) {
      if (!raw || typeof raw !== 'object') { res.ignored++; continue; }
      const e = raw as { t?: unknown; r?: unknown; k?: unknown; d?: unknown };
      const d = (e.d && typeof e.d === 'object' ? e.d : {}) as Record<string, unknown>;
      const run = typeof e.r === 'string' && HEX.test(e.r) ? e.r : null;
      let ok = false;
      switch (e.t) {
        case 'view': ok = true; break;
        case 'start': {
          const cfg = typeof d.cfg === 'string' && knownCfg(d.cfg) ? d.cfg : 'builtin';
          const ev = typeof d.ev === 'string' && /^[\w-]{1,40}$/.test(d.ev) ? d.ev : null;
          if (run) { ok = Number(db.prepare('INSERT OR IGNORE INTO runs (run, visit, ts, dev, ver, cfg, ev) VALUES (?, ?, ?, ?, ?, ?, ?)').run(run, visit, now, dev, ver, cfg, ev).changes) > 0; }
          break;
        }
        case 'mile': {
          const i = typeof e.k === 'string' ? MILES.indexOf(Number(e.k)) : -1;
          if (run && i >= 0) ok = Number(db.prepare('UPDATE runs SET miles = miles | ? WHERE run = ? AND visit = ?').run(1 << i, run, visit).changes) > 0;
          break;
        }
        case 'seen':
        case 'taken': {
          const key = typeof e.k === 'string' && /^[\w@#.-]{1,30}$/.test(e.k) ? e.k : null;
          const type = typeof d.type === 'string' && TYPES.has(d.type) ? d.type : null;
          const s = int(d.s, 0, 5_000_000);
          if (run && key && type && s !== null && db.prepare('SELECT 1 FROM runs WHERE run = ? AND visit = ?').get(run, visit)) {
            const n = (db.prepare('SELECT COUNT(*) AS n FROM pickups WHERE run = ?').get(run) as { n: number }).n;
            const have = db.prepare('SELECT taken FROM pickups WHERE run = ? AND k = ?').get(run, key) as { taken: number } | undefined;
            if (!have && n >= MAX_PICKUPS_PER_RUN) break;
            if (e.t === 'seen') { if (!have) { db.prepare('INSERT INTO pickups (run, k, type, seen_s, taken, ts) VALUES (?, ?, ?, ?, 0, ?)').run(run, key, type, s, now); ok = true; } }
            else if (!have) { db.prepare('INSERT INTO pickups (run, k, type, seen_s, taken, ts) VALUES (?, ?, ?, ?, 1, ?)').run(run, key, type, s, now); ok = true; }   // eingesammelt ⇒ war sichtbar
            else if (!have.taken) { db.prepare('UPDATE pickups SET taken = 1 WHERE run = ? AND k = ?').run(run, key); ok = true; }
          }
          break;
        }
        case 'end': {
          const dist = int(d.dist, 0, 5_000_000);
          const reason = typeof d.reason === 'string' && REASONS.has(d.reason) ? d.reason : null;
          const cause = typeof d.cause === 'string' && CAUSES.has(d.cause) ? d.cause : null;
          if (run && dist !== null && reason) ok = Number(db.prepare('UPDATE runs SET end_ts = ?, end_dist = ?, end_reason = ?, cause = ? WHERE run = ? AND visit = ? AND end_ts IS NULL').run(now, dist, reason, cause, run, visit).changes) > 0;
          break;
        }
      }
      if (ok) res.accepted++; else res.ignored++;
    }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return res;
}
