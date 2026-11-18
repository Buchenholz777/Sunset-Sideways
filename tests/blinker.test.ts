import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { blinkerIntensity, blinkerLight } from '../src/render/sprites';
import { KINDS, type ObjKind } from '../src/sim/world';

const KINDS_LC: ObjKind[] = ['taxi', 'cabrio', 'sedan', 'truck'];

describe('Fahrzeugblinker', () => {
  it('Größe: etwa 6–10 % der sichtbaren Fahrzeugbreite (bei großer Darstellung), nie unter der Mindestbreite', () => {
    for (const kind of KINDS_LC) {
      const l = blinkerLight(kind, 100, 100, 30, 1, B.blinker.scale, 1.1);
      const share = l.w / (KINDS[kind].w * 30);
      expect(share).toBeGreaterThanOrEqual(0.06);
      expect(share).toBeLessThanOrEqual(0.10);
      const far = blinkerLight(kind, 100, 100, 0.5, 1, B.blinker.scale, 1.1);
      expect(far.w).toBeGreaterThanOrEqual(1.1);            // technische Mindestgröße
    }
  });
  it('schlank: Höhe höchstens die Hälfte bis zwei Drittel der Breite (keine Blöcke)', () => {
    for (const kind of KINDS_LC) {
      const l = blinkerLight(kind, 100, 100, 30, 1, B.blinker.scale, 1.1);
      expect(l.h / l.w).toBeLessThanOrEqual(0.6);
    }
  });
  it('Richtung: links = linke Fahrzeughälfte, rechts = rechte; sitzt am Heckleuchtenrand innerhalb der Fahrzeugbreite', () => {
    for (const kind of KINDS_LC) {
      const r = blinkerLight(kind, 100, 100, 20, 1, B.blinker.scale, 1.1), l = blinkerLight(kind, 100, 100, 20, -1, B.blinker.scale, 1.1);
      expect(r.cx).toBeGreaterThan(100);
      expect(l.cx).toBeLessThan(100);
      expect(r.cx - 100).toBeCloseTo(100 - l.cx, 6);
      expect(r.cx + r.w / 2).toBeLessThanOrEqual(100 + (KINDS[kind].w / 2) * 20 + 1e-6);
      expect(r.cy).toBeLessThan(100);                         // über dem Boden
    }
  });
  it('Blinken: weiche Helligkeit ohne Größenänderung, Frequenz im Bereich 1,5–2 Hz, kein hartes Schalten', () => {
    expect(B.blinker.frequency).toBeGreaterThanOrEqual(1.5);
    expect(B.blinker.frequency).toBeLessThanOrEqual(2);
    let max = 0, min = 1, jump = 0, prev = blinkerIntensity(0, B.blinker.frequency, false);
    for (let t = 0; t < 2; t += 1 / 120) {
      const i = blinkerIntensity(t, B.blinker.frequency, false);
      max = Math.max(max, i); min = Math.min(min, i); jump = Math.max(jump, Math.abs(i - prev)); prev = i;
    }
    expect(max).toBeGreaterThan(0.95);
    expect(min).toBeLessThan(0.2);
    expect(jump).toBeLessThan(0.15);                          // kein hartes An/Aus
    const a = blinkerLight('sedan', 100, 100, 20, 1, B.blinker.scale, 1.1), b = blinkerLight('sedan', 100, 100, 20, 1, B.blinker.scale, 1.1);
    expect(a).toEqual(b);                                     // Geometrie hängt nicht von der Zeit ab
  });
  it('Reduzierte Bewegung: gedämpft, aber dauerhaft sichtbar', () => {
    const i = blinkerIntensity(0.3, B.blinker.frequency, true);
    expect(i).toBeGreaterThan(0.5);
    expect(blinkerIntensity(0.9, B.blinker.frequency, true)).toBe(i);
  });
  it('Vorwarnzeit bleibt erhalten (≥ 1,0 s) und die Farbe ist warmes Bernsteinorange', () => {
    expect(B.dynamic.lc.warn).toBeGreaterThanOrEqual(1.0);
    expect(B.blinker.warningDuration).toBeGreaterThanOrEqual(1.0);
    expect(B.blinker.color.toLowerCase()).toBe('#ffb547');
  });
});
