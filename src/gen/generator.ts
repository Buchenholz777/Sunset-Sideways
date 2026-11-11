import { BALANCE as B } from '../config/balance';
import { speedAtDist, travelTime } from '../core/speed';
import { createRng } from '../core/rng';
import { KINDS, PICKUP_TYPES, laneOf, laneX, type ObjKind, type Obstacle, type Pickup, type PickupType } from '../sim/world';
import { checkChain, XM, type Gate, type Interval } from './fairness';

export interface GenWorld {
  s: number; t: number; obstacles: Obstacle[]; pickups: Pickup[]; nextId: number;
}

type Pattern = 'first' | 'single' | 'wall2' | 'stagger' | 'slalom' | 'weave' | 'chain';
type Group = 'fast' | 'mid' | 'slow';
/** Tempoklasse einer Spur: statischer Block oder Verkehr mit festem Tempo (Lkw nur in der langsamen Klasse). */
type LaneClass = 'static' | Group;

const GROUP_KINDS: Record<Group, ObjKind[]> = { fast: ['taxi', 'cabrio'], mid: ['sedan', 'cabrio'], slow: ['truck', 'truck', 'sedan'] };
const groupV = (g: Group): number => B.traffic[g] / 3.6;
const statics = (): ObjKind[] => ([B.traffic.baken ? 'baken' : null, B.traffic.barrier ? 'barrier' : null].filter(Boolean) as ObjKind[]);
const W = (k: ObjKind): number => (B.traffic.weights as Record<string, number>)[k] ?? 1;
/** Gewicht einer Tempoklasse: Mittel der Typgewichte (Lkw doppelt in der langsamen Klasse wie in der Typenliste). */
const groupWeight = (g: Group): number => GROUP_KINDS[g].reduce((a, k) => a + W(k), 0) / GROUP_KINDS[g].length;
const GROUP_BASE: Record<Group, number> = { fast: 0.4, mid: 0.35, slow: 0.25 };

interface PlannedObj { lane: number; kind: ObjKind; z: number; vz: number; gate: number }
interface Candidate { objs: PlannedObj[]; gates: Gate[]; rows: number; endA: number; usedLanes: Set<number>; midZ: number }

export interface GenStat { pattern: Pattern; mult: number; fallback: boolean; anchor: number; gates: Gate[] }

export interface GenOptions { record?: boolean; startS?: number }

export class Generator {
  private rng: () => number;
  private reach: Interval[] = [[-XM, XM]];
  private sEnd: number;
  private lastEnd: number;
  private origin: number;
  private encounters = 0;
  private nextPickupT: number;
  private queue: PickupType[] = [];
  private lastType: PickupType | null = null;
  private pickupCount = 0;
  /** Das erste Angebot jedes Versuchs ist Fliegen (ab 550 m nach dem ersten Ausweichmanöver). */
  private firstDone = false;
  readonly log: GenStat[] = [];

  constructor(seed: number, private opts: GenOptions = {}) {
    this.rng = createRng(seed ^ 0x9e3779b9);
    this.origin = opts.startS ?? 0;
    this.sEnd = this.origin;
    this.lastEnd = this.origin;
    this.nextPickupT = this.range(B.gen.pickupFirst) / this.freq();
  }

  /** Angebotshäufigkeit (≥ 0,05); 0 ist „aus“ und wird vor dem Aufruf abgefangen. */
  private freq(): number { return Math.max(0.05, B.pickups.freq); }
  private pickupGap(): number { return this.range(B.gen.pickupEvery) / this.freq(); }

  /** Erster Ausweichmoment nach ≈ 3 s; bei Einstieg mit hohem Tempo (QA) mindestens 2,6 s Vorlauf. */
  private firstAnchorDist(): number { return Math.max(B.start.firstAnchor, (2.6 * speedAtDist(this.origin)) / 3.6); }

  private range(r: readonly [number, number]): number { return r[0] + (r[1] - r[0]) * this.rng(); }
  private int(n: number): number { return Math.min(n - 1, Math.floor(this.rng() * n)); }

  /** Erzeugt Begegnungen, bis der Horizont gefüllt ist. */
  update(w: GenWorld): void {
    let guard = 0;
    const hz = Math.max(B.gen.horizon, (B.gen.horizonSec * speedAtDist(w.s)) / 3.6);
    while (this.nextAnchor(w) - w.s < hz && guard++ < 6) this.spawn(w);
  }

