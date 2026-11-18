import { BALANCE as B } from '../config/balance';
import { speedAtDist, steerAt } from '../core/speed';
import { Generator, type GenWorld } from '../gen/generator';
import { ScriptedGen, type RouteEntry } from '../sprint/rules';
import { contactTime, obstacleFootprint, pickupFootprint, playerFootprint } from './contacts';
import { planGuide } from './guide';
import { Road } from './road';
import { StyleState, type StyleEvent } from './style';
import { TrafficDirector, lcX, type TrafficEvent } from './traffic';
import { KINDS, laneOf, laneX, type ObjKind, type Obstacle, type Pickup, type PickupType } from './world';

export interface SteerInput {
  /** Tastatur: −1 links, 0 neutral, 1 rechts. */
  dir: number;
  /** Touch: Fingerweg seit dem Aufsetzen in Metern (null = kein Finger). */
  drag?: number | null;
  /** Zähler der Touch-Kontakte; ein neuer Wert verankert den Bezugspunkt an der aktuellen Querposition (kein Sprung). */
  dragSeq?: number;
  /** Absolute Zielquerposition q (Meter, nur Tests und QA); hat Vorrang. */
  target?: number | null;
}

export type SimEvent =
  | { type: 'pickup'; pickup: PickupType; id: number; z: number }
  | { type: 'shieldHit'; x: number; z: number }
  | { type: 'cleared'; x: number; z: number; kind: ObjKind }
  | { type: 'blitz'; x: number; z: number }
  | { type: 'magnetPull'; x: number; z: number }
  | { type: 'glideStart' }
  | { type: 'glideEnd' }
  | { type: 'crash'; kind: ObjKind }
  | { type: 'effectEnd'; effect: PickupType }
  | { type: 'queued'; effect: 'glide' | 'boost' }
  | StyleEvent
  | TrafficEvent;

export interface CrashInfo { kind: ObjKind; id: number; x: number; z: number }

export interface SimOptions {
  /** Feste Begegnungsfolge (Sunset Sprint) statt des laufenden Generators. */ script?: readonly RouteEntry[]; startT?: number; startS?: number; record?: boolean;
  /** nur Tests: keine Hindernistreffer */ ghost?: boolean;
  /** Nur Tests: keine selbstständigen Spurwechsel (Standard: an, außer im festen Sprint). */ noDynamic?: boolean;
}

interface Hit { f: number; pickup: Pickup | null; obstacle: Obstacle | null }

export { overlapInterval } from './contacts';

const dur = (t: 'shield' | 'slow' | 'magnet' | 'boost' | 'guide'): number => B.effects[t];
const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/**
 * Das Auto fährt automatisch vorwärts (Tempo aus der aktiven Fahrzeit). Der Spieler bestimmt nur die
 * Querposition `q` relativ zur Straßenmitte; die Straße (Bögen) wird mitgefahren. Darstellung und Kontakte
 * nutzen dieselben Koordinaten: Streckenfortschritt `s` und Weltposition X = Mittellinie(s) + q.
 */
