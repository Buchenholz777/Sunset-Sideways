import { afterEach, describe, expect, it } from 'vitest';
import { speedAtDist, setSpeedKnots } from '../src/core/speed';
import { BALANCE } from '../src/config/balance';
import { CURVE_KM, DEFAULT_CONFIG, applyConfig, applyDefaults, clone, curveFromKnots, detectProfile, diffConfigs, knotsFor, normalize, validate, withProfile, type GameConfig } from '../src/config/runtime';
import { analyze } from '../src/config/analyze';
import { SPRINT_CONFIG } from '../src/sprint/rules';

const cfg = (f: (c: GameConfig) => void): GameConfig => { const c = clone(DEFAULT_CONFIG); f(c); return c; };
afterEach(() => applyDefaults());

describe('Eigene Steigerungskurve (Admin)', () => {
  it('ausgeschaltet bleibt die bisherige Kurve unverändert (Standard, Profile, Sprint)', () => {
    expect(DEFAULT_CONFIG.tempo.curveOn).toBe(false);
    expect(knotsFor(DEFAULT_CONFIG.tempo)).toEqual([[0, 210], [1000, 325], [2000, 370], [6000, 430], [12000, 480], [16000, 520], [20000, 550], [27000, 600]]);
    expect(SPRINT_CONFIG.tempo.curveOn).toBe(false);
    expect(withProfile(cfg((c) => { c.tempo.curveOn = true; }), 'hard').tempo.curveOn).toBe(false);
  });
  it('Standardmarken liegen auf der Standardkurve (±3 km/h)', () => {
    applyDefaults();
    CURVE_KM.forEach((km, i) => expect(Math.abs(speedAtDist(km * 1000) - DEFAULT_CONFIG.tempo.curve[i])).toBeLessThanOrEqual(3));
    expect(curveFromKnots(BALANCE.speed.knots)).toEqual(DEFAULT_CONFIG.tempo.curve);
  });
  it('eingeschaltet bestimmt die Kurve das Tempo je Reichweite: genau die eingestellten Werte an den Marken', () => {
    const c = cfg((x) => { x.tempo.curveOn = true; x.tempo.curve = [210, 300, 340, 370, 390, 400, 410, 420, 440, 480, 540, 600]; });
    applyConfig(c);
    CURVE_KM.forEach((km, i) => expect(speedAtDist(km * 1000)).toBeCloseTo(c.tempo.curve[i], 6));
    expect(speedAtDist(12_000)).toBeLessThan(480);                 // ab 10–15 km langsamer als bisher
    expect(speedAtDist(15_000)).toBeLessThan(510);
    expect(BALANCE.speed.knots[7][0]).toBe(12_000);
    // dazwischen monoton, ohne Überschwinger; dahinter weiter mit der Steigung des letzten Abschnitts, höchstens 1000
    let p = 0; for (let m = 0; m <= 60_000; m += 50) { const v = speedAtDist(m); expect(v).toBeGreaterThanOrEqual(p - 1e-9); expect(v).toBeLessThanOrEqual(1000); p = v; }
  });
  it('flacher letzter Abschnitt hält das Tempo konstant; Obergrenze 1000 km/h gilt immer', () => {
    applyConfig(cfg((x) => { x.tempo.curveOn = true; x.tempo.curve = [210, 300, 340, 360, 380, 400, 420, 440, 460, 480, 500, 500]; }));
    expect(speedAtDist(200_000)).toBe(500);
    applyConfig(cfg((x) => { x.tempo.curveOn = true; x.tempo.curve = [210, 400, 600, 800, 900, 1000, 1000, 1000, 1000, 1000, 1000, 1000]; }));
    expect(speedAtDist(100_000)).toBeLessThanOrEqual(1000);
  });
  it('normalisieren: begrenzt, rundet auf 5 km/h, fehlende Werte = Standard, nie fallend', () => {
    const n = normalize({ tempo: { curveOn: true, curve: [50, 2000, 333, 100, 'x', null] } });
    expect(n.tempo.curve).toHaveLength(CURVE_KM.length);
    expect(n.tempo.curve[0]).toBe(120); expect(n.tempo.curve[1]).toBe(1000);
    for (let i = 1; i < n.tempo.curve.length; i++) expect(n.tempo.curve[i]).toBeGreaterThanOrEqual(n.tempo.curve[i - 1]);
    for (const v of n.tempo.curve) expect(v % 5).toBe(0);
    expect(normalize({}).tempo.curve).toEqual(DEFAULT_CONFIG.tempo.curve);
  });
  it('validieren: fallendes Tempo, Bereich und fehlende Werte sind Konflikte (nur bei eingeschalteter Kurve)', () => {
    const bad = (curve: unknown) => validate(cfg((c) => { c.tempo.curveOn = true; (c.tempo as unknown as Record<string, unknown>).curve = curve; })).filter((i) => i.path === 'tempo.curve');
    expect(bad(DEFAULT_CONFIG.tempo.curve)).toHaveLength(0);
    expect(bad([210, 325, 300, 410, 430, 450, 465, 480, 510, 550, 600, 655])[0].msg).toMatch(/nicht fallen/);
    expect(bad([100, 325, 370, 410, 430, 450, 465, 480, 510, 550, 600, 655])[0].msg).toMatch(/120 bis 1000/);
    expect(bad([210, 325])[0].msg).toMatch(/fehlt/);
    expect(validate(cfg((c) => { c.tempo.curveOn = false; (c.tempo as unknown as Record<string, unknown>).curve = [999, 1]; })).filter((i) => i.path === 'tempo.curve')).toHaveLength(0);
  });
  it('Profil wird „Eigene Werte“, Änderungen erscheinen in der Veröffentlichen-Zusammenfassung', () => {
    const on = cfg((c) => { c.tempo.curveOn = true; c.tempo.curve = [...c.tempo.curve]; c.tempo.curve[6] = 500; });
    expect(detectProfile(on)).toBe('custom');
    const d = diffConfigs(DEFAULT_CONFIG, normalize(on));
    expect(d.some((x) => x.path === 'tempo.curveOn')).toBe(true);
    expect(d.some((x) => x.label === 'Tempo bei 10 km' && x.to === '500 km/h')).toBe(true);
    expect(diffConfigs(normalize(on), normalize(on))).toHaveLength(0);
  });
  it('Fairness-Analyse läuft mit eigener Kurve (Stichproben bei 0, 12, 27, 38 km)', () => {
    const a = analyze(cfg((c) => { c.tempo.curveOn = true; c.tempo.curve = [210, 300, 340, 370, 390, 400, 410, 420, 440, 480, 540, 600]; }));
    expect(a.samples.map((s) => s.km)).toEqual([0, 12, 27, 38]);
    expect(a.samples[1].kmh).toBeCloseTo(420, 0);
  });
  it('setSpeedKnots-Reste: nach applyDefaults gilt wieder die Standardkurve', () => {
    setSpeedKnots([[0, 100], [1000, 200]]);
    applyDefaults();
    expect(speedAtDist(0)).toBe(210); expect(speedAtDist(27000)).toBe(600);
  });
});