  private nextAnchor(w: GenWorld): number {
    if (this.encounters === 0) return this.origin + this.firstAnchorDist();
    return this.lastEnd + this.gapDist(w, this.lastEnd);
  }

  /** Zeit und Tempo bis zum Streckenmeter anchor – dieselbe Tempokurve wie die Simulation. */
  private plan(w: GenWorld, anchor: number) {
    const dist = Math.max(0, anchor - w.s);
    const vNow = speedAtDist(w.s) / 3.6;
    const T = travelTime(w.s, anchor);
    const tArr = w.t + T;
    const vNom = speedAtDist(anchor) / 3.6;
    const vAvg = T > 1e-6 ? dist / T : vNow;
    const m = B.gen.speedMargin;
    return { tArr, vNom, vAvg, vFast: vNom * m, vAvgFast: vAvg * m };
  }

  private gapDist(w: GenWorld, from: number): number {
    const p = this.plan(w, from);
    return Math.max(B.gen.minGap, (B.gen.gapBase + B.gen.gapGain * Math.exp(-p.tArr / B.gen.gapTau)) / Math.max(0.2, B.gen.gapScale)) * p.vNom;
  }

  /** Muster nach Fahrzeit und Strecke: mit wachsender Distanz öfter zwei bis drei zusammenhängende Entscheidungen. */
  private pickPattern(t: number, km: number): Pattern {
    const f = (x: number) => Math.max(0, Math.min(1, x));
    const opts: [Pattern, number][] = [['single', 45 * (1 - 0.7 * f(km / 8))], ['stagger', 40]];
    if (t >= 12) opts.push(['wall2', 25]);
    if (t >= 20) opts.push(['slalom', 25 + 25 * f(km / 4)]);
    if (t >= 35) opts.push(['weave', 20 + 45 * f(km / 6)]);
    if (km >= 3) opts.push(['chain', 15 + 45 * f((km - 3) / 12)]);
    const total = opts.reduce((acc, o) => acc + o[1], 0);
    let r = this.rng() * total;
    for (const [p, wgt] of opts) { if ((r -= wgt) < 0) return p; }
    return 'single';
  }

  private rowsFor(p: Pattern): number[][] {
    const a = this.int(3);
    const b = (a + 1 + this.int(2)) % 3;
    const c = 3 - a - b;
    switch (p) {
      case 'first': return [[1]];                       // Mitte blockiert: links und rechts sind frei
      case 'single': return [[a]];
      case 'wall2': return [[b, c]];
      case 'stagger': return [[a], [b]];
      case 'slalom': {
        const n = 3 + this.int(2);
        return Array.from({ length: n }, (_, i) => [i % 2 === 0 ? a : b]);
      }
      case 'weave': return [[a, b], [b, c]];
      case 'chain': return [[a, b], [b, c], [c, a]];     // freie Spur wandert c → a → b: drei Entscheidungen in Folge
    }
  }

  private laneClasses(w: GenWorld): (LaneClass | null)[] {
    const cls: (LaneClass | null)[] = [null, null, null];
    const sorted = [...w.obstacles].filter((o) => !o.hit && o.z + 12 > w.s).sort((x, y) => x.z - y.z);
    for (const o of sorted) {
      const v = o.vz * 3.6;
      cls[laneOf(o.x)] = !KINDS[o.kind].moving ? 'static' : v >= (B.traffic.fast + B.traffic.mid) / 2 ? 'fast' : v >= (B.traffic.mid + B.traffic.slow) / 2 ? 'mid' : 'slow';
    }
    return cls;
  }

  /** Tempoklasse nach Gewicht der Fahrzeugtypen; null, wenn alle beweglichen Typen auf 0 stehen. */
  private pickGroup(): Group | null {
    const gs: Group[] = ['fast', 'mid', 'slow'];
    const ws = gs.map((g) => GROUP_BASE[g] * groupWeight(g));
    const total = ws.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let r = this.rng() * total;
    for (let i = 0; i < 3; i++) { if ((r -= ws[i]) < 0) return gs[i]; }
    return 'slow';
  }

  private pickKind(kinds: ObjKind[]): ObjKind {
    const ws = kinds.map(W);
    const total = ws.reduce((a, b) => a + b, 0);
    if (total <= 0) return kinds[this.int(kinds.length)];
    let r = this.rng() * total;
    for (let i = 0; i < kinds.length; i++) { if ((r -= ws[i]) < 0) return kinds[i]; }
    return kinds[kinds.length - 1];
  }