export class Sim {
  t: number;
  /** Startzeit des Laufs (für die Szenenzeit). */
  readonly t0: number;
  /** Streckenfortschritt (monoton, Meter). */
  s: number;
  /** Querposition relativ zur Straßenmitte (m). */
  q = 0;
  /** Quergeschwindigkeit (m/s). */
  vq = 0;
  speedKmh = 0;
  shieldT = 0;
  slowT = 0;
  magnetT = 0;
  boostT = 0;
  guideT = 0;
  /** Pfadfinder: Spurmitte, auf die zugesteuert werden soll (null = aus). */
  guideQ: number | null = null;
  private guideN = 0;
  /** Spurblitz: gespeicherte Aktivierung (Restzeit); wirkt einmal, sobald in der aktuellen Spur ein Hindernis in Reichweite ist. `blitzLeft` > 0 = bereit. */
  blitzT = 0;
  blitzLeft = 0;
  /** Gleitflug: Restzeit; Höhe siehe `height`. */
  glideT = 0;
  /** Bereits verbrauchte Landeverlängerung (s). */
  private glideHold = 0;
  /** Vorgemerkter exklusiver Effekt (Fliegen oder Phantom-Turbo, höchstens einer; der neuere ersetzt den älteren). */
  pendingFx: 'glide' | 'boost' | null = null;
  /** Schutzphase (s) nach abgefangenem Treffer und nach dem Phantom-Turbo: keine Kontakte. */
  graceT = 0;
  /** Stil-System (Near Miss, Combo, Neon Rush) und Verkehrsregie (Spurwechsler). */
  readonly style = new StyleState();
  private readonly director: TrafficDirector | null;
  /** Objekte, die beim Aufsetzen überlappt wurden und bis zur Trennung als passiert gelten. */
  private passed = new Set<number>();
  /** Zeitlupenfaktor 1 … 0,78 (weich ein-/ausgeblendet). */
  slowF = 1;
  /** Phantom-Turbo: Tempofaktor 1 … 1,2 (weich ein-/ausgeblendet). */
  boostF = 1;
  obstacles: Obstacle[] = [];
  pickups: Pickup[] = [];
  nextId = 1;
  crashed = false;
  crash: CrashInfo | null = null;
  events: SimEvent[] = [];
  readonly gen: { update(w: GenWorld): void; log?: unknown[] };
  readonly road: Road;
  private lastSeq = 0;
  private dragBase = 0;
  private touching = false;

  constructor(readonly seed: number, private opts: SimOptions = {}) {
    this.t = opts.startT ?? 0;
    this.s = opts.startS ?? 0;
    this.t0 = this.t;
    this.road = new Road(seed);
    this.speedKmh = speedAtDist(this.s);
    this.gen = opts.script ? new ScriptedGen(opts.script) : new Generator(seed, { record: opts.record, startS: opts.startS });
    this.director = opts.script || opts.noDynamic ? null : new TrafficDirector();
    this.gen.update(this);
  }

  /** Keine Kontakte mit Verkehr: Fliegen, Phantom-Turbo oder kurze Schutzphase. */
  get invulnerable(): boolean { return this.glideT > 0 || this.boostT > 0 || this.graceT > 0; }

  /** Weltposition quer. */
  get X(): number { return this.road.center(this.s) + this.q; }
  /** Querabstand zur Straßenmitte (Alias für q). */
  get x(): number { return this.q; }
  /** Winkel der Fahrzeugnase gegenüber der Straßentangente (aus der Quergeschwindigkeit). */
  get relAngle(): number { return Math.atan2(this.vq, Math.max(1, this.speedKmh / 3.6)); }
  get bodyYaw(): number { return Math.atan(this.road.heading(this.s)) + this.relAngle; }
  get phi(): number { return Math.tan(this.bodyYaw); }
  get slowActive(): boolean { return this.slowT > 0; }
  get airborne(): boolean { return this.glideT > 0; }
  /** Flughöhe in Metern: 0,5 s Abheben, Reiseflug, 1 s Sinken. */
  get height(): number {
    if (this.glideT <= 0) return 0;
    const G = B.glide, el = B.effects.glide - this.glideT;
    return G.height * Math.min(smooth(el / G.up), smooth(this.glideT / G.down));
  }
  /** Längsfaktor des Verkehrs: Zeitlupe wirkt auf Spieler und Verkehr gleich. */
  get timeScale(): number { return this.slowF; }

  /** Quergeschwindigkeit und -position für diesen Schritt. */
  private lateral(dt: number, inp: SteerInput): void {
    const S0 = steerAt(speedAtDist(this.s) * this.boostF), maxQ = B.player.maxX;
    const S = { ...S0, vKey: S0.vKey * B.steer.sens.key, vTouch: S0.vTouch * B.steer.sens.touch };
    let target: number | null = null;
    if (inp.target !== null && inp.target !== undefined) target = clamp(inp.target, -maxQ, maxQ);
    else if (inp.drag !== null && inp.drag !== undefined) {
      if (inp.dragSeq !== undefined && inp.dragSeq !== this.lastSeq) { this.lastSeq = inp.dragSeq; this.dragBase = this.q; }
      target = clamp(this.dragBase + inp.drag, -maxQ, maxQ);
    } else if (inp.dragSeq !== undefined) this.lastSeq = inp.dragSeq;
    if (target !== null) {
      this.touching = true;
      const want = clamp((target - this.q) / S.tauTouch, -S.vTouch, S.vTouch);
      this.vq += (want - this.vq) * (1 - Math.exp(-dt / S.lag));
    } else {
      const dir = clamp(inp.dir, -1, 1);
      const tau = dir !== 0 ? S.tauUp : this.touching ? S.lag * 1.5 : S.tauStop;
      this.vq += (dir * S.vKey - this.vq) * (1 - Math.exp(-dt / tau));
      if (dir !== 0) this.touching = false;
      if (dir === 0 && Math.abs(this.vq) < 0.02) this.vq = 0;
    }
  }

