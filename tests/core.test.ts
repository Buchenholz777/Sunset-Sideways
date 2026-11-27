import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { formatDistance } from '../src/core/format';
import { setLang } from '../src/i18n';
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
    setLang('de');
    expect(formatDistance(999.9)).toBe('999 m');
    expect(formatDistance(1234)).toBe('1,23 km');
  });
});

describe('Speicher', () => {
  it('validiert fehlerhafte Werte', () => {
    expect(parseSaved('{kaputt').best).toBe(0);
    expect(parseSaved(JSON.stringify({ v: 1, best: -5 })).best).toBe(0);
    expect(parseSaved(JSON.stringify({ v: 1, best: 812.7, muted: true }))).toEqual({ best: 812, muted: true, dodged: false, sprintBest: 0, sprintDone: 0, styleBest: 0 });
    // P1 (Rückwärtskompatibilität): alter Speicherstand ohne Stil-Rekord – die Bestweite bleibt unangetastet und wird nie als Stil-Rekord gelesen
    const old = parseSaved(JSON.stringify({ v: 1, best: 25000, muted: false, dodged: true, sprintBest: 3000, sprintDone: 1 }));
    expect(old).toEqual({ best: 25000, muted: false, dodged: true, sprintBest: 3000, sprintDone: 1, styleBest: 0 });
    expect(parseSaved(JSON.stringify({ v: 1, best: 9, styleBest: 4321.9 })).styleBest).toBe(4321);
    expect(parseSaved(JSON.stringify({ v: 1, styleBest: -5 })).styleBest).toBe(0);
    expect(parseSaved(JSON.stringify({ v: 1, styleBest: 'viel' })).styleBest).toBe(0);
    expect(parseSaved(JSON.stringify({ v: 1, best: 3, sprintBest: 4200.9, sprintDone: 2 }))).toMatchObject({ best: 3, sprintBest: 4200, sprintDone: 2 });
    expect(parseSaved(JSON.stringify({ v: 1, sprintBest: -4, sprintDone: 'x' }))).toMatchObject({ sprintBest: 0, sprintDone: 0 });
    expect(parseSaved(JSON.stringify({ v: 1, best: 3, dodged: true })).dodged).toBe(true);
    expect(parseSaved(JSON.stringify({ v: 1, best: 3, dodged: 'ja' })).dodged).toBe(false);
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