  private pickClass(pat: Pattern): LaneClass {
    const st = statics();
    if (pat === 'first') return st.length ? 'static' : (this.pickGroup() ?? 'static');
    const wantStatic = this.rng() >= 0.65;
    if (wantStatic && st.length) return 'static';
    return this.pickGroup() ?? 'static';
  }

  private build(w: GenWorld, pat: Pattern, anchor: number): Candidate | null {
    const p = this.plan(w, anchor);
    const rowGap = (B.gen.rowBase + B.gen.rowGain * Math.exp(-p.tArr / B.gen.rowTau)) * p.vNom * (pat === 'slalom' ? 0.95 : 1);
    const rows = this.rowsFor(pat);
    const cls = this.laneClasses(w);
    const L = B.player.len;
    const objs: PlannedObj[] = [];
    const gates: Gate[] = [];
    const used = new Set<number>();
    let bad = false;
    rows.forEach((lanes, ri) => {
      const off = ri * rowGap;
      for (const lane of lanes) {
        used.add(lane);
        if (cls[lane] === null) cls[lane] = this.pickClass(pat);
        const lc = cls[lane] as LaneClass;
        const st = statics();
        const kinds = lc === 'static' ? (st.length ? st : (['baken'] as ObjKind[])) : GROUP_KINDS[lc];
        const kind = lc === 'static' ? kinds[this.int(kinds.length)] : this.pickKind(kinds);
        const def = KINDS[kind];
        const x = laneX(lane);
        const half = def.w / 2 + B.player.width / 2 + B.gen.blockMargin;
        const saN = anchor + off;
        if (lc === 'static') {
          objs.push({ lane, kind, z: saN, vz: 0, gate: gates.length });
          gates.push({ sa: saN - 3, sb: saN + L + def.len + 3, l: x - half, r: x + half });
        } else {
          const vo = groupV(lc);
          const s0 = w.s;
          const oz0 = (saN * (p.vAvg - vo) + vo * s0) / p.vAvg;
          if (oz0 < s0 + 15) { bad = true; return; }
          const span = L + def.len;
          const saF = oz0 + (vo * (oz0 - s0)) / (p.vAvgFast - vo);
          const sbN = saN + (span * p.vAvg) / (p.vAvg - vo);
          const sbF = saF + (span * p.vAvgFast) / (p.vAvgFast - vo);
          objs.push({ lane, kind, z: oz0, vz: vo, gate: gates.length });
          gates.push({ sa: Math.min(saN, saF) - 8, sb: Math.max(sbN, sbF) + 8, l: x - half, r: x + half });
        }
      }
    });
    if (bad || objs.length === 0) return null;
    const last = (rows.length - 1) * rowGap;
    const endA = Math.max(anchor + last + 8, ...gates.map((g) => g.sb));
    return { objs, gates, rows: rows.length, endA, usedLanes: used, midZ: anchor + last / 2 };
  }

