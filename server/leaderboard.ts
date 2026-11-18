/**
 * Weltrangliste (Cloudflare D1 / SQLite): öffentlich lesbar, geschrieben wird ausschließlich über die geprüfte Server-API.
 *
 * Punkte = Stilpunkte des Laufs (Near Miss, Combo, Neon-Gate-Boni) – die einzige „Punkte“-Wertung des Spiels, nach der auch der lokale Stil-Rekord geführt wird;
 * bei Gleichstand entscheidet die Distanz, danach der frühere Rekord. Eine Distanz-Wertung (Bestweite) bleibt als Spalte erhalten.
 * Je Modus (Endless, Sunset Sprint) und Zeitraum (Gesamt, 7 Tage) zählt je Gast nur der beste gültige Lauf der aktuellen Punkteregeln (score_rules_version).
 *
 * Schutz (Best-Effort, keine absolute Cheat-Sicherheit): serverseitig signierte Gast- und Lauf-Tickets (HMAC, Schlüssel nur im Server), Lauf-ID einmalig,
 * Plausibilitätsprüfung (Distanz ↔ Fahrzeit nach Tempokurve, Wanduhr seit Lauf-Start, Punkte ↔ Near Misses ↔ Rush), Ratenbegrenzung, Moderation im Admin.
 */
import { BALANCE as B } from '../src/config/balance';
import { travelTime } from '../src/core/speed';
import { cleanName } from '../src/leaderboard/names';
import { SPRINT_FINISH_M } from '../src/sprint/rules';
import { hmacHex, randomToken, safeEqual } from './crypto';
import type { Db } from './db';

export const MODES = ['endless', 'sprint'] as const;
export type LbMode = (typeof MODES)[number];
export const PERIODS = ['all', '7d'] as const;
export type LbPeriod = (typeof PERIODS)[number];
const DAY = 86400_000;

export const isMode = (v: unknown): v is LbMode => typeof v === 'string' && (MODES as readonly string[]).includes(v);
export const isPeriod = (v: unknown): v is LbPeriod => typeof v === 'string' && (PERIODS as readonly string[]).includes(v);

/** Geheimer Schlüssel für Tickets: einmalig zufällig erzeugt und nur in der Datenbank des Servers gehalten (nie im Frontend). */
export async function lbSecret(db: Db, envSecret?: string): Promise<string> {
  if (envSecret) return `env:${envSecret}`;
  const row = await db.get<{ value: string }>("SELECT value FROM kv WHERE key = 'lb_secret'");
  if (row) return row.value;
  await db.run("INSERT OR IGNORE INTO kv (key, value) VALUES ('lb_secret', ?)", randomToken(32));
  return (await db.get<{ value: string }>("SELECT value FROM kv WHERE key = 'lb_secret'"))!.value;
}

const safeId = (s: string): boolean => /^[A-Za-z0-9_-]{8,40}$/.test(s);

// ---------------------------------------------------------------- Berechtigungen (stateless, signiert)
export async function issueGuest(secret: string): Promise<{ id: string; token: string }> {
  const id = randomToken(15);
  return { id, token: `g1.${id}.${(await hmacHex(secret, `g|${id}`)).slice(0, 32)}` };
}
export async function verifyGuest(secret: string, token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || token.length > 120) return null;
  const m = /^g1\.([A-Za-z0-9_-]{8,40})\.([0-9a-f]{32})$/.exec(token);
  if (!m) return null;
  return safeEqual(m[2], (await hmacHex(secret, `g|${m[1]}`)).slice(0, 32)) ? m[1] : null;
}
export async function issueTicket(secret: string, mode: LbMode, now: number): Promise<{ run: string; ticket: string }> {
  const run = randomToken(12);
  return { run, ticket: `t1.${run}.${mode}.${now}.${(await hmacHex(secret, `t|${run}|${mode}|${now}`)).slice(0, 32)}` };
}
export async function verifyTicket(secret: string, ticket: unknown): Promise<{ run: string; mode: LbMode; ts: number } | null> {
  if (typeof ticket !== 'string' || ticket.length > 160) return null;
  const m = /^t1\.([A-Za-z0-9_-]{8,40})\.(endless|sprint)\.(\d{10,14})\.([0-9a-f]{32})$/.exec(ticket);
  if (!m) return null;
  if (!safeEqual(m[4], (await hmacHex(secret, `t|${m[1]}|${m[2]}|${m[3]}`)).slice(0, 32))) return null;
  return { run: m[1], mode: m[2] as LbMode, ts: Number(m[3]) };
}

