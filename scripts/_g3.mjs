import fs from 'node:fs';
const p='src/render/lots.ts'; let s=fs.readFileSync(p,'utf8');
s=s.replace("import { hash, mixHex } from './scenery';","import { drawDeco, hash, mixHex } from './scenery';");
const a=s.indexOf('/** Palme als flaches Sprite'); 
s=s.slice(0,a)+`/** Palme: das vorhandene Palmen-Sprite (leichte Windbewegung, eigene Phase je Baum), skaliert mit der Entfernung. */
function drawLotPalm(env: LotEnv, p: PP, s: number, ph: number, d: number): void {
  if (p.k * s < 1.2) return;
  drawDeco('palm', { ctx: env.ctx, sx: p.sx, sy: p.sy, sc: p.k * s, side: 1, hs: (ph / 6) % 1, k: Math.floor(ph * 10), clock: env.clock, reduced: env.reduced, lod: d > 160 || env.quality > 0 });
}
`;
s=s.replace("import { PAL, rect } from './sprites';","import { rect } from './sprites';");
fs.writeFileSync(p,s);
