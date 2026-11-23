import { BALANCE as B } from '../config/balance';
import { createRng } from '../core/rng';

/**
 * Streckenereignisse (Umgebung, keine Spielmechanik): Neon-Palmen-Tunnel und Casino-Durchfahrt.
 * Alles hängt ausschließlich an der gefahrenen Strecke (Meter) und am Seed des Laufs, nie an Zeit oder Bildzahl:
 * derselbe Seed liefert immer denselben Plan, bei jeder Bildrate und jedem Tempo.
 * Verkehr, Wertung, Combo, Rush, Power-ups und Distanz sind davon unberührt.
 */
export type RouteKind = 'PALM_TUNNEL' | 'CASINO_INTERIOR';

/** Themenwelten: Tunnel (0 Cosmic Highway, 1 Atlantis, 2 Neon Kingdom, 3 Midnight Jazz) und Casino (0 Cosmic, 1 Atlantis, 2 Royal Castle, 3 Midnight Jazz). */
export const TUNNEL_THEMES = ['cosmic', 'atlantis', 'medieval', 'jazz'] as const;
export const CASINO_THEMES = ['cosmic', 'atlantis', 'royal', 'jazz'] as const;

export interface RouteEvent {
  kind: RouteKind;
  /** Streckenmeter der Einfahrt (Portal) und der Ausfahrt. */
  start: number;
  end: number;
  /** Gestaltungsvariante (Farbwechsel, Casino-Namen) – nur Darstellung. */
  variant: number;
  /** Themenwelt (Index in TUNNEL_THEMES bzw. CASINO_THEMES). Tunnel folgen der Reihenfolge Cosmic → Atlantis → Kingdom → Jazz und beginnen danach von vorn; Casinos wählen unabhängig davon. */
  theme: number;
  id: number;
}

export const ROUTE = {
  /** Erster Tunnel: genau ab 10 km, 2,5 km lang (von Anfang an reserviert). */
  firstTunnel: { start: 10_000, len: 2_500 },
  /** Weitere Tunnel: Abstand der Einfahrten 8–14 km, Länge 2–3 km. */
  tunnel: { gapMin: 8_000, gapMax: 14_000, lenMin: 2_000, lenMax: 3_000 },
  /** Casino-Durchfahrt: frühestens ab 20 km (Nachtphase), 700–1400 m lang, ungefähr 1–2 je 20 km. */
  casino: { from: 20_000, firstJitter: [200, 1_200] as const, lenMin: 700, lenMax: 1_400, gapMin: 10_000, gapMax: 16_000 },
  /** Mindestabstand zwischen zwei Ereignissen (offene Straße dazwischen). */
  clearance: 1_200,
  /** Plan reicht so weit (m); dahinter beginnt keine weitere Planung. */
  horizon: 400_000,
  /** Länge der Ein- und Ausblendung der Umgebungsstimmung (m, ≈ 0,5 s bei 1000 km/h). */
  blend: 160,
} as const;

/** Nachtphase: ab dieser Strecke ist der vorhandene Nachtzustand voll aktiv (Licht-Stützpunkt 20 km). */
export const nightFrom = (): number => B.scenery.keys[3];

const planCache = new Map<number, RouteEvent[]>();

/** Reproduzierbarer Streckenplan zu einem Seed (sortiert, ohne Überschneidung, Casinos nur nach dem Nachtbeginn). */
export function planRoute(seed: number): RouteEvent[] {
  const hit = planCache.get(seed >>> 0);
  if (hit) return hit;
  const rnd = createRng((seed ^ 0x5a17c0de) >>> 0);
  const between = (a: number, b: number): number => Math.round(a + (b - a) * rnd());
  const ev: RouteEvent[] = [];
  let id = 0;
  // Tunnel zuerst: der erste liegt fest bei 10 km, die übrigen folgen im Abstand der Einfahrten.
  let start: number = ROUTE.firstTunnel.start;
  let len: number = ROUTE.firstTunnel.len;
  while (start < ROUTE.horizon) {
    ev.push({ kind: 'PALM_TUNNEL', start, end: start + len, variant: Math.floor(rnd() * 3), theme: ev.length % TUNNEL_THEMES.length, id: id++ });
    start += between(ROUTE.tunnel.gapMin, ROUTE.tunnel.gapMax);
    len = between(ROUTE.tunnel.lenMin, ROUTE.tunnel.lenMax);
    if (start < ev[ev.length - 1].end + ROUTE.clearance) start = ev[ev.length - 1].end + ROUTE.clearance;
  }
  // Casinos danach: frühestens ab Nachtbeginn und ab 20 km; Kollisionen mit Tunneln werden auf den nächsten freien Abschnitt verschoben.
  const tunnels = ev.slice();
  const free = (a: number, b: number): boolean => tunnels.every((t) => b + ROUTE.clearance <= t.start || a >= t.end + ROUTE.clearance);
  let at: number = Math.max(ROUTE.casino.from, nightFrom()) + between(ROUTE.casino.firstJitter[0], ROUTE.casino.firstJitter[1]);
  while (at < ROUTE.horizon) {
    const clen = between(ROUTE.casino.lenMin, ROUTE.casino.lenMax);
    let guard = 0;
    while (!free(at, at + clen) && guard++ < 64) {
      const t = tunnels.find((x) => !(at + clen + ROUTE.clearance <= x.start || at >= x.end + ROUTE.clearance));
      at = t ? t.end + ROUTE.clearance : at + ROUTE.clearance;
    }
    const cv = Math.floor(rnd() * 4);
    ev.push({ kind: 'CASINO_INTERIOR', start: at, end: at + clen, variant: cv, theme: cv % CASINO_THEMES.length, id: id++ });
    at += clen + between(ROUTE.casino.gapMin, ROUTE.casino.gapMax);
  }
  ev.sort((a, b) => a.start - b.start);
  if (planCache.size > 8) planCache.clear();
  planCache.set(seed >>> 0, ev);
  return ev;
}

/** Ereignis, in dem sich die Strecke s befindet (oder null). */
export function eventAt(plan: readonly RouteEvent[], s: number): RouteEvent | null {
  for (const e of plan) { if (e.start > s) break; if (s < e.end) return e; }
  return null;
}

/** Ereignisse, die den Bereich [a, b] berühren (für die Darstellung, begrenzt auf die Sichtweite). */
export function eventsIn(plan: readonly RouteEvent[], a: number, b: number): RouteEvent[] {
  const out: RouteEvent[] = [];
  for (const e of plan) { if (e.start > b) break; if (e.end >= a) out.push(e); }
  return out;
}

const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/**
 * Stärke 0…1, mit der die Umgebung des Ereignisses auf den Spieler an Streckenmeter s wirkt: steigt vor der Einfahrt und fällt nach der Ausfahrt weich
 * ab (Licht, Dunkelheit, Klang). Die Strecke wird nie unterbrochen.
 */
export function routeStrength(plan: readonly RouteEvent[], s: number): { kind: RouteKind | null; k: number; theme: number } {
  let best: { kind: RouteKind | null; k: number; theme: number } = { kind: null, k: 0, theme: 0 };
  for (const e of eventsIn(plan, s - ROUTE.blend * 2, s + ROUTE.blend * 2)) {
    const k = smooth((s - (e.start - ROUTE.blend * 0.4)) / ROUTE.blend) * (1 - smooth((s - (e.end - ROUTE.blend * 0.6)) / ROUTE.blend));
    if (k > best.k) best = { kind: e.kind, k, theme: e.theme };
  }
  return best;
}
