import { createHandler, type AppEnv } from '../server/app';
import { d1Db } from '../server/db';

/**
 * Cloudflare Pages Function: Admin-Bereich (/admin), Admin-API (/api/admin/*), Spiel-API (/api/config, /api/e).
 * Welche Pfade hierher gelangen, steuert public/_routes.json; alles andere liefert Pages als statische Datei.
 * Bindings (Dashboard → Einstellungen): D1-Datenbank „DB“, Secret ADMIN_PASSWORD_HASH, Variable PUBLIC_ORIGIN.
 */
interface Env extends AppEnv { ASSETS: { fetch(input: Request): Promise<Response> } }
interface Ctx { request: Request; env: Env; next(): Promise<Response>; waitUntil(p: Promise<unknown>): void }

const JSON_HEAD = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  const { request, env } = ctx;
  // Google-Search-Console-Inhaberbestätigung: Pages würde die .html-Datei auf eine Adresse ohne Endung umleiten (308); Google verlangt exakt diese URL mit Status 200.
  if (new URL(request.url).pathname === '/googleca51093de23aed0e.html') return new Response('google-site-verification: googleca51093de23aed0e.html', { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  if (!env.DB) {
    // Ohne D1-Datenbank läuft das Spiel mit den eingebauten Standardwerten weiter; Admin und Messung sind dann aus.
    const p = new URL(request.url).pathname;
    if (p === '/api/health') return new Response('{"ok":true,"db":false}', { headers: JSON_HEAD });
    if (p === '/api/e') return new Response(null, { status: 204 });
    if (p === '/api/config') return new Response('{"error":"keine Datenbank"}', { status: 404, headers: JSON_HEAD });
    return new Response(JSON.stringify({ error: 'D1-Datenbank „DB“ ist nicht verbunden (siehe docs/DEPLOYMENT.md).' }), { status: 503, headers: { ...JSON_HEAD, 'x-robots-tag': 'noindex, nofollow' } });
  }
  const handler = createHandler({
    env,
    db: d1Db(env.DB),
    schemaKey: env.DB,
    assets: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url).href)),
    wait: (p) => ctx.waitUntil(p),
  });
  return (await handler(request)) ?? ctx.next();
};
