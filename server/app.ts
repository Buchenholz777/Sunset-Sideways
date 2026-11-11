import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize as pnormalize, resolve, sep } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DEFAULT_CONFIG, clone, normalize, withProfile } from '../src/config/runtime';
import { MAX_BODY, ingest } from './ingest';
import { Limiter, checkPassword, createSession, findSession, newToken, revokeAll, revokeSession, safeEqual, setPassword, passwordProblem, type Session } from './auth';
import { kvDel, kvGet, kvSet, purge, type Db } from './db';
import { activeEvent, check, currentVersion, draftDiff, getDraft, getVersion, isDirty, listVersions, publicConfig, publish, saveDraft } from './configStore';
import { compare, overview, type Period } from './kpi';
import { checkSite } from './seo';
import * as gsc from './gsc';

export interface AppEnv {
  /** Öffentliche Adresse, z. B. https://spiel.example.de (für Canonical, Sitemap, Cookie-Secure, Origin-Prüfung). */
  publicOrigin?: string;
  production: boolean;
  trustProxy: boolean;
  appSecret?: string;
  gscClientId?: string; gscClientSecret?: string;
  gameDir: string; adminDir: string;
  retentionDays: number;
  sessionIdleHours: number; sessionAbsoluteDays: number;
  seoAllowLocal: boolean;
}

export interface AppOpts { db: Db; env: AppEnv; now?: () => number; fetchImpl?: typeof fetch }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

