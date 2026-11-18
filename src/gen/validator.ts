import { BALANCE as B } from '../config/balance';
import { steerAt } from '../core/speed';
import { KINDS, laneX, type Obstacle } from '../sim/world';

/**
 * Fairness-Validator (P1.2): prüft über einen Zeithorizont (≥ 2,5 s) mit einem zeitabhängigen Fahrspurgraphen, ob der Spieler
 * mit der normalen Steuerung einen kollisionsfreien Weg hat – nicht nur, ob irgendeine Spur gerade frei ist.
 *
 * Modell: Spuren 0–2, Zeitraster `B.dynamic.step`. Der Spieler fährt mit konstantem Tempo; ein Spurwechsel dauert Spurbreite ÷ (0,7 · Lenkgeschwindigkeit)
 * und sperrt beide Spuren, bis er beendet ist; vor `react` Sekunden wird nicht gelenkt. Hindernisse bewegen sich linear. Fahrzeuge mit angekündigtem
 * oder geplantem Spurwechsel sperren beide Spuren bis zum Ende der Querbewegung (konservativ).
 */
export interface Candidate { id: number; toX: number }
export interface SolveOptions {
  /** Reaktionszeit des Spielers vor der ersten Lenkbewegung (s). */
  react?: number;
  horizon?: number;
  /** Fahrzeug, dessen Spurwechsel jetzt (Warnbeginn) geprüft werden soll. */
  candidate?: Candidate;
}

const MZ = 0.8;       // Längs-Sicherheitsabstand (m)
const MX = 0.2;       // Quer-Sicherheitsabstand (m)

interface Occ { z: number; vz: number; len: number; lo0: number; hi0: number; lo1: number; hi1: number; tSwitch: number }

function occupancy(o: Obstacle, cand: Candidate | undefined): Occ {
  const def = KINDS[o.kind], hw = def.w / 2;
  const lc = o.lc;
  let from = o.x, to = o.x, tSwitch = 0;
  if (cand && cand.id === o.id) { from = o.x; to = cand.toX; tSwitch = B.dynamic.lc.warn + B.dynamic.lc.move; }
  else if (lc && lc.stage === 'warn') { from = lc.fromX; to = lc.toX; tSwitch = B.dynamic.lc.warn - lc.t + B.dynamic.lc.move; }
  else if (lc && lc.stage === 'move') { from = lc.fromX; to = lc.toX; tSwitch = Math.max(0, B.dynamic.lc.move - lc.t); }
  else if (lc && lc.stage === 'idle' && lc.scripted) { from = lc.fromX; to = lc.toX; tSwitch = Infinity; }
  const lo0 = Math.min(from, to) - hw, hi0 = Math.max(from, to) + hw;
  return { z: o.z, vz: o.vz, len: def.len, lo0, hi0, lo1: to - hw, hi1: to + hw, tSwitch };
}

/** Ist ein kollisionsfreier, erreichbarer Weg über den Horizont vorhanden? */
export function lanesSolvable(obstacles: readonly Obstacle[], q: number, s: number, speedKmh: number, timeScale: number, opt: SolveOptions = {}): boolean {
  const H = opt.horizon ?? B.dynamic.horizon, dt = B.dynamic.step, react = opt.react ?? B.dynamic.playerReact;
  const K = Math.ceil(H / dt);
  const v = speedKmh / 3.6, L = B.player.len, ph = B.player.width / 2 + MX;
  const sens = Math.min(1, B.steer.sens.key, B.steer.sens.touch);
  const vLat = Math.max(4, 0.7 * steerAt(speedKmh).vKey * sens);
  const m = Math.max(1, Math.ceil(B.road.laneWidth / vLat / dt));
  const occs: Occ[] = [];
  for (const o of obstacles) {
    if (o.hit) continue;
    const oc = occupancy(o, opt.candidate);
    // außerhalb des Horizonts: nichts zu prüfen
    if (oc.z > s + v * H + 60 || oc.z + oc.len < s - L - 20) continue;
    occs.push(oc);
  }
  const free: boolean[][] = [];
  for (let k = 0; k <= K; k++) {
    const t = k * dt, sp = s + v * t;
    const row = [true, true, true];
    for (const oc of occs) {
      const zr = oc.z + oc.vz * timeScale * t;
      if (zr >= sp + MZ || zr + oc.len <= sp - L - MZ) continue;
      const lo = t < oc.tSwitch ? oc.lo0 : oc.lo1, hi = t < oc.tSwitch ? oc.hi0 : oc.hi1;
      for (let l = 0; l < 3; l++) { const x = laneX(l); if (hi > x - ph && lo < x + ph) row[l] = false; }
    }
    free.push(row);
  }
  let dp = [false, false, false];
  for (let l = 0; l < 3; l++) dp[l] = Math.abs(laneX(l) - q) <= 2.0 && free[0][l];
  if (!dp.some(Boolean)) return false;
  // Vorwärtsrechnung über das Zeitraster: Spur halten oder in m Schritten zur Nachbarspur wechseln (beide Spuren frei)
  const reach: boolean[][] = Array.from({ length: K + 1 }, () => [false, false, false]);
  reach[0] = dp;
  const kReact = Math.ceil(react / dt);
  for (let k = 0; k < K; k++) {
    for (let l = 0; l < 3; l++) {
      if (!reach[k][l]) continue;
      if (free[k + 1][l]) reach[k + 1][l] = true;
      if (k < kReact) continue;
      for (const l2 of [l - 1, l + 1]) {
        if (l2 < 0 || l2 > 2) continue;
        let ok = true;
        for (let j = k + 1; j <= Math.min(K, k + m); j++) if (!free[j][l] || !free[j][l2]) { ok = false; break; }
        if (ok) reach[Math.min(K, k + m)][l2] = true;
      }
    }
  }
  return reach[K].some(Boolean);
}

/** Mindestabstand zweier Fahrzeuge (Strecke, Lücke zwischen den Längsintervallen) über ein Zeitfenster, in Metern; negativ = Überlappung. */
export function minLongGap(a: { z: number; vz: number; len: number }, b: { z: number; vz: number; len: number }, ta: number, tb: number, timeScale: number): number {
  let g = Infinity;
  for (let t = ta; t <= tb + 1e-9; t += 0.1) {
    const za = a.z + a.vz * timeScale * t, zb = b.z + b.vz * timeScale * t;
    g = Math.min(g, Math.max(za - (zb + b.len), zb - (za + a.len)));
  }
  return g;
}
