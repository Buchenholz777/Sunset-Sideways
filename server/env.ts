import type { AppEnv } from './app';

/** Lokale Umgebung (Entwicklung/Abnahme): Werte aus process.env, gleiche Namen wie in Cloudflare. */
export function readEnv(e: NodeJS.ProcessEnv = process.env): { app: AppEnv; port: number; host: string; dbPath: string; dir: string; trustProxy: boolean } {
  return {
    port: Number(e.PORT) > 0 ? Number(e.PORT) : 8080,
    host: e.HOST || '127.0.0.1',
    dbPath: e.DB_PATH || 'data/sunset.db',
    dir: e.DIST_DIR || 'dist',
    trustProxy: e.TRUST_PROXY === '1' || e.TRUST_PROXY === 'true',
    app: {
      ADMIN_PASSWORD_HASH: e.ADMIN_PASSWORD_HASH || undefined,
      PUBLIC_ORIGIN: e.PUBLIC_ORIGIN ? new URL(e.PUBLIC_ORIGIN).origin : undefined,
      APP_SECRET: e.APP_SECRET || undefined,
      GSC_CLIENT_ID: e.GSC_CLIENT_ID || undefined,
      GSC_CLIENT_SECRET: e.GSC_CLIENT_SECRET || undefined,
      RETENTION_DAYS: e.RETENTION_DAYS, SESSION_IDLE_HOURS: e.SESSION_IDLE_HOURS, SESSION_ABSOLUTE_DAYS: e.SESSION_ABSOLUTE_DAYS,
      SEO_ALLOW_LOCAL: e.SEO_ALLOW_LOCAL,
    },
  };
}
