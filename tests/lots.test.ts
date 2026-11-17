import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { LOT, clipNear, lotAt, lotKind } from '../src/render/lots';

describe('Grundstücke am Straßenrand (räumliche Anordnung)', () => {
  it('Anordnung ist ortsgebunden und reproduzierbar (unabhängig vom Spielseed)', () => {
    const a = JSON.stringify(lotAt(5, 1, 0).prims), b = JSON.stringify(lotAt(5, 1, 0).prims);
    expect(a).toBe(b);
    expect(JSON.stringify(lotAt(5, 1, 0).prims)).not.toBe(JSON.stringify(lotAt(6, 1, 0).prims));
  });

  it('erste Abschnitte: Motelgrundstück auf einer Seite, offene Fläche gegenüber, Seiten wechseln', () => {
    expect(lotKind(0, 1, 0)).toBe('motel'); expect(lotKind(0, -1, 0)).toBe('open');
    expect(lotKind(2, 1, 0)).toBe('open'); expect(lotKind(2, -1, 0)).toBe('motel');
    const kinds = new Set([0, 1, 2, 3].flatMap((i) => [lotKind(i, 1, 0), lotKind(i, -1, 0)]));
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it('nichts ragt in die aktive Fahrbahn; Bordstein bleibt außer an Einfahrten unberührt; Körper stehen auf dem Boden', () => {
    for (let i = 0; i < 40; i++) for (const side of [-1, 1]) for (const stage of [0, 1, 2, 3, 4]) {
      for (const p of lotAt(i, side, stage).prims) {
        if (p.t === 'box') {
          expect(p.u0, `Abschnitt ${i}`).toBeGreaterThanOrEqual(1.2);                  // Vordach/Schild beginnen erst hinter dem Gehwegrand
          expect(p.u1).toBeGreaterThan(p.u0); expect(p.z1).toBeGreaterThan(p.z0); expect(p.h1).toBeGreaterThan(p.h0);
          expect(p.z0).toBeGreaterThanOrEqual(i * LOT - 1); expect(p.z1).toBeLessThanOrEqual((i + 1) * LOT + 1);
        } else if (p.t === 'gnd') for (const [u] of p.pts) expect(u).toBeGreaterThanOrEqual(-0.3);   // Einfahrten höchstens über Bordstein (0,4 m), nie auf die Fahrbahn
        else if (p.t === 'bush' || p.t === 'palm' || p.t === 'sign') expect(p.u).toBeGreaterThanOrEqual(1.2);
      }
    }
    expect(B.road.halfWidth).toBeGreaterThan(5);
  });

  it('Nahebene: Polygone hinter der Kamera werden beschnitten, nichts springt oder kippt', () => {
    const wall: Array<[number, number, number]> = [[6, 0, 0], [6, 40, 0], [6, 40, 4], [6, 0, 4]];
    const c = clipNear(wall, 10);
    expect(c.length).toBeGreaterThanOrEqual(3);
    for (const p of c) expect(p[1]).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(c.some((p) => Math.abs(p[1] - 10) < 1e-9)).toBe(true);                       // neue Schnittkante genau auf der Nahebene
    expect(clipNear([[6, 0, 0], [6, 4, 0], [6, 4, 3]], 10)).toEqual([]);              // vollständig dahinter
    expect(clipNear(wall, -5)).toEqual(wall);                                          // vollständig davor: unverändert
  });
});
