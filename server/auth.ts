import { argon2Sync, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';

/** Argon2id nach OWASP-Mindestwerten (19 MiB, 2 Durchgänge, 1 Lane); das Format trägt die Parameter, spätere Erhöhung bleibt kompatibel. */
const PARAMS = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const tag = argon2Sync('argon2id', { message: Buffer.from(password, 'utf8'), nonce: salt, ...PARAMS });
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${salt.toString('base64')}$${tag.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(stored);
  if (!m) return false;
  const salt = Buffer.from(m[4], 'base64'), want = Buffer.from(m[5], 'base64');
  try {
    const got = argon2Sync('argon2id', { message: Buffer.from(password, 'utf8'), nonce: salt, memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]), tagLength: want.length });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch { return false; }
}

// Dummy-Hash: gleiche Rechenzeit bei unbekanntem Konto/leerer Datenbank (kein Zeit-Orakel).
const DUMMY = hashPassword(randomBytes(12).toString('hex'));

export const MIN_PASSWORD = 12;
export function passwordProblem(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`;
  if (pw.length > 200) return 'Das Passwort ist zu lang (höchstens 200 Zeichen).';
  if (/^(.)\1+$/.test(pw)) return 'Das Passwort darf nicht nur aus einem wiederholten Zeichen bestehen.';
  return null;
}

export function setPassword(db: Db, password: string, now: number): void {
  const p = passwordProblem(password);
  if (p) throw new Error(p);
  db.prepare('INSERT INTO admin (id, pw_hash, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET pw_hash = excluded.pw_hash, updated_at = excluded.updated_at').run(hashPassword(password), now);
  db.prepare('UPDATE sessions SET revoked = 1').run();            // Passwortwechsel beendet alle Sitzungen
}

export function checkPassword(db: Db, password: string): { ok: boolean; configured: boolean } {
  const row = db.prepare('SELECT pw_hash FROM admin WHERE id = 1').get() as { pw_hash: string } | undefined;
  if (!row) { verifyPassword(password, DUMMY); return { ok: false, configured: false }; }
  return { ok: verifyPassword(password, row.pw_hash), configured: true };
}

// ---------------------------------------------------------------- Sitzungen
export interface SessionOpts { idleMs: number; absoluteMs: number }
export interface Session { id: string; csrf: string; createdAt: number }

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
export const newToken = (n = 32): string => randomBytes(n).toString('base64url');

export function createSession(db: Db, now: number, o: SessionOpts, ua: string): { token: string; session: Session } {
  const token = newToken(32), csrf = newToken(24);
  const id = sha(token);
  db.prepare('INSERT INTO sessions (id, csrf, created_at, last_seen, expires_at, revoked, ua) VALUES (?, ?, ?, ?, ?, 0, ?)').run(id, csrf, now, now, now + o.idleMs, ua.slice(0, 160));
  return { token, session: { id, csrf, createdAt: now } };
}

/** Gültige Sitzung zum Cookie-Token (gleitende Ablaufzeit, absolute Obergrenze) oder null. */
export function findSession(db: Db, token: string | undefined, now: number, o: SessionOpts): Session | null {
  if (!token || token.length < 20 || token.length > 200) return null;
  const r = db.prepare('SELECT id, csrf, created_at, last_seen, expires_at, revoked FROM sessions WHERE id = ?').get(sha(token)) as
    { id: string; csrf: string; created_at: number; last_seen: number; expires_at: number; revoked: number } | undefined;
  if (!r || r.revoked || now > r.expires_at || now > r.created_at + o.absoluteMs) return null;
  if (now - r.last_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?').run(now, Math.min(now + o.idleMs, r.created_at + o.absoluteMs), r.id);
  return { id: r.id, csrf: r.csrf, createdAt: r.created_at };
}

export const revokeSession = (db: Db, id: string): void => { db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(id); };
export const revokeAll = (db: Db): void => { db.prepare('UPDATE sessions SET revoked = 1').run(); };

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------------------------------------------------------------- Ratenbegrenzung (im Arbeitsspeicher)
export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  /** Zählt einen Versuch; false = Grenze erreicht. */
  hit(key: string, now: number): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) { this.hits.set(key, arr); return false; }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 20000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    return true;
  }
  /** Prüft ohne zu zählen. */
  blocked(key: string, now: number): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    return arr.length >= this.max;
  }
  retryAfter(key: string, now: number): number {
    const arr = this.hits.get(key) ?? [];
    return arr.length ? Math.max(1, Math.ceil((arr[0] + this.windowMs - now) / 1000)) : 1;
  }
  reset(key: string): void { this.hits.delete(key); }
}
