import { BALANCE as B } from '../config/balance';
import { speedAtDist } from '../core/speed';

const STEP = 2;
const hash = (n: number): number => {
  let h = (n | 0) * 374761393 + 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Größte Krümmung (1/m) der Hügelfunktion bei voller Amplitude. */
const HILL_KAPPA = 10 / (143 * 143) + 3.4 / (68 * 68) + 15 / (271 * 271);
const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

interface Seg { z0: number; len: number; k: number }

/**
 * Durchgehende Straßenmittellinie in Weltkoordinaten: abschnittsweise Krümmung (weich ein-/ausgeblendet),
 * daraus Kurswinkel und Querversatz. Eine Instanz je Seed; Kamera, Straße, Objekte und Kulisse nutzen sie gemeinsam.
 * Die Zufallsquelle ist eine reine Hash-Funktion und berührt den Fahrkern-Generator nicht.
 */
export class Road {
  private segs: Seg[] = [];
  private nextZ = 0;
  private lastSign = 1;
  private theta: number[] = [0];
  private cen: number[] = [0];
  private n = 0; // Segmentzähler für Hash
  /** Schätzung des Kurswinkels am Ende des letzten Segments (hält die Straße nahe der Z-Achse). */
  private thetaEst = 0;

  constructor(private seed = 0) {
    const sign = hash(seed * 7 + 3) < 0.5 ? -1 : 1;
    this.lastSign = sign;
    const kFirst = B.curves.firstK;
    this.segs.push({ z0: B.curves.firstStart, len: B.curves.firstLen, k: sign * kFirst });
    this.nextZ = B.curves.firstStart + B.curves.firstLen;
    this.thetaEst = sign * kFirst * B.curves.firstLen * 0.7;
  }

  private extendSegs(z: number): void {
    while (this.nextZ < z + 400) {
      const h = (j: number) => hash(this.seed * 131 + this.n * 17 + j);
      this.n++;
      const gap = 90 + 170 * h(1);                       // lesbarer Übergang (Gerade)
      const len = 200 + 240 * h(2);
      let sign = h(3) < 0.55 ? -this.lastSign : this.lastSign;
      if (this.thetaEst > 0.2) sign = -1; else if (this.thetaEst < -0.2) sign = 1;   // Richtung bleibt begrenzt
      const k = sign / (B.curves.minR + B.curves.varR * h(4));
      this.segs.push({ z0: this.nextZ + gap, len, k });
      this.thetaEst += k * len * 0.7;
      this.lastSign = sign;
      this.nextZ += gap + len;
    }
  }

  /** Krümmung (1/m, > 0 = Rechtskurve) – stetig, beginnt und endet weich. */
  curv(z: number): number {
    this.extendSegs(z);
    let lo = 0, hi = this.segs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.segs[m].z0 <= z) lo = m; else hi = m - 1; }
    const s = this.segs[lo];
    if (z < s.z0 || z > s.z0 + s.len) return 0;
    const u = (z - s.z0) / s.len;
    return s.k * smooth(u / 0.3) * smooth((1 - u) / 0.3);
  }

  private integrate(z: number): void {
    const need = Math.ceil(Math.max(0, z) / STEP) + 3;
    while (this.theta.length <= need) {
      const i = this.theta.length - 1;
      const k = this.curv((i + 0.5) * STEP);
      const th = this.theta[i] + k * STEP;
      this.theta.push(th);
      this.cen.push(this.cen[i] + ((this.theta[i] + th) / 2) * STEP);
    }
  }

  private at(arr: number[], z: number): number {
    const f = Math.max(0, z) / STEP;
    const i = Math.floor(f);
    return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
  }

  /** Kurswinkel (rad) der Mittellinie. */
  heading(z: number): number { this.integrate(z + 2 * STEP); return this.at(this.theta, z); }
  /** Hügelhöhe (m, rein optisch): sanfte Wellen ab ≈ 0,6 km, bis 17 km voll, ab 20 km völlig flach. */
  height(z: number): number {
    if (z <= 600 || z >= 20000) return 0;
    // Sichtbarkeit zuerst: Die Krümmung der Hügel wird mit dem Tempo begrenzt, damit Hindernisse ab der Warnweite (1,25 s)
    // nie hinter einer Kuppe verschwinden (Sichtlinie vom Fahrzeug über die Kuppe zum Hindernis).
    const dWarn = (1.25 * speedAtDist(z)) / 3.6;
    const kAllowed = (8 * 2.0) / Math.pow(1.5 * dWarn, 2);
    const vis = Math.min(1, (0.85 * kAllowed) / HILL_KAPPA);
    const amp = Math.min(smooth((z - 600) / 1200), 1 - smooth((z - 17000) / 3000), vis);
    const p = (j: number) => hash(this.seed * 53 + j) * 6.283;
    const swell = 0.75 + 0.25 * Math.sin(z / 2600 + p(7));
    return amp * swell * (10 * Math.sin(z / 143 + p(1)) + 3.4 * Math.sin(z / 68 + p(2)) + 15 * Math.sin(z / 271 + p(3)));
  }

  /** Seitlicher Versatz der Mittellinie (m). */
  center(z: number): number { this.integrate(z + 2 * STEP); return this.at(this.cen, z); }

  /**
   * Versatz der Mittellinie bei z relativ zur Kamera bei zc. Die Kamera blickt mit Vorhalt in den Bogen:
   * statt der Tangente am Kamerapunkt wird (überwiegend) die Tangente 80 m voraus abgezogen.
   */
  offset(z: number, zc: number): number {
    const lam = 0.7;
    const th = (1 - lam) * this.heading(zc) + lam * this.heading(zc + 80);
    return this.center(z) - this.center(zc) - th * (z - zc);
  }
}
