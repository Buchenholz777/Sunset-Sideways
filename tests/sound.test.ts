import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sound } from '../src/audio/sound';

function fakeAudio() {
  const counts = { osc: 0, src: 0 };
  const param = () => ({
    value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {},
  });
  const node = (): Record<string, unknown> => {
    const n: Record<string, unknown> = { connect: (x: unknown) => x, start() {}, stop() {}, gain: param(), frequency: param(), Q: param(), detune: param() };
    return n;
  };
  class FakeCtx {
    currentTime = 0; sampleRate = 8000; state = 'running'; destination = {};
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createOscillator() { counts.osc++; return node(); }
    createBufferSource() { counts.src++; return node(); }
    createDynamicsCompressor() { return node(); }
    createDelay() { const n = node(); n.delayTime = param(); return n; }
    createBuffer() { return { getChannelData: () => new Float32Array(8000) }; }
    resume() { return Promise.resolve(); }
  }
  return { FakeCtx, counts };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Sound', () => {
  it('ohne Web Audio bleibt alles ein No-Op', () => {
    const s = new Sound();
    expect(() => { s.unlock(); s.startLoops(); s.update(200, true); s.sfx('crash'); s.stopLoops(); }).not.toThrow();
  });
  it('Neustarts und Pausen stapeln keine Quellen und Timer', () => {
    vi.useFakeTimers();
    const { FakeCtx, counts } = fakeAudio();
    vi.stubGlobal('window', { AudioContext: FakeCtx });
    const s = new Sound();
    s.unlock();
    for (let i = 0; i < 20; i++) { s.startLoops(); s.startLoops(); s.stopLoops(); }
    s.startLoops();
    expect(counts.osc).toBe(2); // Motor: genau zwei Oszillatoren, einmal erzeugt
    expect(counts.src).toBe(2); // Fahrgeräusch + Reifenquietschen: je genau eine Schleife
    expect(vi.getTimerCount()).toBe(1); // genau ein Musik-Scheduler
    s.stopLoops();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('Stumm-Zustand unterdrückt Effekte', () => {
    const { FakeCtx, counts } = fakeAudio();
    vi.stubGlobal('window', { AudioContext: FakeCtx });
    const s = new Sound();
    s.unlock();
    s.setMuted(true);
    const before = counts.osc;
    s.sfx('start');
    expect(counts.osc).toBe(before);
    s.setMuted(false);
    s.sfx('start');
    expect(counts.osc).toBeGreaterThan(before);
  });
});

describe('Reifenquietschen', () => {
  it('ist eine einzige Schleife, folgt dem Schlupf und endet mit Pause/Stumm', () => {
    const { FakeCtx, counts } = fakeAudio();
    vi.stubGlobal('window', { AudioContext: FakeCtx });
    const s = new Sound();
    s.unlock();
    for (let i = 0; i < 10; i++) { s.startLoops(); s.update(250, false, 0.8); s.stopLoops(); }
    s.startLoops();
    expect(counts.src).toBe(2); // Fahrgeräusch + genau eine Quietsch-Schleife, trotz 10 Neustarts
    expect(() => { s.update(250, false, 0); s.setMuted(true); s.update(250, false, 1); s.stopLoops(); }).not.toThrow();
  });
});