  step(dt: number, inp: SteerInput): void {
    if (this.crashed) return;
    const P = B.player;
    const s0 = this.s, X0 = this.X, q0 = this.q;
    const yaw0 = this.bodyYaw;
    const body0 = playerFootprint(X0, s0, yaw0);

    this.slowF += ((this.slowT > 0 ? B.speed.slowFactor : 1) - this.slowF) * (1 - Math.exp(-dt / B.speed.slowTau));
    this.boostF += ((this.boostT > 0 ? B.speed.boostFactor : 1) - this.boostF) * (1 - Math.exp(-dt / B.speed.boostTau));
    this.lateral(dt, inp);
    this.speedKmh = speedAtDist(this.s) * this.slowF * this.boostF;
    const vm = this.speedKmh / 3.6;

    const ds = vm * dt;
    const sNew = s0 + ds;
    let qNew = q0 + this.vq * dt;
    if (Math.abs(qNew) > P.maxX) { qNew = clamp(qNew, -P.maxX, P.maxX); this.vq = 0; }
    const XNew = this.road.center(sNew) + qNew;
    const yaw1 = Math.atan(this.road.heading(sNew)) + Math.atan2(this.vq, Math.max(1, vm));
    const body1 = playerFootprint(XNew, sNew, yaw1);
    const ts = this.slowF;
    const hits: Hit[] = [];
    const pads = this.pullPickups(dt, qNew, vm);

    const flying = this.glideT > 0;
    const inv = this.invulnerable;
    const driven = inp.dir !== 0 || (inp.drag !== null && inp.drag !== undefined) || (inp.target !== null && inp.target !== undefined);
    for (const o of this.obstacles) {
      if (inv || this.passed.has(o.id)) continue;
      if (o.hit || o.z > sNew + 2 || o.z + o.vz * ts * dt + KINDS[o.kind].len < s0 - P.len - 2) continue;
      const xAfter = o.lc ? lcX(o, dt) : o.x;
      const before = obstacleFootprint(this.road, o);
      const after = o.vz === 0 && xAfter === o.x ? before : obstacleFootprint(this.road, o, o.z + o.vz * ts * dt, xAfter);
      const f = contactTime(body0, body1, before, after);
      if (f !== null) hits.push({ f, pickup: null, obstacle: o });
    }
    for (const p of this.pickups) {
      if (flying || p.taken || p.z > sNew + 2 || p.z < s0 - P.len - 2) continue;
      const pad = pickupFootprint(this.road, p);
      const f = contactTime(body0, body1, pads.get(p) ?? pad, pad);
      if (f !== null) hits.push({ f, pickup: p, obstacle: null });
    }
    if (this.opts.ghost) { for (let i = hits.length - 1; i >= 0; i--) if (!hits[i].pickup) hits.splice(i, 1); }
    // Zeitliche Reihenfolge; bei Gleichstand zuerst Pickups, dann Hindernisse
    hits.sort((a, b) => a.f - b.f || (a.pickup ? 0 : 1) - (b.pickup ? 0 : 1));

    for (const h of hits) {
      if (h.pickup) {
        const p = h.pickup;
        p.taken = true;
        const qAt = q0 + (qNew - q0) * h.f, sAt = s0 + ds * h.f;
        // Fliegen und Phantom-Turbo sind exklusive Bewegungs-/Kollisionszustände: läuft einer, wird der andere (höchstens einer) vorgemerkt und startet danach
        if ((p.type === 'glide' || p.type === 'boost') && (this.glideT > 0 || this.boostT > 0) && !(p.type === 'glide' ? this.glideT > 0 : this.boostT > 0)) { this.pendingFx = p.type; this.events.push({ type: 'queued', effect: p.type }); }
        else if (p.type === 'clear') this.startBlitz(qAt, sAt);
        else if (p.type === 'glide') { this.glideT = B.effects.glide; this.glideHold = 0; this.events.push({ type: 'glideStart' }); }
        else {
          // Erneutes Einsammeln setzt die Dauer zurück, verlängert sie nie über die Grundzeit (kein Stapeln); Restzeit nach diesem Schritt = Dauer − (1 − f)·dt
          const val = dur(p.type) + h.f * dt;
          if (p.type === 'shield') this.shieldT = val; else if (p.type === 'slow') this.slowT = val; else if (p.type === 'boost') this.boostT = val; else if (p.type === 'guide') this.guideT = val; else this.magnetT = val;
        }
        this.events.push({ type: 'pickup', pickup: p.type, id: p.id, z: p.z });
      } else if (h.obstacle) {
        const o = h.obstacle;
        if (o.hit) continue;                                 // z. B. vom Spurblitz im selben Schritt entfernt
        if (this.shieldT > h.f * dt) {
          o.hit = true;
          o.impulse = true;
          o.knockT = 0;
          o.knockVx = (o.x >= q0 ? 1 : -1) * 14;
          this.shieldT = 0;                                // ein Treffer, danach verbraucht
          this.graceT = B.powers.graceShield;              // kurze Schutzphase: keine zweite Kollision unmittelbar danach
          this.style.onHit();                              // Combo, Neon Rush und Rush-Energie enden
          this.events.push({ type: 'shieldHit', x: o.x, z: o.z });
          this.events.push({ type: 'effectEnd', effect: 'shield' });
        } else {
          this.s = s0 + ds * h.f;
          this.q = q0 + (qNew - q0) * h.f;
          this.t += dt * h.f;
          this.crashed = true;
          o.z += o.vz * ts * dt * h.f;
          this.crash = { kind: o.kind, id: o.id, x: o.x, z: o.z };
          this.vq = 0;
          this.style.onHit();
          this.flush();
          this.events.push({ type: 'crash', kind: o.kind });
          return;
        }
      }
    }

    this.t += dt;
    this.s = sNew;
    this.q = qNew;

    const tick = (name: 'shieldT' | 'slowT' | 'magnetT' | 'boostT' | 'guideT', eff: PickupType) => {
      if (this[name] > 0 && (this[name] -= dt) <= 0) { this[name] = 0; this.events.push({ type: 'effectEnd', effect: eff }); }
    };
    const hadBoost = this.boostT > 0;
    tick('shieldT', 'shield'); tick('slowT', 'slow'); tick('magnetT', 'magnet'); tick('boostT', 'boost'); tick('guideT', 'guide');
    if (hadBoost && this.boostT <= 0) this.graceT = Math.max(this.graceT, B.powers.graceBoost);   // Rückkehr zur normalen Kollision mit kurzer Schutzphase
    if (this.graceT > 0 && (this.graceT -= dt) <= 0) { this.graceT = 0; this.markOverlaps(body1); }
    if (this.guideT > 0) { if ((this.guideN++ & 3) === 0) this.guideQ = planGuide(this.obstacles, this.q, this.s, this.speedKmh, this.slowF); } else this.guideQ = null;
    if (this.blitzT > 0) { this.blitzT -= dt; if (this.blitzT <= 0) { this.blitzT = 0; this.blitzLeft = 0; this.events.push({ type: 'effectEnd', effect: 'clear' }); } else if (this.blitzLeft > 0) this.blitzSweep(); }
    if (this.glideT > 0) {
      // Landung: Ist der vorhergesagte Landebereich belegt, schwebt der Wagen bis zu `glideHoldMax` s länger (nie ein unvermeidbarer Crash beim Aufsetzen)
      if (this.glideT <= B.glide.down && this.glideHold < B.powers.glideHoldMax && this.landingBlocked()) this.glideHold += dt;
      else if ((this.glideT -= dt) <= 0) this.land(body1);
    }
    if (this.passed.size) this.updatePassed(body1);
    if (this.pendingFx && this.glideT <= 0 && this.boostT <= 0) {
      const next = this.pendingFx; this.pendingFx = null;                  // der vorgemerkte exklusive Effekt startet erst nach dem laufenden
      if (next === 'glide') { this.glideT = B.effects.glide; this.glideHold = 0; this.events.push({ type: 'glideStart' }); } else this.boostT = B.effects.boost;
    }

    for (const o of this.obstacles) {
      o.z += o.vz * ts * dt;
      if (o.hit) { o.knockT += dt; o.x += o.knockVx * dt; }
    }
    this.obstacles = this.obstacles.filter((o) => !(o.hit && o.knockT > 0.9) && o.z + KINDS[o.kind].len > this.s - 60);
    this.pickups = this.pickups.filter((p) => !p.taken && p.z > this.s - 40);
    if (this.director) this.director.update({ seed: this.seed, t: this.t, t0: this.t0, s: this.s, q: this.q, speedKmh: this.speedKmh, timeScale: ts, obstacles: this.obstacles }, dt);
    this.style.update({ t: this.t, s: this.s, q: this.q, speed: vm, ts, obstacles: this.obstacles, slowActive: this.slowT > 0, magnetActive: this.magnetT > 0, invulnerable: this.invulnerable, driven }, dt);
    this.flush();
    this.gen.update(this);
  }

