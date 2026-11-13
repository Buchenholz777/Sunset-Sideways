import { D0, depthEff, depthInv, type Layout } from './projection';

/**
 * Zuordnung Bildzeile → Tiefe mit Hügeln: Tiefen von nah nach fern abtasten, nur Punkte oberhalb der bisher höchsten
 * Bildzeile sind sichtbar (Kuppen verdecken die Straße dahinter), Zeilen dazwischen werden linear belegt.
 * Die Schrittweite folgt dem Bildgradienten (≤ ≈ 1 Zeile je Schritt): nahe der Kamera ändert sich die Zeile pro Meter stark,
 * mit festem Schritt entstanden am unteren Bildrand Zeilenblöcke gleicher Tiefe (senkrechte Kanten, „abgeknicktes“ Bild).
 * Liefert, ob Gelände (Hügel) vorhanden ist; füllt rowD (−1 = keine Straße in dieser Zeile) sowie die Verdeckungstabelle occD/occY.
 */
export function computeRows(height: (z: number) => number, zc: number, elev0: number, L: Layout, rowD: Float32Array, occD: number[], occY: number[]): boolean {
  rowD.fill(-1);
  occD.length = 0; occY.length = 0;
  let minY = L.h, prevD = -1;
  const d0 = Math.max(1, depthInv(L.Hv / Math.max(1, L.h - 1 - L.hy), L) - 3);
  const hilly = height(zc + 60) !== 0 || height(zc + 300) !== 0 || elev0 !== 0;
  for (let d = d0; d < 2500; ) {
    const de = depthEff(d, L), k = L.fx / de;
    const dde = d <= D0 ? 1 : L.gamma * Math.pow(d / D0, L.gamma - 1);
    const step = Math.min(Math.max(0.6, d * 0.012), 1 / ((L.Hv / (de * de)) * dde + 0.25));
    const y = L.hy + L.Hv / de - (height(zc + d) - elev0) * k;
    if (y < minY) {
      // sichtbares Gelände auch oberhalb des Horizonts (Hügel vor der Kamera): Zeilen bis ganz nach oben zuordnen
      const yTop = Math.max(0, Math.ceil(y)), yBot = Math.min(L.h - 1, Math.ceil(minY) - 1);
      for (let yy = yBot; yy >= yTop; yy--) {
        const u = prevD < 0 ? 1 : (minY - yy) / Math.max(1e-6, minY - y);
        rowD[yy] = prevD < 0 ? d : prevD + (d - prevD) * Math.min(1, Math.max(0, u));
      }
      minY = y; prevD = d;
      if (minY <= 0) { occD.push(d); occY.push(minY); break; }
    }
    occD.push(d); occY.push(minY);
    d += step;
  }
  return hilly;
}
