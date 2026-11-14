import fs from 'node:fs';
let f,s; const open=(p)=>{f=p;s=fs.readFileSync(p,'utf8')}; const save=()=>fs.writeFileSync(f,s);
const rep=(a,b)=>{ if(!s.includes(a)) throw new Error(f+' missing: '+a.slice(0,70)); s=s.replace(a,b); };
open('src/render/lots.ts');
rep("/** Abstand der ersten Fläche hinter der Bordsteinkante (Gehweg 0,4 … 3,3 m). */\nconst U_WALK = 3.3;\n\n","");
rep("haze: string; fade: (d: number) => number;","haze: string; fade: (d: number, extra?: number) => number;");
save();
open('src/render/renderer.ts');
rep("import { computeRows } from './rows';","import { computeRows } from './rows';\nimport { LOT, lotItems, type LotEnv } from './lots';");
rep("export const KM_SIGN_EVERY = 5000;","export const KM_SIGN_EVERY = 5000;\n/** Grundstücke (räumliche Körper) gelten für die Abschnitte bis zu dieser Stufe; darüber bleiben die bisherigen Straßenrand-Motive. */\nconst LOT_STAGE_MAX = 1;");
rep("        let type = decoType(k, side, z);\n", "        let type = decoType(k, side, z);\n        if (stageAt(z) <= LOT_STAGE_MAX) continue;                   // ersetzt durch Grundstücke (lots.ts)\n");
rep("    // Zieltor (Sunset Sprint)", `    // Grundstücke am Straßenrand (Wüstenrand, Motels, Art-déco-Boulevard) als räumliche Körper und Bodenflächen
    {
      const env = this.lotEnv(zc);
      for (let i = Math.floor((zc + 2) / LOT) - 1; i <= Math.floor((zc + DRAW) / LOT); i++) {
        const mid = i * LOT + LOT / 2;
        if (stageAt(mid) > LOT_STAGE_MAX || mid < 40) continue;
        for (const side of [-1, 1]) lotItems(env, i, side, stageAt(mid), items);
      }
    }
    // Zieltor (Sunset Sprint)`);
rep("  private lat(z: number, zc: number)", `  /** Umgebung für Grundstücke: Projektion mit Straßenverlauf und Hügeln, Kamerahöhe, Licht und Qualitätsstufe. */
  private lotEnv(zc: number): LotEnv {
    return {
      ctx: this.ctx, zc, lt: this.lt, lights: gfx.lights, quality: this.quality, clock: this.clock, reduced: this.reducedMotion, haze: this.pal.haze,
      camH: this.L.Hv / this.L.fx,
      P: (x, z, h = 0) => { const p = this.projectWorld(zc, this.road.center(z) + x, z, h); return { sx: p.sx, sy: p.sy, d: p.d, k: p.k }; },
      fade: (d, extra = 1) => this.fade(d, extra),
      ground: (z) => this.road.height(z) - this.elev0,
    };
  }

  private lat(z: number, zc: number)`);
save();
