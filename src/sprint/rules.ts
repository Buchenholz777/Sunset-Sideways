import { DEFAULT_CONFIG, clone, normalize, type GameConfig } from '../config/runtime';
import { BALANCE } from '../config/balance';
import type { GenWorld } from '../gen/generator';
import type { ObjKind, PickupType } from '../sim/world';
import ROUTE_V1 from './route_v1.json';

/**
 * „Sunset Sprint“: eine feste, versionierte Kurzstrecke bis in die Neonnacht (Ziel nach ≈ 60 s).
 * Regeln, Tempokurve, Lichtphasen und Verkehrsfolge sind fest und unabhängig von der Live-Konfiguration des Endless-Modus.
 * Gleiche Strecke und Regeln für alle: Die Begegnungen stammen aus einer gespeicherten Route (route_v1.json), nicht aus dem laufenden Weltzustand.
 */
export const SPRINT_ID = 'S1';
export const SPRINT_VERSION = 1;
/** Fester Streckenseed (Straßenverlauf, Hügel) und Zielstrecke in Metern. */
export const SPRINT_SEED = 20261114;
export const SPRINT_FINISH_M = 7000;
/** Maßstab der Kulissenabschnitte: Der „Strip“ beginnt bei 20 km × Faktor, also deutlich vor dem Ziel. */
export const SPRINT_STAGE_SCALE = 0.275;

export const SPRINT_CONFIG: GameConfig = (() => {
  const c = clone(DEFAULT_CONFIG);
  c.profile = 'custom';
  c.tempo = { startKmh: 240, maxKmh: 520, distToMaxKm: 8, density: 1 };
  c.scenery = { ...c.scenery, duskKm: 1, nightKm: 5.5, moonHighKm: 7 };
  c.event = { ...c.event, on: false };
  return normalize(c);
})();

export interface RouteEntry {
  /** Ab dieser Streckenposition des Spielers (m) erscheint das Objekt. */
  s: number;
  o?: { k: ObjKind; x: number; z: number; v: number };
  p?: { t: PickupType; x: number; z: number };
}
export const SPRINT_ROUTE = ROUTE_V1 as RouteEntry[];

/** Stellt die gespeicherte Route nach – gleiche Eingaben liefern dieselben Begegnungen, egal wie gefahren wird. */
export class ScriptedGen {
  private i = 0;
  readonly log = [];
  constructor(private route: readonly RouteEntry[]) {}
  update(w: GenWorld): void {
    while (this.i < this.route.length && this.route[this.i].s <= w.s) {
      const e = this.route[this.i++];
      if (e.o) w.obstacles.push({ id: w.nextId++, kind: e.o.k, x: e.o.x, z: e.o.z, vz: e.o.v, hit: false, knockT: 0, knockVx: 0 });
      else if (e.p) w.pickups.push({ id: w.nextId++, type: e.p.t, x: e.p.x, z: e.p.z, taken: false });
    }
  }
}

/** Setzt die Sprint-Regeln (Tempokurve, Licht, Kulissenabschnitte) – ruft applyConfig und stellt danach den Kulissenmaßstab. */
export function sprintStageScale(on: boolean): void { (BALANCE.scenery as { stageScale: number }).stageScale = on ? SPRINT_STAGE_SCALE : 1; }