  /** Ereignisse des Stil-Systems und der Verkehrsregie in die Ereigniswarteschlange übernehmen. */
  private flush(): void {
    if (this.style.events.length) { for (const e of this.style.events) this.events.push(e); this.style.events.length = 0; }
    if (this.director && this.director.events.length) { for (const e of this.director.events) this.events.push(e); this.director.events.length = 0; }
  }

  /** Vorhergesagter Landebereich (Spur und Strecke bei Ende des Fluges) belegt? */
  private landingBlocked(): boolean {
    const T = Math.max(0, this.glideT), v = this.speedKmh / 3.6, sL = this.s + v * T;
    const body = playerFootprint(this.road.center(sL) + this.q, sL, Math.atan(this.road.heading(sL)));
    for (const o of this.obstacles) {
      if (o.hit) continue;
      const def = KINDS[o.kind], zL = o.z + o.vz * this.slowF * T;
      if (zL > sL + 3 || zL + def.len < sL - B.player.len - 3) continue;
      const fp = obstacleFootprint(this.road, o, zL, o.lc ? lcX(o, T) : o.x);
      if (contactTime(body, body, fp, fp) !== null) return true;
    }
    return false;
  }

  /** Bereits überlappte Objekte gelten bis zur Trennung (+ 0,3 m) als passiert: kein unfairer Treffer beim Ende von Flug, Phantom-Turbo oder Schutzphase. */
  private markOverlaps(body: ReturnType<typeof playerFootprint>): void {
    for (const o of this.obstacles) {
      if (o.hit) continue;
      const fp = obstacleFootprint(this.road, o);
      if (contactTime(body, body, fp, fp) !== null) this.passed.add(o.id);
    }
  }

