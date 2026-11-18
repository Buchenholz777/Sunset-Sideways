import { BALANCE as B } from '../config/balance';
import { GAME_VERSION } from '../net/remote';

/**
 * Client der Weltrangliste. Alles optional: Das Spiel funktioniert ohne Rangliste, ohne Netz und ohne Registrierung. Fehler werden nie geworfen,
 * sondern als `null` bzw. Statuscode gemeldet. Gespeichert wird lokal nur nach ausdrücklicher Veröffentlichung: die pseudonyme Gast-Berechtigung und der gewählte Name.
 */
export type LbMode = 'endless' | 'sprint';
export type LbPeriod = 'all' | '7d';
export interface LbEntry { rank: number; name: string; score: number; dist: number }
export interface LbMe { has: boolean; name?: string; score?: number; dist?: number; rank?: number; total?: number }
export interface RunClaim { mode: LbMode; score: number; dist: number; dur: number; nm: number; gp: number }
export interface SubmitOk { ok: true; duplicate: boolean; name: string; all: LbMe; week: LbMe }

const KEY = 'ssw-lb:v1';
interface Local { token?: string; name?: string }

export function loadLocal(): Local {
  try { const o = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Local; return { token: typeof o.token === 'string' ? o.token : undefined, name: typeof o.name === 'string' ? o.name : undefined }; } catch { return {}; }
}
function saveLocal(p: Local): void { try { localStorage.setItem(KEY, JSON.stringify({ ...loadLocal(), ...p })); } catch { /* gesperrt: nur Sitzung */ } }
export const hasPublished = (): boolean => !!loadLocal().token;

interface Res<T> { status: number; data: T | null }
async function call<T>(path: string, body?: unknown, timeoutMs = 8000): Promise<Res<T>> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : undefined;
  try {
    const r = await fetch(`/api/lb${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl?.signal, credentials: 'same-origin' });
    let data: T | null = null;
    try { data = (await r.json()) as T; } catch { /* keine JSON-Antwort */ }
    return { status: r.status, data };
  } catch { return { status: 0, data: null }; }
  finally { if (timer) clearTimeout(timer); }
}

export class LeaderboardClient {
  private ticket: { mode: LbMode; ticket: string } | null = null;
  private startedFor: LbMode | null = null;

  /** Beim Start eines Laufs: serverseitig signiertes Lauf-Ticket holen (still; ohne Netz gibt es später einfach keine Veröffentlichung). */
  async begin(mode: LbMode): Promise<void> {
    this.ticket = null; this.startedFor = mode;
    const r = await call<{ ticket?: string }>('/start', { mode });
    if (this.startedFor === mode && r.status === 200 && typeof r.data?.ticket === 'string') this.ticket = { mode, ticket: r.data.ticket };
  }
  get hasTicket(): boolean { return this.ticket !== null; }
  /** Ticket des laufenden/letzten Laufs (wird beim Veröffentlichen genau einmal verwendet). */
  takeTicket(): { mode: LbMode; ticket: string } | null { return this.ticket; }

  async top(mode: LbMode, period: LbPeriod): Promise<LbEntry[] | null> {
    const r = await call<{ entries?: LbEntry[] }>(`/top?mode=${mode}&period=${period}`);
    return r.status === 200 && Array.isArray(r.data?.entries) ? r.data!.entries!.slice(0, B.leaderboard.maxDisplayEntries) : null;
  }

  /** Eigener bester Lauf und Platz (nur mit lokaler Gast-Berechtigung, sonst `{ has: false }`). */
  async me(mode: LbMode, period: LbPeriod): Promise<LbMe | null> {
    const token = loadLocal().token;
    if (!token) return { has: false };
    const r = await call<LbMe>('/me', { token, mode, period });
    return r.status === 200 && r.data ? r.data : null;
  }

  /** Lauf veröffentlichen (ausdrückliche Aktion). Legt bei Bedarf die pseudonyme Gast-Berechtigung an. */
  async publish(name: string, c: RunClaim): Promise<{ ok: true; res: SubmitOk } | { ok: false; status: number; error: string }> {
    const tk = this.ticket;
    if (!tk || tk.mode !== c.mode) return { ok: false, status: 0, error: 'Für diesen Lauf ist keine Veröffentlichung möglich (keine Verbindung beim Start).' };
    let token = loadLocal().token;
    if (!token) {
      const g = await call<{ token?: string }>('/guest', {});
      if (g.status === 429) return { ok: false, status: 429, error: 'Zu viele Anfragen. Bitte später erneut versuchen.' };
      if (g.status !== 200 || typeof g.data?.token !== 'string') return { ok: false, status: g.status, error: 'Die Weltrangliste ist gerade nicht erreichbar. Dein Ergebnis bleibt auf diesem Gerät.' };
      token = g.data.token;
    }
    const r = await call<SubmitOk & { error?: string }>('/submit', { token, ticket: tk.ticket, name, score: c.score, dist: c.dist, dur: c.dur, nm: c.nm, gp: c.gp, ver: GAME_VERSION, rules: B.leaderboard.scoreRulesVersion });
    if (r.status === 200 && r.data && r.data.ok) {
      saveLocal({ token, name: r.data.name });
      if (this.ticket === tk) this.ticket = null;               // ein Ticket gilt für genau einen Lauf
      return { ok: true, res: r.data };
    }
    if (r.status === 0) return { ok: false, status: 0, error: 'Die Weltrangliste ist gerade nicht erreichbar. Bitte später erneut versuchen.' };
    return { ok: false, status: r.status, error: typeof r.data?.error === 'string' ? r.data.error : 'Veröffentlichung nicht möglich.' };
  }
}