  private spawn(w: GenWorld): void {
    const first = this.encounters === 0;
    const base = first ? this.origin + this.firstAnchorDist() : this.lastEnd;
    const gapFor = (a: number) => (first ? 0 : this.gapDist(w, a));
    const gap0 = gapFor(base);
    const tries: { pat: Pattern; mult: number }[] = [];
    if (first) tries.push({ pat: 'first', mult: 1 });
    else {
      const tArr = this.plan(w, base + gap0).tArr;
      const km = (base + gap0) / 1000;
      const pats = [this.pickPattern(tArr, km), this.pickPattern(tArr, km), 'single' as Pattern];
      // Ist das Magnetfeld an der Reihe, braucht die Begegnung mehr Vorlauf (Magnet-Pickup und Folge-Pickup davor)
      if (this.firstDone && this.queue.length === 0) this.refillQueue();
      const mults = this.firstDone && tArr >= this.nextPickupT && this.queue[0] === 'magnet' ? [1.9, 2.4, 3.5] : B.gen.mults;
      for (const m of mults) for (const pat of pats) tries.push({ pat, mult: m });
      tries.push({ pat: 'single', mult: 5 }, { pat: 'single', mult: 8 });
    }
    let accepted: { c: Candidate; r: ReturnType<typeof checkChain>; pat: Pattern; mult: number; anchor: number } | null = null;
    for (const tr of tries) {
      const anchor = first ? base : base + gap0 * tr.mult;
      const c = this.build(w, tr.pat, anchor);
      if (!c) continue;
      const r = checkChain(this.reach, this.sEnd, c.gates, this.plan(w, anchor).vFast);
      if (r.ok) { accepted = { c, r, pat: tr.pat, mult: tr.mult, anchor }; break; }
    }
    if (!accepted) {
      // Letzter, immer gültiger Ersatz: einzelnes Hindernis, sehr großer Abstand, Erreichbarkeit zurückgesetzt.
      const anchor = base + gap0 * 10;
      this.reach = [[-XM, XM]];
      this.sEnd = anchor - 400;
      const c = this.build(w, 'single', anchor)!;
      accepted = { c, r: checkChain(this.reach, this.sEnd, c.gates, this.plan(w, anchor).vFast), pat: 'single', mult: 10, anchor };
    }
    const { c, pat, mult, anchor } = accepted;
    let r = accepted.r;
    for (const o of c.objs) {
      w.obstacles.push({ id: w.nextId++, kind: o.kind, x: laneX(o.lane), z: o.z, vz: o.vz, hit: false, knockT: 0, knockVx: 0 });
    }
    const pk = this.placePickup(w, c, anchor);
    if (pk) r = pk;
    this.reach = r.reach;
    this.sEnd = r.sEnd;
    this.lastEnd = c.endA;
    this.encounters++;
    if (this.opts.record) this.log.push({ pattern: pat, mult, fallback: mult >= 5, anchor, gates: c.gates });
  }

  /** Gemischte Reihenfolge aller vier Typen; nie derselbe Typ direkt hintereinander. */
  private refillQueue(): void {
    // Jeder aktive Typ kommt mit seinem Anteil in die Mischung: Anteil 1 = einmal, 0,3 = mit 30 % Wahrscheinlichkeit, 2 = zweimal.
    const all: PickupType[] = [];
    for (const t of [...PICKUP_TYPES.filter((x) => x !== 'glide'), 'glide' as PickupType]) {
      if (!B.pickups.on[t]) continue;
      const sh = Math.max(0, B.pickups.share[t] + (t === 'glide' ? B.pickups.glideBoost : 0));
      const frac = sh - Math.floor(sh);
      const n = Math.floor(sh) + (frac > 1e-9 && this.rng() < frac ? 1 : 0);
      for (let i = 0; i < n; i++) all.push(t);
    }
    for (let i = all.length - 1; i > 0; i--) { const j = this.int(i + 1); [all[i], all[j]] = [all[j], all[i]]; }
    if (all.length > 1 && all[0] === this.lastType) { const k = all.findIndex((t) => t !== this.lastType); if (k > 0) [all[0], all[k]] = [all[k], all[0]]; }
    this.queue = all;
  }

  /**
   * Erstes Angebot jedes Versuchs: Fliegen als Tor über alle drei Spuren (kein Verfehlen durch die Spurwahl),
   * ab 550 m vor einer Begegnung, nur wenn alle Spuren dort frei sind.
   */
  private placeFirstGlide(w: GenWorld, c: Candidate, anchor: number): ReturnType<typeof checkChain> | null {
    const p = this.plan(w, anchor);
    const first = Math.min(...c.gates.map((g) => g.sa));
    const zp = first - 1.3 * p.vNom;
    if (zp < this.origin + B.glide.firstFrom || zp < this.sEnd + 6 || zp < w.s + 40) return null;
    if ([0, 1, 2].some((l) => w.obstacles.some((o) => !o.hit && laneOf(o.x) === l && Math.abs(o.z - zp) < 25))) return null;
    const r = checkChain(this.reach, this.sEnd, c.gates, p.vFast);
    if (!r.ok) return null;
    for (const lane of [0, 1, 2]) w.pickups.push({ id: w.nextId++, type: 'glide', x: laneX(lane), z: zp, taken: false });
    this.firstDone = true;
    this.lastType = 'glide';
    this.pickupCount++;
    this.nextPickupT = this.plan(w, zp).tArr + this.pickupGap();
    return r;
  }

  /** Zwangstore, die den Wagen an einer Pickup-Position in dessen Sammelbreite halten. */
  private must(zp: number, x: number): Gate[] {
    return [
      { sa: zp, sb: zp, l: -XM - 1, r: x - 0.9 },
      { sa: zp, sb: zp, l: x + 0.9, r: XM + 1 },
    ];
  }

