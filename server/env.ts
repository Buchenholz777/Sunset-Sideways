import type { AppEnv } from './app';

const bool = (v: string | undefined): boolean => v === '1' || v === 'true';
const num = (v: string | undefined, d: number): number => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : d; };

/** Liest die Betriebskonfiguration aus Umgebungsvariablen (siehe docs/DEPLOYMENT.md). */
export function readEnv(e: NodeJS.ProcessEnv = process.env): { app: AppEnv; port: number; host: string; dbPath: string } {
  let publicOrigin: string | undefined;
  if (e.PUBLIC_ORIGIN) {
    const u = new URL(e.PUBLIC_ORIGIN);
    publicOrigin = u.origin;
  }
  return {
    port: num(e.PORT, 8080),
    host: e.HOST || '127.0.0.1',
    dbPath: e.DB_PATH || 'data/sunset.db',
    app: {
      publicOrigin,
      production: e.NODE_ENV === 'production',
      trustProxy: bool(e.TRUST_PROXY),
      appSecret: e.APP_SECRET || undefined,
      gscClientId: e.GSC_CLIENT_ID || undefined,
      gscClientSecret: e.GSC_CLIENT_SECRET || undefined,
      gameDir: e.GAME_DIR || 'dist',
      adminDir: e.ADMIN_DIR || 'dist-admin',
      retentionDays: num(e.RETENTION_DAYS, 30),
      sessionIdleHours: num(e.SESSION_IDLE_HOURS, 12),
      sessionAbsoluteDays: num(e.SESSION_ABSOLUTE_DAYS, 7),
      seoAllowLocal: bool(e.SEO_ALLOW_LOCAL),
    },
  };
}