// ---------------------------------------------------------------- Plausibilität
export interface RunClaim { mode: LbMode; score: number; dist: number; dur: number; nm: number; gp: number }

/**
 * Prüft die Angaben eines Laufs gegen das Spiel (Tempokurve, Near-Miss-Rate, Punkte-Obergrenzen). Liefert null (plausibel) oder den Ablehnungsgrund.
 * `wallS` = Sekunden zwischen Ausstellung des Lauf-Tickets und Einreichung.
 */
export function plausibility(c: RunClaim, wallS: number): string | null {
  const L = B.leaderboard.submissionLimits;
  const ints = [c.score, c.dist, c.nm, c.gp];
  if (!ints.every((v) => Number.isInteger(v) && v >= 0) || !Number.isFinite(c.dur)) return 'ungültige Zahlen';
  if (c.score > L.maxScore || c.dist > L.maxDistM) return 'über dem Höchstwert';
  if (c.dur < 1.5 || c.dur > 86400) return 'ungültige Dauer';
  if (c.mode === 'sprint' && c.dist > SPRINT_FINISH_M + 50) return 'Distanz über dem Sprint-Ziel';
  // Distanz ↔ aktive Fahrzeit: Grundtempo laut Tempokurve, höchstens ×1,45 (Phantom-Turbo und Rush) bzw. ×0,5 (Zeitblasen)
  const t = travelTime(0, Math.max(1, c.dist));
  if (c.dur < t / 1.45 - 2) return 'Fahrzeit zu kurz für die Distanz';
  if (c.dur > t * 2.2 + 20) return 'Fahrzeit zu lang für die Distanz';
  // Wanduhr: der Lauf läuft in Echtzeit; Pausen verlängern nur
  if (wallS < c.dur * 0.85 - 3) return 'Lauf wurde schneller eingereicht als gespielt';
  if (wallS > 12 * 3600) return 'Lauf-Ticket abgelaufen';
  // Near Misses: höchstens einer je 0,35 s; Punkte je Near Miss höchstens 100 × Combo 5; Rush braucht mindestens 6 knappe Near Misses; Gates höchstens 900 je Rush
  if (c.nm > c.dur / 0.35 + 1) return 'zu viele Near Misses';
  const rushMax = Math.floor(c.dur / (B.style.rush.duration + 1)) + 1;
  const gateMaxPerRush = B.style.rush.gateBonuses.reduce((a, b) => a + b, 0);
  if (c.gp > rushMax * gateMaxPerRush) return 'zu viele Rush-Punkte';
  if (c.gp > 0 && c.nm < Math.ceil(B.style.rush.maxCharge / B.style.rush.chargePerfect)) return 'Rush ohne ausreichend Near Misses';
  if (c.score > c.nm * B.style.nearMiss.points * B.style.combo.maxMult + c.gp) return 'Punkte passen nicht zu den Near Misses';
  return null;
}

// ---------------------------------------------------------------- Abfragen
const rulesNow = (): number => B.leaderboard.scoreRulesVersion;
const since = (p: LbPeriod, now: number): number => (p === '7d' ? now - 7 * DAY : 0);

/** Bester Lauf je Gast (Reihenfolge: Punkte, Distanz, früher) für Modus, aktuelle Regeln und Zeitraum; gesperrte Gäste und entfernte Läufe zählen nicht. */
const BEST = `WITH best AS (
  SELECT r.pid, r.run, r.score, r.dist, r.ts, ROW_NUMBER() OVER (PARTITION BY r.pid ORDER BY r.score DESC, r.dist DESC, r.ts ASC) AS rn
  FROM lb_runs r JOIN lb_players p ON p.id = r.pid
  WHERE r.status = 'ok' AND r.mode = ? AND r.rules = ? AND r.ts >= ? AND p.banned = 0)`;

export interface LbEntry { rank: number; name: string; score: number; dist: number }

