import { gfx } from './sprites';
import { mixHex } from './scenery';

/**
 * Eigenes 3D-Modell des violetten 80er-Sportkeils: niedrige, nach hinten abfallende Kabine, leicht eingezogenes
 * Heckdeck zwischen breiten hinteren Kotflügeln, abgeschrägte Kanten, Reifen in den Radkästen, schmale symmetrische
 * Rückleuchten über einem abgesetzten Diffusor mit integrierten Auspufföffnungen. Flächen werden per Painter-Algorithmus
 * mit schwacher Perspektive gezeichnet; der Gierwinkel (Fahrzeugachse gegen Kamerablick) wirkt kontinuierlich:
 * 0° = gerade von hinten (Heck waagerecht und mittig), ± = Dreiviertel-Heckansicht mit sichtbarer Flanke.
 * Koordinaten: x seitlich (+ rechts), y oben, z nach vorn; Fahrzeug 1,9 × 4,2 m, Mittelpunkt im Ursprung.
 * Sichtbare Breite (±0,95 m über den Reifen) und Trefferfläche (balance.player) sind aufeinander abgestimmt.
 */
export interface CarFx { turbo: boolean; grip: boolean; brake: number; steer: number; running: boolean; yaw: number; /** Flughöhe in Modelleinheiten */ lift?: number; /** Phantom-Turbo 0…1: Karosserie wird schwarz, nur die Rückleuchten leuchten */ stealth?: number; /** Darstellung der Länge 0…1 (1 = wahre Länge, deckt sich mit der Kollisionsbox) */ zs?: number }

type V3 = [number, number, number];
interface Poly { pts: V3[]; col: string; al?: number }
interface Face { pts: V3[]; col: string; kind: 'rear' | 'right' | 'left' | 'top'; extra: Poly[]; /** Zeichenreihenfolge: positive Werte werden früher (weiter hinten) gezeichnet */ bias?: number }

const ZR = -2.1;
/** Darstellung der Länge (steile Heckkamera dehnt das Modell sonst); Heck und Breite bleiben maßgeblich. */
const ZS = 0.6;
const COL = {
  violet: '#4a1a9a', purple: '#6a28c0', deep: '#2a0f5e', lilac: '#c9a8ff', glass: '#0b0d26', tire: '#07070f',
  red: '#ff2a2a', magenta: '#ff4fd8', dark: '#10061f', bevel: '#8a3fe0', fender: '#7a34d0',
};
const RIGHT_SIDE = '#5a22b0', LEFT_SIDE = '#3d1585';

const mirror = (p: V3[]): V3[] => p.map(([x, y, z]) => [-x, y, z] as V3).reverse();
const q = (x0: number, x1: number, y0: number, y1: number, z: number): V3[] => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];

