import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/audio/soundtrack';

describe('Soundtrack-Pipeline', () => {
  const ok = { main: 'song.ogg', rush: 'song-rush.ogg', loopStart: 0, loopEnd: 140, license: 'Eigene Produktion, geprüft' };
  it('akzeptiert eine vollständige Beschreibung', () => { expect(parseManifest(ok)).toEqual(ok); });
  it('verlangt einen Lizenznachweis', () => { expect(parseManifest({ ...ok, license: '' })).toBeNull(); expect(parseManifest({ main: 'a.ogg' })).toBeNull(); });
  it('weist unsichere oder fehlende Dateinamen ab', () => {
    expect(parseManifest({ ...ok, main: '../x.ogg' })).toBeNull();
    expect(parseManifest({ ...ok, main: 'https://x/y.ogg' })).toBeNull();
    expect(parseManifest({ ...ok, main: 'song.exe' })).toBeNull();
    expect(parseManifest(null)).toBeNull();
  });
  it('lehnt ungültige Loop-Grenzen ab und ignoriert ungültige Rush-Spur', () => {
    expect(parseManifest({ ...ok, loopEnd: 0 })).toBeNull();
    expect(parseManifest({ ...ok, rush: 'bad name' })?.rush).toBeUndefined();
  });
});

describe('Abspielliste', () => {
  const base = { main: 'a.mp3', license: 'CC0' };
  it('übernimmt gültige Listen mit mehr als einem Stück', () => { expect(parseManifest({ ...base, playlist: ['a.mp3', 'b.mp3'] })?.playlist).toEqual(['a.mp3', 'b.mp3']); });
  it('lehnt Listen mit unsicheren Namen ab, ignoriert Einzellisten', () => {
    expect(parseManifest({ ...base, playlist: ['a.mp3', '../b.mp3'] })).toBeNull();
    expect(parseManifest({ ...base, playlist: ['a.mp3'] })?.playlist).toBeUndefined();
  });
});
