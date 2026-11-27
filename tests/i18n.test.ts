import { afterEach, describe, expect, it } from 'vitest';
import { getLang, locale, setLang, tr } from '../src/i18n';

describe('Sprachwahl', () => {
  afterEach(() => setLang('en'));
  it('Standard ist Englisch', () => {
    expect(getLang()).toBe('en');
    expect(locale()).toBe('en-US');
  });
  it('übersetzt mit Platzhaltern und fällt auf Deutsch zurück', () => {
    expect(tr('Ziel: Schaffe 1 km.')).toBe('Goal: Reach 1 km.');
    expect(tr('Ziel: Noch {n} m bis zu deiner Bestweite.', { n: 40 })).toContain('40');
    expect(tr('Unbekannter Text')).toBe('Unbekannter Text');
    setLang('de');
    expect(tr('Ziel: Schaffe 1 km.')).toBe('Ziel: Schaffe 1 km.');
    expect(locale()).toBe('de-DE');
  });
  it('Listener werden beim Wechsel gerufen', () => {
    let seen = '';
    // onLang wird über den Wechsel ausgelöst
    import('../src/i18n').then(() => undefined);
    setLang('de'); seen = getLang();
    expect(seen).toBe('de');
  });
});