  /** Aufsetzen: bereits überlappte Objekte gelten bis zur unmittelbaren Trennung als passiert. */
  private land(body: ReturnType<typeof playerFootprint>): void {
    this.glideT = 0;
    this.glideHold = 0;
    this.events.push({ type: 'glideEnd' });
    this.markOverlaps(body);
  }

  private updatePassed(body: ReturnType<typeof playerFootprint>): void {
    for (const id of [...this.passed]) {
      const o = this.obstacles.find((x) => x.id === id);
      if (!o) { this.passed.delete(id); continue; }
      const fp = obstacleFootprint(this.road, o);
      const fat = (b: typeof fp) => ({ ...b, halfWidth: b.halfWidth + 0.3, halfLength: b.halfLength + 0.3 });
      if (contactTime(fat(body), fat(body), fat(fp), fat(fp)) === null) this.passed.delete(id);   // erst mit etwas Abstand gilt das Objekt als getrennt
    }
  }

  /** Liegt ein Hindernis im Weg, den ein angezogener Pickup seitlich zurücklegen würde? (Nichts wird durch Hindernisse hindurch eingesammelt.) */
  private pullBlocked(p: Pickup): boolean {
    const lo = Math.min(p.x, this.q) - 1.2, hi = Math.max(p.x, this.q) + 1.2;
    for (const o of this.obstacles) {
      if (o.hit) continue;
      const def = KINDS[o.kind];
      if (o.z > p.z + 4 || o.z + def.len < p.z - 4) continue;
      if (o.x + def.w / 2 > lo && o.x - def.w / 2 < hi) return true;
    }
    return false;
  }

