import fs from 'node:fs';
const p='src/render/lots.ts'; let s=fs.readFileSync(p,'utf8');
const a="  ctx.fillStyle = col; ctx.globalAlpha *= alpha; ctx.fill();\n  return minD;";
if(!s.includes(a)) throw 1;
s=s.replace(a,"  const base = ctx.globalAlpha;\n  ctx.fillStyle = col; ctx.globalAlpha = base * alpha; ctx.fill();\n  ctx.globalAlpha = base;\n  return minD;");
// Neon-Glow: Alpha sauber setzen
s=s.replace("ctx.globalAlpha *= 0.9; fillPoly(env, glow, p.neon, env.lights); }","fillPoly(env, glow, p.neon, env.lights); }");
fs.writeFileSync(p,s);
