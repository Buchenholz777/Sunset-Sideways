import { describe, expect, it } from 'vitest';
import { nearestLane, tapLane } from '../src/input/input';
import { laneX } from '../src/sim/world';

describe('Tipp-Steuerung', () => {
  it('Tipp links/rechts wechselt genau eine Spur und bleibt im Bereich 0..2', () => {
    expect(tapLane(1, -1)).toBe(0); expect(tapLane(1, 1)).toBe(2);
    expect(tapLane(0, -1)).toBe(0); expect(tapLane(2, 1)).toBe(2);
    expect(tapLane(tapLane(1, 1), 1)).toBe(2);
  });
  it('nächste Spur aus der Quer-Position', () => {
    for (const l of [0, 1, 2]) expect(nearestLane(laneX(l))).toBe(l);
    expect(nearestLane(-99)).toBe(0); expect(nearestLane(99)).toBe(2);
  });
});
