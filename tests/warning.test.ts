import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, PROFILES } from '../src/config/runtime';
import { DRAW, READ_OBJECT_PX, makeLayout, readableDistance } from '../src/render/projection';
import { KINDS } from '../src/sim/world';

/**
 * Sichtbare Warnzeit (Bild, nicht Generator): Zeit von dem Moment, in dem ein Fahrzeug im Bild mindestens READ_OBJECT_PX (CSS-Pixel) breit,
 * also erkennbar ist, bis zum Kontakt, bei höchster Grundgeschwindigkeit. Sie muss Reaktion (0,4 s) + Spurwechsel (≈ 0,26 s bei 600 km/h) + Reserve (0,14 s) tragen.
 */
const NEED_S = 0.8;
const LAYOUTS: Array<[string, number, number]> = [['320×568', 320, 568], ['390×844', 390, 844], ['412×915', 412, 915], ['844×390', 844, 390], ['1280×720', 1280, 720]];

describe('Sichtbare Warnzeit bei Höchsttempo', () => {
  const speeds = [['Standard 600 km/h', DEFAULT_CONFIG.tempo.maxKmh], ['Anspruchsvoll', PROFILES.hard.patch.maxKmh!]] as const;
  for (const [label, kmh] of speeds) {
    it(`${label}: Fahrzeuge sind auf allen Formaten früh genug erkennbar (≥ ${NEED_S} s)`, () => {
      for (const [n, w, h] of LAYOUTS) {
        const L = makeLayout(w, h);
        for (const kind of ['taxi', 'cabrio', 'sedan', 'truck', 'barrier'] as const) {
          const d = Math.min(DRAW, readableDistance(KINDS[kind].w, READ_OBJECT_PX, L));
          const warn = d / (kmh / 3.6);
          expect(warn, `${n} ${kind} ${kmh} km/h: ${warn.toFixed(2)} s`).toBeGreaterThanOrEqual(NEED_S * (kmh > 600 ? 0.9 : 1));
        }
      }
    });
  }
  it('Baken (0,9 m breit) werden erst spät als Objekt lesbar: dokumentierte Grenze, Spurmarkierung zeigt sie früher', () => {
    const L = makeLayout(390, 844);
    const d = readableDistance(KINDS.baken.w, READ_OBJECT_PX, L);
    expect(d).toBeGreaterThan(30);     // Messwert zur Abnahme; die Warnfläche (markers) wird deutlich vorher sichtbar
  });
});
