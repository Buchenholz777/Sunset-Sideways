import { BALANCE as B } from '../config/balance';

export type ObjKind = 'taxi' | 'cabrio' | 'sedan' | 'truck' | 'baken' | 'barrier';
/** Impulsschild, Zeitblase, Spurblitz ('clear'), Magnetfeld, Fliegen ('glide', selten), Phantom-Turbo ('boost'), Pfadfinder ('guide'). */
export type PickupType = 'shield' | 'slow' | 'clear' | 'magnet' | 'glide' | 'boost' | 'guide';
export const PICKUP_TYPES: readonly PickupType[] = ['shield', 'slow', 'clear', 'magnet', 'glide', 'boost', 'guide'];

export interface KindDef { w: number; len: number; moving: boolean }
export const KINDS: Record<ObjKind, KindDef> = {
  taxi: { w: 1.85, len: 4.6, moving: true },
  cabrio: { w: 1.8, len: 4.1, moving: true },
  sedan: { w: 1.9, len: 4.8, moving: true },
  truck: { w: 2.45, len: 10, moving: true },
  baken: { w: 0.9, len: 0.9, moving: false },
  barrier: { w: 2.6, len: 0.7, moving: false },
};

export interface Obstacle {
  id: number; kind: ObjKind; x: number; z: number; vz: number;
  hit: boolean; knockT: number; knockVx: number;
  /** Durch den Spur-Räumer entfernt (Rückmeldung in der Darstellung). */
  cleared?: boolean;
  /** Vom Impulsschild weggestoßen. */
  impulse?: boolean;
}
export interface Pickup { id: number; type: PickupType; x: number; z: number; taken: boolean; /** vom Magnetfeld angezogen */ pull?: boolean }

export const laneX = (i: number): number => (i - 1) * B.road.laneWidth;
export const laneOf = (x: number): number => Math.max(0, Math.min(2, Math.round(x / B.road.laneWidth) + 1));
