import { DUMMY_HASH, hashPassword, randomToken, sha256Hex, verifyPassword } from './crypto';
import type { Db } from './db';

export { safeEqual } from './crypto';

export const MIN_PASSWORD = 12;
export function passwordProblem(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`;
  if (pw.length > 200) return 'Das Passwort ist zu lang (höchstens 200 Zeichen).';
  if (/^(.)\1+$/.test(pw)) return 'Das Passwort darf nicht nur aus einem wiederholten Zeichen bestehen.';
  return null;
}

/**
 * Wirksamer Passwort-Hash: Wurde das Passwort im Admin geändert, steht der neue Hash in der Datenbank – solange der
 * Geheimwert ADMIN_PASSWORD_HASH unverändert ist. Wird der Geheimwert ausgetauscht (z. B. bei vergessenem Passwort), gewinnt er.
 */
export async function effectiveHash(db: Db, envHash: string | undefined): Promise<{ hash: string | null; fp: string }> {
  const envFp = envHash ? await sha256Hex(envHash) : '';
  const row = await db.get<{ pw_hash: string; env_fp: string; updated_at: number }>('SELECT pw_hash, env_fp, updated_at FROM admin WHERE id = 1');
  if (row && row.env_fp === envFp) return { hash: row.pw_hash, fp: await sha256Hex(`${row.pw_hash}|${row.updated_at}`) };
  if (envHash) return { hash: envHash, fp: await sha256Hex(envHash) };
  return { hash: null, fp: '' };
}

/** Neues Passwort im Admin setzen: beendet alle Sitzungen (der Fingerabdruck ändert sich). */
export async function setPassword(db: Db, envHash: string | undefined, password: string, now: number): Promise<void> {
  const p = passwordProblem(password);
  if (p) throw new Error(p);
  const envFp = envHash ? await sha256Hex(envHash) : '';
  await db.run('INSERT INTO admin (id, pw_hash, env_fp, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET pw_hash = excluded.pw_hash, env_fp = excluded.env_fp, updated_at = excluded.updated_at', await hashPassword(password), envFp, now);
  await db.run('UPDATE sessions SET revoked = 1');
}

export async function checkPassword(db: Db, envHash: string | undefined, password: string): Promise<{ ok: boolean; configured: boolean; fp: string }> {
  const e = await effectiveHash(db, envHash);
  if (!e.hash) { await verifyPassword(password, DUMMY_HASH); return { ok: false, configured: false, fp: '' }; }
  return { ok: await verifyPassword(password, e.hash), configured: true, fp: e.fp };
}

// ---------------------------------------------------------------- Sitzungen
export interface SessionOpts { idleMs: number; absoluteMs: number }
export interface Session { id: string; csrf: string; createdAt: number }

export async function createSession(db: Db, now: number, o: SessionOpts, ua: string, fp: string): Promise<{ token: string; session: Session }> {
  const token = randomToken(32), csrf = randomToken(24);
  const id = await sha256Hex(token);
  await db.run('INSERT INTO sessions (id, csrf, pwfp, created_at, last_seen, expires_at, revoked, ua) VALUES (?, ?, ?, ?, ?, ?, 0, ?)', id, csrf, fp, now, now, now + o.idleMs, ua.slice(0, 160));
  return { token, session: { id, csrf, createdAt: now } };
}

/** Gültige Sitzung zum Cookie-Token (gleitende Ablaufzeit, absolute Obergrenze, an das aktuelle Passwort gebunden) oder null. */
export async function findSession(db: Db, envHash: string | undefined, token: string | undefined, now: number, o: SessionOpts): Promise<Session | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const r = await db.get<{ id: string; csrf: string; pwfp: string; created_at: number; last_seen: number; expires_at: number; revoked: number }>('SELECT id, csrf, pwfp, created_at, last_seen, expires_at, revoked FROM sessions WHERE id = ?', await sha256Hex(token));
  if (!r || r.revoked || now > r.expires_at || now > r.created_at + o.absoluteMs) return null;
  if ((await effectiveHash(db, envHash)).fp !== r.pwfp) return null;          // Passwort wurde geändert
  if (now - r.last_seen > 60_000) await db.run('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?', now, Math.min(now + o.idleMs, r.created_at + o.absoluteMs), r.id);
  return { id: r.id, csrf: r.csrf, createdAt: r.created_at };
}

export const revokeSession = async (db: Db, id: string): Promise<void> => { await db.run('UPDATE sessions SET revoked = 1 WHERE id = ?', id); };
export const revokeAll = async (db: Db): Promise<void> => { await db.run('UPDATE sessions SET revoked = 1'); };

// ---------------------------------------------------------------- Ratenbegrenzung
/** Fehlversuche in der Datenbank gezählt (wirkt über alle Cloudflare-Instanzen hinweg). */
export class DbLimiter {
  constructor(private db: Db, private max: number, private windowMs: number) {}
  private async count(key: string, now: number): Promise<{ n: number; oldest: number }> {
    const r = await this.db.get<{ n: number; o: number | null }>('SELECT COUNT(*) AS n, MIN(ts) AS o FROM attempts WHERE k = ? AND ts > ?', key, now - this.windowMs);
    return { n: r?.n ?? 0, oldest: r?.o ?? now };
  }
  async blocked(key: string, now: number): Promise<boolean> { return (await this.count(key, now)).n >= this.max; }
  async hit(key: string, now: number): Promise<void> { await this.db.run('INSERT INTO attempts (k, ts) VALUES (?, ?)', key, now); }
  async retryAfter(key: string, now: number): Promise<number> { const c = await this.count(key, now); return Math.max(1, Math.ceil((c.oldest + this.windowMs - now) / 1000)); }
  async reset(key: string): Promise<void> { await this.db.run('DELETE FROM attempts WHERE k = ?', key); }
}

/** Einfache Begrenzung im Arbeitsspeicher (je Instanz, bestmöglich) – für hochfrequente öffentliche Endpunkte. */
export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  hit(key: string, now: number): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) { this.hits.set(key, arr); return false; }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    return true;
  }
}