function build(fx: CarFx): Face[] {
  const F: Face[] = [];
  const b = fx.brake;
  const core = b > 0.3 ? '#ff6a5a' : COL.red;
  const E = -0.001;
  // ---------------- Diffusor (abgesetzt, leicht nach vorn versetzt) mit Lamellen und integrierten Auspufföffnungen
  const fins: Poly[] = [];
  for (let i = 0; i < 5; i++) fins.push({ pts: q(-0.5 + i * 0.25, -0.48 + i * 0.25, 0.17, 0.4, ZR + 0.06 + E), col: '#3a1f6e' });
  F.push({
    kind: 'rear', col: '#1a0a36',
    pts: [[-0.56, 0.12, ZR + 0.06], [0.56, 0.12, ZR + 0.06], [0.62, 0.2, ZR + 0.06], [0.62, 0.44, ZR + 0.06], [-0.62, 0.44, ZR + 0.06], [-0.62, 0.2, ZR + 0.06]],
    extra: [
      ...fins,
      { pts: q(-0.5, -0.24, 0.2, 0.3, ZR + 0.06 + 2 * E), col: '#8a8aa8' }, { pts: q(0.24, 0.5, 0.2, 0.3, ZR + 0.06 + 2 * E), col: '#8a8aa8' },
      { pts: q(-0.47, -0.27, 0.22, 0.28, ZR + 0.06 + 3 * E), col: '#06020f' }, { pts: q(0.27, 0.47, 0.22, 0.28, ZR + 0.06 + 3 * E), col: '#06020f' },
    ],
  });
  // ---------------- Reifen von hinten: sichtbarer Aufstand unter den Kotflügeln
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -0.96 : 0.6, x1 = s < 0 ? -0.6 : 0.96;
    F.push({ kind: 'rear', col: COL.tire, bias: 6, pts: q(x0, x1, 0, 0.5, -1.7), extra: [{ pts: q(x0, x1, 0.3, 0.5, -1.71), col: '#12091e' }, { pts: q(x0, x1, 0.04, 0.1, -1.71), col: '#2a2a40' }] });
  }
  // ---------------- Heckfläche: abgerundete Schultern, schmale symmetrische Leuchtbänder
  const strip = (s: number): Poly[] => {
    const a = s < 0 ? -0.84 : 0.14, c = s < 0 ? -0.14 : 0.84;
    return [
      { pts: q(a, c, 0.46, 0.62, ZR + E), col: '#ff2a2a', al: 0.2 + 0.4 * b },
      { pts: q(a + 0.02, c - 0.02, 0.5, 0.58, ZR + 2 * E), col: core },
      ...(b > 0.3 ? [{ pts: q(a + 0.02, c - 0.02, 0.56, 0.58, ZR + 3 * E), col: '#ffd0c0' }] : []),
    ];
  };
  F.push({
    kind: 'rear', col: COL.violet,
    pts: [[-0.88, 0.44, ZR], [0.88, 0.44, ZR], [0.94, 0.5, ZR], [0.94, 0.6, ZR], [0.84, 0.7, ZR], [-0.84, 0.7, ZR], [-0.94, 0.6, ZR], [-0.94, 0.5, ZR]],
    extra: [
      { pts: q(-0.9, 0.9, 0.44, 0.47, ZR + E), col: COL.deep },
      { pts: q(-0.1, 0.1, 0.5, 0.58, ZR + 2 * E), col: COL.dark },
      ...strip(-1), ...strip(1),
      { pts: q(-0.78, 0.78, 0.65, 0.69, ZR + E), col: COL.lilac, al: 0.5 },
    ],
  });
  // ---------------- Obere Flächen in Stufen: Kante → Heckdeck (eingezogen) → Heckscheibe → Dach → Scheibe → Haube
  F.push({ kind: 'top', col: '#9a5ae6', pts: [[-0.84, 0.7, ZR], [0.84, 0.7, ZR], [0.68, 0.76, -2.04], [-0.68, 0.76, -2.04]], extra: [] });
  F.push({
    kind: 'top', col: COL.purple, pts: [[-0.68, 0.76, -2.04], [0.68, 0.76, -2.04], [0.62, 0.79, -1.15], [-0.62, 0.79, -1.15]],
    extra: [{ pts: [[-0.6, 0.765, -2.0], [0.6, 0.765, -2.0], [0.57, 0.78, -1.5], [-0.57, 0.78, -1.5]], col: '#ffb066', al: 0.22 * gfx.sun }],
  });
  for (const s of [-1, 1] as const) {
    const m = (pts: V3[]) => (s > 0 ? pts : mirror(pts));
    F.push({
      kind: 'top', col: COL.fender, pts: m([[0.68, 0.76, -2.04], [0.84, 0.7, ZR], [0.94, 0.6, ZR], [0.94, 0.6, -0.9], [0.66, 0.79, -0.9], [0.62, 0.79, -1.15]]),
      extra: [{ pts: m([[0.72, 0.75, -2.0], [0.88, 0.67, -2.0], [0.9, 0.64, -1.2], [0.7, 0.77, -1.2]]), col: '#ffb066', al: 0.28 * gfx.sun }],
    });
  }
  F.push({
    kind: 'top', col: COL.glass, pts: [[-0.62, 0.79, -1.15], [0.62, 0.79, -1.15], [0.52, 1.0, -0.3], [-0.52, 1.0, -0.3]],
    extra: [
      { pts: [[-0.46, 0.82, -1.05], [-0.18, 0.82, -1.05], [-0.1, 0.98, -0.4], [-0.38, 0.98, -0.4]], col: '#3a3f8a', al: 0.5 },
      { pts: [[0.18, 0.82, -1.05], [0.3, 0.82, -1.05], [0.38, 0.98, -0.4], [0.26, 0.98, -0.4]], col: '#3a3f8a', al: 0.36 },
      { pts: [[-0.6, 0.8, -1.14], [0.6, 0.8, -1.14], [0.59, 0.82, -1.1], [-0.59, 0.82, -1.1]], col: '#8a9cff', al: 0.6 * (1 - gfx.sun) },
    ],
  });
  F.push({
    kind: 'top', col: COL.purple, pts: [[-0.46, 1.0, -0.3], [0.46, 1.0, -0.3], [0.52, 1.0, -0.22], [0.5, 1.0, 0.6], [0.44, 1.0, 0.7], [-0.44, 1.0, 0.7], [-0.5, 1.0, 0.6], [-0.52, 1.0, -0.22]],
    extra: [{ pts: [[-0.46, 1.0, -0.26], [0.46, 1.0, -0.26], [0.46, 1.0, 0.1], [-0.46, 1.0, 0.1]], col: '#ffb066', al: 0.26 * gfx.sun }],
  });
  // Dachvorderkante: Scheibe und Haube laufen innerhalb der Dachbreite aus (keine losen Flügel neben dem Dach)
  F.push({ kind: 'top', col: '#4a1a9a', pts: [[-0.5, 1.0, 0.7], [0.5, 1.0, 0.7], [0.46, 0.8, 1.25], [-0.46, 0.8, 1.25]], extra: [] });
  // ---------------- Flanken (nur die zur Kamera gedrehte Seite wird gezeichnet)
  for (const s of [1, -1] as const) {
    const m = (pts: V3[]) => (s > 0 ? pts : mirror(pts));
    const xs = (x: number) => s * x;
    const kind = s > 0 ? 'right' : 'left';
    const archAt = (zc: number, r: number): V3[] => Array.from({ length: 9 }, (_, i) => { const a = (i / 8) * Math.PI; return [xs(0.95), 0.18 + Math.sin(a) * r, zc + Math.cos(a) * r] as V3; });
    F.push({
      kind, col: s > 0 ? RIGHT_SIDE : LEFT_SIDE,
      pts: m([[0.94, 0.14, ZR], [0.94, 0.14, -0.7], [0.94, 0.5, -0.7], [0.94, 0.6, ZR]]),
      extra: [
        { pts: [[xs(0.95), 0.34, -2.0], [xs(0.95), 0.34, -0.8], [xs(0.95), 0.58, -0.95], [xs(0.95), 0.6, -2.0]], col: '#7a2fd0', al: 0.9 },
        { pts: archAt(-1.5, 0.42), col: '#0c0618' },
        { pts: [[xs(0.96), 0, -1.95], [xs(0.96), 0, -1.1], [xs(0.96), 0.4, -1.1], [xs(0.96), 0.4, -1.95]], col: COL.tire },
        { pts: [[xs(0.955), 0.42, -2.05], [xs(0.955), 0.42, -0.72], [xs(0.955), 0.45, -0.72], [xs(0.955), 0.45, -2.05]], col: COL.magenta },
      ],
    });
    F.push({
      kind, col: COL.glass,
      pts: m([[0.68, 0.79, -1.0], [0.68, 0.79, 0.9], [0.5, 1.0, 0.7], [0.52, 1.0, -0.3]]),
      extra: [{ pts: m([[0.64, 0.82, -0.9], [0.64, 0.82, -0.1], [0.54, 0.97, -0.2], [0.54, 0.97, -0.3]]), col: '#3a3f8a', al: 0.5 }],
    });
  }
  return F;
}

