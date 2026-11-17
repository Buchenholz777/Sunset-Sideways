import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { LOT, lotAt, lotKind } from '../src/render/lots';
import { decoType, decoX, LANDMARK_FAR, LANDMARK_SCALE, landmarksAhead, stageAt } from '../src/render/scenery';

/** Hauptlandmarken: je Viertel eine, abwechselnd rechts und links, nie dicht hintereinander (kein Konkurrieren mehrerer Lichttürme). */
function marks(type: 'wheel' | 'eiffel', from: number, to: number) {
  const out: { z: number; side: number }[] = [];
  for (let k = Math.floor(from / 22); k <= Math.floor(to / 22); k++) for (const side of [-1, 1]) if (decoType(k, side, k * 22) === type) out.push({ z: k * 22, side });
  return out.sort((a, b) => a.z - b.z);
}
describe('Landmarken der Strecke', () => {
  const END = 40000;
  it('Riesenrad nur im Unterhaltungsviertel, Eiffelturm nur am Strip', () => {
    for (const m of marks('wheel', 0, END)) expect(stageAt(m.z), `Riesenrad bei ${m.z} m`).toBe(3);
    for (const m of marks('eiffel', 0, END)) expect(stageAt(m.z), `Eiffelturm bei ${m.z} m`).toBeGreaterThanOrEqual(4);
    expect(marks('wheel', 0, END).length).toBeGreaterThan(3);
    expect(marks('eiffel', 0, END).length).toBeGreaterThan(3);
  });
  it('Abstand ≥ 1 km und wechselnde Seite: höchstens zwei gleiche Wahrzeichen in Sichtweite', () => {
    for (const t of ['wheel', 'eiffel'] as const) {
      const m = marks(t, 0, END);
      for (let i = 1; i < m.length; i++) { expect(m[i].z - m[i - 1].z, `${t} ${m[i].z}`).toBeGreaterThanOrEqual(1000); expect(m[i].side).not.toBe(m[i - 1].side); }
    }
    for (let z = 0; z < END; z += 100) for (const t of ['wheel', 'eiffel']) expect(landmarksAhead(z, z + LANDMARK_FAR).filter((m) => m.type === t).length, `${t} bei ${z} m`).toBeLessThanOrEqual(2);
  });
  it('Fern- und Nahsicht nutzen dieselbe Weltposition (keine springende Skyline-Kopie)', () => {
    for (const m of landmarksAhead(10000, 30000)) {
      expect(m.x).toBe(decoX(m.type, m.k, m.side));
      expect(Math.sign(m.x)).toBe(m.side);
      expect(landmarksAhead(m.z - 1500, m.z + 1).find((o) => o.k === m.k && o.side === m.side)?.x).toBe(m.x);   // aus 1,5 km dieselbe Lage wie beim Vorbeifahren
    }
  });
  it('Wahrzeichen stehen auf einem freien Vorplatz und ragen nie in Fahrbahn oder Gehweg', () => {
    for (const m of landmarksAhead(10000, 30000)) {
      const i = Math.floor(m.z / LOT);
      expect(lotKind(i, m.side, stageAt(m.z)), `${m.type} bei ${m.z} m`).toBe('fair');
      for (const p of lotAt(i, m.side, stageAt(m.z)).prims) if (p.t === 'box') expect(p.h1, 'nichts Hohes auf dem Vorplatz').toBeLessThan(6);
      const s = LANDMARK_SCALE[m.type] ?? 1;
      const inner = m.type === 'wheel' ? Math.abs(m.x) + (15 - 15) * s : Math.abs(m.x) + (7 - 8.5) * s;   // Rad: Mitte 15·s außen, Radius 15·s; Turm: Mitte 7·s, Fußbreite 8,5·s
      expect(inner, `${m.type} bei ${m.z} m`).toBeGreaterThan(B.road.halfWidth + 3.3);
    }
  });
  it('Viertel unterscheiden sich in ihren Grundstücken', () => {
    const kinds = (stage: number) => new Set(Array.from({ length: 8 }, (_, i) => [lotKind(i + 300, 1, stage), lotKind(i + 300, -1, stage)]).flat());
    expect(kinds(2).has('hotel')).toBe(true);
    expect(kinds(3).has('show')).toBe(true);
    expect(kinds(4).has('quiet')).toBe(true);
    expect([...kinds(2)].join()).not.toBe([...kinds(3)].join());
  });
});
