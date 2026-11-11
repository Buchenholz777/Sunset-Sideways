import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type Status = 'ok' | 'warn' | 'fail' | 'info';
export interface Check { id: string; label: string; status: Status; found: string; fix: string }
export interface SeoReport { origin: string; checkedAt: number; finalUrl: string | null; checks: Check[]; summary: { ok: number; warn: number; fail: number } }

interface Res { status: number; headers: Headers; body: string; url: string; chain: string[] }

const isPrivate = (ip: string): boolean => {
  if (ip === '::1' || ip === '::' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip)) return true;
  const m = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
};

export interface SeoOpts {
  /** Hosts, die auch lokal/privat sein dürfen (die eigene Installation). */
  allowHosts: string[];
  allowLocal?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

async function guard(url: URL, o: SeoOpts): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Nur http(s)-Adressen sind erlaubt.');
  if (o.allowLocal || o.allowHosts.includes(url.host)) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (ips.some(isPrivate)) throw new Error('Diese Adresse zeigt auf ein privates Netz und wird nicht geprüft.');
}

async function get(urlStr: string, o: SeoOpts, method = 'GET', maxBytes = 1_000_000): Promise<Res> {
  const f = o.fetchImpl ?? fetch;
  let url = new URL(urlStr);
  const chain: string[] = [];
  for (let i = 0; i < 6; i++) {
    await guard(url, o);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await f(url, { method, redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'SunsetSidewaysSeoCheck/1.0', accept: 'text/html,application/xml,text/plain,image/*;q=0.8' } });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        chain.push(`${r.status} ${url.href}`);
        url = new URL(r.headers.get('location')!, url);
        continue;
      }
      let body = '';
      if (method === 'GET' && r.body) {
        const ct = r.headers.get('content-type') ?? '';
        if (/text|xml|json/i.test(ct)) {
          const reader = r.body.getReader();
          let got = 0;
          const parts: Uint8Array[] = [];
          for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; parts.push(value); if (got > maxBytes) { void reader.cancel(); break; } }
          body = Buffer.concat(parts).toString('utf8');
        } else void r.body.cancel();
      }
      return { status: r.status, headers: r.headers, body, url: url.href, chain };
    } finally { clearTimeout(timer); }
  }
  throw new Error('Zu viele Weiterleitungen.');
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? '').trim() : null;
};
const metas = (html: string): Array<{ key: string; content: string }> => {
  const out: Array<{ key: string; content: string }> = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = attr(m[0], 'name') ?? attr(m[0], 'property');
    const content = attr(m[0], 'content');
    if (key && content !== null) out.push({ key: key.toLowerCase(), content });
  }
  return out;
};
const decode = (s: string): string => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const stripTags = (s: string): string => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const norm = (u: string): string => u.replace(/\/+$/, '').toLowerCase();

