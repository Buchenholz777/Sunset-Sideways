import { describe, expect, it } from 'vitest';
import { decoType, stageAt } from '../src/render/scenery';

/** Hauptlandmarken: je Viertel eine, abwechselnd rechts und links, nie dicht hintereinander (kein Konkurrieren mehrerer Lichttürme). */
function marks(type: 'wheel' | 'eiffel', from: number, to: number) {
  const out: { z: number; side: number }[] = [];
  for (let k = Math.floor(from / 22); k <= Math.floor(to / 22); k++) for (const side of [-1, 1]) if (decoType(k, side, k * 22) === type) out.push({ z: k * 22, side });
  return out.sort((a, b) => a.z - b.z);
}
describe('Landmarken der Strecke', () => {
  const END = 40000;
  it('Riesenrad nur im Hotel-/Unterhaltungsviertel, Eiffelturm nur am Strip, nirgends doppelt', () => {
    for (const m of marks('wheel', 0, END)) { const st = stageAt(m.z); expect(st >= 2 && st < 4, `Riesenrad bei ${m.z} m (Stufe ${st})`).toBe(true); }
    for (const m of marks('eiffel', 0, END)) expect(stageAt(m.z), `Eiffelturm bei ${m.z} m`).toBeGreaterThanOrEqual(4);
    expect(marks('wheel', 0, END).length).toBeGreaterThan(3);
    expect(marks('eiffel', 0, END).length).toBeGreaterThan(3);
  });
  it('Abstand ≥ 600 m und wechselnde Seite', () => {
    for (const t of ['wheel', 'eiffel'] as const) {
      const m = marks(t, 0, END);
      for (let i = 1; i < m.length; i++) { expect(m[i].z - m[i - 1].z, `${t} ${m[i].z}`).toBeGreaterThanOrEqual(500); expect(m[i].side).not.toBe(m[i - 1].side); }
    }
  });
});