export function drawCar(ctx: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => [number, number], _k: number, fx: CarFx): void {
  const yaw = fx.yaw;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const lift = fx.lift ?? 0;
  const st = Math.max(0, Math.min(1, fx.stealth ?? 0));
  const LIGHTS = new Set(['#ff2a2a', '#ff6a5a', '#ffd0c0']);
  const tone = (col: string): string => (st > 0 && !LIGHTS.has(col) && col.length === 7 ? mixHex(col, '#05050c', 0.9 * st) : col);
  const zs = fx.zs ?? ZS;
  const zc = (z: number) => ZR + (z - ZR) * zs;
  const proj = (p: V3) => project(p[0], p[1] + lift, zc(p[2]));
  const gp = (p: V3) => project(p[0], 0, zc(p[2]));
  const path = (pts: V3[], fn: (p: V3) => [number, number] = proj) => { ctx.beginPath(); pts.map(fn).forEach((r, i) => { if (i) ctx.lineTo(r[0], r[1]); else ctx.moveTo(r[0], r[1]); }); ctx.closePath(); };
  // kompakter Kontaktschatten unter den Reifen und weicher Körperschatten; in der Luft kleiner und heller
  const air = Math.min(1, lift / 3);
  const a = 1 - 0.55 * air;
  ctx.fillStyle = `rgba(0,0,10,${0.22 * a})`;
  path([[-0.78, 0, -1.95], [0.78, 0, -1.95], [0.7, 0, 1.0], [-0.7, 0, 1.0]], gp); ctx.fill();
  ctx.fillStyle = `rgba(0,0,10,${0.5 * a})`;
  for (const sg of [-1, 1]) {
    path([[sg * 0.62, 0, -1.95], [sg * 0.95, 0, -1.95], [sg * 0.95, 0, -1.1], [sg * 0.62, 0, -1.1]], gp); ctx.fill();
  }
  // kurze Reflexe direkt unter den Rückleuchten
  ctx.globalAlpha = (0.08 + 0.25 * fx.brake) * a;
  for (const sg of [-1, 1]) { ctx.fillStyle = '#ff2a2a'; path([[sg * 0.16, 0, ZR - 0.02], [sg * 0.84, 0, ZR - 0.02], [sg * 0.8, 0, ZR - 0.12], [sg * 0.2, 0, ZR - 0.12]], gp); ctx.fill(); }
  ctx.globalAlpha = 1;

  const faces = build(fx).filter((f) => f.kind === 'rear' || f.kind === 'top' || (f.kind === 'right' && s > (f.col === COL.glass ? 0.07 : 0.02)) || (f.kind === 'left' && s < -(f.col === COL.glass ? 0.07 : 0.02)));
  const depth = (f: Face) => f.pts.reduce((acc, p) => acc + (-p[0] * s + p[2] * c), 0) / f.pts.length + (f.bias ?? 0);
  faces.sort((x, y) => depth(y) - depth(x));
  for (const f of faces) {
    ctx.fillStyle = tone(f.col);
    path(f.pts); ctx.fill();
    for (const e of f.extra) { ctx.globalAlpha = e.al ?? 1; ctx.fillStyle = tone(e.col); path(e.pts); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(5,0,20,0.42)'; ctx.lineWidth = 1;
    path(f.pts); ctx.stroke();
  }
  // Lichtkanten: warmes Sunset-Licht, später violett-blaue Lichtkanten
  const warm = gfx.sun > 0.45;
  ctx.strokeStyle = warm ? '#ffb066' : '#8a9cff';
  ctx.globalAlpha = (warm ? 0.4 + 0.4 * gfx.sun : 0.8) * (1 - 0.85 * st);
  ctx.lineWidth = 1;
  const lines: V3[][] = [
    [[-0.84, 0.7, ZR], [0.84, 0.7, ZR]], [[-0.94, 0.6, ZR], [-0.84, 0.7, ZR]], [[0.94, 0.6, ZR], [0.84, 0.7, ZR]],
    [[-0.68, 0.76, -2.04], [0.68, 0.76, -2.04]], [[-0.52, 1.0, -0.3], [0.52, 1.0, -0.3]],
    [[-0.62, 0.79, -1.15], [-0.52, 1.0, -0.3]], [[0.62, 0.79, -1.15], [0.52, 1.0, -0.3]],
  ];
  for (const l of lines) { ctx.beginPath(); const p0 = proj(l[0]), p1 = proj(l[1]); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); }
  ctx.globalAlpha = 1;
  if (st > 0) {
    // Knight-Rider: kräftig leuchtende Rückleuchten mit Lichthof und Reflex auf dem Asphalt
    for (const sg of [-1, 1]) {
      ctx.fillStyle = '#ff2a2a';
      ctx.globalAlpha = 0.28 * st; path([[sg * 0.12, 0.42, ZR - 0.02], [sg * 0.9, 0.42, ZR - 0.02], [sg * 0.9, 0.66, ZR - 0.02], [sg * 0.12, 0.66, ZR - 0.02]]); ctx.fill();
      ctx.globalAlpha = 0.22 * st; path([[sg * 0.1, 0, ZR - 0.02], [sg * 0.86, 0, ZR - 0.02], [sg * 0.8, 0, ZR - 0.5], [sg * 0.16, 0, ZR - 0.5]], gp); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
