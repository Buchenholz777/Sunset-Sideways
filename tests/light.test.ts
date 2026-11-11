import { describe, expect, it } from 'vitest';
import { drawCar, type CarFx } from '../src/render/car3d';
import { LIGHT_KEYS, drawSun, keyMix, lightT, mixHex } from '../src/render/scenery';
import { makeLayout } from '../src/render/projection';

describe('Lichtphasen nach gefahrener Distanz', () => {
  it('Stützpunkte 0 / 15 / 17 / 20 km: langer Sunset, Sonne sinkt 15–17 km, blaue Stunde 17–20 km, ab 20 km Nacht', () => {
    expect(LIGHT_KEYS).toEqual([0, 15000, 17000, 20000]);
    expect(lightT(0)).toBe(0);
    expect(lightT(15000)).toBeCloseTo(0.14, 9);
    expect(lightT(17000)).toBeCloseTo(0.5, 9);
    expect(lightT(20000)).toBe(1);
    expect(lightT(50000)).toBe(1);
    expect(lightT(7500)).toBeLessThan(0.1);                     // bis 15 km bleibt es warm
  });
  it('Sonne bleibt bis 15 km sichtbar (sinkt nur langsam) und ist bei 17 km hinter den Bergen', () => {
    const calls: number[] = [];
    const ctx = { createRadialGradient: () => ({ addColorStop() {} }), fillRect: (_x: number, y: number) => { calls.push(y); }, set fillStyle(_v: unknown) {} } as unknown as CanvasRenderingContext2D;
    const L = makeLayout(1280, 720);
    const drawn = (m: number) => { calls.length = 0; drawSun(ctx, L, m); return calls.length > 0; };
    expect(drawn(0)).toBe(true); expect(drawn(7500)).toBe(true); expect(drawn(14900)).toBe(true);
    expect(drawn(16990)).toBe(true); expect(drawn(17001)).toBe(false);
  });
  it('monoton, stetig und ohne harte Sprünge', () => {
    let prev = 0;
    for (let s = 0; s <= 30000; s += 5) {
      const v = lightT(s);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(v - prev).toBeLessThan(0.01);
      prev = v;
    }
  });
  it('Farbmischung interpoliert getrennt je Kanal', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(keyMix(['#ff0000', '#00ff00', '#0000ff'], 0.5)).toBe('#00ff00');
  });
});

/** Minimaler 2D-Kontext, der gefüllte Polygone aufzeichnet. */
function recorder() {
  const polys: { col: string; pts: [number, number][] }[] = [];
  let cur: [number, number][] = [];
  const ctx = {
    fillStyle: '' as string, strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    beginPath() { cur = []; }, moveTo(x: number, y: number) { cur.push([x, y]); }, lineTo(x: number, y: number) { cur.push([x, y]); },
    closePath() {}, stroke() {}, save() {}, restore() {}, translate() {}, rotate() {}, transform() {},
    fill() { polys.push({ col: String(this.fillStyle), pts: [...cur] }); },
    fillRect(x: number, y: number, w: number, h: number) { polys.push({ col: String(this.fillStyle), pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] }); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, polys };
}
const FX: CarFx = { turbo: false, grip: false, brake: 0, steer: 0, running: true, yaw: 0 };
const RIGHT_SIDE = '#5a22b0', LEFT_SIDE = '#3d1585';

describe('Fahrzeugmodell: echte Flankenansicht', () => {
  const draw = (yawDeg: number) => {
    const r = recorder();
    const yaw = (yawDeg * Math.PI) / 180;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    drawCar(r.ctx, (x, y, z) => [200 + 36 * (x * c + z * s), 300 - 36 * y], 36, { ...FX, yaw });
    return r.polys;
  };
  const bounds = (ps: { pts: [number, number][] }[]) => { const xs = ps.flatMap((p) => p.pts.map((q) => q[0])); return [Math.min(...xs), Math.max(...xs)]; };

  it('gerade von hinten: keine Flanke sichtbar', () => {
    const p = draw(0);
    expect(p.some((q) => q.col === RIGHT_SIDE || q.col === LEFT_SIDE)).toBe(false);
  });
  it('Nase nach rechts (Rechtskurve): rechte Flanke sichtbar, Heck nach links; Linkskurve spiegelbildlich', () => {
    const r = draw(20), l = draw(-20);
    const rs = r.filter((q) => q.col === RIGHT_SIDE), ls = l.filter((q) => q.col === LEFT_SIDE);
    expect(rs.length).toBeGreaterThan(0);
    expect(r.some((q) => q.col === LEFT_SIDE)).toBe(false);
    expect(ls.length).toBeGreaterThan(0);
    expect(l.some((q) => q.col === RIGHT_SIDE)).toBe(false);
    // Flanke liegt auf der Seite der Nase: rechts von der Fahrzeugmitte (x = 200) bzw. links davon
    const [rMin, rMax] = bounds(rs), [lMin, lMax] = bounds(ls);
    expect(rMax - 200).toBeGreaterThan(12);
    expect(200 - lMin).toBeGreaterThan(12);
    // Spiegelung: Breite der sichtbaren Flanke gleich
    expect(Math.abs((rMax - rMin) - (lMax - lMin))).toBeLessThan(2);
  });
  it('Flanke wächst kontinuierlich mit dem Winkel (keine Sprünge zwischen den Ansichten)', () => {
    let prev = 0;
    for (let a = 1; a <= 24; a++) {
      const side = draw(a).filter((q) => q.col === RIGHT_SIDE);
      const [mn, mx] = side.length ? bounds(side) : [0, 0];
      const w = mx - mn;
      expect(w).toBeGreaterThanOrEqual(prev - 0.01);
      expect(w - prev).toBeLessThan(6);
      prev = w;
    }
    expect(prev).toBeGreaterThan(8); // bei 24° klar sichtbare Flankenbreite
  });
});