  /**
   * Setzt höchstens ein Power-up vor die neue Begegnung. Der Weg über den Pickup (Umweg) muss anfahrbar und
   * danach weiter lösbar sein; der einfache Weg ist durch die ohnehin geprüfte Kette gesichert.
   * - Spurblitz: nur in einer Spur, in der innerhalb von 90 m ein Hindernis folgt.
   * - Magnetfeld: mit einem Folge-Pickup (Impulsschild oder Zeitblase) in der Nachbarspur, den der Magnet anzieht.
   * Liefert den Erreichbarkeitszustand nach dem Einsammeln oder null.
   */
  private placePickup(w: GenWorld, c: Candidate, anchor: number): ReturnType<typeof checkChain> | null {
    if (this.encounters < 1 || B.pickups.freq <= 0) return null;
    if (!this.firstDone) {
      if (B.pickups.on.glide && B.pickups.share.glide + B.pickups.glideBoost > 0) return this.placeFirstGlide(w, c, anchor);
      this.firstDone = true;                                         // Fliegen ausgeschaltet: das erste Angebot ist ein normaler Pickup
    }
    const p = this.plan(w, anchor);
    const first = Math.min(...c.gates.map((g) => g.sa));
    if (this.firstDone && this.queue.length === 0) this.refillQueue();
    const blockedNear = (lane: number, z: number) => w.obstacles.some((o) => !o.hit && laneOf(o.x) === lane && Math.abs(o.z - z) < 25);
    const order: PickupType[] = this.firstDone ? this.queue : ['glide'];
    for (let qi = 0; qi < order.length; qi++) {
      const type = order[qi];
      const lanes = [0, 1, 2];
      for (let i = lanes.length - 1; i > 0; i--) { const j = this.int(i + 1); [lanes[i], lanes[j]] = [lanes[j], lanes[i]]; }
      for (const lane of lanes) {
        let zp = first - 1.3 * p.vNom;
        let musts: Gate[] = [];
        let extra: { type: PickupType; lane: number; z: number } | null = null;
        const x = laneX(lane);
        if (type === 'clear') {
          if (!c.usedLanes.has(lane)) continue;                      // Zeitfenster 6 s: Ziel in dieser Spur folgt
        } else if (type === 'glide' && this.firstDone && this.plan(w, first).tArr < B.glide.minT) continue;
        else if (type === 'magnet') {
          zp = first - 2.0 * p.vNom;
          const nb = [lane - 1, lane + 1].filter((l) => l >= 0 && l <= 2);
          const nl = nb[this.int(nb.length)];
          const zb = first - 0.8 * p.vNom;
          if (blockedNear(nl, zb)) continue;
          const helpers = (['shield', 'slow'] as PickupType[]).filter((t) => B.pickups.on[t]);
          if (helpers.length === 0) continue;
          extra = { type: helpers[this.int(helpers.length)], lane: nl, z: zb };
          musts = [...this.must(zp, x), ...this.must(zb, laneX(nl))];
        }
        if (zp < this.sEnd + 6 || zp < w.s + 40) continue;
        if (!this.firstDone ? zp < this.origin + B.glide.firstFrom : this.plan(w, zp).tArr < this.nextPickupT) continue;
        if (blockedNear(lane, zp)) continue;
        if (musts.length === 0) musts = this.must(zp, x);
        const r = checkChain(this.reach, this.sEnd, [...musts, ...c.gates], p.vFast);
        if (!r.ok) continue;
        if (extra) {
          // Auch der Weg nur über den Magneten (ohne den angezogenen Pickup) muss weiterführen
          const only = checkChain(this.reach, this.sEnd, [...this.must(zp, x), ...c.gates], p.vFast);
          if (!only.ok) continue;
        }
        if (this.firstDone) this.queue.splice(qi, 1);
        this.firstDone = true;
        this.lastType = type;
        w.pickups.push({ id: w.nextId++, type, x, z: zp, taken: false });
        if (extra) w.pickups.push({ id: w.nextId++, type: extra.type, x: laneX(extra.lane), z: extra.z, taken: false });
        this.pickupCount++;
        this.nextPickupT = this.plan(w, zp).tArr + this.pickupGap();
        return r;
      }
    }
    return null;
  }
}
