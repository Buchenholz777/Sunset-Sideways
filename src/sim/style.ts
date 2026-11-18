import { BALANCE as B } from '../config/balance';
import { KINDS, type Obstacle } from './world';

/**
 * P1.1 Stil-System: Near Miss, Combo und Neon Rush. Reine Zusatzwertung: Die Distanz (Bestweite) bleibt unverändert, die Punkte laufen
 * in `styleScore`. Alle Zeiten sind aktive Simulationszeit (keine Wall-Clock; Pause und Tab-Wechsel halten alles an).
 *
 * Near Miss = (A) reale Kollisionsbedrohung (Kollisionskurs innerhalb von `ttcMax` s), (B) aktive Ausweichbewegung durch Spielereingabe
 * (`minShift` m), (C) erfolgreiches Passieren, (D) keine Kollision. Pro Hindernis höchstens einmal. Bewertet wird nach der Kollisionsprüfung
 * des Schritts, mit Zeit bis zum Zusammenstoß aus Annäherungsgeschwindigkeit (framerate-unabhängig, kein Bildzähler).
 */
export type StyleEvent =
  | { type: 'nearMiss'; pts: number; mult: number; combo: number; rush: boolean; slow: boolean; x: number; z: number; charge: number; perfect: boolean }
  | { type: 'comboLost'; reason: 'time' | 'hit' }
  | { type: 'rushStart' }
  | { type: 'rushEnd'; reason: 'time' | 'hit' };

export interface StyleCtx {
  t: number; s: number; q: number;
  /** Tempo in m/s (inkl. Zeitblase / Phantom-Turbo). */
  speed: number;
  /** Verkehrs-Zeitfaktor (Zeitblase). */
  ts: number;
  obstacles: readonly Obstacle[];
  slowActive: boolean; magnetActive: boolean;
  /** Fliegen, Phantom-Turbo oder Schutzphase: keine Wertung. */
  invulnerable: boolean;
  /** In diesem Schritt wirkte eine Spielereingabe (Tasten, Finger, Zielposition). */
  driven: boolean;
}

interface Track { armQ: number; steered: boolean; shifted: boolean; minGap: number; tick: number }

export class StyleState {
  styleScore = 0;
  nearMissCount = 0;
  maxCombo = 0;
  rushCount = 0;
  comboCount = 0;
  lastNearMissT = -Infinity;
  rushCharge = 0;
  rushActive = false;
  rushRemaining = 0;
  rushCooldown = 0;
  /** Neon Rush 2.0: vergangene Rush-Zeit (s), Rush-Chain (eingesammelte Neon Gates dieses Rushs), Gate-Punkte insgesamt, Tore und Slashes insgesamt. */
  rushElapsed = 0;
  rushChain = 0;
  gatePoints = 0;
  gatesTaken = 0;
  slashCount = 0;
  private tracks = new Map<number, Track>();
  private tick = 0;
  events: StyleEvent[] = [];

  get multiplier(): number { return Math.max(1, Math.min(B.style.combo.maxMult, this.comboCount)); }
  comboWindow(magnet: boolean): number { return magnet ? B.style.combo.windowMagnet : B.style.combo.window; }
  /** Restzeit des Combo-Fensters (s), 0 wenn keine Combo läuft. */
  comboRemaining(t: number, magnet: boolean): number { return this.comboCount > 0 ? Math.max(0, this.comboWindow(magnet) - (t - this.lastNearMissT)) : 0; }

  /** Zentrale Punkteberechnung: Combo-Stufe × Neon Rush × Zeitblase – jeder Faktor genau einmal. */
  static points(mult: number, rush: boolean, slow: boolean): number {
    const S = B.style;
    return Math.round(S.nearMiss.points * mult * (rush ? S.rush.pointsMult : 1) * (slow ? S.slowPointsMult : 1));
  }

  /** Treffer (Schild fängt ab oder Absturz): Combo und Rush enden, Rush-Energie wird 0. */
  onHit(): void {
    if (this.comboCount > 0) { this.comboCount = 0; this.events.push({ type: 'comboLost', reason: 'hit' }); }
    if (this.rushActive) { this.rushActive = false; this.rushRemaining = 0; this.rushChain = 0; this.events.push({ type: 'rushEnd', reason: 'hit' }); }
    this.rushCharge = 0;
    this.rushCooldown = 0;
    this.tracks.clear();
  }

  /** Neon Gate eingesammelt: Rush-Chain +1, Bonus aus gateBonuses (nicht mit der Combo multipliziert). */
  gateTaken(): { n: number; pts: number } {
    const bon = B.style.rush.gateBonuses;
    const n = Math.min(this.rushChain + 1, bon.length);
    const pts = bon[n - 1];
    this.rushChain = n; this.gatesTaken++; this.gatePoints += pts; this.styleScore += pts;
    return { n, pts };
  }

