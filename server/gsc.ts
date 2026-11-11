import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { kvDel, kvGet, kvSet, type Db } from './db';

/** Optionale, nur lesende Anbindung der Google Search Console (OAuth, Bereich webmasters.readonly). Ohne Zugangsdaten bleibt der technische SEO-Check voll nutzbar. */
export interface GscEnv { clientId?: string; clientSecret?: string; appSecret?: string; origin: string }

export const gscAvailable = (e: GscEnv): boolean => !!(e.clientId && e.clientSecret && e.appSecret);
export const redirectUri = (e: GscEnv): string => `${e.origin}/admin/api/gsc/callback`;

const key = (secret: string): Buffer => createHash('sha256').update('gsc:' + secret).digest();
function seal(secret: string, text: string): string {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(secret), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function unseal(secret: string, blob: string): string | null {
  try {
    const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
    const d = createDecipheriv('aes-256-gcm', key(secret), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
}

export function authUrl(e: GscEnv, state: string): string {
  const p = new URLSearchParams({ client_id: e.clientId!, redirect_uri: redirectUri(e), response_type: 'code', scope: 'https://www.googleapis.com/auth/webmasters.readonly', access_type: 'offline', prompt: 'consent', state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type F = typeof fetch;
async function tokenCall(e: GscEnv, params: Record<string, string>, f: F): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const r = await f('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: e.clientId!, client_secret: e.clientSecret!, ...params }) });
  if (!r.ok) throw new Error(`Google-Anmeldung fehlgeschlagen (Status ${r.status}).`);
  return (await r.json()) as never;
}

export async function connect(db: Db, e: GscEnv, code: string, f: F = fetch): Promise<void> {
  const t = await tokenCall(e, { code, grant_type: 'authorization_code', redirect_uri: redirectUri(e) }, f);
  if (!t.refresh_token) throw new Error('Google hat kein dauerhaftes Zugriffstoken geliefert (Zugriff erneut erteilen).');
  kvSet(db, 'gsc_token', seal(e.appSecret!, t.refresh_token));
  kvDel(db, 'gsc_site'); kvDel(db, 'gsc_cache');
}
export const disconnect = (db: Db): void => { kvDel(db, 'gsc_token'); kvDel(db, 'gsc_site'); kvDel(db, 'gsc_cache'); };
export const isConnected = (db: Db): boolean => kvGet(db, 'gsc_token') !== null;

async function access(db: Db, e: GscEnv, f: F): Promise<string> {
  const blob = kvGet(db, 'gsc_token');
  const refresh = blob && e.appSecret ? unseal(e.appSecret, blob) : null;
  if (!refresh) throw new Error('Nicht mit der Search Console verbunden.');
  return (await tokenCall(e, { refresh_token: refresh, grant_type: 'refresh_token' }, f)).access_token;
}

export interface SiteEntry { siteUrl: string; permissionLevel: string }
export async function listSites(db: Db, e: GscEnv, f: F = fetch): Promise<SiteEntry[]> {
  const at = await access(db, e, f);
  const r = await f('https://www.googleapis.com/webmasters/v3/sites', { headers: { authorization: `Bearer ${at}` } });
  if (!r.ok) throw new Error(`Seitenliste nicht abrufbar (Status ${r.status}).`);
  const j = (await r.json()) as { siteEntry?: SiteEntry[] };
  return (j.siteEntry ?? []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser');   // nur bestätigte Properties
}

export interface GscData {
  site: string; from: string; to: string; fetchedAt: number;
  totals: { impressions: number; clicks: number; ctr: number; position: number };
  queries: Array<{ query: string; impressions: number; clicks: number; ctr: number; position: number }>;
}

const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

export async function fetchData(db: Db, e: GscEnv, now: number, force = false, f: F = fetch): Promise<GscData | null> {
  const site = kvGet(db, 'gsc_site');
  if (!site) return null;
  const cached = kvGet(db, 'gsc_cache');
  if (cached && !force) { const c = JSON.parse(cached) as GscData; if (c.site === site && now - c.fetchedAt < 6 * 3600_000) return c; }
  const at = await access(db, e, f);
  const from = day(now - 31 * 86400_000), to = day(now - 3 * 86400_000);     // Search-Console-Daten laufen etwa 2–3 Tage nach
  const q = async (body: Record<string, unknown>) => {
    const r = await f(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, { method: 'POST', headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' }, body: JSON.stringify({ startDate: from, endDate: to, ...body }) });
    if (!r.ok) throw new Error(`Search-Console-Abfrage fehlgeschlagen (Status ${r.status}).`);
    return (await r.json()) as { rows?: Array<{ keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }> };
  };
  const total = (await q({})).rows?.[0];
  const rows = (await q({ dimensions: ['query'], rowLimit: 10 })).rows ?? [];
  const data: GscData = {
    site, from, to, fetchedAt: now,
    totals: { impressions: total?.impressions ?? 0, clicks: total?.clicks ?? 0, ctr: total?.ctr ?? 0, position: total?.position ?? 0 },
    queries: rows.map((r) => ({ query: r.keys?.[0] ?? '', impressions: r.impressions, clicks: r.clicks, ctr: r.ctr, position: r.position })),
  };
  kvSet(db, 'gsc_cache', JSON.stringify(data));
  return data;
}
