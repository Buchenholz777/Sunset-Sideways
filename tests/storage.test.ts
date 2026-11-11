import { afterEach, describe, expect, it, vi } from 'vitest';
import { load, save } from '../src/storage/storage';
import { GAME_TITLE } from '../src/config/meta';

afterEach(() => vi.unstubAllGlobals());

function fakeStorage(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}

describe('Titel und Speicher-Migration (S01)', () => {
  it('Spieltitel ist zentral „Sunset Sideways“', () => { expect(GAME_TITLE).toBe('Sunset Sideways'); });
  it('alter Rekord und Ton-Einstellung (glimmer-mile:v1) werden gelesen und kopiert, der alte Schlüssel bleibt', () => {
    const st = fakeStorage({ 'glimmer-mile:v1': JSON.stringify({ v: 1, best: 4321, muted: true }) });
    vi.stubGlobal('localStorage', st);
    const s = load();
    expect(s.best).toBe(4321);
    expect(s.muted).toBe(true);
    expect(st.m.get('glimmer-mile:v1')).toBeDefined();
    expect(JSON.parse(st.m.get('sunset-sideways:v1')!).best).toBe(4321);
  });
  it('vorhandener neuer Schlüssel wird nicht von alten Werten überschrieben', () => {
    const st = fakeStorage({ 'glimmer-mile:v1': JSON.stringify({ v: 1, best: 100 }), 'sunset-sideways:v1': JSON.stringify({ v: 1, best: 900 }) });
    vi.stubGlobal('localStorage', st);
    expect(load().best).toBe(900);
    save({ best: 1000 });
    expect(JSON.parse(st.m.get('glimmer-mile:v1')!).best).toBe(100);
    expect(JSON.parse(st.m.get('sunset-sideways:v1')!).best).toBe(1000);
  });
});