  private startRush(): void {
    this.rushActive = true; this.rushRemaining = B.style.rush.duration; this.rushElapsed = 0; this.rushChain = 0; this.rushCount++;
    this.events.push({ type: 'rushStart' });
  }

  update(c: StyleCtx, dt: number): void {
    const R = B.style.rush;
    // Neon-Rush-Zeit und Abklingzeit
    if (this.rushActive) {
      this.rushRemaining -= dt; this.rushElapsed += dt;
      this.lastNearMissT += dt;                       // die Combo läuft während des Rushs nicht ab
      if (this.rushRemaining <= 0) {
        this.rushActive = false; this.rushRemaining = 0; this.rushCharge = 0; this.rushCooldown = R.cooldown; this.rushChain = 0;
        this.events.push({ type: 'rushEnd', reason: 'time' });
      }
    } else if (this.rushCooldown > 0) {
      this.rushCooldown = Math.max(0, this.rushCooldown - dt);
      if (this.rushCooldown === 0 && this.rushCharge >= R.maxCharge) this.startRush();      // während der Abklingzeit geladen: jetzt aktivieren
    }
    // Combo-Ablauf (Magnet verlängert das Fenster, bei Ablauf gilt wieder die normale Regel)
    if (this.comboCount > 0 && c.t - this.lastNearMissT > this.comboWindow(c.magnetActive)) {
      this.comboCount = 0; this.events.push({ type: 'comboLost', reason: 'time' });
    }
    if (c.invulnerable) { this.tracks.clear(); return; }
    this.scan(c);
  }

  private scan(c: StyleCtx): void {
    const N = B.style.nearMiss, P = B.player;
    const tick = ++this.tick;
    for (const o of c.obstacles) {
      if (o.hit) { this.tracks.delete(o.id); continue; }
      const def = KINDS[o.kind];
      const ahead = o.z - c.s;                       // Abstand Fahrzeugnase → Hindernisheck
      let tr = this.tracks.get(o.id);
      if (!tr && ahead > c.speed * (N.ttcMax + 1) + 40) continue;
      const rel = c.speed - o.vz * c.ts;
      const lat = Math.abs(c.q - o.x);
      const half = def.w / 2 + P.width / 2;
      const onCourse = lat < half + N.courseMargin;
      const passed = o.z + def.len < c.s - P.len;
      if (!tr) {
        if (passed || ahead <= 0 || rel <= 0.1 || !onCourse || ahead / rel > N.ttcMax) continue;
        tr = { armQ: c.q, steered: false, shifted: false, minGap: Infinity, tick };
        this.tracks.set(o.id, tr);
      }
      tr.tick = tick;
      if (c.driven) tr.steered = true;                 // reale Spielereingabe seit dem Bedrohungsbeginn (kein automatisches Korrigieren)
      if (tr.steered && Math.abs(c.q - tr.armQ) >= N.minShift) tr.shifted = true;
      if (o.z < c.s + 0.5 && o.z + def.len > c.s - P.len - 0.5) tr.minGap = Math.min(tr.minGap, lat - half);
      if (passed) {
        this.tracks.delete(o.id);
        const gap = Number.isFinite(tr.minGap) ? tr.minGap : lat - half;
        if (tr.shifted && !onCourse && gap <= N.maxGap) this.award(c, o, gap <= B.style.rush.perfectGap);
      }
    }
    // Hindernisse, die nicht mehr existieren (entfernt, außer Reichweite): Verfolgung beenden
    if (this.tracks.size) for (const [id, tr] of this.tracks) if (tr.tick !== tick) this.tracks.delete(id);
  }

  private award(c: StyleCtx, o: Obstacle, perfect: boolean): void {
    const S = B.style;
    this.comboCount = this.comboCount > 0 && c.t - this.lastNearMissT <= this.comboWindow(c.magnetActive) ? this.comboCount + 1 : 1;
    this.lastNearMissT = c.t;
    this.maxCombo = Math.max(this.maxCombo, this.comboCount);
    this.nearMissCount++;
    const mult = this.multiplier;
    const pts = StyleState.points(mult, this.rushActive, c.slowActive);
    this.styleScore += pts;
    // Rush-Energie: nicht während Neon Rush; besonders knappe Near Misses laden mehr, die Zeitblase nur anteilig
    if (!this.rushActive) this.rushCharge = Math.min(S.rush.maxCharge, this.rushCharge + (perfect ? S.rush.chargePerfect : S.rush.chargePerMiss) * (c.slowActive ? S.rush.chargeSlowK : 1));
    this.events.push({ type: 'nearMiss', pts, mult, combo: this.comboCount, rush: this.rushActive, slow: c.slowActive, x: o.x, z: o.z, charge: this.rushCharge, perfect });
    if (!this.rushActive && this.rushCharge >= S.rush.maxCharge && this.rushCooldown <= 0) this.startRush();
  }
}
