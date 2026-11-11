import { DEFAULT_CONFIG, clone, normalize, withProfile } from '../src/config/runtime';
import { MAX_BODY, ingest } from './ingest';
import { DbLimiter, Limiter, checkPassword, createSession, findSession, passwordProblem, revokeSession, safeEqual, setPassword, type Session } from './auth';
import { ensureSchema, kvDel, kvGet, kvSet, purge, type D1Like, type Db } from './db';
import { activeEvent, check, currentVersion, draftDiff, getDraft, getVersion, isDirty, listVersions, publicConfig, publish, saveDraft } from './configStore';
import { compare, overview, type Period } from './kpi';
import { checkSite } from './seo';
import { randomToken, sha256Hex } from './crypto';
import * as gsc from './gsc';

/** Umgebung (Cloudflare Pages: Bindings, Variablen und Secrets; lokal: aus process.env gebildet). */
export interface AppEnv {
  DB?: D1Like;
  /** Geheimwert: PBKDF2-Hash des Admin-Passworts (npm run admin:hash). */
  ADMIN_PASSWORD_HASH?: string;
  /** Öffentliche Adresse, z. B. https://www.sunsetsideways.com (Canonical, Sitemap, Origin-Prüfung). */
  PUBLIC_ORIGIN?: string;
  APP_SECRET?: string;
  GSC_CLIENT_ID?: string; GSC_CLIENT_SECRET?: string;
  RETENTION_DAYS?: string; SESSION_IDLE_HOURS?: string; SESSION_ABSOLUTE_DAYS?: string;
  SEO_ALLOW_LOCAL?: string;
}

export interface Deps {
  env: AppEnv;
  db: Db;
  /** Objekt, an dem „Schema angelegt“ je Instanz vermerkt wird (D1-Binding bzw. die lokale Datenbank). */
  schemaKey?: object;
  now?: () => number;
  /** Statische Dateien des Deployments (Pages: env.ASSETS.fetch; lokal: Dateisystem). */
  assets?: (path: string) => Promise<Response | null>;
  fetchImpl?: typeof fetch;
  /** Hintergrundarbeit (Pages: waitUntil). */
  wait?: (p: Promise<unknown>) => void;
}

const num = (v: string | undefined, d: number): number => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : d; };
const CSP_ADMIN = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const PRIVATE: Record<string, string> = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-frame-options': 'DENY', 'content-security-policy': CSP_ADMIN, 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };

// Instanz-lokal (bestmöglich): hochfrequente Endpunkte. Anmeldeversuche werden dagegen in der Datenbank gezählt.
const limiters = new WeakMap<object, { ingest: Limiter; api: Limiter }>();
const limitersFor = (k: object): { ingest: Limiter; api: Limiter } => { let l = limiters.get(k); if (!l) { l = { ingest: new Limiter(120, 60_000), api: new Limiter(240, 60_000) }; limiters.set(k, l); } return l; };

