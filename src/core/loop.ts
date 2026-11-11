import { BALANCE } from '../config/balance';

/** Fester Zeitschritt mit begrenztem Nachholen; genau eine rAF-Schleife. */
export class FixedLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  private active = false;

  constructor(
    private step: (dt: number) => void,
    private render: (frameDt: number) => void,
    private onStall: () => void = () => {},
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.reset();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.active = false;
    cancelAnimationFrame(this.raf);
  }

  /** Akkumulator zurücksetzen (nach Fokusverlust/Fortsetzen). */
  reset(): void {
    this.acc = 0;
    this.last = performance.now();
  }

  private tick = (now: number): void => {
    if (!this.active) return;
    const { dt, maxCatchUpSteps, stallMs } = BALANCE;
    const raw = Math.max(0, now - this.last);
    this.last = now;
    if (raw > stallMs) {
      // Größere Unterbrechung: nichts nachholen, Spiel pausieren lassen.
      this.acc = 0;
      this.onStall();
    } else {
      this.acc += Math.min(raw / 1000, dt * maxCatchUpSteps);
      while (this.acc >= dt) {
        this.step(dt);
        this.acc -= dt;
      }
    }
    this.render(Math.min(raw, 100) / 1000);
    this.raf = requestAnimationFrame(this.tick);
  };
}
