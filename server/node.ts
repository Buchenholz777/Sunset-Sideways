import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize as pnormalize, resolve, sep } from 'node:path';
import { createHandler, type AppEnv } from './app';
import type { Db } from './db';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.woff2': 'font/woff2',
};

export interface NodeOpts { db: Db; env: AppEnv; /** Ausgabeordner des Builds (enthält Spiel und _admin/). */ dir: string; now?: () => number; fetchImpl?: typeof fetch; trustProxy?: boolean }

/**
 * Lokaler Server mit derselben Handler-Logik wie die Cloudflare Pages Function (siehe functions/): für Entwicklung, Tests und die Browser-Abnahme.
 * Statische Dateien kommen aus dem Dateisystem statt von Cloudflare.
 */
export function createNodeApp(o: NodeOpts) {
  const root = resolve(o.dir);
  const fileResponse = (rel: string, transform?: (t: string) => string): Response | null => {
    const file = resolve(join(root, pnormalize('/' + rel)));
    if (file !== root && !file.startsWith(root + sep)) return null;
    if (!existsSync(file) || !statSync(file).isFile()) return null;
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const immutable = /^assets\/.*-[\w-]{6,}\./.test(rel);
    const h = { 'content-type': type, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', 'x-content-type-options': 'nosniff' };
    return new Response(transform && type.startsWith('text/html') ? transform(readFileSync(file, 'utf8')) : readFileSync(file), { status: 200, headers: h });
  };
  const handler = createHandler({
    env: o.env, db: o.db, now: o.now, fetchImpl: o.fetchImpl,
    assets: async (path) => fileResponse(path.endsWith('/') ? path.slice(1) + 'index.html' : path.slice(1)),
  });

  async function toRequest(req: IncomingMessage): Promise<Request> {
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const c of req) { n += (c as Buffer).length; if (n > 1_000_000) throw Object.assign(new Error('zu groß'), { status: 413 }); chunks.push(c as Buffer); }
    const host = String((o.trustProxy && req.headers['x-forwarded-host']) || req.headers.host || 'localhost');
    const proto = o.trustProxy && String(req.headers['x-forwarded-proto'] ?? '').startsWith('https') ? 'https' : 'http';
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && k !== 'cf-connecting-ip') headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    // Wie Cloudflare: die Client-Adresse kommt vom Server, nie vom Client
    const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    headers.set('cf-connecting-ip', o.trustProxy && xff.length ? xff[xff.length - 1] : req.socket.remoteAddress ?? 'lokal');
    const method = req.method ?? 'GET';
    return new Request(`${proto}://${host}${req.url ?? '/'}`, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks) });
  }

  async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const request = await toRequest(req);
    let r = await handler(request);
    if (!r) {
      const u = new URL(request.url);
      const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
      const origin = o.env.PUBLIC_ORIGIN ?? u.origin;
      r = fileResponse(rel, (t) => t.replace(/__ORIGIN__/g, origin)) ?? new Response('Nicht gefunden', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const headers: Record<string, string | string[]> = {};
    r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
    const cookies = r.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
    const body = request.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { ...headers, 'content-length': String(body.length) });
    res.end(body);
  }

  const requestListener = (req: IncomingMessage, res: ServerResponse): void => {
    serve(req, res).catch((e: unknown) => {
      const st = (e as { status?: number }).status ?? 500;
      if (st === 500) console.error('[server]', e);
      if (!res.headersSent) res.writeHead(st, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: st === 500 ? 'Interner Fehler.' : String((e as Error).message) }));
    });
  };

  return {
    listen(port: number, host: string): Promise<Server> {
      const srv = createServer(requestListener);
      srv.requestTimeout = 30_000; srv.headersTimeout = 15_000;
      return new Promise((r) => srv.listen(port, host, () => r(srv)));
    },
  };
}
