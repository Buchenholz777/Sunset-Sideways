import { BALANCE as B } from '../config/balance';
import { lanesSolvable, minLongGap } from '../gen/validator';
import { KINDS, laneOf, laneX, type Obstacle } from './world';

/** Schwierigkeitsphase 1–4 nach aktiver Fahrzeit (Einstieg, Aufbau, Arcade Flow, High-Score). */
export function phaseAt(tActive: number): 1 | 2 | 3 | 4 {
  const ps = B.dynamic.phaseStart;
  let p = 0;
  for (let i = 0; i < ps.length; i++) if (tActive >= ps[i]) p = i;
  return (p + 1) as 1 | 2 | 3 | 4;
}

const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** Querposition (Spurmitte-Koordinate) eines Verkehrsteilnehmers nach `ahead` Sekunden aus dem aktuellen Stand (ohne den Zustand zu ändern). */
export function lcX(o: Obstacle, ahead = 0): number {
  const lc = o.lc;
  if (!lc) return o.x;
  if (lc.stage === 'move') return lc.fromX + (lc.toX - lc.fromX) * smooth((lc.t + ahead) / B.dynamic.lc.move);
  if (lc.stage === 'done') return lc.toX;
  return o.x;
}

/** Fahrzeug mit angekündigtem oder laufendem Spurwechsel (Blinker bzw. Querbewegung). */
export const isChanging = (o: Obstacle): boolean => !!o.lc && (o.lc.stage === 'warn' || o.lc.stage === 'move');