export async function checkSite(originIn: string, o: SeoOpts): Promise<SeoReport> {
  const origin = new URL(originIn).origin;
  const checks: Check[] = [];
  const add = (id: string, label: string, status: Status, found: string, fix: string): void => { checks.push({ id, label, status, found, fix }); };
  const now = (o.now ?? Date.now)();
  let page: Res | null = null;
  try { page = await get(origin + '/', o); } catch (e) {
    add('http', 'Startseite erreichbar', 'fail', (e as Error).message, 'Domain, DNS, HTTPS-Zertifikat und Server prüfen; die Startseite muss ohne Anmeldung mit Status 200 antworten.');
    return finish(origin, now, null, checks);
  }
  const html = page.body;
  const hop = page.chain.length ? ` (nach ${page.chain.length} Weiterleitung${page.chain.length > 1 ? 'en' : ''}: ${page.chain.join(' → ')})` : '';
  add('http', 'HTTP-Status der Startseite', page.status === 200 ? (page.chain.length > 1 ? 'warn' : 'ok') : 'fail', `Status ${page.status}${hop}`,
    page.status === 200 ? (page.chain.length > 1 ? 'Mehrere Weiterleitungen nacheinander vermeiden – höchstens eine (z. B. http → https).' : '-') : 'Die Startseite muss mit Status 200 antworten. Fehlerursache im Server-Log suchen.');
  const isHttps = new URL(page.url).protocol === 'https:';
  const local = /^(localhost|127\.|\[::1\])/.test(new URL(page.url).host);
  add('https', 'HTTPS', isHttps ? 'ok' : local ? 'info' : 'fail', isHttps ? 'Seite wird über HTTPS ausgeliefert.' : local ? 'Lokale Adresse über HTTP – für den Test in Ordnung.' : 'Seite wird unverschlüsselt (HTTP) ausgeliefert.', 'Ein Zertifikat einrichten (z. B. Caddy oder Let\'s Encrypt) und HTTP auf HTTPS weiterleiten.');

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const t = title ? stripTags(title[1]) : '';
  add('title', 'Seitentitel (title)', !t ? 'fail' : t.length < 10 || t.length > 65 ? 'warn' : 'ok', t ? `„${t}“ (${t.length} Zeichen)` : 'Kein Titel gefunden.', !t ? '<title> im <head> der Startseite ergänzen, 10–60 Zeichen mit Spielname und Kernaussage.' : t.length < 10 ? 'Titel auf 10–60 Zeichen erweitern.' : t.length > 65 ? 'Titel auf höchstens 60 Zeichen kürzen, sonst wird er in der Suche abgeschnitten.' : '-');
  const ms = metas(html);
  const desc = ms.find((m) => m.key === 'description')?.content ?? '';
  add('description', 'Meta-Beschreibung', !desc ? 'fail' : desc.length < 70 || desc.length > 165 ? 'warn' : 'ok', desc ? `„${desc.slice(0, 120)}${desc.length > 120 ? '…' : ''}“ (${desc.length} Zeichen)` : 'Keine Meta-Beschreibung gefunden.', !desc ? '<meta name="description" content="…"> mit 70–160 Zeichen ergänzen.' : desc.length < 70 ? 'Beschreibung auf 70–160 Zeichen erweitern.' : desc.length > 165 ? 'Beschreibung auf höchstens 160 Zeichen kürzen.' : '-');
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1]));
  add('h1', 'Hauptüberschrift (H1)', h1s.length === 1 ? 'ok' : 'fail', h1s.length ? `${h1s.length}× H1: „${h1s[0]}“` : 'Keine H1 im ausgelieferten HTML.', h1s.length === 0 ? 'Genau eine <h1> mit dem Spielnamen im HTML der Startseite ergänzen.' : h1s.length > 1 ? 'Nur eine <h1> je Seite verwenden.' : '-');
  const lang = /<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i.exec(html)?.[1] ?? '';
  add('lang', 'Sprache (html lang)', lang ? 'ok' : 'fail', lang ? `lang="${lang}"` : 'Kein lang-Attribut am <html>-Element.', '<html lang="de"> setzen.');
  const canon = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(html);
  const canonHref = canon ? attr(canon[0], 'href') : null;
  const pageUrl = origin + '/';
  add('canonical', 'Canonical-Link', !canonHref ? 'fail' : norm(canonHref) === norm(pageUrl) ? 'ok' : 'warn', canonHref ? `canonical → ${canonHref}` : 'Kein canonical-Link gefunden.', !canonHref ? `<link rel="canonical" href="${pageUrl}"> im <head> ergänzen.` : norm(canonHref) === norm(pageUrl) ? '-' : `Canonical zeigt auf eine andere Adresse als ${pageUrl}. Setze die Umgebungsvariable PUBLIC_ORIGIN auf die öffentliche Adresse.`);
  const robotsMeta = ms.find((m) => m.key === 'robots')?.content ?? '';
  const xrobots = page.headers.get('x-robots-tag') ?? '';
  const noindex = /noindex/i.test(robotsMeta) || /noindex/i.test(xrobots);
  add('indexable', 'Indexierbarkeit', noindex ? 'fail' : 'ok', noindex ? `noindex gesetzt (${robotsMeta || xrobots})` : 'Keine Sperre per meta robots oder X-Robots-Tag.', 'noindex von der öffentlichen Startseite entfernen.');
  add('viewport', 'Mobile Darstellung (viewport)', ms.some((m) => m.key === 'viewport') ? 'ok' : 'fail', ms.some((m) => m.key === 'viewport') ? 'viewport-Meta vorhanden.' : 'Kein viewport-Meta.', '<meta name="viewport" content="width=device-width, initial-scale=1"> ergänzen.');

  // robots.txt + Sitemap
  let sitemapUrl = origin + '/sitemap.xml';
  try {
    const r = await get(origin + '/robots.txt', o);
    const text = r.body;
    const blockAll = /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(\r?\n|$)/i.test(text) && !/^allow:\s*\/\s*$/im.test(text);
    const sm = /^sitemap:\s*(\S+)/im.exec(text)?.[1];
    if (sm) sitemapUrl = sm;
    add('robots', 'robots.txt', r.status !== 200 ? 'fail' : blockAll ? 'fail' : sm ? 'ok' : 'warn', r.status !== 200 ? `Status ${r.status}` : blockAll ? 'Disallow: / sperrt die ganze Seite.' : sm ? `erreichbar, Sitemap: ${sm}` : 'erreichbar, aber ohne Sitemap-Zeile.', r.status !== 200 ? '/robots.txt bereitstellen (der mitgelieferte Server tut das automatisch).' : blockAll ? 'Disallow: / entfernen.' : sm ? '-' : `Zeile „Sitemap: ${origin}/sitemap.xml“ ergänzen.`);
  } catch (e) { add('robots', 'robots.txt', 'fail', (e as Error).message, '/robots.txt bereitstellen.'); }
  try {
    const r = await get(sitemapUrl, o);
    const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    const valid = r.status === 200 && /<urlset/i.test(r.body) && locs.length > 0;
    const hasStart = locs.some((l) => norm(l) === norm(pageUrl));
    const hasAdmin = locs.some((l) => /\/admin/i.test(l));
    add('sitemap', 'Sitemap', !valid ? 'fail' : !hasStart || hasAdmin ? 'warn' : 'ok', !valid ? `Status ${r.status}, keine gültige Sitemap` : `${locs.length} Adresse(n)${hasStart ? ', enthält die Startseite' : ', Startseite fehlt'}${hasAdmin ? ', enthält /admin!' : ', ohne /admin'}`, !valid ? `/sitemap.xml mit <urlset> und der Startseite ${pageUrl} bereitstellen.` : !hasStart ? `Startseite ${pageUrl} in die Sitemap aufnehmen.` : hasAdmin ? '/admin aus der Sitemap entfernen.' : '-');
  } catch (e) { add('sitemap', 'Sitemap', 'fail', (e as Error).message, '/sitemap.xml bereitstellen.'); }

  // Social Preview
  const og = (k: string): string => ms.find((m) => m.key === k)?.content ?? '';
  const missing = ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card'].filter((k) => !og(k));
  let imgNote = '';
  let imgOk = true;
  const img = og('og:image');
  if (img) {
    try {
      const r = await get(new URL(img, origin).href, o, 'GET');
      imgOk = r.status === 200 && /^image\//i.test(r.headers.get('content-type') ?? '');
      imgNote = imgOk ? 'Vorschaubild erreichbar.' : `Vorschaubild nicht abrufbar (Status ${r.status}).`;
      if (!/^https?:\/\//i.test(img)) { imgOk = false; imgNote += ' og:image muss eine absolute Adresse sein.'; }
    } catch (e) { imgOk = false; imgNote = `Vorschaubild nicht abrufbar: ${(e as Error).message}`; }
  }
  add('social', 'Social-Vorschau (Open Graph / Twitter)', missing.length || !imgOk ? (missing.length > 2 || !img ? 'fail' : 'warn') : 'ok', missing.length ? `Fehlend: ${missing.join(', ')}. ${imgNote}` : `Titel, Beschreibung, Bild und Karte vorhanden. ${imgNote}`, missing.length || !imgOk ? 'Fehlende og:*-Tags und twitter:card im <head> ergänzen; das Bild (1200×630) muss unter einer absoluten HTTPS-Adresse erreichbar sein.' : '-');

  // Admin-Schutz
  try {
    const r = await get(origin + '/admin', o);
    const ok = (/noindex/i.test(r.headers.get('x-robots-tag') ?? '')) && /no-store/i.test(r.headers.get('cache-control') ?? '') && (r.status === 200 || r.status === 401 || r.status === 403);
    add('admin', 'Admin-Bereich nicht indexierbar', ok ? 'ok' : 'fail', `/admin: Status ${r.status}, X-Robots-Tag „${r.headers.get('x-robots-tag') ?? '-'}“, Cache-Control „${r.headers.get('cache-control') ?? '-'}“`, 'Der Server muss /admin mit „X-Robots-Tag: noindex, nofollow“ und „Cache-Control: no-store“ ausliefern.');
  } catch (e) { add('admin', 'Admin-Bereich nicht indexierbar', 'warn', (e as Error).message, '/admin prüfen.'); }
  return finish(origin, now, page.url, checks);
}

function finish(origin: string, checkedAt: number, finalUrl: string | null, checks: Check[]): SeoReport {
  const c = (s: Status): number => checks.filter((x) => x.status === s).length;
  return { origin, checkedAt, finalUrl, checks, summary: { ok: c('ok'), warn: c('warn'), fail: c('fail') } };
}
