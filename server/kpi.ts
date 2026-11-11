import type { Db } from './db';

export const REACH = [1000, 5000, 15000, 20000, 27000] as const;
export type Period = '24h' | '7d' | '30d';
export const PERIOD_MS: Record<Period, number> = { '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 };

export interface Filter {
  from: number; to: number;
  dev?: string | null; ver?: string | null;
  /** 'event' = nur Läufe während einer Flugwoche, 'regular' = nur ohne Ereignis. */
  ev?: 'all' | 'event' | 'regular';
  cfg?: string | null;
}

export interface Pct { num: number; den: number; value: number | null }
const pct = (num: number, den: number): Pct => ({ num, den, value: den > 0 ? num / den : null });

function runWhere(f: Filter, alias = 'r'): { sql: string; args: (string | number)[] } {
  const a: (string | number)[] = [f.from, f.to];
  let sql = `${alias}.ts >= ? AND ${alias}.ts < ?`;
  if (f.dev) { sql += ` AND ${alias}.dev = ?`; a.push(f.dev); }
  if (f.ver) { sql += ` AND ${alias}.ver = ?`; a.push(f.ver); }
  if (f.ev === 'event') sql += ` AND ${alias}.ev IS NOT NULL`;
  if (f.ev === 'regular') sql += ` AND ${alias}.ev IS NULL`;
  if (f.cfg) { sql += ` AND ${alias}.cfg = ?`; a.push(f.cfg); }
  return { sql, args: a };
}

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
/** Perzentil nach „nearest rank“: kleinster Wert, unter dem mindestens p % der Werte liegen oder gleich sind. */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export interface RunMetrics {
  runs: number;
  eventRuns: number;
  repeat: Pct;
  withEnd: number;
  noEnd: number;
  dist: { median: number | null; p90: number | null; n: number };
  reach: Array<{ at: number; count: number; share: number | null }>;
  crash: { n: number; bins: Array<{ from: number; to: number | null; count: number }>; causes: Array<{ cause: string; count: number }>; byReason: Record<string, number> };
  pickups: Array<{ type: string; seen: number; taken: number; rate: number | null }>;
  glideFirst: { median: number | null; n: number };
}

export function runMetrics(db: Db, f: Filter): RunMetrics {
  const w = runWhere(f);
  const runs = db.prepare(`SELECT r.run, r.visit, r.ev, r.miles, r.end_ts, r.end_dist, r.end_reason, r.cause FROM runs r WHERE ${w.sql}`).all(...w.args) as
    Array<{ run: string; visit: string; ev: string | null; miles: number; end_ts: number | null; end_dist: number | null; end_reason: string | null; cause: string | null }>;
  const n = runs.length;
  const perVisit = new Map<string, number>();
  for (const r of runs) perVisit.set(r.visit, (perVisit.get(r.visit) ?? 0) + 1);
  const twice = [...perVisit.values()].filter((c) => c >= 2).length;
  const ends = runs.filter((r) => r.end_ts !== null && r.end_dist !== null);
  const dists = ends.map((r) => r.end_dist as number);
  const reach = REACH.map((at, i) => {
    const count = runs.filter((r) => (r.miles & (1 << i)) !== 0 || (r.end_dist ?? 0) >= at).length;
    return { at, count, share: n > 0 ? count / n : null };
  });
  const crashes = runs.filter((r) => r.end_reason === 'crash' && r.end_dist !== null);
  const bins: RunMetrics['crash']['bins'] = [];
  for (let k = 0; k < 30; k++) bins.push({ from: k * 1000, to: (k + 1) * 1000, count: 0 });
  bins.push({ from: 30000, to: null, count: 0 });
  for (const c of crashes) bins[Math.min(30, Math.floor((c.end_dist as number) / 1000))].count++;
  const causes = new Map<string, number>();
  for (const c of crashes) causes.set(c.cause ?? 'unbekannt', (causes.get(c.cause ?? 'unbekannt') ?? 0) + 1);
  const byReason: Record<string, number> = {};
  for (const r of ends) byReason[r.end_reason ?? '?'] = (byReason[r.end_reason ?? '?'] ?? 0) + 1;

  const pw = runWhere(f, 'r');
  const pk = db.prepare(`SELECT p.type AS type, COUNT(*) AS seen, SUM(p.taken) AS taken FROM pickups p JOIN runs r ON r.run = p.run WHERE ${pw.sql} GROUP BY p.type`).all(...pw.args) as Array<{ type: string; seen: number; taken: number }>;
  const gf = db.prepare(`SELECT MIN(p.seen_s) AS s FROM pickups p JOIN runs r ON r.run = p.run WHERE p.type = 'glide' AND ${pw.sql} GROUP BY p.run`).all(...pw.args) as Array<{ s: number }>;
  const types = ['shield', 'slow', 'clear', 'magnet', 'glide', 'boost', 'guide'];
  return {
    runs: n,
    eventRuns: runs.filter((r) => r.ev !== null).length,
    repeat: pct(twice, perVisit.size),
    withEnd: ends.length,
    noEnd: n - ends.length,
    dist: { median: percentile(dists, 50), p90: percentile(dists, 90), n: dists.length },
    reach,
    crash: { n: crashes.length, bins, causes: [...causes].map(([cause, count]) => ({ cause, count })).sort((a, b) => b.count - a.count).slice(0, 6), byReason },
    pickups: types.map((t) => { const x = pk.find((p) => p.type === t); const seen = x?.seen ?? 0, taken = x?.taken ?? 0; return { type: t, seen, taken, rate: seen > 0 ? taken / seen : null }; }),
    glideFirst: { median: percentile(gf.map((g) => g.s), 50), n: gf.length },
  };
}

export interface Cards {
  views: number | null;
  runs: number;
  startRate: Pct | null;
  repeatRate: Pct;
  medianDist: { value: number | null; n: number };
}

/** Besuche werden dem Zeitpunkt ihres ersten Ereignisses zugeordnet; Konfigurations-/Ereignisfilter betreffen nur Läufe. */
export function cards(db: Db, f: Filter, rm: RunMetrics): Cards {
  const runLevelOnly = !!f.cfg || (f.ev && f.ev !== 'all');
  if (runLevelOnly) return { views: null, runs: rm.runs, startRate: null, repeatRate: rm.repeat, medianDist: { value: rm.dist.median, n: rm.dist.n } };
  const a: (string | number)[] = [f.from, f.to];
  let vsql = 'v.ts >= ? AND v.ts < ?';
  if (f.dev) { vsql += ' AND v.dev = ?'; a.push(f.dev); }
  if (f.ver) { vsql += ' AND v.ver = ?'; a.push(f.ver); }
  const views = (db.prepare(`SELECT COUNT(*) AS n FROM visits v WHERE ${vsql}`).get(...a) as { n: number }).n;
  const counts = db.prepare(`SELECT COUNT(*) AS c FROM runs r JOIN visits v ON v.visit = r.visit WHERE ${vsql} GROUP BY r.visit`).all(...a) as Array<{ c: number }>;
  const withRun = counts.length, twice = counts.filter((c) => c.c >= 2).length;
  return { views, runs: rm.runs, startRate: pct(withRun, views), repeatRate: pct(twice, withRun), medianDist: { value: rm.dist.median, n: rm.dist.n } };
}

export function series(db: Db, f: Filter, buckets: number): number[] {
  const w = runWhere(f);
  const step = (f.to - f.from) / buckets;
  const rows = db.prepare(`SELECT CAST((r.ts - ?) / ? AS INTEGER) AS b, COUNT(*) AS n FROM runs r WHERE ${w.sql} GROUP BY b`).all(f.from, step, ...w.args) as Array<{ b: number; n: number }>;
  const out = new Array<number>(buckets).fill(0);
  for (const r of rows) if (r.b >= 0 && r.b < buckets) out[r.b] = r.n;
  return out;
}

export interface Overview {
  period: Period; from: number; to: number; step: 'hour' | 'day';
  coverage: { status: 'nodata' | 'partial' | 'ok'; firstEventAt: number | null };
  cards: Cards; prevCards: Cards;
  metrics: RunMetrics; prevMetrics: RunMetrics;
  series: { labels: number[]; cur: number[]; prev: number[] };
  markers: { publishes: Array<{ ts: number; id: number; label: string | null }>; events: Array<{ from: number; to: number; id: number }> };
  filters: { versions: string[]; configs: Array<{ id: number; publishedAt: number; label: string | null }> };
}

export function overview(db: Db, period: Period, now: number, extra: Omit<Filter, 'from' | 'to'>): Overview {
  const len = PERIOD_MS[period];
  const cur: Filter = { ...extra, from: now - len, to: now + 1 };
  const prev: Filter = { ...extra, from: now - 2 * len, to: now - len };
  const rm = runMetrics(db, cur), pm = runMetrics(db, prev);
  const buckets = period === '24h' ? 24 : period === '7d' ? 7 : 30;
  const stepMs = len / buckets;
  const first = (db.prepare('SELECT MIN(ts) AS t FROM visits').get() as { t: number | null }).t;
  const publishes = db.prepare('SELECT id, published_at AS ts, label FROM config_versions WHERE published_at >= ? AND published_at < ? ORDER BY id').all(cur.from, cur.to) as Overview['markers']['publishes'];
  const events = db.prepare('SELECT id, event_start AS "from", event_end AS "to" FROM config_versions WHERE event_start IS NOT NULL AND event_end IS NOT NULL AND event_end > ? AND event_start < ? ORDER BY id').all(cur.from, cur.to) as Overview['markers']['events'];
  const versions = (db.prepare('SELECT DISTINCT ver FROM visits ORDER BY ver').all() as Array<{ ver: string }>).map((r) => r.ver);
  const configs = (db.prepare('SELECT id, published_at AS publishedAt, label FROM config_versions ORDER BY id DESC LIMIT 30').all() as Overview['filters']['configs']);
  return {
    period, from: cur.from, to: cur.to, step: period === '24h' ? 'hour' : 'day',
    coverage: { status: first === null ? 'nodata' : first > cur.from ? 'partial' : 'ok', firstEventAt: first },
    cards: cards(db, cur, rm), prevCards: cards(db, prev, pm),
    metrics: rm, prevMetrics: pm,
    series: { labels: Array.from({ length: buckets }, (_, i) => Math.round(cur.from + i * stepMs)), cur: series(db, cur, buckets), prev: series(db, prev, buckets) },
    markers: { publishes, events },
    filters: { versions, configs },
  };
}

export function compare(db: Db, period: Period, now: number, a: string, b: string, extra: Omit<Filter, 'from' | 'to' | 'cfg'>): { a: RunMetrics; b: RunMetrics } {
  const len = PERIOD_MS[period];
  const base = { ...extra, from: now - len, to: now + 1 };
  return { a: runMetrics(db, { ...base, cfg: a }), b: runMetrics(db, { ...base, cfg: b }) };
}