/** Stabiler Zufallswert 0…1 aus Seed und Objekt-Kennung (verbraucht keinen Zufallsstrom: der Generator bleibt unverändert). */
export function hash01(seed: number, id: number): number {
  let h = (seed ^ Math.imul(id + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

export type TrafficEvent =
  | { type: 'laneWarn'; id: number; x: number; z: number; toX: number }
  | { type: 'laneCancel'; id: number };

export interface TrafficCtx {
  seed: number; t: number; t0: number; s: number; q: number; speedKmh: number; timeScale: number;
  obstacles: Obstacle[];
}

const CHANGER_KINDS: ReadonlySet<string> = new Set(['taxi', 'cabrio', 'sedan']);

/**
 * Verkehrsregie (Typ B – Spurwechsler): wählt je Phase einen begrenzten Anteil der geeigneten Fahrzeuge, kündigt den Wechsel mindestens
 * `lc.warn` Sekunden mit Blinker an, prüft Ziel-Lücke und Lösbarkeit (Fairness-Validator) beim Warnbeginn und vor der Querbewegung und führt
 * die Bewegung weich (kein Teleport) aus. Verwirft den Wechsel, wenn er nicht sicher ist.
 */
export class TrafficDirector {
  private evaluated = new Set<number>();
  events: TrafficEvent[] = [];

  /** Gleichzeitig laufende Spurwechsel (Warnung oder Bewegung). */
  active(obs: readonly Obstacle[]): number { let n = 0; for (const o of obs) if (!o.hit && isChanging(o)) n++; return n; }

  /** Fortschreiben der Stufen: Warnung → Bewegung → fertig. Danach Auswahl neuer Wechsler. */
  update(c: TrafficCtx, dt: number): void {
    const D = B.dynamic;
    for (const o of c.obstacles) {
      const lc = o.lc;
      if (!lc || o.hit) continue;
      if (lc.stage === 'warn') {
        lc.t += dt;
        if (lc.t >= D.lc.warn) {
          if (this.safeNow(c, o, lc.toX, 0, (o.z - c.s) / Math.max(1, c.speedKmh / 3.6 - o.vz * c.timeScale))) { lc.stage = 'move'; lc.t = 0; }
          else { lc.stage = 'cancelled'; this.events.push({ type: 'laneCancel', id: o.id }); }
        }
      } else if (lc.stage === 'move') {
        lc.t += dt;
        o.x = lcX(o, 0);
        if (lc.t >= D.lc.move) { lc.stage = 'done'; o.x = lc.toX; }
      }
    }
    if (!D.on) return;
    const phase = phaseAt(c.t), share = D.changerShare[phase - 1], cap = D.maxActive[phase - 1];
    if (cap <= 0) return;
    const v = c.speedKmh / 3.6;
    let act = -1;
    for (const o of c.obstacles) {
      if (o.hit || this.evaluated.has(o.id) || !CHANGER_KINDS.has(o.kind)) continue;
      const rel = v - o.vz * c.timeScale;
      if (rel <= 1) continue;
      const ttc = (o.z - c.s) / rel;
      if (ttc > D.lc.decideMax || ttc < 0 || o.z - c.s > D.lc.visible) continue;      // nur sichtbare, noch ferne Fahrzeuge: der Blinker muss erkennbar sein
      const scripted = o.lc?.stage === 'idle' && o.lc.scripted === true;
      if (ttc < D.lc.decideMin) { this.evaluated.add(o.id); if (scripted && o.lc) o.lc.stage = 'cancelled'; continue; }   // zu spät für eine faire Ankündigung
      this.evaluated.add(o.id);
      if (!scripted && hash01(c.seed, o.id) >= share) continue;
      if (act < 0) act = this.active(c.obstacles);
      if (act >= cap) { if (scripted && o.lc) o.lc.stage = 'cancelled'; continue; }
      const lane = laneOf(o.x);
      const dirs = scripted && o.lc ? [o.lc.toX] : (hash01(c.seed ^ 0x51ed, o.id) < 0.5 ? [laneX(lane - 1), laneX(lane + 1)] : [laneX(lane + 1), laneX(lane - 1)]);
      let started = false;
      for (const toX of dirs) {
        if (toX < laneX(0) - 0.01 || toX > laneX(2) + 0.01 || Math.abs(toX - o.x) < 0.5) continue;
        if (ttc < D.lc.minTtc || !this.safeNow(c, o, toX, D.lc.warn, ttc)) continue;
        o.lc = { stage: 'warn', t: 0, fromX: o.x, toX, scripted };
        this.events.push({ type: 'laneWarn', id: o.id, x: o.x, z: o.z, toX });
        act++; started = true;
        break;
      }
      if (!started && scripted && o.lc) o.lc.stage = 'cancelled';
    }
    if (this.evaluated.size > 4000) this.evaluated.clear();
  }

  /**
   * Sicherheitsprüfung für einen Wechsel auf toX: (1) Lücke in der Zielspur über die gesamte Bewegung (kein Durchfahren anderer Fahrzeuge),
   * (2) Fairness-Validator: Es bleibt ein erreichbarer, kollisionsfreier Weg (die Vorwarnung `lead` liegt noch vor der Bewegung).
   */
  private safeNow(c: TrafficCtx, o: Obstacle, toX: number, lead: number, ttc: number): boolean {
    const D = B.dynamic, def = KINDS[o.kind];
    const t1 = lead + D.lc.move + 0.4;
    for (const u of c.obstacles) {
      if (u === o || u.hit) continue;
      const ud = KINDS[u.kind];
      const ux = [u.x];
      if (u.lc && (u.lc.stage === 'warn' || u.lc.stage === 'move' || (u.lc.stage === 'idle' && u.lc.scripted))) ux.push(u.lc.toX);
      const near = ux.some((x) => Math.abs(x - toX) < (def.w + ud.w) / 2 + 0.3);
      if (!near) continue;
      // Das andere Fahrzeug steht in der Zielspur (oder fährt dorthin): ausreichender Längsabstand über die ganze Dauer, bei Warnbeginn mit der Warnzeit
      const gap = minLongGap({ z: o.z, vz: o.vz, len: def.len }, { z: u.z, vz: u.vz, len: ud.len }, 0, t1, c.timeScale);
      if (gap < D.lc.laneGap + D.lc.zMargin * 0.3) return false;
    }
    // Beim Warnbeginn gilt der Kandidat; vor der Querbewegung trägt der Fahrzeugzustand (warn) die Restzeit selbst
    // Der Horizont reicht bis über die Ankunft des Wechslers hinaus (mindestens 2,8 s), damit auch spätere Engstellen zählen
    const horizon = Math.min(5, Math.max(D.horizon, ttc + 0.6));
    return lanesSolvable(c.obstacles, c.q, c.s, c.speedKmh, c.timeScale, lead > 0 ? { candidate: { id: o.id, toX }, horizon } : { horizon });
  }
}