export async function top(db: Db, mode: LbMode, period: LbPeriod, now: number, limit = B.leaderboard.maxDisplayEntries): Promise<LbEntry[]> {
  const rows = await db.all<{ name: string; score: number; dist: number }>(
    `${BEST} SELECT p.name AS name, b.score AS score, b.dist AS dist FROM best b JOIN lb_players p ON p.id = b.pid WHERE b.rn = 1 ORDER BY b.score DESC, b.dist DESC, b.ts ASC LIMIT ?`,
    mode, rulesNow(), since(period, now), Math.max(1, Math.min(B.leaderboard.maxDisplayEntries, limit)));
  // Rang = Position; gleiche Punkte und Distanz teilen sich den Platz nicht (frühere Zeit entscheidet), deshalb fortlaufend
  return rows.map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, dist: r.dist }));
}

export interface MyRank { has: boolean; name?: string; score?: number; dist?: number; rank?: number; total?: number }

/** Eigener bester Lauf und globaler Platz, serverseitig berechnet (auch außerhalb der Top 100). */
export async function myRank(db: Db, pid: string, mode: LbMode, period: LbPeriod, now: number): Promise<MyRank> {
  const own = await db.get<{ name: string; score: number; dist: number; ts: number }>(
    `${BEST} SELECT p.name AS name, b.score AS score, b.dist AS dist, b.ts AS ts FROM best b JOIN lb_players p ON p.id = b.pid WHERE b.rn = 1 AND b.pid = ?`,
    mode, rulesNow(), since(period, now), pid);
  if (!own) return { has: false };
  const r = await db.get<{ n: number; total: number }>(
    `${BEST} SELECT (SELECT COUNT(*) FROM best WHERE rn = 1 AND (score > ? OR (score = ? AND dist > ?) OR (score = ? AND dist = ? AND ts < ?))) AS n, (SELECT COUNT(*) FROM best WHERE rn = 1) AS total`,
    mode, rulesNow(), since(period, now), own.score, own.score, own.dist, own.score, own.dist, own.ts);
  return { has: true, name: own.name, score: own.score, dist: own.dist, rank: (r?.n ?? 0) + 1, total: r?.total ?? 1 };
}

// ---------------------------------------------------------------- Einreichen
export interface SubmitBody { token?: unknown; ticket?: unknown; name?: unknown; score?: unknown; dist?: unknown; dur?: unknown; nm?: unknown; gp?: unknown; ver?: unknown; rules?: unknown }
export interface SubmitResult { status: number; body: Record<string, unknown> }

export async function submit(db: Db, secret: string, now: number, b: SubmitBody): Promise<SubmitResult> {
  const pid = await verifyGuest(secret, b.token);
  if (!pid) return { status: 401, body: { error: 'Gast-Berechtigung ungültig.' } };
  const tk = await verifyTicket(secret, b.ticket);
  if (!tk) return { status: 400, body: { error: 'Lauf-Ticket ungültig.' } };
  const nm = cleanName(b.name);
  if (!nm.ok) return { status: 400, body: { error: nm.error } };
  const num = (v: unknown): number => (typeof v === 'number' ? v : NaN);
  const ver = typeof b.ver === 'string' && /^[\w.+-]{1,40}$/.test(b.ver) ? b.ver : null;
  if (!ver) return { status: 400, body: { error: 'Spielversion ungültig.' } };
  if (b.rules !== rulesNow()) return { status: 409, body: { error: 'Diese Version der Punkteregeln ist nicht mehr aktiv. Bitte das Spiel neu laden.', rules: rulesNow() } };
  const claim: RunClaim = { mode: tk.mode, score: num(b.score), dist: num(b.dist), dur: num(b.dur), nm: num(b.nm), gp: num(b.gp) };
  const player = await db.get<{ banned: number }>('SELECT banned FROM lb_players WHERE id = ?', pid);
  if (player?.banned) return { status: 403, body: { error: 'Dieser Gast ist gesperrt.' } };
  // Tageslimit je Gast
  const perDay = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM lb_runs WHERE pid = ? AND ts > ?', pid, now - DAY);
  if ((perDay?.n ?? 0) >= B.leaderboard.submissionLimits.perDay) return { status: 429, body: { error: 'Tageslimit erreicht.' } };
  const bad = plausibility(claim, (now - tk.ts) / 1000);
  if (bad) {
    await db.run("INSERT OR IGNORE INTO lb_runs (run, pid, mode, score, dist, dur, nm, gp, ver, rules, ts, status, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rejected', ?)",
      tk.run, pid, tk.mode, Math.max(0, Math.floor(claim.score) || 0), Math.max(0, Math.floor(claim.dist) || 0), Number.isFinite(claim.dur) ? claim.dur : 0, Math.max(0, Math.floor(claim.nm) || 0), Math.max(0, Math.floor(claim.gp) || 0), ver, rulesNow(), now, bad);
    return { status: 422, body: { error: 'Das Ergebnis wurde nicht akzeptiert.' } };
  }
  await db.run('INSERT INTO lb_players (id, name, created, last) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, last = excluded.last', pid, nm.name, now, now);
  // Atomar: gleiche Lauf-ID erzeugt nie einen zweiten Eintrag (Primärschlüssel)
  const ins = await db.run("INSERT OR IGNORE INTO lb_runs (run, pid, mode, score, dist, dur, nm, gp, ver, rules, ts, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')",
    tk.run, pid, tk.mode, claim.score, claim.dist, claim.dur, claim.nm, claim.gp, ver, rulesNow(), now);
  const all = await myRank(db, pid, tk.mode, 'all', now), week = await myRank(db, pid, tk.mode, '7d', now);
  return { status: 200, body: { ok: true, duplicate: ins.changes === 0, name: nm.name, all, week } };
}

