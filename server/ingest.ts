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
 * Alle Schreibzugriffe sind idempotent und laufen als ein atomarer Stapel (D1-tauglich, ohne Lesen zwischen den Schritten):
 * Start/Streckenmarke/Pickup ändern bei Wiederholung nichts, ein Ende zählt nur einmal.
 */
export async function ingest(db: Db, body: unknown, now: number): Promise<IngestResult> {
  const res: IngestResult = { accepted: 0, ignored: 0 };
  if (!body || typeof body !== 'object') return res;
  const b = body as { v?: unknown; ver?: unknown; dev?: unknown; events?: unknown };
  if (typeof b.v !== 'string' || !HEX.test(b.v) || !Array.isArray(b.events)) return res;
  const dev = typeof b.dev === 'string' && DEVS.has(b.dev) ? b.dev : 'desktop';
  const ver = typeof b.ver === 'string' && /^[\w.+-]{1,24}$/.test(b.ver) ? b.ver : 'unbekannt';
  const visit = b.v;
  const events = b.events.slice(0, MAX_EVENTS);

  // Bekannte Konfigurationsversionen (eine Abfrage für alle Start-Ereignisse)
  const wanted = new Set<string>();
  for (const e of events) { const d = (e as { t?: unknown; d?: { cfg?: unknown } } | null)?.d; if ((e as { t?: unknown } | null)?.t === 'start' && typeof d?.cfg === 'string' && /^\d{1,9}$/.test(d.cfg)) wanted.add(d.cfg); }
  const known = new Set<string>(['builtin']);
  if (wanted.size) for (const r of await db.all<{ id: number }>(`SELECT id FROM config_versions WHERE id IN (${[...wanted].map(() => '?').join(',')})`, ...[...wanted].map(Number))) known.add(String(r.id));

  const stmts: Array<[string, ...unknown[]]> = [['INSERT OR IGNORE INTO visits (visit, ts, dev, ver) VALUES (?, ?, ?, ?)', visit, now, dev, ver]];
  const counted: boolean[] = [];                    // je Ereignis: Index der Anweisung, deren Änderungszahl zählt (-1 = nur validiert)
  const at: number[] = [];
  const add = (s: [string, ...unknown[]] | null): void => { if (s) { at.push(stmts.length); stmts.push(s); } else at.push(-1); counted.push(true); };

  for (const raw of events) {
    if (!raw || typeof raw !== 'object') { at.push(-2); counted.push(false); continue; }
    const e = raw as { t?: unknown; r?: unknown; k?: unknown; d?: unknown };
    const d = (e.d && typeof e.d === 'object' ? e.d : {}) as Record<string, unknown>;
    const run = typeof e.r === 'string' && HEX.test(e.r) ? e.r : null;
    switch (e.t) {
      case 'view': add(null); break;
      case 'start': {
        const cfg = typeof d.cfg === 'string' && known.has(d.cfg) ? d.cfg : 'builtin';
        const ev = typeof d.ev === 'string' && /^[\w-]{1,40}$/.test(d.ev) ? d.ev : null;
        add(run ? ['INSERT OR IGNORE INTO runs (run, visit, ts, dev, ver, cfg, ev) VALUES (?, ?, ?, ?, ?, ?, ?)', run, visit, now, dev, ver, cfg, ev] : null);
        if (!run) at[at.length - 1] = -2;
        break;
      }
      case 'mile': {
        const i = typeof e.k === 'string' ? MILES.indexOf(Number(e.k)) : -1;
        if (run && i >= 0) add(['UPDATE runs SET miles = miles | ? WHERE run = ? AND visit = ?', 1 << i, run, visit]); else { at.push(-2); counted.push(false); }
        break;
      }
      case 'seen':
      case 'taken': {
        const key = typeof e.k === 'string' && /^[\w@#.-]{1,30}$/.test(e.k) ? e.k : null;
        const type = typeof d.type === 'string' && TYPES.has(d.type) ? d.type : null;
        const s = int(d.s, 0, 5_000_000);
        if (run && key && type && s !== null) {
          // nur für Läufe dieses Besuchs und bis zur Obergrenze je Lauf; „eingesammelt“ setzt zugleich „sichtbar“
          add([`INSERT OR IGNORE INTO pickups (run, k, type, seen_s, taken, ts) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM runs WHERE run = ? AND visit = ?) AND (SELECT COUNT(*) FROM pickups WHERE run = ?) < ${MAX_PICKUPS_PER_RUN}`, run, key, type, s, e.t === 'taken' ? 1 : 0, now, run, visit, run]);
          if (e.t === 'taken') { stmts.push(['UPDATE pickups SET taken = 1 WHERE run = ? AND k = ? AND taken = 0 AND EXISTS (SELECT 1 FROM runs WHERE run = ? AND visit = ?)', run, key, run, visit]); }
        } else { at.push(-2); counted.push(false); }
        break;
      }
      case 'end': {
        const dist = int(d.dist, 0, 5_000_000);
        const reason = typeof d.reason === 'string' && REASONS.has(d.reason) ? d.reason : null;
        const cause = typeof d.cause === 'string' && CAUSES.has(d.cause) ? d.cause : null;
        if (run && dist !== null && reason) add(['UPDATE runs SET end_ts = ?, end_dist = ?, end_reason = ?, cause = ? WHERE run = ? AND visit = ? AND end_ts IS NULL', now, dist, reason, cause, run, visit]); else { at.push(-2); counted.push(false); }
        break;
      }
      default: at.push(-2); counted.push(false);
    }
  }
  const changes = await db.batch(stmts);
  for (const i of at) { if (i === -2) res.ignored++; else if (i === -1) res.accepted++; else if (changes[i] > 0) res.accepted++; else res.ignored++; }
  void counted;
  return res;
}
