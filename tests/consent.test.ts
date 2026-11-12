import { describe, expect, it } from 'vitest';
import { CONSENT_KEY, readConsent, writeConsent, type StoreLike } from '../src/consent';

const mem = (): StoreLike & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };

describe('Einwilligung', () => {
  it('ohne Eintrag oder Speicher: keine Entscheidung (Banner wird gezeigt, nichts geladen)', () => {
    expect(readConsent(mem())).toBeNull();
    expect(readConsent(null)).toBeNull();
  });
  it('speichert und liest Zustimmung und Ablehnung', () => {
    const s = mem();
    writeConsent(s, 'granted', 1);
    expect(readConsent(s)).toBe('granted');
    writeConsent(s, 'denied', 2);
    expect(readConsent(s)).toBe('denied');
    expect(JSON.parse(s.m.get(CONSENT_KEY)!)).toEqual({ v: 1, d: 'denied', ts: 2 });
  });
  it('ungültige oder fremde Werte gelten als „keine Entscheidung“; Speicherfehler brechen nichts', () => {
    const s = mem();
    s.m.set(CONSENT_KEY, 'kaputt'); expect(readConsent(s)).toBeNull();
    s.m.set(CONSENT_KEY, JSON.stringify({ v: 2, d: 'granted' })); expect(readConsent(s)).toBeNull();
    s.m.set(CONSENT_KEY, JSON.stringify({ v: 1, d: 'vielleicht' })); expect(readConsent(s)).toBeNull();
    expect(() => writeConsent({ getItem: () => null, setItem: () => { throw new Error('voll'); } }, 'granted')).not.toThrow();
  });
});