  /**
   * Magnetfeld: zieht einen erreichbaren Pickup aus der Nachbarspur (Radius `magnetLanes` Spurbreiten) heran, jeweils einen zur Zeit
   * (Querbewegung in Richtung Wagen, so dass er mittig getroffen wird; nie durch Hindernisse). Liefert die Trefferfläche vor der Bewegung für den kontinuierlichen Kontakt.
   */
  private pullPickups(dt: number, qNew: number, vm: number): Map<Pickup, ReturnType<typeof pickupFootprint>> {
    const pads = new Map<Pickup, ReturnType<typeof pickupFootprint>>();
    if (this.magnetT > 0 && this.glideT <= 0 && !this.pickups.some((p) => p.pull && !p.taken)) {
      let best: Pickup | null = null;
      const radius = B.powers.magnetLanes * B.road.laneWidth;
      for (const p of this.pickups) {
        const dx = Math.abs(p.x - this.q);
        if (p.taken || p.type === 'magnet' || p.z < this.s + 8 || p.z > this.s + B.powers.magnetRange || dx < 1.6 || dx > radius) continue;
        if ((!best || p.z < best.z) && !this.pullBlocked(p)) best = p;
      }
      if (best) { best.pull = true; this.events.push({ type: 'magnetPull', x: best.x, z: best.z }); }
    }
    for (const p of this.pickups) {
      if (!p.pull || p.taken || this.glideT > 0) continue;
      pads.set(p, pickupFootprint(this.road, p));
      const left = Math.max(0.12, (p.z - this.s) / Math.max(1, vm) * 0.6);
      const step = Math.max(10, Math.abs(qNew - p.x) / left) * dt;
      p.x += Math.max(-step, Math.min(step, qNew - p.x));
    }
    return pads;
  }

  /**
   * Spurblitz: gespeicherte Aktivierung (Fenster `effects.blitz` s). Wirkt genau einmal: Sobald in der aktuellen Spur ein Hindernis innerhalb von
   * `blitzTtc` s Kollisionszeit liegt, werden die Hindernisse dieser Spur in diesem Bereich (höchstens `blitzMax`) geräumt. Geräumte Hindernisse
   * zählen weder als Kollision noch als Near Miss (`hit`). Ohne Ziel verfällt der Effekt nach Ablauf des Fensters.
   */
  private startBlitz(_q: number, s: number): void {
    this.blitzT = B.effects.blitz;
    this.blitzLeft = B.powers.blitzMax;
    this.blitzSweep(s);
  }

  private blitzSweep(sAt = this.s): void {
    const lane = laneOf(this.q), v = this.speedKmh / 3.6;
    const targets = this.obstacles
      .filter((o) => {
        if (o.hit || laneOf(o.x) !== lane || o.z + KINDS[o.kind].len <= sAt) return false;
        const rel = v - o.vz * this.slowF;
        return rel > 0.1 && Math.max(0, o.z - sAt) / rel <= B.powers.blitzTtc;
      })
      .sort((a, b) => a.z - b.z)
      .slice(0, B.powers.blitzMax);
    if (targets.length === 0) return;
    for (const o of targets) {
      o.hit = true;
      o.cleared = true;
      o.knockT = 0;
      o.knockVx = 0;
      this.events.push({ type: 'cleared', x: o.x, z: o.z, kind: o.kind });
    }
    this.events.push({ type: 'blitz', x: laneX(lane), z: sAt });
    this.blitzT = 0; this.blitzLeft = 0;
    this.events.push({ type: 'effectEnd', effect: 'clear' });
  }
}
