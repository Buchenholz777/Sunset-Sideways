import { describe, expect, it } from 'vitest';
import { BALANCE as B } from '../src/config/balance';
import { speedAtDist } from '../src/core/speed';
import { Generator, type GenWorld, type Pattern } from '../src/gen/generator';
import { KINDS, laneOf, type Obstacle, type Pickup } from '../src/sim/world';

interface Enc { pattern: Pattern; anchor: number; obs: Obstacle[]; pk: Pickup[]; t: number }

/** Lässt den Generator mit nominaler Fahrt (Tempokurve, kein Ausweichen nötig) 150 s laufen und ordnet neue Objekte der jeweiligen Begegnung zu. */
function record(seed: number, seconds = 150): Enc[] {
  const g = new Generator(seed, { record: true });
  const w: GenWorld = { s: 0, t: 0, obstacles: [], pickups: [], nextId: 1 };
  const out: Enc[] = []; const seenO = new Set<number>(), seenP = new Set<number>();
  const take = () => {
    const n = g.log.length;
    if (n > out.length) {
      const e: Enc = { pattern: g.log[n - 1].pattern, anchor: g.log[n - 1].anchor, obs: [], pk: [], t: w.t };
      for (const o of w.obstacles) if (!seenO.has(o.id)) { seenO.add(o.id); e.obs.push({ ...o }); }
      for (const p of w.pickups) if (!seenP.has(p.id)) { seenP.add(p.id); e.pk.push({ ...p }); }
      out.push(e);
    }
  };
  g.update(w); take();
  while (w.t < seconds) {
    const v = speedAtDist(w.s) / 3.6;
    for (const o of w.obstacles) o.z += o.vz * B.dt;
    w.s += v * B.dt; w.t += B.dt;
    const before = g.log.length; g.update(w);
    if (g.log.length > before) take();
    w.obstacles = w.obstacles.filter((o) => o.z > w.s - 40);
  }
  return out;
}
const all = Array.from({ length: 40 }, (_, i) => record(i + 1));
const flat = all.flat();
const of = (p: Pattern) => flat.filter((e) => e.pattern === p);

describe('Begegnungen mit eigener Entscheidung', () => {
  it('Lkw, Baustelle und Umweg kommen in 40 Läufen à 150 s regelmäßig vor und wechseln mit anderen Mustern', () => {
    for (const p of ['truck', 'works', 'detour'] as Pattern[]) expect(of(p).length, p).toBeGreaterThanOrEqual(15);
    // Abwechslung: nie dieselbe Spezialbegegnung fünfmal hintereinander (Einzelhindernisse im Einstieg dürfen sich wiederholen)
    for (const run of all) { let streak = 1; for (let i = 1; i < run.length; i++) { streak = run[i].pattern === run[i - 1].pattern ? streak + 1 : 1; if (run[i].pattern !== 'single') expect(streak).toBeLessThanOrEqual(5); } }
  });

  it('Lkw: breiter, langsamer Lkw in einer Spur, die anderen Spuren bleiben frei; Vorbeifahrzeit gemessen und Messwert dokumentiert (kein Dauerüberholen bei diesem Tempo)', () => {
    const encs = of('truck').filter((e) => e.obs.some((o) => o.kind === 'truck'));
    expect(encs.length / of('truck').length).toBeGreaterThan(0.8);       // fast immer ein Lkw (sonst belegte die Spur schon anderer Verkehr)
    let minPass = Infinity, minEarly = Infinity;
    for (const e of encs) {
      const trucks = e.obs.filter((o) => o.kind === 'truck');
      expect(new Set(e.obs.map((o) => laneOf(o.x))).size).toBe(1);        // genau eine Spur belegt
      for (const o of trucks) {
        expect(o.vz * 3.6).toBeLessThan(B.traffic.mid);                   // langsamer als der übrige Verkehr
        const v = speedAtDist(e.anchor) / 3.6;
        const pass = (KINDS.truck.len + B.player.len) / (v - o.vz);   // Zeit, in der der Wagen auf Höhe des Lkw ist
        minPass = Math.min(minPass, pass); if (e.anchor < 1500) minEarly = Math.min(minEarly, pass);
      }
    }
    console.log(`Lkw-Vorbeifahrzeit (kürzeste): frühes Spiel < 1,5 km ${minEarly.toFixed(2)} s, überhaupt ${minPass.toFixed(2)} s`);
    expect(minEarly).toBeGreaterThanOrEqual(0.1);
  });

  it('Baustelle: zwei Absperrungsreihen in verschiedenen Spuren, zeitlich getrennt (≥ 1,0 s), danach Erholung', () => {
    for (const e of of('works')) {
      const bars = e.obs.filter((o) => o.kind === 'barrier');
      expect(bars.length).toBeGreaterThanOrEqual(2);
      const [a, b] = [...bars].sort((x, y) => x.z - y.z);
      expect(laneOf(a.x)).not.toBe(laneOf(b.x));
      const v = speedAtDist(e.anchor) / 3.6;
      expect((b.z - a.z) / v, `Reihenabstand bei ${e.anchor.toFixed(0)} m`).toBeGreaterThanOrEqual(1.0);
    }
    // Erholung: die nächste Begegnung beginnt mindestens 0,9 s nach dem Ende der Baustelle
    let checked = 0;
    for (const run of all) for (let i = 0; i < run.length - 1; i++) {
      if (run[i].pattern !== 'works') continue;
      const lastZ = Math.max(...run[i].obs.map((o) => o.z));
      const nextFirst = Math.min(...run[i + 1].obs.map((o) => o.z));
      const v = speedAtDist(lastZ) / 3.6;
      expect((nextFirst - lastZ) / v).toBeGreaterThanOrEqual(0.9); checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('Umweg: Pickup liegt neben dem Hindernis (nicht in dessen Spur) und höchstens 2,5 s davor; der Standardweg bleibt die geprüfte Kette', () => {
    const encs = of('detour').filter((e) => e.pk.length > 0);
    expect(encs.length).toBeGreaterThanOrEqual(10);
    for (const e of encs) {
      const lane = laneOf(e.obs[0].x);
      const pk = e.pk[0];
      expect(laneOf(pk.x)).not.toBe(lane);
      const v = speedAtDist(e.anchor) / 3.6;
      expect((e.obs[0].z - pk.z) / v).toBeLessThanOrEqual(2.5);
      expect((e.obs[0].z - pk.z) / v).toBeGreaterThan(0.5);
    }
  });
});
