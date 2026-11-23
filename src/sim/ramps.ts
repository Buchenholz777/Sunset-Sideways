import { createRng } from '../core/rng';
import { planRoute } from './route';
import { laneX } from './world';
import { type Footprint } from './contacts';
import type { Road } from './road';

/**
 * Rampen: Auffahrten auf der Straße und Lkw mit Laderampe am Heck. Wer mit dem Wagen über die Fläche fährt, hebt ab (gleicher Flugzustand wie „Fliegen“, aber kürzer),
 * kann im Flug lenken und setzt nach `fly` Sekunden an der markierten Stelle wieder auf. Im Flug gibt es keine Kontakte, der Lkw-Aufbau lässt sich so überfliegen.
 * Lage und Art hängen nur von Seed und Strecke ab (reproduzierbar); in Tunneln und Casinos gibt es keine Rampen.
 */
export const RAMP = {
  /** Flugdauer (s): steiles Abheben, dann langes Sinken. */
  fly: 2.0,
  /** Scheitelhöhe des Sprungs (m): ein hoher Bogen, kein Schweben und kein Antrieb. */
  jumpH: 4.5,
  /** Form des Bogens: Exponent < 1 steigt steil an (Scheitel bei u = 0,5^(1/rise)) und sinkt dann lang aus. */
  rise: 0.55,
  /** Länge und Breite der Auffahrtsfläche (m) und Höhe der Oberkante (m); Autotransporter-Rampe schmaler (Breite des Aufliegers). */
  len: 5.5, width: 3.0, truckWidth: 2.3, height: 2.0,
  /** Erste Rampe frühestens ab (m), Abstand der folgenden (m), Anteil der Lkw-Rampen. */
  first: 1100, gapMin: 1100, gapMax: 2100, truckShare: 1,
  /** Tempo des Rampen-Lkw (m/s), wie die übrigen Lkw (36 km/h). */
  truckV: 10,
  /** Rampen entstehen, sobald sie näher als so viele Meter am Wagen liegen (größer als die Zeichenweite). */
  spawnAhead: 700,
} as const;

export interface Ramp { id: number; x: number; z: number; vz: number; truck: boolean; taken: boolean }
export interface RampSlot { z: number; lane: number; truck: boolean }

export function rampFootprint(road: Road, r: Ramp): Footprint {
  return { x: road.center(r.z) + r.x, z: r.z, yaw: Math.atan(road.heading(r.z)), halfWidth: (r.truck ? RAMP.truckWidth : RAMP.width) / 2, halfLength: RAMP.len / 2 };
}

/** Folge der Rampenpositionen zu einem Seed (lazy, gleiche Folge für jeden Aufrufer). */
export class RampPlan {
  private rnd: () => number;
  private z: number;
  private list: RampSlot[] = [];
  private events: ReturnType<typeof planRoute>;
  constructor(seed: number, from = 0) {
    this.rnd = createRng((seed ^ 0x7a3b11) >>> 0);
    this.z = Math.max(RAMP.first, from);
    this.events = planRoute(seed);
  }
  /** Alle Positionen bis einschließlich z. */
  upTo(z: number): readonly RampSlot[] {
    while (this.z <= z) {
      let at = this.z;
      // keine Rampe in oder kurz vor einem Streckenereignis
      for (const e of this.events) if (at > e.start - 300 && at < e.end + 200) at = e.end + 200;
      const lane = Math.floor(this.rnd() * 3);
      this.list.push({ z: at, lane, truck: this.rnd() < RAMP.truckShare });
      this.z = at + RAMP.gapMin + this.rnd() * (RAMP.gapMax - RAMP.gapMin);
    }
    return this.list;
  }
  laneX(s: RampSlot): number { return laneX(s.lane); }
}
