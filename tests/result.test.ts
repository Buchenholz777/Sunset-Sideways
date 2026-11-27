import { describe, expect, it } from 'vitest';
import { crashCauseText, nextGoalText } from '../src/game';
import { setLang } from '../src/i18n';

setLang('de');

describe('Ergebnis: Ursache und nächstes Ziel', () => {
  it('Absturzursache aus dem Crash-Ereignis', () => {
    expect(crashCauseText('barrier')).toBe('Absperrung getroffen');
    expect(crashCauseText('truck')).toBe('Lkw getroffen');
    expect(crashCauseText('baken')).toBe('Bake getroffen');
    expect(crashCauseText(undefined)).toBe('');
  });
  it('Ziel nur aus erfasstem Zustand', () => {
    expect(nextGoalText(175, 0, false, 0)).toBe('Ziel: Sammle ein Power-up ein.');
    expect(nextGoalText(600, 0, false, 2)).toBe('Ziel: Schaffe 1 km.');
    expect(nextGoalText(4200, 5000, false, 3)).toBe('Ziel: Noch 800 m bis zu deiner Bestweite.');
    expect(nextGoalText(4200, 4200, true, 3)).toBe('Ziel: Das 5-km-Schild.');
    expect(nextGoalText(12000, 30000, false, 3)).toBe('Ziel: Das 15-km-Schild.');
  });
});
