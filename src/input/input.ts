import { BALANCE as B } from '../config/balance';
import type { SteerInput } from '../sim/sim';
import { laneX } from '../sim/world';

/** Tipp statt Wischen: kurz und fast ohne Fingerweg. */
export const TAP = { maxMs: 260, maxPx: 12 } as const;

/** Zielspur eines Tipps: eine Spur links/rechts der Bezugsspur, begrenzt auf 0..2. */
export function tapLane(refLane: number, side: -1 | 1): number { return Math.max(0, Math.min(2, refLane + side)); }
export const nearestLane = (q: number): number => Math.max(0, Math.min(2, Math.round(q / B.road.laneWidth + 1)));

/** Fingerweg in Pixeln → Querweg in Metern (Totzone, sonst linear: 11 m je Bildbreite). */
export function dragMeters(dxPx: number, surfaceWidth: number): number {
  const a = Math.abs(dxPx);
  if (a <= B.touch.deadPx) return 0;
  return Math.sign(dxPx) * ((a - B.touch.deadPx) / Math.max(120, surfaceWidth)) * B.touch.mPerWidth * B.steer.sens.touch;
}

/**
 * Tastatur (← → bzw. A D) und Ein-Finger-Ziehen auf der Spielfläche. Beim Aufsetzen springt der Wagen nicht
 * (`dragSeq` verankert den Bezugspunkt in der Simulation). Nach dem Loslassen bleibt das Ziel kurz bestehen, damit der
 * Wagen die gewählte Position zügig erreicht; Abbruch, Pause, Fokusverlust und Tastendruck löschen es.
 */
export class Input {
  private left = false;
  private right = false;
  private drag: number | null = null;
  private seq = 0;
  private pid: number | null = null;
  private releasedAt = 0;
  private refX = 0;
  private downAt = 0;
  private maxDx = 0;
  private tapTarget: number | null = null;
  private tapLaneIdx = 1;
  private tapAt = 0;
  /** Tippen links/rechts wechselt eine Spur (nur Touch-Modus). */
  tapEnabled = false;
  /** Aktuelle Quer-Position des Wagens (für den Bezug des Tipps). */
  getQ: () => number = () => 0;
  private ac = new AbortController();
  /** Nur im laufenden Spiel Tasten abfangen und Pointer annehmen. */
  active = false;

  constructor(private surface: HTMLElement) {
    const sig = { signal: this.ac.signal };
    window.addEventListener('keydown', this.onKey(true), sig);
    window.addEventListener('keyup', this.onKey(false), sig);
    window.addEventListener('blur', () => this.reset(), sig);
    surface.addEventListener('pointerdown', this.onDown, sig);
    surface.addEventListener('pointermove', this.onMove, sig);
    surface.addEventListener('pointerup', this.onUp, sig);
    surface.addEventListener('pointercancel', this.onAbort, sig);
    surface.addEventListener('lostpointercapture', this.onAbort, sig);
  }

  private onKey = (down: boolean) => (e: KeyboardEvent): void => {
    const k = e.code;
    const isL = k === 'ArrowLeft' || k === 'KeyA';
    const isR = k === 'ArrowRight' || k === 'KeyD';
    if (!isL && !isR) return;
    if (this.active) e.preventDefault();
    if (down && this.pid === null) this.drag = null;                       // Tastatur übernimmt
    if (isL) this.left = down;
    if (isR) this.right = down;
  };

  private onDown = (e: PointerEvent): void => {
    if (!this.active || this.pid !== null) return;      // weitere Finger ignorieren
    this.pid = e.pointerId;
    this.refX = e.clientX;
    this.downAt = performance.now();
    this.maxDx = 0;
    this.seq++;
    this.drag = 0;
    try { this.surface.setPointerCapture(e.pointerId); } catch { /* ignorieren */ }
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pid) return;
    this.maxDx = Math.max(this.maxDx, Math.abs(e.clientX - this.refX));
    this.drag = dragMeters(e.clientX - this.refX, this.surface.getBoundingClientRect().width);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pid) return;
    this.pid = null;
    this.releasedAt = performance.now();                                   // Ziel bleibt kurz bestehen (Settle)
    if (this.drag !== null && Math.abs(this.drag) < 0.05) this.drag = null;  // Tipp: Position halten
    if (this.tapEnabled && e.type === 'pointerup' && this.maxDx <= TAP.maxPx && performance.now() - this.downAt <= TAP.maxMs) {
      const r = this.surface.getBoundingClientRect();
      const side: -1 | 1 = e.clientX < r.left + r.width / 2 ? -1 : 1;
      const now = performance.now();
      const ref = this.tapTarget !== null && now - this.tapAt < B.touch.settle * 1000 ? this.tapLaneIdx : nearestLane(this.getQ());
      this.tapLaneIdx = tapLane(ref, side); this.tapTarget = laneX(this.tapLaneIdx); this.tapAt = now;
      this.drag = null;
    }
  };

  /**
   * Abbruch (pointercancel, unbeabsichtigt verlorenes Capture, z. B. Rotation oder Systemgeste): Die alte Lenkanforderung wird sofort neutral,
   * ohne Nachführen. Der reguläre lostpointercapture nach pointerup trifft auf pid === null und bleibt wirkungslos.
   */
  private onAbort = (e: PointerEvent): void => {
    if (e.pointerId !== this.pid) return;
    this.pid = null;
    this.drag = null;
    this.releasedAt = 0;
    this.tapTarget = null;
  };

  /** Alle laufenden Eingaben verwerfen (Pause, Fokus, Größenwechsel, Crash, Neustart). */
  reset(): void {
    this.left = false;
    this.right = false;
    this.drag = null;
    this.pid = null;
    this.releasedAt = 0;
    this.tapTarget = null;
  }

  snapshot(): SteerInput {
    if (this.pid === null && this.drag !== null && performance.now() - this.releasedAt > B.touch.settle * 1000) this.drag = null;
    if (this.tapTarget !== null && (this.pid !== null || this.left || this.right || performance.now() - this.tapAt > B.touch.settle * 1000 || Math.abs(this.getQ() - this.tapTarget) < 0.12)) this.tapTarget = null;
    if (this.tapTarget !== null) return { dir: 0, target: this.tapTarget, dragSeq: this.seq };
    const dir = this.left === this.right ? 0 : this.left ? -1 : 1;
    return { dir, drag: this.drag, dragSeq: this.seq };
  }

  destroy(): void { this.ac.abort(); }
}
