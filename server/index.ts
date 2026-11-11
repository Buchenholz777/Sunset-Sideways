import { createNodeApp } from './node';
import { readEnv } from './env';
import { sqliteDb } from './sqlite';

// Lokaler Server (Entwicklung/Abnahme). Produktion läuft als Cloudflare Pages Function (functions/), siehe docs/DEPLOYMENT.md.
const cfg = readEnv();
const db = sqliteDb(cfg.dbPath);
const app = createNodeApp({ db, env: cfg.app, dir: cfg.dir, trustProxy: cfg.trustProxy });
const srv = await app.listen(cfg.port, cfg.host);
console.log(`Sunset Sideways (lokal) auf http://${cfg.host}:${cfg.port}  ·  Admin: /admin  ·  Passwort-Hash: ADMIN_PASSWORD_HASH oder npm run admin:passwd`);
const stop = (): void => { srv.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
