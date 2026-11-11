import { createApp } from './app';
import { openDb } from './db';
import { readEnv } from './env';

const cfg = readEnv();
if (cfg.app.production && !cfg.app.publicOrigin) console.warn('[warn] PUBLIC_ORIGIN ist nicht gesetzt: Canonical, Sitemap und Origin-Prüfung nutzen den Host-Header.');
if (cfg.app.production && !cfg.app.trustProxy && cfg.host === '127.0.0.1') console.warn('[hinweis] Hinter einem Reverse-Proxy TRUST_PROXY=1 setzen, damit Anmelde-Limits die echte Client-Adresse sehen.');
const db = openDb(cfg.dbPath);
const app = createApp({ db, env: cfg.app });
app.maintenance();
setInterval(() => { try { app.maintenance(); } catch (e) { console.error('[wartung]', e); } }, 6 * 3600_000).unref();
const srv = await app.listen(cfg.port, cfg.host);
const hasAdmin = !!db.prepare('SELECT 1 FROM admin WHERE id = 1').get();
console.log(`Sunset Sideways läuft auf http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}  (Admin: /admin${hasAdmin ? '' : ' – noch kein Passwort: npm run admin:passwd'})`);
const stop = (): void => { srv.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
