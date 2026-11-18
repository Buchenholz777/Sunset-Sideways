import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createNodeApp } from '../server/node';
import { ensureSchema, type Db } from '../server/db';
import { sqliteDb } from '../server/sqlite';
import { setPassword as setPw } from '../server/auth';
import { BALANCE as B } from '../src/config/balance';
import { cleanName, isOffensive } from '../src/leaderboard/names';
import { plausibility } from '../server/leaderboard';
import { travelTime } from '../src/core/speed';

let clock = 1_800_000_000_000;
const dir = mkdtempSync(join(tmpdir(), 'ssw-lb-'));
mkdirSync(join(dir, '_admin'), { recursive: true });
writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Spiel</title>');
writeFileSync(join(dir, '_admin', 'index.html'), '<!doctype html><title>ADMIN</title>');
const PW = 'Ein-sehr-gutes-Passwort-1';
let ipN = 0;

interface Ctx { db: Db; srv: Server; url: string }
async function boot(): Promise<Ctx> {
  const db = sqliteDb(':memory:');
  await ensureSchema(db, db);
  await setPw(db, undefined, PW, clock);
  const app = createNodeApp({ db, env: { SEO_ALLOW_LOCAL: '1' }, dir, now: () => clock, trustProxy: true });
  const srv = await app.listen(0, '127.0.0.1');
  return { db, srv, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` };
}

let c: Ctx;
beforeAll(async () => { c = await boot(); });
afterAll(() => c.srv.close());

/** Jede Anfrage von einer eigenen IP, damit sich die Ratenbegrenzungen der Tests nicht gegenseitig auslösen. */
const post = (path: string, body: unknown, ip = `10.0.0.${++ipN}`, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(c.url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers }, body: JSON.stringify(body) });
const get = (path: string, ip = `10.1.0.${++ipN}`): Promise<Response> => fetch(c.url + path, { headers: { 'x-forwarded-for': ip } });

async function guest(): Promise<string> { return ((await (await post('/api/lb/guest', {})).json()) as { token: string }).token; }
/** Ein plausibler Lauf: ≈ 1,2 km in passender Fahrzeit, Ticket wird bei Spielbeginn ausgestellt, Einreichung nach der Spielzeit. */
async function playAndSubmit(token: string, over: Record<string, unknown> = {}, mode = 'endless', ip?: string): Promise<{ r: Response; j: any }> {
  const t = (await (await post('/api/lb/start', { mode })).json()) as { ticket: string };
  const dist = (over.dist as number) ?? 1200;
  const dur = (over.dur as number) ?? Math.ceil(travelTime(0, dist)) + 2;
  clock += dur * 1000 + 500;
  const body = { token, ticket: t.ticket, name: 'NEONRIDER', score: 800, dist, dur, nm: 4, gp: 0, ver: 'test', rules: B.leaderboard.scoreRulesVersion, ...over };
  const r = await post('/api/lb/submit', body, ip);
  return { r, j: await r.json() };
}
const topOf = async (mode = 'endless', period = 'all'): Promise<{ entries: { rank: number; name: string; score: number; dist: number }[] }> => (await get(`/api/lb/top?mode=${mode}&period=${period}`)).json() as never;

describe('Spielername', () => {
  it('gültige Namen (3–16 Zeichen) werden akzeptiert und bereinigt', () => {
    for (const n of ['NEONRIDER', 'SUNSETKING', 'FASTLANE', 'Ali', 'Max Power', 'a_b-c.d', 'ÄÖÜ-Fan', 'x'.repeat(16)]) expect(cleanName(n).ok, n).toBe(true);
    expect(cleanName('  Max   Power  ')).toEqual({ ok: true, name: 'Max Power' });
  });
  it('zu kurz, zu lang, leer, kein Text', () => {
    for (const n of ['', 'ab', ' a ', 'x'.repeat(17), null, 5, undefined, {}]) expect(cleanName(n).ok, String(n)).toBe(false);
  });
  it('HTML, Scripts und Sonderzeichen sind nicht möglich', () => {
    for (const n of ['<script>alert(1)</script>', '<b>fett</b>', 'a"b"c', "x'y'z", 'a&b&c', 'name;drop', 'javascript:1', '../etc', 'a\u0000bc', 'ab\ncd'.replace('\n', '\u0007')]) expect(cleanName(n).ok, n).toBe(false);
  });
  it('offensichtliche Beleidigungen (auch mit Ziffern/Wiederholungen) werden abgewiesen, harmlose Namen nicht', () => {
    for (const n of ['Arschloch', 'fUcK you', 'Sch3iss3', 'f.u.c.k', 'H1tler', 'Nazi99', 'wiiichser']) expect(isOffensive(n) || !cleanName(n).ok, n).toBe(true);
    for (const n of ['Class', 'Assist', 'Therapist', 'Grape', 'Skillz', 'Heilbronn', 'Sauber']) expect(cleanName(n).ok, n).toBe(true);
  });
});

describe('Plausibilität', () => {
  const ok = { mode: 'endless' as const, score: 800, dist: 1200, dur: Math.ceil(travelTime(0, 1200)) + 2, nm: 4, gp: 0 };
  const wall = ok.dur + 1;
  it('realistischer Lauf wird akzeptiert', () => expect(plausibility(ok, wall)).toBeNull());
  it('negative, fehlende und nicht ganzzahlige Werte werden abgelehnt', () => {
    for (const bad of [{ score: -1 }, { dist: -5 }, { nm: 1.5 }, { score: NaN }, { dur: NaN }, { gp: -1 }]) expect(plausibility({ ...ok, ...bad } as never, wall), JSON.stringify(bad)).not.toBeNull();
  });
  it('unrealistische Werte: Höchstwerte, Fahrzeit zu kurz/lang, Wanduhr, Punkte ohne Near Misses', () => {
    expect(plausibility({ ...ok, score: B.leaderboard.submissionLimits.maxScore + 1 }, wall)).not.toBeNull();
    expect(plausibility({ ...ok, dist: B.leaderboard.submissionLimits.maxDistM + 1 }, wall)).not.toBeNull();
    expect(plausibility({ ...ok, dur: 4 }, 100)).not.toBeNull();                      // 1,2 km in 4 s
    expect(plausibility({ ...ok, dur: ok.dur * 10 }, ok.dur * 10)).not.toBeNull();    // viel zu langsam für die Distanz
    expect(plausibility(ok, 3)).not.toBeNull();                                        // schneller eingereicht als gespielt
    expect(plausibility(ok, 13 * 3600)).not.toBeNull();                                // Ticket zu alt
    expect(plausibility({ ...ok, score: 100_000 }, wall)).not.toBeNull();              // Punkte passen nicht zu 4 Near Misses
    expect(plausibility({ ...ok, nm: 9999 }, wall)).not.toBeNull();                    // Near-Miss-Rate unmöglich
    expect(plausibility({ ...ok, gp: 900, nm: 2 }, wall)).not.toBeNull();              // Rush-Punkte ohne Near Misses
  });
  it('Rush-Punkte nur mit genug Near Misses und höchstens 900 je Rush', () => {
    const run = { ...ok, dist: 6000, dur: Math.ceil(travelTime(0, 6000)) + 2, nm: 40, gp: 900, score: 900 + 3000 };
    expect(plausibility(run, run.dur + 1)).toBeNull();
    expect(plausibility({ ...run, gp: 901 * 40 }, run.dur + 1)).not.toBeNull();
  });
  it('Sunset Sprint: Distanz höchstens bis zum Ziel', () => {
    expect(plausibility({ ...ok, mode: 'sprint', dist: 10_000_00 }, 1e5)).not.toBeNull();
  });
});

describe('Weltrangliste (API)', () => {
  it('im Produktivbetrieb ohne Einträge: leere Liste, keine erfundenen Datensätze', async () => {
    const j = await topOf();
    expect(j.entries).toEqual([]);
    expect((await topOf('sprint', '7d')).entries).toEqual([]);
  });
  it('Lesen ist öffentlich, ungültige Parameter werden abgewiesen, Fehlaufrufe zerstören nichts', async () => {
    expect((await get('/api/lb/top?mode=x')).status).toBe(400);
    expect((await get('/api/lb/top?mode=endless&period=y')).status).toBe(400);
    expect((await get('/api/lb/nichts')).status).toBe(405);
    expect((await post('/api/lb/submit', 'kaputt' as never)).status).toBeLessThan(500);
    expect((await fetch(c.url + '/api/lb/submit', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.9' }, body: '{kaputt' })).status).toBe(400);
    expect((await post('/api/lb/submit', {}, undefined, { 'content-type': 'text/plain' })).status).toBe(403);
  });
  it('kein direktes Schreiben ohne gültige Berechtigung: gefälschtes Gast- und Lauf-Ticket werden abgelehnt', async () => {
    const token = await guest();
    const good = (await (await post('/api/lb/start', { mode: 'endless' })).json()) as { ticket: string };
    const body = { token, ticket: good.ticket, name: 'Hacker', score: 1, dist: 100, dur: 10, nm: 0, gp: 0, ver: 'x', rules: 1 };
    expect((await post('/api/lb/submit', { ...body, token: 'g1.AAAAAAAAAAAA.' + '0'.repeat(32) })).status).toBe(401);
    expect((await post('/api/lb/submit', { ...body, token: undefined })).status).toBe(401);
    expect((await post('/api/lb/submit', { ...body, ticket: good.ticket.replace(/.$/, (m) => (m === '0' ? '1' : '0')) })).status).toBe(400);
    expect((await post('/api/lb/submit', { ...body, ticket: good.ticket.replace('.endless.', '.sprint.') })).status).toBe(400);
    expect((await topOf()).entries).toHaveLength(0);
  });
  it('Lauf einreichen: Eintrag erscheint mit Name, Punkten, Distanz; Antwort enthält den eigenen Platz', async () => {
    const t = await guest();
    const { r, j } = await playAndSubmit(t, { name: 'NEONRIDER', score: 800, nm: 4 });
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.all.rank).toBe(1);
    const top = await topOf();
    expect(top.entries).toEqual([{ rank: 1, name: 'NEONRIDER', score: 800, dist: 1200 }]);
    expect(JSON.stringify(top)).not.toContain(t);                                    // keine interne Identität öffentlich
  });
  it('Namen mit HTML werden serverseitig abgewiesen und nie gespeichert', async () => {
    const t = await guest();
    const { r } = await playAndSubmit(t, { name: '<img src=x onerror=alert(1)>' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await topOf())).not.toContain('<img');
  });
  it('gleiche Lauf-ID erzeugt keinen zweiten Eintrag (Wiederholung/Replay)', async () => {
    const t = await guest();
    const tk = (await (await post('/api/lb/start', { mode: 'endless' })).json()) as { ticket: string };
    clock += 40_000;
    const body = { token: t, ticket: tk.ticket, name: 'ReplayMan', score: 500, dist: 1200, dur: Math.ceil(travelTime(0, 1200)) + 2, nm: 3, gp: 0, ver: 'test', rules: 1 };
    const a = (await (await post('/api/lb/submit', body)).json()) as { duplicate: boolean };
    const b = (await (await post('/api/lb/submit', body)).json()) as { duplicate: boolean };
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect((await topOf()).entries.filter((e) => e.name === 'ReplayMan')).toHaveLength(1);
    expect((await c.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM lb_runs WHERE run = ?", tk.ticket.split('.')[1]))!.n).toBe(1);
  });
  it('ein schlechteres Ergebnis überschreibt den Rekord nicht; ein besseres ersetzt ihn; je Gast nur ein Eintrag', async () => {
    const t = await guest();
    await playAndSubmit(t, { name: 'BestOnly', score: 900, nm: 4 });
    await playAndSubmit(t, { name: 'BestOnly', score: 300, nm: 4 });
    let e = (await topOf()).entries.filter((x) => x.name === 'BestOnly');
    expect(e).toHaveLength(1);
    expect(e[0].score).toBe(900);
    await playAndSubmit(t, { name: 'BestOnly', score: 1500, nm: 4 });
    e = (await topOf()).entries.filter((x) => x.name === 'BestOnly');
    expect(e).toHaveLength(1);
    expect(e[0].score).toBe(1500);
  });
  it('Sortierung: Punkte, bei Gleichstand größere Distanz, danach früherer Rekord', async () => {
    const mk = async (name: string, score: number, dist: number) => playAndSubmit(await guest(), { name, score, dist, nm: 4 });
    await mk('TieA', 700, 1000); await mk('TieB', 700, 1500); await mk('TieC', 700, 1500);
    const names = (await topOf()).entries.map((e) => e.name).filter((n) => n.startsWith('Tie'));
    expect(names).toEqual(['TieB', 'TieC', 'TieA']);
  });
  it('Spielmodi sind getrennt (Endless ≠ Sprint)', async () => {
    const t = await guest();
    await playAndSubmit(t, { name: 'SprintOnly', score: 400, dist: 1000, nm: 3 }, 'sprint');
    expect((await topOf('sprint')).entries.map((e) => e.name)).toContain('SprintOnly');
    expect((await topOf('endless')).entries.map((e) => e.name)).not.toContain('SprintOnly');
  });
  it('Zeiträume: „Letzte 7 Tage“ enthält ältere Läufe nicht mehr, „All Time“ schon', async () => {
    const t = await guest();
    await playAndSubmit(t, { name: 'OldTimer', score: 777, nm: 4 });
    expect((await topOf('endless', '7d')).entries.map((e) => e.name)).toContain('OldTimer');
    clock += 8 * 86400_000;
    expect((await topOf('endless', '7d')).entries.map((e) => e.name)).not.toContain('OldTimer');
    expect((await topOf('endless', 'all')).entries.map((e) => e.name)).toContain('OldTimer');
  });
  it('eigener Platz wird serverseitig berechnet, auch außerhalb der Top 100; ohne Veröffentlichung gibt es keinen', async () => {
    const lowT = await guest();
    expect(((await (await post('/api/lb/me', { token: lowT, mode: 'endless', period: 'all' })).json()) as { has: boolean }).has).toBe(false);
    await playAndSubmit(lowT, { name: 'Letzter', score: 1, dist: 500, nm: 1 });
    // 100 Spieler mit höheren Punkten direkt in der Datenbank (nur für den Test, Produktionspfad bleibt die API)
    for (let i = 0; i < 100; i++) {
      await c.db.run('INSERT INTO lb_players (id, name, created, last) VALUES (?, ?, ?, ?)', `bulk-${i}-xxxxxxxx`, `Bulk ${i}`, clock, clock);
      await c.db.run("INSERT INTO lb_runs (run, pid, mode, score, dist, dur, nm, gp, ver, rules, ts, status) VALUES (?, ?, 'endless', ?, 1000, 30, 3, 0, 't', ?, ?, 'ok')", `bulkrun-${i}-xxxxxxx`, `bulk-${i}-xxxxxxxx`, 100_000 + i, B.leaderboard.scoreRulesVersion, clock);
    }
    const top = (await topOf()).entries;
    expect(top).toHaveLength(B.leaderboard.maxDisplayEntries);
    expect(top.map((e) => e.name)).not.toContain('Letzter');
    const me = (await (await post('/api/lb/me', { token: lowT, mode: 'endless', period: 'all' })).json()) as { has: boolean; rank: number; total: number };
    expect(me.has).toBe(true);
    expect(me.rank).toBeGreaterThan(100);
    expect(me.total).toBeGreaterThan(100);
  });
  it('unplausible Ergebnisse werden abgelehnt und erscheinen nicht', async () => {
    const t = await guest();
    const before = (await topOf()).entries.length;
    const a = await playAndSubmit(t, { name: 'Cheater', score: 4_000_000, nm: 4 });
    expect(a.r.status).toBe(422);
    const b = await playAndSubmit(t, { name: 'Cheater', score: -5 });
    expect(b.r.status).toBe(422);
    const tk = (await (await post('/api/lb/start', { mode: 'endless' })).json()) as { ticket: string };
    const instant = await post('/api/lb/submit', { token: t, ticket: tk.ticket, name: 'Cheater', score: 300, dist: 5000, dur: 40, nm: 3, gp: 0, ver: 'v', rules: 1 });
    expect(instant.status).toBe(422);                                                // sofort nach Start eingereicht
    expect((await topOf()).entries.map((e) => e.name)).not.toContain('Cheater');
    expect((await topOf()).entries.length).toBe(before);
    expect((await c.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM lb_runs WHERE status = 'rejected'"))!.n).toBeGreaterThan(0);
  });
  it('Score-Versionen werden getrennt: fremde Regelversion wird abgelehnt, ältere Läufe erscheinen nicht in der aktiven Liste, bleiben aber erhalten', async () => {
    const t = await guest();
    const { r } = await playAndSubmit(t, { name: 'AlteRegeln', rules: B.leaderboard.scoreRulesVersion + 1 });
    expect(r.status).toBe(409);
    await c.db.run('INSERT INTO lb_players (id, name, created, last) VALUES (?, ?, ?, ?)', 'oldrules-pid-xxxx', 'Vorsaison', clock, clock);
    await c.db.run("INSERT INTO lb_runs (run, pid, mode, score, dist, dur, nm, gp, ver, rules, ts, status) VALUES ('oldrun-xxxxxxxx', 'oldrules-pid-xxxx', 'endless', 999999, 9000, 90, 9, 0, 't', 0, ?, 'ok')", clock);
    expect((await topOf()).entries.map((e) => e.name)).not.toContain('Vorsaison');
    expect((await c.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM lb_runs WHERE run = 'oldrun-xxxxxxxx'"))!.n).toBe(1);
  });
  it('Ratenbegrenzung: zu viele Einreichungen von einer IP werden gebremst (429)', async () => {
    const ip = '10.77.0.1';
    const t = await guest();
    const codes: number[] = [];
    for (let i = 0; i < B.leaderboard.submissionLimits.perMinute + 2; i++) codes.push((await post('/api/lb/submit', { token: t }, ip)).status);
    expect(codes.at(-1)).toBe(429);
    expect(codes.slice(0, 3).every((x) => x !== 429)).toBe(true);
  });
  it('die Ratenbegrenzungen der Endpunkte zählen getrennt (Start/Lesen/Gast verbrauchen das Einreichlimit nicht)', async () => {
    const ip = '10.88.0.1';
    const t = (await (await post('/api/lb/guest', {}, ip)).json()) as { token: string };
    for (let i = 0; i < 12; i++) { await post('/api/lb/start', { mode: 'endless' }, ip); await post('/api/lb/me', { token: t.token, mode: 'endless' }, ip); }
    const r = await post('/api/lb/submit', { token: t.token }, ip);
    expect(r.status).not.toBe(429);
  });
  it('das Spiel bleibt ohne Registrierung nutzbar: Gast-Berechtigung braucht weder E-Mail noch Konto', async () => {
    const r = await post('/api/lb/guest', {});
    expect(r.status).toBe(200);
    expect(Object.keys((await r.json()) as object)).toEqual(['token']);
  });
});

describe('Admin: Kennzahlen und Moderation', () => {
  let cookie = '', csrf = '';
  const admin = (method: string, path: string, body?: unknown, auth = true): Promise<Response> => fetch(c.url + path, { method, headers: { 'content-type': 'application/json', ...(auth && cookie ? { cookie, 'x-csrf-token': csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  it('nicht öffentlich erreichbar (ohne Sitzung 401), kein Schreiben über die öffentliche API', async () => {
    expect((await admin('GET', '/api/admin/lb', undefined, false)).status).toBe(401);
    expect((await admin('POST', '/api/admin/lb/remove', { run: 'x' }, false)).status).toBe(401);
    expect((await admin('POST', '/api/admin/lb/ban', { pid: 'x' }, false)).status).toBe(401);
    expect((await post('/api/lb/remove', { run: 'x' })).status).toBe(404);
  });
  it('mit Sitzung: Kennzahlen, Läufe entfernen, Gäste sperren', async () => {
    const r = await fetch(c.url + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PW }) });
    expect(r.status).toBe(200);
    cookie = r.headers.get('set-cookie')!.split(';')[0]; csrf = ((await r.json()) as { csrf: string }).csrf;
    await c.db.run("DELETE FROM lb_runs WHERE run LIKE 'bulkrun-%'");                  // Testdaten der Platzierungsprüfung entfernen
    const t = await guest();
    await playAndSubmit(t, { name: 'Moderiert', score: 2000, nm: 5 });
    const ov = (await (await admin('GET', '/api/admin/lb')).json()) as { published: number; players: number; top: { endless: { run: string; pid: string; name: string }[] }; rejected: unknown[] };
    expect(ov.published).toBeGreaterThan(0);
    expect(ov.players).toBeGreaterThan(0);
    expect(Array.isArray(ov.rejected)).toBe(true);
    const mine = ov.top.endless.find((x) => x.name === 'Moderiert')!;
    expect(mine).toBeTruthy();
    expect((await admin('POST', '/api/admin/lb/remove', { run: mine.run })).status).toBe(200);
    expect((await topOf()).entries.map((e) => e.name)).not.toContain('Moderiert');
    const t2 = await guest();
    await playAndSubmit(t2, { name: 'Gesperrt', score: 2100, nm: 5 });
    const ov2 = (await (await admin('GET', '/api/admin/lb')).json()) as { top: { endless: { pid: string; name: string }[] } };
    const bad = ov2.top.endless.find((x) => x.name === 'Gesperrt')!;
    expect((await admin('POST', '/api/admin/lb/ban', { pid: bad.pid })).status).toBe(200);
    expect((await topOf()).entries.map((e) => e.name)).not.toContain('Gesperrt');
    const again = await playAndSubmit(t2, { name: 'Gesperrt', score: 2200, nm: 5 });
    expect(again.r.status).toBe(403);
  });
});
