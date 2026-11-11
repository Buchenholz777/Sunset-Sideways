import fs from 'node:fs';
let f, s;
const open = (p) => { f = p; s = fs.readFileSync(p, 'utf8'); };
const save = () => fs.writeFileSync(f, s);
const rep = (a, b) => { if (!s.includes(a)) throw new Error(f + ' missing: ' + a.slice(0, 70)); s = s.replace(a, b); };

open('src/config/balance.ts');
rep("    slowFactor: 0.78, slowTau: 0.18,", "    slowFactor: 0.78, slowTau: 0.18,\n    /** Phantom-Turbo: Tempofaktor und Ein-/Ausblendzeit. */\n    boostFactor: 1.2, boostTau: 0.35,");
rep("effects: { shield: 10, slow: 7, magnet: 15, blitz: 6, glide: 8 },", "effects: { shield: 10, slow: 7, magnet: 15, blitz: 6, glide: 8, boost: 6, guide: 10 },");
save();

open('src/sim/world.ts');
rep("export type PickupType = 'shield' | 'slow' | 'clear' | 'magnet' | 'glide';", "export type PickupType = 'shield' | 'slow' | 'clear' | 'magnet' | 'glide' | 'boost' | 'guide';");
rep("export const PICKUP_TYPES: readonly PickupType[] = ['shield', 'slow', 'clear', 'magnet', 'glide'];", "export const PICKUP_TYPES: readonly PickupType[] = ['shield', 'slow', 'clear', 'magnet', 'glide', 'boost', 'guide'];");
rep("/** Impulsschild, Zeitblase, Spurblitz ('clear'), Magnetfeld, Gleitflug (selten). */", "/** Impulsschild, Zeitblase, Spurblitz ('clear'), Magnetfeld, Fliegen ('glide', selten), Phantom-Turbo ('boost'), Pfadfinder ('guide'). */");
save();

open('src/sim/sim.ts');
rep("import { Road } from './road';", "import { planGuide } from './guide';\nimport { Road } from './road';");
rep("const DUR: Record<'shield' | 'slow' | 'magnet', number> = { shield: B.effects.shield, slow: B.effects.slow, magnet: B.effects.magnet };", "const DUR: Record<'shield' | 'slow' | 'magnet' | 'boost' | 'guide', number> = { shield: B.effects.shield, slow: B.effects.slow, magnet: B.effects.magnet, boost: B.effects.boost, guide: B.effects.guide };");
rep("  magnetT = 0;", "  magnetT = 0;\n  boostT = 0;\n  guideT = 0;\n  /** Pfadfinder: Spurmitte, auf die zugesteuert werden soll (null = aus). */\n  guideQ: number | null = null;\n  private guideN = 0;");
rep("    this.lateral(dt, inp);\n    this.speedKmh = speedAtDist(this.s) * this.slowF;", "    this.boostF += ((this.boostT > 0 ? B.speed.boostFactor : 1) - this.boostF) * (1 - Math.exp(-dt / B.speed.boostTau));\n    this.lateral(dt, inp);\n    this.speedKmh = speedAtDist(this.s) * this.slowF * this.boostF;");
rep("          if (p.type === 'shield') this.shieldT = val; else if (p.type === 'slow') this.slowT = val; else { this.magnetT = val; this.magnetUsed = false; }", "          if (p.type === 'shield') this.shieldT = val; else if (p.type === 'slow') this.slowT = val; else if (p.type === 'boost') this.boostT = val; else if (p.type === 'guide') this.guideT = val; else { this.magnetT = val; this.magnetUsed = false; }");
rep("const tick = (name: 'shieldT' | 'slowT' | 'magnetT', eff: PickupType)", "const tick = (name: 'shieldT' | 'slowT' | 'magnetT' | 'boostT' | 'guideT', eff: PickupType)");
rep("tick('shieldT', 'shield'); tick('slowT', 'slow'); tick('magnetT', 'magnet');", "tick('shieldT', 'shield'); tick('slowT', 'slow'); tick('magnetT', 'magnet'); tick('boostT', 'boost'); tick('guideT', 'guide');\n    if (this.guideT > 0) { if ((this.guideN++ & 3) === 0) this.guideQ = planGuide(this.obstacles, this.q, this.s, this.speedKmh, this.slowF); } else this.guideQ = null;");
save();

open('src/gen/generator.ts');
rep("    if (this.encounters < 1) return null;\n    const p = this.plan(w, anchor);", "    if (this.encounters < 1) return null;\n    if (!this.firstDone) return this.placeFirstGlide(w, c, anchor);\n    const p = this.plan(w, anchor);");
rep("  /** Zwangstore, die den Wagen", `  /**
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
    this.nextPickupT = this.plan(w, zp).tArr + this.range(B.gen.pickupEvery);
    return r;
  }

  /** Zwangstore, die den Wagen`);
save();

open('src/game.ts');
rep("give: (shield: number, slow = 0, radar = 0, glide = 0) => { if (this.sim) { this.sim.shieldT = shield; this.sim.slowT = slow; this.sim.magnetT = radar; if (glide > 0) this.sim.glideT = glide; } },", "give: (shield: number, slow = 0, radar = 0, glide = 0, boost = 0, guide = 0) => { if (this.sim) { this.sim.shieldT = shield; this.sim.slowT = slow; this.sim.magnetT = radar; if (glide > 0) this.sim.glideT = glide; this.sim.boostT = boost; this.sim.guideT = guide; } },");
save();