// ---------------------------------------------------------------- Admin
export async function adminOverview(db: Db, now: number): Promise<Record<string, unknown>> {
  const n = async (sql: string, ...a: unknown[]): Promise<number> => (await db.get<{ n: number }>(sql, ...a))?.n ?? 0;
  const topOf = (mode: LbMode) => db.all(`${BEST} SELECT b.run AS run, substr(b.pid, 1, 6) AS pid, p.name AS name, b.score AS score, b.dist AS dist, b.ts AS ts FROM best b JOIN lb_players p ON p.id = b.pid WHERE b.rn = 1 ORDER BY b.score DESC, b.dist DESC, b.ts ASC LIMIT 10`, mode, rulesNow(), 0);
  return {
    rules: rulesNow(),
    published: await n("SELECT COUNT(*) AS n FROM lb_runs WHERE status = 'ok'"),
    players: await n("SELECT COUNT(DISTINCT pid) AS n FROM lb_runs WHERE status = 'ok'"),
    active: await n("SELECT COUNT(DISTINCT pid) AS n FROM lb_runs WHERE status = 'ok' AND ts > ? AND rules = ?", now - 7 * DAY, rulesNow()),
    banned: await n('SELECT COUNT(*) AS n FROM lb_players WHERE banned = 1'),
    rejected24h: await n("SELECT COUNT(*) AS n FROM lb_runs WHERE status = 'rejected' AND ts > ?", now - DAY),
    top: { endless: await topOf('endless'), sprint: await topOf('sprint') },
    rejected: await db.all("SELECT run, substr(pid, 1, 6) AS pid, mode, score, dist, dur, reason, ts FROM lb_runs WHERE status = 'rejected' ORDER BY ts DESC LIMIT 30"),
  };
}
export async function removeRun(db: Db, run: string): Promise<boolean> { return safeId(run) && (await db.run("UPDATE lb_runs SET status = 'removed', reason = 'Admin' WHERE run = ? AND status = 'ok'", run)).changes > 0; }
/** Sperrt einen Gast anhand der (gekürzten oder vollen) ID: seine Läufe erscheinen nicht mehr. */
export async function banPlayer(db: Db, pid: string, banned: boolean): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(pid)) return false;
  const row = await db.get<{ id: string }>('SELECT id FROM lb_players WHERE id = ? OR (length(?) < 12 AND substr(id, 1, length(?)) = ?)', pid, pid, pid, pid);
  if (!row) return false;
  await db.run('UPDATE lb_players SET banned = ? WHERE id = ?', banned ? 1 : 0, row.id);
  return true;
}
