import { DEFAULT_CONFIG, normalize, type GameConfig } from '../config/runtime';

declare const __GAME_VERSION__: string;
/** Statischer Build ohne Server (nur Spiel): keine Konfig-Abfrage, keine Messung. */
const STATIC = (import.meta as unknown as { env?: { VITE_STATIC?: string } }).env?.VITE_STATIC === '1';
export const GAME_VERSION: string = typeof __GAME_VERSION__ === 'string' ? __GAME_VERSION__ : 'dev';

/** Veröffentlichte Konfiguration, die ein Versuch beim Start fest übernimmt. */
export interface RemoteConfig {
  id: string;
  config: GameConfig;
  /** Laufendes Ereignis (Flugwoche): Kennung und Ende in ms seit 1970. */
  event: { id: string; endsAt: number } | null;
  source: 'server' | 'builtin' | 'preview';
}

export const BUILTIN: RemoteConfig = { id: 'builtin', config: DEFAULT_CONFIG, event: null, source: 'builtin' };

export const randomId = (n = 12): string => {
  const a = new Uint8Array(n);
  try { crypto.getRandomValues(a); } catch { for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256); }
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
};

/** Lädt die aktuelle Konfiguration; bei Fehler/Zeitüberschreitung null (Spiel nutzt dann seinen vorherigen Stand bzw. die eingebauten Werte). */
export async function fetchConfig(previewToken: string | null, timeoutMs = 2500): Promise<RemoteConfig | null> {
  if (STATIC || typeof fetch !== 'function') return null;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : undefined;
  try {
    const url = '/api/config' + (previewToken ? `?preview=${encodeURIComponent(previewToken)}` : '');
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: ctl?.signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { id?: unknown; config?: unknown; event?: { id?: unknown; endsAt?: unknown } | null };
    if (typeof j.id !== 'string' || !j.config || typeof j.config !== 'object') return null;
    const ev = j.event && typeof j.event.id === 'string' && typeof j.event.endsAt === 'number' ? { id: j.event.id, endsAt: j.event.endsAt } : null;
    return { id: j.id, config: normalize(j.config), event: ev, source: previewToken ? 'preview' : 'server' };
  } catch { return null; } finally { if (timer !== undefined) clearTimeout(timer); }
}

export const eventActive = (c: RemoteConfig, now = Date.now()): boolean => c.event !== null && now < c.event.endsAt;

export function deviceType(): 'phone' | 'tablet' | 'desktop' {
  try {
    if (!matchMedia('(pointer: coarse)').matches) return 'desktop';
    return Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet';
  } catch { return 'desktop'; }
}

interface Ev { t: string; r?: string; k?: string; d?: Record<string, unknown> }

/**
 * Erstbetreiber-Messung ohne Cookies: zufällige Besuchskennung nur im Arbeitsspeicher, eigene Kennung je Versuch.
 * Ereignisse werden gesammelt und gebündelt gesendet; Fehler bleiben folgenlos – das Spiel hängt nie an der Messung.
 */
export class Telemetry {
  readonly visit = randomId(12);
  private queue: Ev[] = [];
  constructor(public enabled: boolean) {
    if (STATIC) this.enabled = enabled = false;
    if (enabled && typeof window !== 'undefined') {
      setInterval(() => this.flush(false), 5000);
      window.addEventListener('pagehide', () => this.flush(true));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(true); });
    }
  }
  send(t: string, run?: string, key?: string, d?: Record<string, unknown>): void {
    if (!this.enabled) return;
    this.queue.push({ t, r: run, k: key, d });
    if (this.queue.length >= 25) this.flush(false);
  }
  flush(beacon: boolean): void {
    if (!this.enabled || this.queue.length === 0) return;
    const body = JSON.stringify({ v: this.visit, ver: GAME_VERSION, dev: deviceType(), events: this.queue.splice(0, 50) });
    try {
      if (beacon && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/e', new Blob([body], { type: 'application/json' }))) return;
      void fetch('/api/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }).catch(() => {});
    } catch { /* Messung ist optional */ }
  }
}
