import { BALANCE as B } from '../config/balance';
import type { SteerInput } from '../sim/sim';

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
    surface.addEventListener('pointercancel', this.onUp, sig);
    surface.addEventListener('lostpointercapture', this.onUp, sig);
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
    this.seq++;
    this.drag = 0;
    try { this.surface.setPointerCapture(e.pointerId); } catch { /* ignorieren */ }
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pid) return;
    this.drag = dragMeters(e.clientX - this.refX, this.surface.getBoundingClientRect().width);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pid) return;
    this.pid = null;
    this.releasedAt = performance.now();                                   // Ziel bleibt kurz bestehen (Settle)
    if (this.drag !== null && Math.abs(this.drag) < 0.05) this.drag = null;  // Tipp: Position halten
  };

  /** Alle laufenden Eingaben verwerfen (Pause, Fokus, Größenwechsel, Crash, Neustart). */
  reset(): void {
    this.left = false;
    this.right = false;
    this.drag = null;
    this.pid = null;
    this.releasedAt = 0;
  }

  snapshot(): SteerInput {
    if (this.pid === null && this.drag !== null && performance.now() - this.releasedAt > B.touch.settle * 1000) this.drag = null;
    const dir = this.left === this.right ? 0 : this.left ? -1 : 1;
    return { dir, drag: this.drag, dragSeq: this.seq };
  }

  destroy(): void { this.ac.abort(); }
}
