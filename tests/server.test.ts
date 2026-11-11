import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AppEnv } from '../server/app';
import { createNodeApp } from '../server/node';
import { ensureSchema, type Db } from '../server/db';
import { sqliteDb } from '../server/sqlite';
import { setPassword as setPw } from '../server/auth';
import { DEFAULT_CONFIG, clone } from '../src/config/runtime';

const PW = 'Ein-sehr-gutes-Passwort-1';
let clock = 1_800_000_000_000;
const dir = mkdtempSync(join(tmpdir(), 'ssw-'));
mkdirSync(join(dir, '_admin'), { recursive: true });
writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="de"><head><title>Spiel</title><link rel="canonical" href="__ORIGIN__/"></head><body><h1>Sunset</h1></body></html>');
writeFileSync(join(dir, '_admin', 'index.html'), '<!doctype html><title>ADMIN-APP</title>');

const baseEnv: AppEnv = { SEO_ALLOW_LOCAL: '1' };
const setPassword = (db: Db, pw: string, now: number): Promise<void> => setPw(db, undefined, pw, now);

interface Ctx { db: Db; srv: Server; url: string }
async function boot(env: Partial<AppEnv> = {}): Promise<Ctx> {
  const db = sqliteDb(':memory:');
  await ensureSchema(db, db);
  const app = createNodeApp({ db, env: { ...baseEnv, ...env }, dir, now: () => clock });
  const srv = await app.listen(0, '127.0.0.1');
  return { db, srv, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` };
}

class Client {
  cookie = ''; csrf = '';
  constructor(private c: Ctx) {}
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const h: Record<string, string> = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (body !== undefined) h['content-type'] = h['content-type'] ?? 'application/json';
    const r = await fetch(this.c.url + path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' });
    const sc = r.headers.get('set-cookie');
    if (sc) { const pair = sc.split(';')[0]; this.cookie = pair.endsWith('=') ? '' : pair; }
    return r;
  }
  async login(pw = PW): Promise<Response> {
    const r = await this.req('POST', '/api/admin/login', { password: pw });
    if (r.ok) this.csrf = ((await r.clone().json()) as { csrf: string }).csrf;
    return r;
  }
  w(method: string, path: string, body: unknown = {}): Promise<Response> { return this.req(method, path, body, { 'x-csrf-token': this.csrf }); }
}

describe('Anmeldung und Sitzungen', () => {
  let c: Ctx;
  beforeAll(async () => { c = await boot(); });
  afterAll(() => c.srv.close());

  it('ohne gesetztes Passwort ist keine Anmeldung möglich (503), Login-Seite sagt wie', async () => {
    const a = new Client(c);
    expect((await a.login('irgendwas-langes-123')).status).toBe(503);
    const page = await a.req('GET', '/admin');
    expect(await page.text()).toContain('ADMIN_PASSWORD_HASH');
  });

  it('private Seite und API ohne Sitzung: Login-Seite bzw. 401, nie Inhalt; alle mit no-store und noindex', async () => {
    await setPassword(c.db, PW, clock);
    const a = new Client(c);
    for (const p of ['/admin', '/admin/', '/admin/irgendwas', '/admin/assets/x.js']) {
      const r = await a.req('GET', p);
      const t = await r.text();
      expect(t).not.toContain('ADMIN-APP');
      expect(t).toContain('Anmeldung');
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('x-robots-tag')).toContain('noindex');
    }
    for (const p of ['/api/admin/settings', '/api/admin/me', '/api/admin/stats', '/api/admin/seo', '/api/admin/gsc', '/api/admin/stats/compare?a=1&b=2']) {
      const r = await a.req('GET', p);
      expect(r.status, p).toBe(401);
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
    for (const [m, p] of [['PUT', '/api/admin/settings'], ['POST', '/api/admin/publish'], ['POST', '/api/admin/testdrive'], ['POST', '/api/admin/password'], ['POST', '/api/admin/seo/check']] as const) {
      expect((await a.req(m, p, {})).status, p).toBe(401);
    }
  });

  it('Anmeldung: Cookie ist HttpOnly + SameSite=Strict, danach liefert /admin die App (no-store, noindex)', async () => {
    const a = new Client(c);
    const r = await a.login();
    expect(r.status).toBe(200);
    const sc = r.headers.get('set-cookie')!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Strict/);
    expect(sc).not.toMatch(/Secure/);                       // lokal über HTTP
    const page = await a.req('GET', '/admin');
    expect(await page.text()).toContain('ADMIN-APP');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('x-robots-tag')).toContain('noindex');
    expect((await a.req('GET', '/api/admin/settings')).status).toBe(200);
  });

  it('CSRF: schreibende Aufrufe brauchen Token, JSON und gleiche Herkunft', async () => {
    const a = new Client(c);
    await a.login();
    expect((await a.req('PUT', '/api/admin/settings', { config: DEFAULT_CONFIG })).status).toBe(403);                              // kein Token
    expect((await a.req('PUT', '/api/admin/settings', { config: DEFAULT_CONFIG }, { 'x-csrf-token': 'falsch' })).status).toBe(403);
    expect((await a.req('PUT', '/api/admin/settings', { config: DEFAULT_CONFIG }, { 'x-csrf-token': a.csrf, origin: 'https://boese.example' })).status).toBe(403);
    expect((await a.req('PUT', '/api/admin/settings', 'x=1', { 'x-csrf-token': a.csrf, 'content-type': 'text/plain' })).status).toBe(415);
    expect((await a.w('PUT', '/api/admin/settings', { config: DEFAULT_CONFIG })).status).toBe(200);
    expect((await a.req('PUT', '/api/admin/settings', { config: DEFAULT_CONFIG }, { 'x-csrf-token': a.csrf, origin: c.url })).status).toBe(200);
    // Login selbst: fremde Herkunft abgelehnt
    const b = new Client(c);
    expect((await b.req('POST', '/api/admin/login', { password: PW }, { origin: 'https://boese.example' })).status).toBe(403);
  });

  it('Abmelden beendet nur diese Sitzung; das alte Cookie ist danach wertlos', async () => {
    const a = new Client(c), b = new Client(c);
    await a.login(); await b.login();
    const old = a.cookie;
    expect((await a.w('POST', '/api/admin/logout')).status).toBe(200);
    const again = new Client(c); again.cookie = old;
    expect((await again.req('GET', '/api/admin/settings')).status).toBe(401);
    expect((await b.req('GET', '/api/admin/settings')).status).toBe(200);
  });

  it('Passwortwechsel beendet alle Sitzungen; altes Passwort gilt nicht mehr, kurzes wird abgelehnt', async () => {
    const a = new Client(c), b = new Client(c);
    await a.login(); await b.login();
    expect((await a.w('POST', '/api/admin/password', { current: 'falsch-falsch-123', next: 'Neues-Passwort-4567' })).status).toBe(403);
    expect((await a.w('POST', '/api/admin/password', { current: PW, next: 'kurz' })).status).toBe(400);
    expect((await a.w('POST', '/api/admin/password', { current: PW, next: 'Neues-Passwort-4567' })).status).toBe(200);
    const aOld = new Client(c); aOld.cookie = b.cookie;
    expect((await aOld.req('GET', '/api/admin/settings')).status).toBe(401);
    const n = new Client(c);
    expect((await n.login(PW)).status).toBe(401);
    expect((await n.login('Neues-Passwort-4567')).status).toBe(200);
    await setPassword(c.db, PW, clock);                                  // für die folgenden Tests zurück
  });

  it('Sitzung läuft nach Leerlauf ab (gleitend) und absolut nach 7 Tagen', async () => {
    const a = new Client(c);
    await a.login();
    const t0 = clock;
    clock = t0 + 11 * 3600_000;
    expect((await a.req('GET', '/api/admin/me')).status).toBe(200);          // innerhalb 12 h, verlängert
    clock = t0 + 22 * 3600_000;
    expect((await a.req('GET', '/api/admin/me')).status).toBe(200);          // 11 h nach der letzten Aktivität
    clock = t0 + 35 * 3600_000;
    expect((await a.req('GET', '/api/admin/me')).status).toBe(401);          // > 12 h Leerlauf
    clock = t0;
    const b = new Client(c);
    await b.login();
    for (let d = 1; d <= 6; d++) { clock = t0 + d * 20 * 3600_000; await b.req('GET', '/api/admin/me'); }
    clock = t0 + 7 * 86400_000 + 3600_000;
    expect((await b.req('GET', '/api/admin/me')).status).toBe(401);          // absolute Obergrenze
    clock = t0 + 8 * 86400_000;
  });

  it('Anmeldeversuche sind begrenzt: nach 8 Fehlversuchen 429 mit Retry-After, auch mit richtigem Passwort', async () => {
    const x = await boot();
    await setPassword(x.db, PW, clock);
    const a = new Client(x);
    for (let i = 0; i < 8; i++) expect((await a.login('falsch-falsch-12')).status).toBe(401);
    const r = await a.login(PW);
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    clock += 16 * 60_000;
    expect((await a.login(PW)).status).toBe(200);
    x.srv.close();
  });

  it('Produktion: __Host--Cookie mit Secure', async () => {
    const x = await boot({ PUBLIC_ORIGIN: 'https://spiel.example.de' });
    await setPassword(x.db, PW, clock);
    const r = await new Client(x).req('POST', '/api/admin/login', { password: PW }, { origin: 'https://spiel.example.de' });
    expect(r.status).toBe(200);
    const sc = r.headers.get('set-cookie')!;
    expect(sc).toMatch(/^__Host-ssw_admin=/);
    expect(sc).toMatch(/Secure/); expect(sc).toMatch(/HttpOnly/); expect(sc).toMatch(/SameSite=Strict/); expect(sc).toMatch(/Path=\//);
    x.srv.close();
  });
});

describe('Konfiguration, Veröffentlichung, Ereignis', () => {
  let c: Ctx, a: Client;
  beforeAll(async () => { c = await boot({ SESSION_IDLE_HOURS: String(24 * 90), SESSION_ABSOLUTE_DAYS: '365' }); await setPassword(c.db, PW, clock); a = new Client(c); await a.login(); });
  afterAll(() => c.srv.close());
  const pub = async (): Promise<{ id: string; config: typeof DEFAULT_CONFIG; event: { id: string; endsAt: number } | null }> => (await (await fetch(c.url + '/api/config')).json()) as never;
  const setDraft = (f: (x: typeof DEFAULT_CONFIG) => void): Promise<Response> => { const d = clone(DEFAULT_CONFIG); f(d); return a.w('PUT', '/api/admin/settings', { config: d }); };

  it('ohne Veröffentlichung liefert die API die eingebauten Standardwerte', async () => {
    const p = await pub();
    expect(p.id).toBe('builtin');
    expect(p.config.tempo.maxKmh).toBe(600);
  });

  it('Entwurf ist nicht öffentlich; Veröffentlichen vergibt Versions-ID, listet Änderungen und gilt für neue Abrufe', async () => {
    const r = await (await setDraft((d) => { d.tempo.maxKmh = 520; d.pickups.on.boost = false; })).json() as { dirty: boolean; diff: Array<{ label: string }> };
    expect(r.dirty).toBe(true);
    expect(r.diff.map((x) => x.label)).toEqual(expect.arrayContaining(['Höchstes Grundtempo', 'Phantom-Turbo']));
    expect((await pub()).config.tempo.maxKmh).toBe(600);
    const res = await a.w('POST', '/api/admin/publish', { label: 'Test A' });
    const j = await res.json() as { version: number };
    expect(res.status).toBe(200);
    expect(j.version).toBe(1);
    const p = await pub();
    expect(p.id).toBe('1');
    expect(p.config.tempo.maxKmh).toBe(520);
    expect(p.config.pickups.on.boost).toBe(false);
  });

  it('Konflikte blockieren das Veröffentlichen (Server-Validierung), unzulässige Werte werden begrenzt', async () => {
    await setDraft((d) => { d.scenery.nightKm = 16; d.scenery.duskKm = 15; });
    let st = await (await a.req('GET', '/api/admin/settings')).json() as { issues: Array<{ path: string; level: string }> };
    expect(st.issues.some((i) => i.path === 'scenery.nightKm' && i.level === 'error')).toBe(true);
    const r = await a.w('POST', '/api/admin/publish', {});
    expect(r.status).toBe(409);
    expect(((await r.json()) as { blocking: unknown[] }).blocking.length).toBeGreaterThan(0);
    expect((await pub()).id).toBe('1');                                                                                   // nichts geändert
    await setDraft((d) => { (d.tempo as unknown as Record<string, number>).maxKmh = 99999; });
    st = await (await a.req('GET', '/api/admin/settings')).json() as never;
    expect((st as unknown as { draft: typeof DEFAULT_CONFIG }).draft.tempo.maxKmh).toBe(700);
  });

  it('Kombination hohes Tempo + dichter Verkehr + niedrige Empfindlichkeit wird am Regler gemeldet und blockiert', async () => {
    await setDraft((d) => { d.tempo.maxKmh = 700; d.tempo.density = 1.6; d.traffic.minGap = 0.4; d.controls.key = 0.5; d.controls.touch = 0.5; });
    const st = await (await a.req('GET', '/api/admin/settings')).json() as { issues: Array<{ path: string; level: string; msg: string }> };
    expect(st.issues.some((i) => i.path === 'controls.key' && i.level === 'error')).toBe(true);
    expect((await a.w('POST', '/api/admin/publish', {})).status).toBe(409);
  });

  it('Flugwoche: startet mit dem Veröffentlichen, endet automatisch, wird durch andere Änderungen nicht neu gestartet', async () => {
    await setDraft((d) => { d.event.on = true; d.event.days = 2; d.event.glideBoost = 0.9; });
    const t0 = clock;
    const v2 = (await (await a.w('POST', '/api/admin/publish', { label: 'Woche' })).json()) as { version: number };
    let p = await pub();
    expect(p.event?.endsAt).toBe(t0 + 2 * 86400_000);
    expect(p.id).toBe(String(v2.version));
    clock = t0 + 86400_000;
    await setDraft((d) => { d.event.on = true; d.event.days = 2; d.event.glideBoost = 0.9; d.tempo.maxKmh = 580; });
    await a.w('POST', '/api/admin/publish', {});
    p = await pub();
    expect(p.event?.endsAt).toBe(t0 + 2 * 86400_000);                                // Ende bleibt
    clock = t0 + 2 * 86400_000 + 1;
    p = await pub();
    expect(p.event).toBeNull();                                                      // abgelaufen → reguläre Konfiguration
    expect(p.config.tempo.maxKmh).toBe(580);
    const st = await (await a.req('GET', '/api/admin/settings')).json() as { event: { state: string } };
    expect(st.event.state).toBe('expired');
  });

  it('Wiederherstellen lädt eine alte Version in den Entwurf, ohne sie zu veröffentlichen', async () => {
    const r = await (await a.w('POST', '/api/admin/restore', { id: 1 })).json() as { draft: typeof DEFAULT_CONFIG; dirty: boolean };
    expect(r.draft.tempo.maxKmh).toBe(520);
    expect(r.dirty).toBe(true);
    expect((await pub()).config.tempo.maxKmh).toBe(580);
    expect((await a.w('POST', '/api/admin/restore', { id: 999 })).status).toBe(404);
  });

  it('„Standardwerte laden“ und Profile wirken auf den Entwurf', async () => {
    const d = await (await a.w('POST', '/api/admin/settings/defaults')).json() as { draft: typeof DEFAULT_CONFIG };
    expect(d.draft).toEqual(DEFAULT_CONFIG);
    const h = await (await a.w('POST', '/api/admin/settings/profile', { profile: 'hard' })).json() as { draft: typeof DEFAULT_CONFIG };
    expect(h.draft.profile).toBe('hard');
    expect(h.draft.tempo.startKmh).toBeGreaterThan(DEFAULT_CONFIG.tempo.startKmh);
  });

  it('Testfahrt: Token liefert den Entwurf (nicht den veröffentlichten Stand), ungültige Token nicht', async () => {
    await setDraft((d) => { d.tempo.startKmh = 150; });
    const t = (await (await a.w('POST', '/api/admin/testdrive')).json()) as { token: string; url: string };
    expect(t.url).toContain('/?testdrive=');
    const pv = await (await fetch(`${c.url}/api/config?preview=${t.token}`)).json() as { id: string; config: typeof DEFAULT_CONFIG };
    expect(pv.id).toBe('draft');
    expect(pv.config.tempo.startKmh).toBe(150);
    expect((await fetch(`${c.url}/api/config?preview=gibtesnicht1234`)).status).toBe(404);
    clock += 31 * 60_000;
    expect((await fetch(`${c.url}/api/config?preview=${t.token}`)).status).toBe(404);
  });
});

describe('Messung und Kennzahlen mit bekannten Testdaten', () => {
  let c: Ctx, a: Client;
  const post = (body: unknown, headers: Record<string, string> = {}): Promise<Response> => fetch(c.url + '/api/e', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const hex = (n: number, len = 12): string => n.toString(16).padStart(len, '0');
  beforeAll(async () => { clock += 10 * 86400_000; c = await boot(); await setPassword(c.db, PW, clock); a = new Client(c); await a.login(); });
  afterAll(() => c.srv.close());

  it('Zähl- und Prozentwerte stimmen mit dem bekannten Datensatz überein', async () => {
    // Besuche: 10 (6 Desktop, 4 Smartphone). Läufe: V1 2 Läufe, V2 1, V3 1, V4–V6 je 1 → 7 Läufe von 6 Besuchen.
    const t0 = clock;
    const visit = (i: number) => hex(100 + i);
    for (let i = 1; i <= 10; i++) await post({ v: visit(i), ver: '0.1.0', dev: i <= 6 ? 'desktop' : 'phone', events: [{ t: 'view' }] });
    const run = (v: number, r: number, dist: number, reason = 'crash', cause = 'taxi', miles: number[] = [], cfg = 'builtin') => post({ v: visit(v), ver: '0.1.0', dev: v <= 6 ? 'desktop' : 'phone', events: [
      { t: 'start', r: hex(r, 16), d: { cfg, ev: null } }, ...miles.map((m) => ({ t: 'mile', r: hex(r, 16), k: String(m) })), { t: 'end', r: hex(r, 16), d: { dist, reason, cause } }] });
    await run(1, 1, 800); await run(1, 2, 3200, 'crash', 'truck', [1000]);
    await run(2, 3, 6000, 'crash', 'taxi', [1000, 5000]);
    await run(3, 4, 16000, 'crash', 'cabrio', [1000, 5000, 15000]);
    await run(4, 5, 2500, 'restart', undefined, [1000]);
    await run(5, 6, 21000, 'crash', 'truck', [1000, 5000, 15000, 20000]);
    await run(6, 7, 28000, 'crash', 'taxi', [1000, 5000, 15000, 20000, 27000]);
    // Läufe ohne Endereignis (abgebrochen)
    await post({ v: visit(7), ver: '0.1.0', dev: 'phone', events: [{ t: 'start', r: hex(8, 16), d: { cfg: 'builtin' } }] });

    const k = await (await a.req('GET', '/api/admin/stats?period=24h')).json() as {
      cards: { views: number; runs: number; startRate: { num: number; den: number; value: number }; repeatRate: { num: number; den: number }; medianDist: { value: number; n: number } };
      metrics: { runs: number; withEnd: number; noEnd: number; reach: Array<{ count: number; share: number }>; crash: { n: number; causes: Array<{ cause: string; count: number }>; bins: Array<{ count: number }> }; dist: { median: number; p90: number } };
      series: { cur: number[] }; coverage: { status: string };
    };
    expect(k.cards.views).toBe(10);
    expect(k.cards.runs).toBe(8);
    expect(k.cards.startRate).toMatchObject({ num: 7, den: 10 });                 // Besuche 1–7 haben mindestens einen Lauf
    expect(k.cards.repeatRate).toMatchObject({ num: 1, den: 7 });                 // nur Besuch 1 hat zwei Läufe
    expect(k.metrics.withEnd).toBe(7); expect(k.metrics.noEnd).toBe(1);
    expect(k.cards.medianDist).toMatchObject({ n: 7, value: 6000 });              // 800, 2500, 3200, 6000, 16000, 21000, 28000
    expect(k.metrics.dist.p90).toBe(28000);
    expect(k.metrics.reach.map((r) => r.count)).toEqual([6, 4, 3, 2, 1]);         // 1/5/15/20/27 km, Basis 8 Läufe
    expect(k.metrics.reach[0].share).toBeCloseTo(6 / 8);
    expect(k.metrics.crash.n).toBe(6);
    expect(k.metrics.crash.causes.slice(0, 2)).toMatchObject([{ cause: 'taxi', count: 3 }, { cause: 'truck', count: 2 }]);
    expect(k.metrics.crash.bins[0].count).toBe(1); expect(k.metrics.crash.bins[3].count).toBe(1); expect(k.metrics.crash.bins[28].count).toBe(1);
    expect(k.series.cur.reduce((x, y) => x + y, 0)).toBe(8);
    expect(k.coverage.status).not.toBe('nodata');
    // Filter Smartphone: Besuche 7–10
    const ph = await (await a.req('GET', '/api/admin/stats?period=24h&dev=phone')).json() as { cards: { views: number; runs: number } };
    expect(ph.cards.views).toBe(4);
    expect(ph.cards.runs).toBe(1);
    // Vorperiode: leer → 0 Läufe, Vergleich zeigt Basis 0
    const prev = await (await a.req('GET', '/api/admin/stats?period=24h')).json() as { prevCards: { runs: number; views: number } };
    expect(prev.prevCards.runs).toBe(0);
    void t0;
  });

  it('Power-ups: je Objekt höchstens einmal sichtbar/eingesammelt, Sammelquote und erste Fliegen-Strecke', async () => {
    const v = hex(900), r = hex(901, 16), r2 = hex(902, 16);
    const ev = (t: string, rr: string, k: string, type: string, s: number) => ({ t, r: rr, k, d: { type, s } });
    await post({ v, ver: '0.1.0', dev: 'desktop', events: [
      { t: 'start', r, d: { cfg: 'builtin' } }, { t: 'start', r: r2, d: { cfg: 'builtin' } },
      ev('seen', r, 'glide@900', 'glide', 700), ev('seen', r, 'glide@900', 'glide', 710), ev('taken', r, 'glide@900', 'glide', 900), ev('taken', r, 'glide@900', 'glide', 900),
      ev('seen', r, 'shield#5', 'shield', 1200), ev('seen', r, 'magnet#6', 'magnet', 1500), ev('taken', r, 'magnet#6', 'magnet', 1560),
      ev('seen', r2, 'glide@1500', 'glide', 1300),
    ] });
    const k = await (await a.req('GET', '/api/admin/stats?period=24h')).json() as { metrics: { pickups: Array<{ type: string; seen: number; taken: number; rate: number | null }>; glideFirst: { median: number; n: number } } };
    const get = (t: string) => k.metrics.pickups.find((p) => p.type === t)!;
    expect(get('glide')).toMatchObject({ seen: 2, taken: 1, rate: 0.5 });
    expect(get('shield')).toMatchObject({ seen: 1, taken: 0, rate: 0 });
    expect(get('magnet')).toMatchObject({ seen: 1, taken: 1, rate: 1 });
    expect(get('boost')).toMatchObject({ seen: 0, taken: 0, rate: null });          // keine Daten ≠ 0 %
    expect(k.metrics.glideFirst).toMatchObject({ n: 2, median: 700 });              // erste Sichtung je Lauf: 700 und 1300 → Median (nearest rank) 700
  });

  it('Ereignisse werden geprüft, dedupliziert und nicht ausgewertet, wenn sie zu einem Admin-Browser gehören', async () => {
    const before = await (await a.req('GET', '/api/admin/stats?period=24h')).json() as { cards: { runs: number; views: number } };
    const bad = [{ v: 'nicht-hex!', events: [{ t: 'start', r: hex(1, 16) }] }, { v: hex(5), events: 'x' }, { v: hex(6), events: [{ t: 'start' }, { t: 'boom', r: hex(2, 16) }, { t: 'end', r: hex(3, 16), d: { dist: -5, reason: 'crash' } }, null, 5] }];
    for (const b of bad) expect((await post(b)).status).toBe(204);
    const dup = { v: hex(777), ver: '0.1.0', dev: 'desktop', events: [{ t: 'start', r: hex(778, 16), d: { cfg: 'builtin' } }, { t: 'start', r: hex(778, 16), d: { cfg: 'builtin' } }, { t: 'end', r: hex(778, 16), d: { dist: 1000, reason: 'crash', cause: 'taxi' } }, { t: 'end', r: hex(778, 16), d: { dist: 9999, reason: 'leave' } }] };
    await post(dup); await post(dup);
    // Admin-Sitzung sendet: wird verworfen
    const adminPost = await fetch(c.url + '/api/e', { method: 'POST', headers: { 'content-type': 'application/json', cookie: a.cookie }, body: JSON.stringify({ v: hex(888), ver: '0.1.0', dev: 'desktop', events: [{ t: 'start', r: hex(889, 16), d: { cfg: 'builtin' } }] }) });
    expect(adminPost.status).toBe(204);
    const after = await (await a.req('GET', '/api/admin/stats?period=24h')).json() as { cards: { runs: number; views: number }; metrics: { dist: { n: number } } };
    expect(after.cards.runs).toBe(before.cards.runs + 1);                               // genau ein neuer Lauf (dedupliziert), Admin-Lauf nicht gezählt
    const row = await c.db.get<{ end_dist: number; end_reason: string }>('SELECT end_dist, end_reason FROM runs WHERE run = ?', hex(778, 16));
    expect(row).toMatchObject({ end_dist: 1000, end_reason: 'crash' });                // erstes Ende zählt
    expect(await c.db.get('SELECT 1 FROM runs WHERE run = ?', hex(889, 16))).toBeUndefined();
  });

  it('zu große Anfragen und zu viele Anfragen werden abgewehrt', async () => {
    expect((await post({ v: hex(1), events: [{ t: 'view', pad: 'x'.repeat(40_000) }] })).status).toBe(413);
    const x = await boot();
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await fetch(x.url + '/api/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status;
    expect(last).toBe(429);
    x.srv.close();
  });

  it('Versionsvergleich: Läufe werden der beim Start verwendeten Konfiguration zugeordnet', async () => {
    const x = await boot(); await setPassword(x.db, PW, clock);
    const b = new Client(x); await b.login();
    const d1 = clone(DEFAULT_CONFIG); d1.tempo.maxKmh = 520;
    await b.w('PUT', '/api/admin/settings', { config: d1 }); await b.w('POST', '/api/admin/publish', { label: 'A' });   // Version 1
    const d2 = clone(DEFAULT_CONFIG);
    await b.w('PUT', '/api/admin/settings', { config: d2 }); await b.w('POST', '/api/admin/publish', { label: 'B' });   // Version 2
    const send = (v: number, r: number, cfg: string, dist: number) => fetch(x.url + '/api/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: hex(v), ver: '0.1.0', dev: 'desktop', events: [{ t: 'view' }, { t: 'start', r: hex(r, 16), d: { cfg } }, { t: 'end', r: hex(r, 16), d: { dist, reason: 'crash', cause: 'taxi' } }] }) });
    await send(1, 1, '1', 1000); await send(2, 2, '1', 3000); await send(3, 3, '2', 9000); await send(4, 4, '999', 5000);   // unbekannte Version → eingebaut
    const cmp = await (await b.req('GET', '/api/admin/stats/compare?period=24h&a=1&b=2')).json() as { a: { runs: number; dist: { median: number } }; b: { runs: number; dist: { median: number } } };
    expect(cmp.a.runs).toBe(2); expect(cmp.a.dist.median).toBe(1000);
    expect(cmp.b.runs).toBe(1); expect(cmp.b.dist.median).toBe(9000);
    const only = await (await b.req('GET', '/api/admin/stats?period=24h&cfg=builtin')).json() as { cards: { runs: number; views: number | null; startRate: unknown } };
    expect(only.cards.runs).toBe(1);
    expect(only.cards.views).toBeNull(); expect(only.cards.startRate).toBeNull();     // Aufrufe sind keiner Version zugeordnet
    x.srv.close();
  });

  it('keine Daten ist nicht „0“: leere Datenbank meldet nodata', async () => {
    const x = await boot(); await setPassword(x.db, PW, clock);
    const b = new Client(x); await b.login();
    const k = await (await b.req('GET', '/api/admin/stats?period=7d')).json() as { coverage: { status: string }; cards: { runs: number } };
    expect(k.coverage.status).toBe('nodata');
    x.srv.close();
  });
});

describe('Öffentliche Seiten und SEO', () => {
  let c: Ctx, a: Client;
  beforeAll(async () => { c = await boot(); await setPassword(c.db, PW, clock); a = new Client(c); await a.login(); });
  afterAll(() => c.srv.close());

  it('Startseite wird ohne Anmeldung geliefert, Canonical zeigt auf die Domain; robots.txt und sitemap.xml ohne /admin', async () => {
    const html = await (await fetch(c.url + '/')).text();
    expect(html).toContain(`href="${c.url}/"`);
    const robots = await (await fetch(c.url + '/robots.txt')).text();
    expect(robots).toContain(`Sitemap: ${c.url}/sitemap.xml`);
    expect(robots).not.toMatch(/admin/i);
    const sm = await (await fetch(c.url + '/sitemap.xml')).text();
    expect(sm).toContain(`<loc>${c.url}/</loc>`);
    expect(sm).not.toMatch(/admin/);
  });

  it('SEO-Check liefert je Prüfpunkt Status, gefundenen Wert und Behebung – ohne Search Console', async () => {
    const r = await (await a.w('POST', '/api/admin/seo/check', { domain: c.url })).json() as { report: { checks: Array<{ id: string; status: string; found: string; fix: string }> } };
    const byId = Object.fromEntries(r.report.checks.map((x) => [x.id, x]));
    for (const id of ['http', 'title', 'description', 'h1', 'lang', 'canonical', 'robots', 'sitemap', 'indexable', 'social', 'admin']) expect(byId[id], id).toBeTruthy();
    expect(byId.http.status).toBe('ok');
    expect(byId.canonical.status).toBe('ok');                  // Platzhalter wurde ersetzt
    expect(byId.robots.status).toBe('ok');
    expect(byId.sitemap.status).toBe('ok');
    expect(byId.admin.status).toBe('ok');                      // /admin: noindex + no-store
    expect(byId.description.status).toBe('fail');             // Test-Startseite hat keine Beschreibung → konkrete Behebung
    expect(byId.description.fix).toContain('meta name="description"');
    expect(byId.title.found).toContain('Spiel');
    const gsc = await (await a.req('GET', '/api/admin/gsc')).json() as { available: boolean; connected: boolean };
    expect(gsc).toMatchObject({ available: false, connected: false });                     // ohne Verbindung bleibt alles benutzbar
  });

  it('SEO-Check erkennt noindex, fehlende Seite und schützt vor Zielen in privaten Netzen', async () => {
    const fake = (async (u: unknown) => {
      const url = String(u);
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } });
      if (url.endsWith('/sitemap.xml')) return new Response('', { status: 404 });
      return new Response('<html><head><meta name="robots" content="noindex"><title>A</title></head><body></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const { checkSite } = await import('../server/seo');
    const rep = await checkSite('https://example.org', { allowHosts: [], allowLocal: true, fetchImpl: fake });
    const by = Object.fromEntries(rep.checks.map((x) => [x.id, x]));
    expect(by.indexable.status).toBe('fail'); expect(by.robots.status).toBe('fail'); expect(by.sitemap.status).toBe('fail');
    expect(by.title.status).toBe('warn'); expect(by.h1.status).toBe('fail'); expect(by.lang.status).toBe('fail');
    await expect(checkSite('http://192.168.1.10', { allowHosts: [], fetchImpl: fake })).resolves.toMatchObject({ checks: [expect.objectContaining({ id: 'http', status: 'fail' })] });
  });
});

describe('Passwort als Cloudflare-Secret (ADMIN_PASSWORD_HASH)', () => {
  it('Hash-Format, Anmeldung mit dem Secret, Änderung im Admin, Austausch des Secrets setzt zurück', async () => {
    const { hashPassword, verifyPassword } = await import('../server/crypto');
    const h1 = await hashPassword('Geheimes-Passwort-001');
    expect(h1).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await verifyPassword('Geheimes-Passwort-001', h1)).toBe(true);
    expect(await verifyPassword('Geheimes-Passwort-002', h1)).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2-sha256$999999999$AA==$AA==')).toBe(false);       // überhöhte Iterationszahl wird abgelehnt
    const x = await boot({ ADMIN_PASSWORD_HASH: h1 });
    const a = new Client(x);
    expect((await a.login('Geheimes-Passwort-002')).status).toBe(401);
    expect((await a.login('Geheimes-Passwort-001')).status).toBe(200);
    // Änderung im Admin (D1) gilt, solange das Secret gleich bleibt – und beendet die Sitzung
    expect((await a.w('POST', '/api/admin/password', { current: 'Geheimes-Passwort-001', next: 'Anderes-Passwort-5555' })).status).toBe(200);
    const b = new Client(x);
    expect((await b.login('Geheimes-Passwort-001')).status).toBe(401);
    expect((await b.login('Anderes-Passwort-5555')).status).toBe(200);
    x.srv.close();
    // Neues Secret (vergessenes Passwort): gewinnt gegenüber dem in der Datenbank geänderten Passwort, alte Sitzungen sind ungültig
    const h2 = await hashPassword('Notfall-Passwort-9999');
    const y = await boot({ ADMIN_PASSWORD_HASH: h1 });
    await setPw(y.db, h1, 'Anderes-Passwort-5555', clock);
    const c2 = new Client(y);
    expect((await c2.login('Anderes-Passwort-5555')).status).toBe(200);
    y.srv.close();
    const z = await boot({ ADMIN_PASSWORD_HASH: h2 });
    expect((await new Client(z).login('Notfall-Passwort-9999')).status).toBe(200);
    z.srv.close();
  });
});