export function createHandler(d: Deps): (req: Request) => Promise<Response | null> {
  const { env, db } = d;
  const { ingest: ingestLim, api: apiLim } = limitersFor(d.schemaKey ?? db);
  const now = d.now ?? Date.now;
  const idleMs = num(env.SESSION_IDLE_HOURS, 12) * 3600_000;
  const sopts = { idleMs, absoluteMs: num(env.SESSION_ABSOLUTE_DAYS, 7) * 86400_000 };
  const retentionDays = num(env.RETENTION_DAYS, 30);
  const loginFail = new DbLimiter(db, 8, 15 * 60_000), loginFailAll = new DbLimiter(db, 40, 15 * 60_000), pwFail = new DbLimiter(db, 5, 15 * 60_000);

  const ipOf = (req: Request): string => req.headers.get('cf-connecting-ip') ?? ((req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'lokal');
  const urlOrigin = (u: URL): string => u.origin;
  const originOf = (u: URL): string => (env.PUBLIC_ORIGIN ? new URL(env.PUBLIC_ORIGIN).origin : urlOrigin(u));

  const respond = (status: number, body: BodyInit | null, headers: Record<string, string | string[]> = {}): Response => {
    const h = new Headers();
    for (const [k, v] of Object.entries(headers)) for (const x of Array.isArray(v) ? v : [v]) h.append(k, x);
    return new Response(body, { status, headers: h });
  };
  const json = (status: number, data: unknown, extra: Record<string, string | string[]> = {}): Response => respond(status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', ...PRIVATE, ...extra });
  const publicJson = (status: number, data: unknown): Response => respond(status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });

  async function readJson(req: Request, max = MAX_BODY): Promise<unknown> {
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > max) throw Object.assign(new Error('Anfrage zu groß'), { status: 413 });
    const text = await req.text();
    if (text.length > max) throw Object.assign(new Error('Anfrage zu groß'), { status: 413 });
    if (!text) return {};
    try { return JSON.parse(text); } catch { throw Object.assign(new Error('Ungültiges JSON'), { status: 400 }); }
  }

  const secureOf = (u: URL): boolean => u.protocol === 'https:' || (env.PUBLIC_ORIGIN ?? '').startsWith('https://');
  const cookieName = (u: URL): string => (secureOf(u) ? '__Host-ssw_admin' : 'ssw_admin');
  const cookieOf = (req: Request, name: string): string | undefined => {
    for (const part of (req.headers.get('cookie') ?? '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
    return undefined;
  };
  const setCookie = (u: URL, token: string, maxAge: number): string => `${cookieName(u)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureOf(u) ? '; Secure' : ''}`;
  const sessionOf = (req: Request, u: URL): Promise<Session | null> => findSession(db, env.ADMIN_PASSWORD_HASH, cookieOf(req, cookieName(u)), now(), sopts);

  const sameOrigin = (req: Request, u: URL): boolean => {
    const o = req.headers.get('origin');
    return o === null || o === originOf(u) || o === urlOrigin(u);
  };
  const isJson = (req: Request): boolean => /^application\/json\b/i.test(req.headers.get('content-type') ?? '');

  // ---------------------------------------------------------------- Login-Seite
  async function loginPage(): Promise<Response> {
    const nonce = randomToken(16);
    const configured = !!env.ADMIN_PASSWORD_HASH || !!(await db.get('SELECT 1 AS x FROM admin WHERE id = 1'));
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="dark light"><title>Anmeldung · Sunset Sideways</title>
<style nonce="${nonce}">:root{--bg:#0d1020;--card:#161a33;--ink:#eef0ff;--mut:#9aa1c9;--line:#2a3058;--acc:#ff5fa8;--acc2:#5fe0ff}@media (prefers-color-scheme:light){:root{--bg:#f2f3fa;--card:#fff;--ink:#16193a;--mut:#555b86;--line:#d6d9ee}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,Segoe UI,sans-serif}
main{width:min(420px,100%);background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 24px;box-shadow:0 0 40px rgba(95,224,255,.07)}
h1{margin:0 0 4px;font-size:1.35rem}p{margin:0 0 18px;color:var(--mut)}label{display:block;font-weight:600;margin-bottom:6px}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);font:inherit}
input:focus-visible,button:focus-visible{outline:3px solid var(--acc2);outline-offset:2px}
button{margin-top:16px;width:100%;padding:13px;border:0;border-radius:10px;font:inherit;font-weight:700;color:#10122a;background:linear-gradient(90deg,var(--acc),var(--acc2));cursor:pointer}
button[disabled]{opacity:.6;cursor:wait}#msg{min-height:1.5em;margin-top:12px;color:#ff8a8a}</style></head>
<body><main><h1>Sunset Sideways · Admin</h1><p>${configured ? 'Bitte mit dem Admin-Passwort anmelden.' : 'Noch kein Passwort gesetzt. Siehe docs/DEPLOYMENT.md: ADMIN_PASSWORD_HASH setzen.'}</p>
<form id="f" autocomplete="on"><label for="pw">Passwort</label><input id="pw" name="password" type="password" autocomplete="current-password" required ${configured ? '' : 'disabled'} autofocus><button id="go" type="submit" ${configured ? '' : 'disabled'}>Anmelden</button><div id="msg" role="alert" aria-live="polite"></div></form></main>
<script nonce="${nonce}">const f=document.getElementById('f'),m=document.getElementById('msg'),b=document.getElementById('go');f.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;m.textContent='';try{const r=await fetch('/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value}),credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(r.ok){location.replace('/admin');return}m.textContent=r.status===429?'Zu viele Versuche. Bitte in '+(j.retryAfter||15)+' Sekunden erneut versuchen.':(j.error||'Anmeldung fehlgeschlagen.')}catch{m.textContent='Server nicht erreichbar.'}b.disabled=false});</script></body></html>`;
    return respond(200, html, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` });
  }

  // ---------------------------------------------------------------- Admin-API
  const eventState = async (t: number) => {
    const v = await currentVersion(db);
    if (!v || !v.config.event.on) return { state: 'off' as const, endsAt: null, remainingMs: 0, boost: 0 };
    const a = activeEvent(v, t);
    if (a) return { state: 'active' as const, endsAt: a.endsAt, remainingMs: a.endsAt - t, boost: v.config.event.glideBoost };
    return { state: 'expired' as const, endsAt: v.eventEnd, remainingMs: 0, boost: 0 };
  };

  async function stateBody(t: number) {
    const draft = await getDraft(db);
    const c = check(draft);
    const cur = await currentVersion(db);
    return {
      now: t, draft, issues: c.issues, analysis: c.analysis, defaults: DEFAULT_CONFIG,
      published: cur ? { id: cur.id, publishedAt: cur.publishedAt, label: cur.label, config: cur.config } : null,
      dirty: await isDirty(db), diff: await draftDiff(db), event: await eventState(t),
      versions: (await listVersions(db)).map((v) => ({ id: v.id, label: v.label, publishedAt: v.publishedAt, eventStart: v.eventStart, eventEnd: v.eventEnd, eventOn: v.config.event.on, profile: v.config.profile })),
    };
  }

  const q1 = (u: URL, k: string): string | null => { const v = u.searchParams.get(k); return v && v !== 'all' ? v : null; };
  const periodOf = (u: URL): Period => (['24h', '7d', '30d'].includes(u.searchParams.get('period') ?? '') ? u.searchParams.get('period') : '7d') as Period;
  const evOf = (u: URL): 'all' | 'event' | 'regular' => (['event', 'regular'].includes(u.searchParams.get('ev') ?? '') ? u.searchParams.get('ev') : 'all') as 'all' | 'event' | 'regular';
  const gscEnv = (u: URL): gsc.GscEnv => ({ clientId: env.GSC_CLIENT_ID, clientSecret: env.GSC_CLIENT_SECRET, appSecret: env.APP_SECRET, origin: originOf(u) });
  const domainOf = async (u: URL): Promise<string> => (await kvGet(db, 'domain')) ?? env.PUBLIC_ORIGIN ?? originOf(u);
  const seoOpts = (u: URL) => ({ allowHosts: [u.host, ...(env.PUBLIC_ORIGIN ? [new URL(env.PUBLIC_ORIGIN).host] : [])], allowLocal: env.SEO_ALLOW_LOCAL === '1' || env.SEO_ALLOW_LOCAL === 'true', fetchImpl: d.fetchImpl, now });

  async function adminApi(req: Request, u: URL): Promise<Response> {
    const path = u.pathname.slice('/api/admin'.length) || '/';
    const method = req.method;
    const t = now();

    if (path === '/login' && method === 'POST') {
      if (!sameOrigin(req, u) || !isJson(req)) return json(403, { error: 'Anfrage abgelehnt.' });
      const ip = `login:${ipOf(req)}`;
      if ((await loginFail.blocked(ip, t)) || (await loginFailAll.blocked('login:all', t))) { const ra = await loginFail.retryAfter(ip, t); return json(429, { error: 'Zu viele Versuche.', retryAfter: ra }, { 'retry-after': String(ra) }); }
      const body = (await readJson(req, 4096)) as { password?: unknown };
      if (typeof body.password !== 'string' || body.password.length > 400) return json(400, { error: 'Passwort fehlt.' });
      const r = await checkPassword(db, env.ADMIN_PASSWORD_HASH, body.password);
      if (!r.configured) return json(503, { error: 'Kein Passwort gesetzt (ADMIN_PASSWORD_HASH fehlt, siehe docs/DEPLOYMENT.md).' });
      if (!r.ok) { await loginFail.hit(ip, t); await loginFailAll.hit('login:all', t); return json(401, { error: 'Anmeldung fehlgeschlagen.' }); }
      await loginFail.reset(ip);
      const { token, session } = await createSession(db, t, sopts, req.headers.get('user-agent') ?? '', r.fp);
      return json(200, { ok: true, csrf: session.csrf }, { 'set-cookie': setCookie(u, token, Math.floor(idleMs / 1000)) });
    }

    // Alles Weitere: gültige Sitzung (serverseitig geprüft)
    const s = await sessionOf(req, u);
    if (!s) return json(401, { error: 'Nicht angemeldet.' });
    if (!apiLim.hit(s.id, t)) return json(429, { error: 'Zu viele Anfragen.' });
    if (method !== 'GET' && method !== 'HEAD') {
      if (!sameOrigin(req, u)) return json(403, { error: 'Herkunft nicht erlaubt.' });
      if (!isJson(req)) return json(415, { error: 'JSON erwartet.' });
      if (!safeEqual(req.headers.get('x-csrf-token') ?? '', s.csrf)) return json(403, { error: 'CSRF-Prüfung fehlgeschlagen.' });
    }

    if (path === '/me' && method === 'GET') return json(200, { ok: true, csrf: s.csrf });
    if (path === '/logout' && method === 'POST') { await revokeSession(db, s.id); return json(200, { ok: true }, { 'set-cookie': setCookie(u, '', 0) }); }
    if (path === '/password' && method === 'POST') {
      const b = (await readJson(req, 4096)) as { current?: unknown; next?: unknown };
      if (await pwFail.blocked('pw', t)) return json(429, { error: 'Zu viele Versuche.' });
      if (typeof b.current !== 'string' || typeof b.next !== 'string') return json(400, { error: 'Angaben fehlen.' });
      if (!(await checkPassword(db, env.ADMIN_PASSWORD_HASH, b.current)).ok) { await pwFail.hit('pw', t); return json(403, { error: 'Das aktuelle Passwort stimmt nicht.' }); }
      const prob = passwordProblem(b.next);
      if (prob) return json(400, { error: prob });
      await setPassword(db, env.ADMIN_PASSWORD_HASH, b.next, t);                 // beendet alle Sitzungen
      return json(200, { ok: true, relogin: true }, { 'set-cookie': setCookie(u, '', 0) });
    }

    // Einstellungen (Entwurf, Veröffentlichung, Versionen)
    if (path === '/settings' && method === 'GET') return json(200, await stateBody(t));
    if (path === '/settings' && method === 'PUT') { const b = (await readJson(req)) as { config?: unknown }; await saveDraft(db, b.config); return json(200, await stateBody(t)); }
    if (path === '/check' && method === 'POST') { const b = (await readJson(req)) as { config?: unknown }; const c = check(normalize(b.config)); return json(200, { issues: c.issues, analysis: c.analysis }); }
    if (path === '/settings/defaults' && method === 'POST') { await saveDraft(db, clone(DEFAULT_CONFIG)); return json(200, await stateBody(t)); }
    if (path === '/settings/profile' && method === 'POST') {
      const b = (await readJson(req)) as { profile?: unknown };
      if (b.profile !== 'relaxed' && b.profile !== 'arcade' && b.profile !== 'hard') return json(400, { error: 'Unbekanntes Profil.' });
      await saveDraft(db, withProfile(await getDraft(db), b.profile));
      return json(200, await stateBody(t));
    }
    if (path === '/publish' && method === 'POST') {
      const b = (await readJson(req)) as { label?: unknown };
      const r = await publish(db, t, typeof b.label === 'string' ? b.label : null);
      if (!r.ok) return json(409, { error: 'Die Einstellungen enthalten Konflikte.', blocking: r.blocking });
      return json(200, { ok: true, version: r.version.id, state: await stateBody(t) });
    }
    if (path === '/restore' && method === 'POST') {
      const b = (await readJson(req)) as { id?: unknown };
      const v = typeof b.id === 'number' ? await getVersion(db, b.id) : null;
      if (!v) return json(404, { error: 'Version nicht gefunden.' });
      await saveDraft(db, v.config);
      return json(200, await stateBody(t));
    }
    if (path === '/testdrive' && method === 'POST') {
      const token = randomToken(18);
      await kvSet(db, `td:${token}`, String(t + 30 * 60_000));
      return json(200, { token, url: `${originOf(u)}/?testdrive=${token}`, expiresAt: t + 30 * 60_000 });
    }

    // Kennzahlen
    if (path === '/stats' && method === 'GET') {
      if (d.wait) d.wait(purge(db, t, retentionDays).catch(() => undefined));
      return json(200, await overview(db, periodOf(u), t, { dev: q1(u, 'dev'), ver: q1(u, 'ver'), ev: evOf(u), cfg: q1(u, 'cfg') }));
    }
    if (path === '/stats/compare' && method === 'GET') {
      const a = q1(u, 'a'), b = q1(u, 'b');
      if (!a || !b) return json(400, { error: 'Zwei Versionen angeben.' });
      return json(200, { period: periodOf(u), ...(await compare(db, periodOf(u), t, a, b, { dev: q1(u, 'dev'), ver: q1(u, 'ver'), ev: evOf(u) })) });
    }

    // SEO
    if (path === '/seo' && method === 'GET') { const r = await kvGet(db, 'seo_report'); return json(200, { domain: await domainOf(u), publicOrigin: env.PUBLIC_ORIGIN ?? null, report: r ? JSON.parse(r) : null }); }
    if (path === '/seo/check' && method === 'POST') {
      const b = (await readJson(req, 2048)) as { domain?: unknown };
      let domain = await domainOf(u);
      if (typeof b.domain === 'string' && b.domain.trim()) {
        try { const x = new URL(b.domain.trim()); if (x.protocol !== 'http:' && x.protocol !== 'https:') throw new Error('x'); domain = x.origin; await kvSet(db, 'domain', domain); }
        catch { return json(400, { error: 'Bitte eine vollständige Adresse wie https://www.sunsetsideways.com angeben.' }); }
      }
      try {
        const report = await checkSite(domain, seoOpts(u));
        await kvSet(db, 'seo_report', JSON.stringify(report));
        return json(200, { domain, report });
      } catch (e) { return json(502, { error: (e as Error).message }); }
    }
    if (path.startsWith('/gsc')) return gscApi(req, u, path, method, t);
    return json(404, { error: 'Nicht gefunden.' });
  }

  async function gscApi(req: Request, u: URL, path: string, method: string, t: number): Promise<Response> {
    const e = gscEnv(u);
    if (path === '/gsc' && method === 'GET') {
      const connected = await gsc.isConnected(db);
      const base = { available: gsc.gscAvailable(e), connected, site: await kvGet(db, 'gsc_site'), redirectUri: gsc.redirectUri(e) };
      if (!connected) return json(200, base);
      try {
        const sites = await gsc.listSites(db, e, d.fetchImpl);
        const data = base.site ? await gsc.fetchData(db, e, t, u.searchParams.get('force') === '1', d.fetchImpl) : null;
        return json(200, { ...base, sites, data });
      } catch (err) { return json(200, { ...base, error: (err as Error).message }); }
    }
    if (path === '/gsc/connect' && method === 'POST') {
      if (!gsc.gscAvailable(e)) return json(400, { error: 'GSC_CLIENT_ID, GSC_CLIENT_SECRET und APP_SECRET sind nicht gesetzt.' });
      const state = randomToken(18);
      await kvSet(db, 'gsc_state', JSON.stringify({ h: await sha256Hex(state), exp: t + 10 * 60_000 }));
      return json(200, { url: gsc.authUrl(e, state) });
    }
    if (path === '/gsc/site' && method === 'POST') {
      const b = (await readJson(req, 2048)) as { site?: unknown };
      if (typeof b.site !== 'string') return json(400, { error: 'Property fehlt.' });
      const sites = await gsc.listSites(db, e, d.fetchImpl).catch(() => []);
      if (!sites.some((x) => x.siteUrl === b.site)) return json(400, { error: 'Diese Property ist nicht bestätigt oder nicht verfügbar.' });
      await kvSet(db, 'gsc_site', b.site); await kvDel(db, 'gsc_cache');
      return json(200, { ok: true });
    }
    if (path === '/gsc/disconnect' && method === 'POST') { await gsc.disconnect(db); return json(200, { ok: true }); }
    return json(404, { error: 'Nicht gefunden.' });
  }

  // Private Dateien der Admin-Oberfläche: nur mit gültiger Sitzung, nie zwischengespeichert
  async function privateAsset(path: string): Promise<Response> {
    const r = d.assets ? await d.assets(path) : null;
    if (!r || !r.ok) return json(404, { error: 'Nicht gefunden.' });
    const h = new Headers(r.headers);
    for (const [k, v] of Object.entries(PRIVATE)) h.set(k, v);
    h.delete('etag'); h.delete('last-modified');
    return new Response(r.body, { status: 200, headers: h });
  }

  // ---------------------------------------------------------------- Hauptverteiler (null = nicht zuständig → statische Datei bzw. Spielseite)
  return async (req: Request): Promise<Response | null> => {
    const u = new URL(req.url);
    const p = u.pathname;
    const method = req.method;
    const t = now();
    const mine = p === '/admin' || p.startsWith('/admin/') || p.startsWith('/_admin/') || p.startsWith('/api/');
    if (!mine && p !== '/robots.txt' && p !== '/sitemap.xml') return null;
    if (p === '/api/health') return publicJson(200, { ok: true });

    await ensureSchema(db, d.schemaKey ?? db);

    // OAuth-Rückkehr von Google: kommt ohne Sitzungscookie (SameSite=Strict); abgesichert durch den einmaligen, kurzlebigen state.
    if (p === '/api/admin/gsc/callback' && method === 'GET') {
      const raw = await kvGet(db, 'gsc_state');
      await kvDel(db, 'gsc_state');
      const st = raw ? (JSON.parse(raw) as { h: string; exp: number }) : null;
      const code = u.searchParams.get('code');
      const ok = !!st && st.exp > t && safeEqual(st.h, await sha256Hex(u.searchParams.get('state') ?? '')) && !!code;
      let msg = ok ? 'gsc=ok' : 'gsc=fehler';
      if (ok) { try { await gsc.connect(db, gscEnv(u), code!, d.fetchImpl); } catch { msg = 'gsc=fehler'; } }
      return respond(302, null, { location: `/admin#seo?${msg}`, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    }

    if (p === '/api/admin' || p.startsWith('/api/admin/')) return adminApi(req, u);

    if (p === '/admin' || p.startsWith('/admin/') || p.startsWith('/_admin/')) {
      const s = await sessionOf(req, u);
      if (!s) {
        if (method !== 'GET' && method !== 'HEAD') return json(401, { error: 'Nicht angemeldet.' });
        return loginPage();                                  // auch für /_admin/* – nie Dateiinhalt ohne Sitzung
      }
      if (p.startsWith('/_admin/')) return privateAsset(p);
      return privateAsset('/_admin/');                       // /admin und /admin/<Ansicht> → App-Shell
    }

    if (p === '/api/config' && method === 'GET') {
      const token = u.searchParams.get('preview');
      if (token) {
        const exp = /^[\w-]{8,64}$/.test(token) ? Number((await kvGet(db, `td:${token}`)) ?? 0) : 0;
        if (!exp || exp < t) return publicJson(404, { error: 'Testfahrt abgelaufen.' });
        const dr = await getDraft(db);
        return publicJson(200, { id: 'draft', config: dr, event: dr.event.on ? { id: 'preview', endsAt: t + dr.event.days * 86400_000 } : null });
      }
      return publicJson(200, await publicConfig(db, t));
    }
    if (p === '/api/e' && method === 'POST') {
      if (!ingestLim.hit(ipOf(req), t)) return respond(429, null, { 'retry-after': '30' });
      if (await sessionOf(req, u)) return respond(204, null);                          // Admin-Besuche zählen nie
      try { await ingest(db, await readJson(req), t); } catch (e) { const st = (e as { status?: number }).status; if (st) return respond(st, null); }
      if (d.wait && Math.random() < 0.01) d.wait(purge(db, t, retentionDays).catch(() => undefined));
      return respond(204, null);
    }
    if (p === '/robots.txt') return respond(200, `User-agent: *\nAllow: /\n\nSitemap: ${originOf(u)}/sitemap.xml\n`, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    if (p === '/sitemap.xml') return respond(200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${originOf(u)}/</loc></url>\n</urlset>\n`, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    return publicJson(404, { error: 'Nicht gefunden.' });
  };
}