const CSP_ADMIN = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function createApp(o: AppOpts) {
  const { db, env } = o;
  const now = o.now ?? Date.now;
  const idleMs = env.sessionIdleHours * 3600_000;
  const sopts = { idleMs, absoluteMs: env.sessionAbsoluteDays * 86400_000 };
  const secureCookie = env.production || (env.publicOrigin ?? '').startsWith('https://');
  const COOKIE = secureCookie ? '__Host-ssw_admin' : 'ssw_admin';
  const loginFail = new Limiter(8, 15 * 60_000);          // je IP
  const loginFailAll = new Limiter(40, 15 * 60_000);      // insgesamt
  const pwFail = new Limiter(5, 15 * 60_000);
  const ingestLim = new Limiter(120, 60_000);
  const apiLim = new Limiter(240, 60_000);                // private Anfragen je Sitzung
  const testdrives = new Map<string, number>();
  const gscEnv = (req: IncomingMessage): gsc.GscEnv => ({ clientId: env.gscClientId, clientSecret: env.gscClientSecret, appSecret: env.appSecret, origin: originOf(req) });

  const ipOf = (req: IncomingMessage): string => {
    if (env.trustProxy) { const x = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean); if (x.length) return x[x.length - 1]; }
    return req.socket.remoteAddress ?? 'unbekannt';
  };
  const hostOf = (req: IncomingMessage): string => String((env.trustProxy && req.headers['x-forwarded-host']) || req.headers.host || 'localhost');
  const originOf = (req: IncomingMessage): string => {
    if (env.publicOrigin) return env.publicOrigin;
    const proto = env.trustProxy && String(req.headers['x-forwarded-proto'] ?? '').startsWith('https') ? 'https' : 'http';
    return `${proto}://${hostOf(req)}`;
  };

  // ---------------------------------------------------------------- Antworten
  const SEC = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };
  function send(res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string | string[]> = {}): void {
    res.writeHead(status, { ...SEC, 'content-length': Buffer.byteLength(body), ...headers });
    res.end(body);
  }
  const PRIVATE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-frame-options': 'DENY', 'content-security-policy': CSP_ADMIN };
  const json = (res: ServerResponse, status: number, data: unknown, extra: Record<string, string | string[]> = {}): void =>
    send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', ...PRIVATE, ...extra });
  const publicJson = (res: ServerResponse, status: number, data: unknown): void =>
    send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });

  async function readJson(req: IncomingMessage, max = MAX_BODY): Promise<unknown> {
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const c of req) { n += (c as Buffer).length; if (n > max) throw Object.assign(new Error('Anfrage zu groß'), { status: 413 }); chunks.push(c as Buffer); }
    if (n === 0) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Ungültiges JSON'), { status: 400 }); }
  }

  const cookies = (req: IncomingMessage): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const part of String(req.headers.cookie ?? '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
    return out;
  };
  const setCookie = (token: string, maxAge: number): string => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
  const sessionOf = (req: IncomingMessage): Session | null => findSession(db, cookies(req)[COOKIE], now(), sopts);

  /** Schreibende Anfragen: gleiche Herkunft und gültiges CSRF-Token. */
  function sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (origin === undefined) return true;                                  // Nicht-Browser-Clients scheitern spätestens am CSRF-Token
    const ok = new Set([originOf(req), `${env.trustProxy && String(req.headers['x-forwarded-proto'] ?? '').startsWith('https') ? 'https' : 'http'}://${hostOf(req)}`]);
    return ok.has(String(origin));
  }
  const isJson = (req: IncomingMessage): boolean => /^application\/json\b/i.test(String(req.headers['content-type'] ?? ''));

  // ---------------------------------------------------------------- Statische Dateien
  function serveFile(req: IncomingMessage, res: ServerResponse, root: string, rel: string, extra: Record<string, string> = {}, transform?: (t: string) => string): boolean {
    const base = resolve(root);
    const file = resolve(join(base, pnormalize('/' + rel)));
    if (file !== base && !file.startsWith(base + sep)) return false;
    if (!existsSync(file) || !statSync(file).isFile()) return false;
    const ext = extname(file).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    const immutable = /\/assets\//.test('/' + rel) && /-[\w-]{6,}\./.test(rel);
    const headers: Record<string, string> = { ...SEC, 'content-type': type, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', ...extra };
    if (transform && ext === '.html') {
      const body = transform(readFileSync(file, 'utf8'));
      send(res, 200, req.method === 'HEAD' ? '' : body, { ...headers, 'content-length': String(Buffer.byteLength(body)) });
      return true;
    }
    headers['content-length'] = String(statSync(file).size);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
    return true;
  }

  const loginPage = (res: ServerResponse): void => {
    const nonce = randomBytes(16).toString('base64');
    const configured = !!db.prepare('SELECT 1 FROM admin WHERE id = 1').get();
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="dark light"><title>Anmeldung · Sunset Sideways</title>
<style nonce="${nonce}">:root{--bg:#0d1020;--card:#161a33;--ink:#eef0ff;--mut:#9aa1c9;--line:#2a3058;--acc:#ff5fa8;--acc2:#5fe0ff}@media (prefers-color-scheme:light){:root{--bg:#f2f3fa;--card:#fff;--ink:#16193a;--mut:#555b86;--line:#d6d9ee}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,Segoe UI,sans-serif}
main{width:min(420px,100%);background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 24px;box-shadow:0 0 40px rgba(95,224,255,.07)}
h1{margin:0 0 4px;font-size:1.35rem}p{margin:0 0 18px;color:var(--mut)}label{display:block;font-weight:600;margin-bottom:6px}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);font:inherit}
input:focus-visible,button:focus-visible{outline:3px solid var(--acc2);outline-offset:2px}
button{margin-top:16px;width:100%;padding:13px;border:0;border-radius:10px;font:inherit;font-weight:700;color:#10122a;background:linear-gradient(90deg,var(--acc),var(--acc2));cursor:pointer}
button[disabled]{opacity:.6;cursor:wait}#msg{min-height:1.5em;margin-top:12px;color:#ff8a8a}</style></head>
<body><main><h1>Sunset Sideways · Admin</h1><p>${configured ? 'Bitte mit dem Admin-Passwort anmelden.' : 'Noch kein Passwort gesetzt. Auf dem Server <code>npm run admin:passwd</code> ausführen.'}</p>
<form id="f" autocomplete="on"><label for="pw">Passwort</label><input id="pw" name="password" type="password" autocomplete="current-password" required ${configured ? '' : 'disabled'} autofocus><button id="go" type="submit" ${configured ? '' : 'disabled'}>Anmelden</button><div id="msg" role="alert" aria-live="polite"></div></form></main>
<script nonce="${nonce}">const f=document.getElementById('f'),m=document.getElementById('msg'),b=document.getElementById('go');f.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;m.textContent='';try{const r=await fetch('/admin/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value}),credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(r.ok){location.replace('/admin');return}m.textContent=r.status===429?'Zu viele Versuche. Bitte in '+(j.retryAfter||15)+' Sekunden erneut versuchen.':(j.error||'Anmeldung fehlgeschlagen.')}catch{m.textContent='Server nicht erreichbar.'}b.disabled=false});</script></body></html>`;
    send(res, 200, html, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-frame-options': 'DENY', 'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` });
  };

  // ---------------------------------------------------------------- Admin-API
  const reportOf = (): unknown => { const r = kvGet(db, 'seo_report'); return r ? JSON.parse(r) : null; };
  const domainOf = (req: IncomingMessage): string => kvGet(db, 'domain') ?? env.publicOrigin ?? originOf(req);
  const seoOpts = (req: IncomingMessage) => ({ allowHosts: [hostOf(req), ...(env.publicOrigin ? [new URL(env.publicOrigin).host] : [])], allowLocal: env.seoAllowLocal, fetchImpl: o.fetchImpl, now });

  const eventState = (t: number) => {
    const v = currentVersion(db);
    if (!v || !v.config.event.on) return { state: 'off' as const, endsAt: null, remainingMs: 0, boost: 0 };
    const a = activeEvent(v, t);
    if (a) return { state: 'active' as const, endsAt: a.endsAt, remainingMs: a.endsAt - t, boost: v.config.event.glideBoost };
    return { state: 'expired' as const, endsAt: v.eventEnd, remainingMs: 0, boost: 0 };
  };

  function stateBody(t: number) {
    const draft = getDraft(db);
    const c = check(draft);
    const cur = currentVersion(db);
    return {
      now: t, draft, issues: c.issues, analysis: c.analysis, defaults: DEFAULT_CONFIG,
      published: cur ? { id: cur.id, publishedAt: cur.publishedAt, label: cur.label, config: cur.config } : null,
      dirty: isDirty(db), diff: draftDiff(db), event: eventState(t),
      versions: listVersions(db).map((v) => ({ id: v.id, label: v.label, publishedAt: v.publishedAt, eventStart: v.eventStart, eventEnd: v.eventEnd, eventOn: v.config.event.on, profile: v.config.profile })),
    };
  }

  const q1 = (u: URL, k: string): string | null => { const v = u.searchParams.get(k); return v && v !== 'all' ? v : null; };

  async function adminApi(req: IncomingMessage, res: ServerResponse, u: URL): Promise<void> {
    const path = u.pathname.slice('/admin/api'.length) || '/';
    const method = req.method ?? 'GET';
    const t = now();

    if (path === '/login' && method === 'POST') {
      if (!sameOrigin(req) || !isJson(req)) return json(res, 403, { error: 'Anfrage abgelehnt.' });
      const ip = ipOf(req);
      if (loginFail.blocked(ip, t) || loginFailAll.blocked('all', t)) { const ra = Math.max(loginFail.retryAfter(ip, t), 1); return json(res, 429, { error: 'Zu viele Versuche.', retryAfter: ra }, { 'retry-after': String(ra) }); }
      const body = (await readJson(req, 4096)) as { password?: unknown };
      if (typeof body.password !== 'string' || body.password.length > 400) return json(res, 400, { error: 'Passwort fehlt.' });
      const r = checkPassword(db, body.password);
      if (!r.configured) return json(res, 503, { error: 'Kein Passwort gesetzt. Auf dem Server „npm run admin:passwd“ ausführen.' });
      if (!r.ok) { loginFail.hit(ip, t); loginFailAll.hit('all', t); return json(res, 401, { error: 'Anmeldung fehlgeschlagen.' }); }
      loginFail.reset(ip);
      const { token, session } = createSession(db, t, sopts, String(req.headers['user-agent'] ?? ''));
      return json(res, 200, { ok: true, csrf: session.csrf }, { 'set-cookie': setCookie(token, Math.floor(idleMs / 1000)) });
    }

    // Alles Weitere: gültige Sitzung (serverseitig geprüft)
    const s = sessionOf(req);
    if (!s) return json(res, 401, { error: 'Nicht angemeldet.' });
    if (!apiLim.hit(s.id, t)) return json(res, 429, { error: 'Zu viele Anfragen.' });
    if (method !== 'GET' && method !== 'HEAD') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Herkunft nicht erlaubt.' });
      if (!isJson(req)) return json(res, 415, { error: 'JSON erwartet.' });
      if (!safeEqual(String(req.headers['x-csrf-token'] ?? ''), s.csrf)) return json(res, 403, { error: 'CSRF-Prüfung fehlgeschlagen.' });
    }

    if (path === '/me' && method === 'GET') return json(res, 200, { ok: true, csrf: s.csrf });
    if (path === '/logout' && method === 'POST') { revokeSession(db, s.id); return json(res, 200, { ok: true }, { 'set-cookie': setCookie('', 0) }); }
    if (path === '/password' && method === 'POST') {
      const b = (await readJson(req, 4096)) as { current?: unknown; next?: unknown };
      if (pwFail.blocked('pw', t)) return json(res, 429, { error: 'Zu viele Versuche.' });
      if (typeof b.current !== 'string' || typeof b.next !== 'string') return json(res, 400, { error: 'Angaben fehlen.' });
      if (!checkPassword(db, b.current).ok) { pwFail.hit('pw', t); return json(res, 403, { error: 'Das aktuelle Passwort stimmt nicht.' }); }
      const prob = passwordProblem(b.next);
      if (prob) return json(res, 400, { error: prob });
      setPassword(db, b.next, t);                                           // beendet alle Sitzungen
      return json(res, 200, { ok: true, relogin: true }, { 'set-cookie': setCookie('', 0) });
    }

    if (path === '/state' && method === 'GET') return json(res, 200, stateBody(t));
    if (path === '/draft' && method === 'PUT') {
      const b = (await readJson(req)) as { config?: unknown };
      saveDraft(db, b.config);
      return json(res, 200, stateBody(t));
    }
    if (path === '/check' && method === 'POST') {
      const b = (await readJson(req)) as { config?: unknown };
      const c = check(normalize(b.config));
      return json(res, 200, { issues: c.issues, analysis: c.analysis });
    }
    if (path === '/draft/defaults' && method === 'POST') { saveDraft(db, clone(DEFAULT_CONFIG)); return json(res, 200, stateBody(t)); }
    if (path === '/draft/profile' && method === 'POST') {
      const b = (await readJson(req)) as { profile?: unknown };
      if (b.profile !== 'relaxed' && b.profile !== 'arcade' && b.profile !== 'hard') return json(res, 400, { error: 'Unbekanntes Profil.' });
      saveDraft(db, withProfile(getDraft(db), b.profile));
      return json(res, 200, stateBody(t));
    }
    if (path === '/publish' && method === 'POST') {
      const b = (await readJson(req)) as { label?: unknown };
      const r = publish(db, t, typeof b.label === 'string' ? b.label : null);
      if (!r.ok) return json(res, 409, { error: 'Die Einstellungen enthalten Konflikte.', blocking: r.blocking });
      return json(res, 200, { ok: true, version: r.version.id, state: stateBody(t) });
    }
    if (path === '/restore' && method === 'POST') {
      const b = (await readJson(req)) as { id?: unknown };
      const v = typeof b.id === 'number' ? getVersion(db, b.id) : null;
      if (!v) return json(res, 404, { error: 'Version nicht gefunden.' });
      saveDraft(db, v.config);
      return json(res, 200, stateBody(t));
    }
    if (path === '/testdrive' && method === 'POST') {
      for (const [k, exp] of testdrives) if (exp < t) testdrives.delete(k);
      const token = newToken(18);
      testdrives.set(token, t + 30 * 60_000);
      return json(res, 200, { token, url: `${originOf(req)}/?testdrive=${token}`, expiresAt: t + 30 * 60_000 });
    }

    if (path === '/kpi' && method === 'GET') {
      const period = (['24h', '7d', '30d'].includes(u.searchParams.get('period') ?? '') ? u.searchParams.get('period') : '7d') as Period;
      const ev = (['event', 'regular'].includes(u.searchParams.get('ev') ?? '') ? u.searchParams.get('ev') : 'all') as 'all' | 'event' | 'regular';
      return json(res, 200, overview(db, period, t, { dev: q1(u, 'dev'), ver: q1(u, 'ver'), ev, cfg: q1(u, 'cfg') }));
    }
    if (path === '/compare' && method === 'GET') {
      const period = (['24h', '7d', '30d'].includes(u.searchParams.get('period') ?? '') ? u.searchParams.get('period') : '7d') as Period;
      const a = q1(u, 'a'), b = q1(u, 'b');
      if (!a || !b) return json(res, 400, { error: 'Zwei Versionen angeben.' });
      const ev = (['event', 'regular'].includes(u.searchParams.get('ev') ?? '') ? u.searchParams.get('ev') : 'all') as 'all' | 'event' | 'regular';
      return json(res, 200, { period, ...compare(db, period, t, a, b, { dev: q1(u, 'dev'), ver: q1(u, 'ver'), ev }) });
    }

    if (path === '/seo' && method === 'GET') return json(res, 200, { domain: domainOf(req), publicOrigin: env.publicOrigin ?? null, report: reportOf() });
    if (path === '/seo/check' && method === 'POST') {
      const b = (await readJson(req, 2048)) as { domain?: unknown };
      let domain = domainOf(req);
      if (typeof b.domain === 'string' && b.domain.trim()) {
        try { const x = new URL(b.domain.trim()); if (x.protocol !== 'http:' && x.protocol !== 'https:') throw new Error('x'); domain = x.origin; kvSet(db, 'domain', domain); }
        catch { return json(res, 400, { error: 'Bitte eine vollständige Adresse wie https://spiel.example.de angeben.' }); }
      }
      try {
        const report = await checkSite(domain, seoOpts(req));
        kvSet(db, 'seo_report', JSON.stringify(report));
        return json(res, 200, { domain, report });
      } catch (e) { return json(res, 502, { error: (e as Error).message }); }
    }

    if (path.startsWith('/gsc')) return gscApi(req, res, u, path, method, t);
    return json(res, 404, { error: 'Nicht gefunden.' });
  }

  async function gscApi(req: IncomingMessage, res: ServerResponse, u: URL, path: string, method: string, t: number): Promise<void> {
    const e = gscEnv(req);
    if (path === '/gsc' && method === 'GET') {
      const base = { available: gsc.gscAvailable(e), connected: gsc.isConnected(db), site: kvGet(db, 'gsc_site'), redirectUri: gsc.redirectUri(e) };
      if (!base.connected) return json(res, 200, base);
      try {
        const sites = await gsc.listSites(db, e, o.fetchImpl);
        const data = base.site ? await gsc.fetchData(db, e, t, u.searchParams.get('force') === '1', o.fetchImpl) : null;
        return json(res, 200, { ...base, sites, data });
      } catch (err) { return json(res, 200, { ...base, error: (err as Error).message }); }
    }
    if (path === '/gsc/connect' && method === 'POST') {
      if (!gsc.gscAvailable(e)) return json(res, 400, { error: 'GSC_CLIENT_ID, GSC_CLIENT_SECRET und APP_SECRET sind nicht gesetzt.' });
      const state = newToken(18);
      kvSet(db, 'gsc_state', JSON.stringify({ h: createHash('sha256').update(state).digest('hex'), exp: t + 10 * 60_000 }));
      return json(res, 200, { url: gsc.authUrl(e, state) });
    }
    if (path === '/gsc/site' && method === 'POST') {
      const b = (await readJson(req, 2048)) as { site?: unknown };
      if (typeof b.site !== 'string') return json(res, 400, { error: 'Property fehlt.' });
      const sites = await gsc.listSites(db, e, o.fetchImpl).catch(() => []);
      if (!sites.some((s) => s.siteUrl === b.site)) return json(res, 400, { error: 'Diese Property ist nicht bestätigt oder nicht verfügbar.' });
      kvSet(db, 'gsc_site', b.site); kvDel(db, 'gsc_cache');
      return json(res, 200, { ok: true });
    }
    if (path === '/gsc/disconnect' && method === 'POST') { gsc.disconnect(db); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'Nicht gefunden.' });
  }

  // ---------------------------------------------------------------- Hauptverteiler
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const t = now();
    const u = new URL(req.url ?? '/', 'http://x');
    const p = u.pathname;
    const method = req.method ?? 'GET';

    // OAuth-Rückkehr von Google: kommt ohne Sitzungscookie (SameSite=Strict); abgesichert durch den einmaligen, kurzlebigen state.
    if (p === '/admin/api/gsc/callback' && method === 'GET') {
      const raw = kvGet(db, 'gsc_state');
      kvDel(db, 'gsc_state');
      const st = raw ? (JSON.parse(raw) as { h: string; exp: number }) : null;
      const given = u.searchParams.get('state') ?? '';
      const code = u.searchParams.get('code');
      const ok = !!st && st.exp > t && safeEqual(st.h, createHash('sha256').update(given).digest('hex')) && !!code;
      let msg = 'gsc=ok';
      if (!ok) msg = 'gsc=fehler';
      else { try { await gsc.connect(db, gscEnv(req), code!, o.fetchImpl); } catch { msg = 'gsc=fehler'; } }
      return send(res, 302, '', { location: `/admin#seo?${msg}`, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    }

    if (p === '/admin/api' || p.startsWith('/admin/api/')) { await adminApi(req, res, u); return; }

    if (p === '/admin' || p.startsWith('/admin/')) {
      const s = sessionOf(req);
      if (!s) {
        if (method !== 'GET' && method !== 'HEAD') return json(res, 401, { error: 'Nicht angemeldet.' });
        return loginPage(res);
      }
      const rel = p === '/admin' || p === '/admin/' ? 'index.html' : p.slice('/admin/'.length);
      if (serveFile(req, res, env.adminDir, rel, PRIVATE)) return;
      if (!extname(rel)) { if (serveFile(req, res, env.adminDir, 'index.html', PRIVATE)) return; }
      return json(res, 404, { error: 'Nicht gefunden.' });
    }

    // ---- öffentlich
    if (p === '/api/health') return publicJson(res, 200, { ok: true });
    if (p === '/api/config' && method === 'GET') {
      const token = u.searchParams.get('preview');
      if (token) {
        const exp = testdrives.get(token);
        if (!exp || exp < t) return publicJson(res, 404, { error: 'Testfahrt abgelaufen.' });
        const d = getDraft(db);
        return publicJson(res, 200, { id: 'draft', config: d, event: d.event.on ? { id: 'preview', endsAt: t + d.event.days * 86400_000 } : null });
      }
      return publicJson(res, 200, publicConfig(db, t));
    }
    if (p === '/api/e' && method === 'POST') {
      if (!ingestLim.hit(ipOf(req), t)) return send(res, 429, '', { 'retry-after': '30' });
      if (sessionOf(req)) { await readJson(req).catch(() => null); return send(res, 204, ''); }           // Admin-Besuche zählen nie
      try { ingest(db, await readJson(req), t); } catch (e) { const st = (e as { status?: number }).status; if (st) return send(res, st, ''); }
      return send(res, 204, '');
    }
    if (p === '/robots.txt') return send(res, 200, `User-agent: *\nAllow: /\n\nSitemap: ${originOf(req)}/sitemap.xml\n`, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    if (p === '/sitemap.xml') return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${originOf(req)}/</loc></url>\n</urlset>\n`, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    if (p.startsWith('/api/')) return publicJson(res, 404, { error: 'Nicht gefunden.' });

    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, '', { allow: 'GET, HEAD' });
    const origin = originOf(req);
    const tpl = (html: string): string => html.replace(/__ORIGIN__/g, origin);
    const rel = p === '/' ? 'index.html' : p.slice(1);
    if (serveFile(req, res, env.gameDir, rel, {}, tpl)) return;
    send(res, 404, 'Nicht gefunden', { 'content-type': 'text/plain; charset=utf-8' });
  }

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    handle(req, res).catch((e: unknown) => {
      const st = (e as { status?: number }).status ?? 500;
      if (st === 500) console.error('[server]', e);
      if (!res.headersSent) json(res, st, { error: st === 500 ? 'Interner Fehler.' : String((e as Error).message) });
      else res.end();
    });
  };

  return {
    handler,
    listen(port: number, host: string): Promise<Server> {
      const srv = createServer(handler);
      srv.requestTimeout = 30_000;
      srv.headersTimeout = 15_000;
      return new Promise((r) => srv.listen(port, host, () => r(srv)));
    },
    maintenance(): void { purge(db, now(), env.retentionDays); },
    revokeAll: () => revokeAll(db),
  };
}
