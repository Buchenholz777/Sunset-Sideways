import { describe, expect, it } from 'vitest';
import { RENDER, isCrispScale, makeLayout, renderScale } from '../src/render/projection';

describe('Renderauflösung', () => {
  it('Desktop 1280 × 720 rendert 960 × 540 statt 640 × 360', () => {
    const L = makeLayout(1280, 720);
    expect([L.w, L.h]).toEqual([960, 540]);
  });
  it('1920 × 1080 rendert 960 × 540 (ganzzahlig 2:1, scharf)', () => {
    const L = makeLayout(1920, 1080);
    expect([L.w, L.h]).toEqual([960, 540]);
    expect(isCrispScale(L.scale)).toBe(true);
  });
  it('Smartphones bleiben 1:1 (keine Mehrkosten)', () => {
    for (const [w, h] of [[320, 568], [390, 844], [844, 390], [430, 932]]) expect(makeLayout(w, h).scale).toBe(1);
  });
  it('Pixelbudget wird nie überschritten, auch bei extremen Formaten', () => {
    for (const [w, h] of [[2560, 1080], [3440, 1440], [1920, 1200], [768, 1024], [1024, 768], [3840, 2160], [1280, 720], [1281, 721]]) {
      const L = makeLayout(w, h);
      expect(L.w * L.h).toBeLessThanOrEqual(RENDER.maxPixels * 1.02);
      expect(L.scale).toBeGreaterThanOrEqual(1);
    }
  });
  it('Skalierung ist stetig: ein Pixel Fensteränderung springt nie sichtbar', () => {
    let prev = renderScale(300, 600);
    for (let w = 301; w <= 2200; w++) {
      const s = renderScale(w, Math.round(w * 0.5625));
      expect(Math.abs(s - prev)).toBeLessThan(0.02);
      prev = s;
    }
  });
  it('Komposition bleibt: Horizont, Straße und Wagenzeile liegen in gleichen Bildanteilen', () => {
    const a = makeLayout(1280, 720), b = makeLayout(1920, 1080);
    expect(a.hy / a.h).toBeCloseTo(b.hy / b.h, 2);
    expect(a.gy / a.h).toBeCloseTo(b.gy / b.h, 2);
    expect(a.fx / a.h).toBeCloseTo(b.fx / b.h, 1);
  });
  it('Mindestgrößen bleiben in CSS-Pixeln gleich (u = 2 / Skalierung)', () => {
    const L = makeLayout(1280, 720);
    expect(L.u * L.scale).toBeCloseTo(2, 5);
  });
});
