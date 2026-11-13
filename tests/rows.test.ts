import { describe, expect, it } from 'vitest';
import { Road } from '../src/sim/road';
import { makeLayout, CAM_BACK } from '../src/render/projection';
import { computeRows } from '../src/render/rows';
import { BALANCE as B } from '../src/config/balance';

/**
 * Regression „abgeknicktes Bild“: Am unteren Bildrand bekamen mehrere Zeilen dieselbe Tiefe (grobe Abtastung nahe der Kamera),
 * sichtbar als senkrechte Straßenkanten und Versatz der Fahrbahn – besonders bei Anstiegen.
 */
describe('Zeilen → Tiefe (Straßenrendering)', () => {
  it('unten im Bild nie Blöcke gleicher Tiefe, Tiefe wächst nach oben, auch an Anstiegen und Gefällen', () => {
    let worstRun = 0, frames = 0, hills = 0;
    for (const [w, h] of [[1280, 720], [390, 844], [844, 390]]) {
      const L = makeLayout(w, h);
      const rowD = new Float32Array(L.h), occD: number[] = [], occY: number[] = [];
      for (const seed of [3, 99]) {
        const rd = new Road(seed);
        for (let s = 50; s < 21000; s += 53) {
          const zc = s - B.player.len - CAM_BACK, elev0 = rd.height(s - B.player.len / 2);
          computeRows((z) => rd.height(z), zc, elev0, L, rowD, occD, occY);
          frames++;
          if (Math.abs(elev0 - rd.height(zc)) > 0.05) hills++;
          expect(rowD[L.h - 1], `${w}x${h} s=${s}`).toBeGreaterThan(0);                 // unterste Zeile hat Straße
          let run = 1;
          for (let y = Math.floor(L.h * 0.5); y < L.h; y++) {
            if (rowD[y] > 0 && Math.abs(rowD[y] - rowD[y - 1]) < 1e-6) { run++; worstRun = Math.max(worstRun, run); } else run = 1;
            if (rowD[y] > 0 && rowD[y - 1] > 0) expect(rowD[y - 1] + 1e-4, `${w}x${h} s=${s} y=${y}`).toBeGreaterThanOrEqual(rowD[y]);   // nach unten nie weiter weg
          }
        }
      }
    }
    expect(hills).toBeGreaterThan(50);              // der Test deckt echte Steigungen ab
    expect(worstRun).toBeLessThan(3);               // vorher bis zu 28 Zeilen gleicher Tiefe
    expect(frames).toBeGreaterThan(1000);
  }, 120000);
});
