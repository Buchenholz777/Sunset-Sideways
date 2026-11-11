import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { formatDistance } from '../src/core/format';
import { parseSaved } from '../src/storage/storage';
import { GameState } from '../src/core/state';


describe('RNG', () => {
  it('ist reproduzierbar', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});

describe('Format', () => {
  it('Meter und Kilometer deutsch', () => {
    expect(formatDistance(999.9)).toBe('999 m');
    expect(formatDistance(1234)).toBe('1,23 km');
  });
});

describe('Speicher', () => {
  it('validiert fehlerhafte Werte', () => {
    expect(parseSaved('{kaputt').best).toBe(0);
    expect(parseSaved(JSON.stringify({ v: 1, best: -5 })).best).toBe(0);
    expect(parseSaved(JSON.stringify({ v: 1, best: 812.7, muted: true }))).toEqual({ best: 812, muted: true });
  });
});

describe('Zustand', () => {
  it('lässt nur erlaubte Übergänge zu', () => {
    const s = new GameState();
    expect(s.go('paused')).toBe(false);
    expect(s.go('running')).toBe(true);
    expect(s.go('crashed')).toBe(true);
  });
});
