import fs from 'node:fs';
let f, s;
const open = (p) => { f = p; s = fs.readFileSync(p, 'utf8'); };
const save = () => fs.writeFileSync(f, s);
const rep = (a, b) => { if (!s.includes(a)) throw new Error(f + ' missing: ' + a.slice(0, 70)); s = s.replace(a, b); };

// ---------------- sprites: neue Symbole + auffällige Fliegen-/Turbo-Pickups
open('src/render/sprites.ts');
rep("const GLIDE_MINI", "const BOOST_BIG = [\n  '.....#.....', '....#s#....', '...##s##...', '..##.s.##..', '.##..#..##.', '.....#.....', '....#s#....', '...##s##...', '..##...##..',\n];\nconst BOOST_MINI = ['..#..', '.#s#.', '#.s.#', '..#..', '.#.#.'];\nconst GUIDE_BIG = [\n  '.....#.....', '....###....', '...#####...', '..#######..', '.....#.....', '.....#.....', '.##..#..##.', '.##..#..##.',\n];\nconst GUIDE_MINI = ['..#..', '.###.', '#.#.#', '..#..', '..#..'];\nconst GLIDE_MINI");
rep("  glide: { big: GLIDE_BIG, mini: GLIDE_MINI, main: '#ff9ae0' },", "  glide: { big: GLIDE_BIG, mini: GLIDE_MINI, main: '#ff9ae0' },\n  boost: { big: BOOST_BIG, mini: BOOST_MINI, main: '#ff3b3b' },\n  guide: { big: GUIDE_BIG, mini: GUIDE_MINI, main: '#6bffa8' },");
rep("  const rows = mini ? LOOK[type].mini : LOOK[type].big;", "  if (ground && (type === 'glide' || type === 'boost')) {\n    // auffälliges Signal: pulsierender Lichtkranz (Fliegen zusätzlich mit Lichtsäule)\n    const pulse = 0.5 + 0.5 * Math.sin(clock * 6);\n    ctx.globalAlpha = 0.22 + 0.22 * pulse; ctx.fillStyle = main;\n    ctx.beginPath(); ctx.arc(sx, cy, rr * (1.5 + 0.25 * pulse), 0, Math.PI * 2); ctx.fill();\n    if (type === 'glide') { ctx.globalAlpha = 0.18 + 0.12 * pulse; ctx.fillRect(Math.round(sx - rr * 0.25), Math.round(cy - rr * 7), Math.max(2, Math.round(rr * 0.5)), Math.round(rr * 7)); }\n    ctx.globalAlpha = 1;\n  }\n  const rows = mini ? LOOK[type].mini : LOOK[type].big;");
save();

// ---------------- car3d: Phantom (Knight-Rider-Look)
open('src/render/car3d.ts');
rep("import { gfx } from './sprites';", "import { gfx } from './sprites';\nimport { mixHex } from './scenery';");
rep("/** Flughöhe in Modelleinheiten */ lift?: number }", "/** Flughöhe in Modelleinheiten */ lift?: number; /** Phantom-Turbo 0…1: Karosserie wird schwarz, nur die Rückleuchten leuchten */ stealth?: number }");
rep("  const lift = fx.lift ?? 0;", "  const lift = fx.lift ?? 0;\n  const st = Math.max(0, Math.min(1, fx.stealth ?? 0));\n  const LIGHTS = new Set(['#ff2a2a', '#ff6a5a', '#ffd0c0']);\n  const tone = (col: string): string => (st > 0 && !LIGHTS.has(col) && col.length === 7 ? mixHex(col, '#05050c', 0.9 * st) : col);");
rep("    ctx.fillStyle = f.col;\n    path(f.pts); ctx.fill();\n    for (const e of f.extra) { ctx.globalAlpha = e.al ?? 1; ctx.fillStyle = e.col; path(e.pts); ctx.fill(); }", "    ctx.fillStyle = tone(f.col);\n    path(f.pts); ctx.fill();\n    for (const e of f.extra) { ctx.globalAlpha = e.al ?? 1; ctx.fillStyle = tone(e.col); path(e.pts); ctx.fill(); }");
rep("  ctx.globalAlpha = warm ? 0.4 + 0.4 * gfx.sun : 0.8;", "  ctx.globalAlpha = (warm ? 0.4 + 0.4 * gfx.sun : 0.8) * (1 - 0.85 * st);");
rep("  ctx.globalAlpha = 1;\n}\n", `  ctx.globalAlpha = 1;
  if (st > 0) {
    // Knight-Rider: kräftig leuchtende Rückleuchten mit Lichthof und Reflex auf dem Asphalt
    for (const sg of [-1, 1]) {
      ctx.fillStyle = '#ff2a2a';
      ctx.globalAlpha = 0.28 * st; path([[sg * 0.12, 0.42, ZR - 0.02], [sg * 0.9, 0.42, ZR - 0.02], [sg * 0.9, 0.66, ZR - 0.02], [sg * 0.12, 0.66, ZR - 0.02]]); ctx.fill();
      ctx.globalAlpha = 0.22 * st; path([[sg * 0.1, 0, ZR - 0.02], [sg * 0.86, 0, ZR - 0.02], [sg * 0.8, 0, ZR - 0.5], [sg * 0.16, 0, ZR - 0.5]], gp); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
`);
save();

// ---------------- renderer
open('src/render/renderer.ts');
rep("blitz: boolean;", "blitz: boolean; boost: boolean; /** Pfadfinder: Spurmitte oder null */ guide: number | null;");
rep("  private visYaw = 0;", "  private stealth = 0;\n  private visYaw = 0;");
rep("this.visYaw = 0; this.particles.length = 0;", "this.visYaw = 0; this.stealth = 0; this.particles.length = 0;");
rep("running: v.running, yaw, lift: v.lift / 0.8 });", "running: v.running, yaw, lift: v.lift / 0.8, stealth: this.stealth });");
rep("    const sx = this.projectWorld(zc, this.carBx, this.carBz).sx;", "    this.stealth += ((v.boost ? 1 : 0) - this.stealth) * (1 - Math.exp(-this.dtLast / 0.3));\n    const sx = this.projectWorld(zc, this.carBx, this.carBz).sx;");
rep("    const relT = Math.max(-0.09, Math.min(0.09, v.rel * 0.55));", "    this.dtLast = dt;\n    const relT = Math.max(-0.09, Math.min(0.09, v.rel * 0.55));");
rep("  private stealth = 0;", "  private dtLast = 1 / 60;\n  private stealth = 0;");
// Burst-Farben
rep("kind === 'glide' ? ['#ff9ae0', '#9ae8ff', '#fff']", "kind === 'boost' ? ['#ff3b3b', '#ffb0a0', '#fff'] : kind === 'guide' ? ['#6bffa8', '#fff'] : kind === 'glide' ? ['#ff9ae0', '#9ae8ff', '#fff']");
// Pfadfinder-Chevrons und Phantom-Streifen
rep("    // Gleitflug: Landepunkt in der letzten Flugsekunde", `    // Pfadfinder: leuchtende Chevrons weisen die freie Spur
    if (v.guide !== null) {
      for (let dd = 30; dd <= 300; dd += 24) {
        const z = v.s + dd, gx = v.guide;
        const p = this.proj(zc, gx, z);
        if (p.d < 6 || p.d > DRAW) continue;
        items.push({ d: p.d - 0.3, draw: () => {
          const a = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.clock * 9 - dd / 22))) * this.fade(p.d);
          const p1 = this.proj(zc, gx - 1.2, z - 0.9), p2 = this.proj(zc, gx, z + 0.9), p3 = this.proj(zc, gx + 1.2, z - 0.9);
          ctx.globalAlpha = a; ctx.strokeStyle = '#6bffa8'; ctx.lineWidth = Math.max(1.2, 0.28 * p.k);
          ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.lineTo(p3.sx, p3.sy); ctx.stroke();
          ctx.globalAlpha = 1;
        } });
      }
    }
    // Gleitflug: Landepunkt in der letzten Flugsekunde`);
rep("    if (v.glideLeft > 0 && v.running) {\n      // Gleitflug: Lichtschweif", `    if (this.stealth > 0.05 && v.running) {
      // Phantom-Turbo: rote Lichtschlieren hinter den Rückleuchten
      const k0 = L.fx / CAM_BACK, y0 = L.gy - (0.55 * 0.8 + v.lift) * k0;
      for (const off of [-0.5, 0.5]) {
        const x0 = this.carSx + off * k0, len = Math.min(L.h - y0, 2.6 * k0 * this.stealth);
        const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
        g.addColorStop(0, 'rgba(255,40,40,0.85)'); g.addColorStop(1, 'rgba(255,40,40,0)');
        ctx.globalAlpha = this.stealth; ctx.fillStyle = g;
        ctx.fillRect(Math.round(x0 - Math.max(1, 0.09 * k0)), y0, Math.max(2, 0.18 * k0), len);
      }
      ctx.globalAlpha = 1;
    }
    if (v.glideLeft > 0 && v.running) {
      // Gleitflug: Lichtschweif`);
save();

// ---------------- HTML / CSS
open('index.html');
rep('<li id="fx-slow"', '<li id="fx-boost" hidden><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8l6-6 6 6M2 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2"/></svg><span class="fx-name">Phantom</span><span class="fx-time"></span></li>\n          <li id="fx-guide" hidden><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l5 6H9v8H7V7H3z" fill="currentColor"/></svg><span class="fx-name">Pfadfinder</span><span class="fx-time"></span></li>\n          <li id="fx-slow"');
save();
open('src/ui/style.css');
rep("#fx-glide { color: #ff9ae0; }", "#fx-glide { color: #ff9ae0; } #fx-boost { color: #ff5a5a; } #fx-guide { color: #6bffa8; }");
save();

// ---------------- game
open('src/game.ts');
s = s.replaceAll("blitz: '', glide: '' }", "blitz: '', glide: '', boost: '', guide: '' }");
rep("blitz: $('fx-blitz'), glide: $('fx-glide'),", "blitz: $('fx-blitz'), glide: $('fx-glide'), boost: $('fx-boost'), guide: $('fx-guide'),");
rep("blitz: false, lift: 0, glideLeft: 0,", "blitz: false, boost: false, guide: null, lift: 0, glideLeft: 0,");
rep("blitz: sim.blitzT > 0, lift: sim.height,", "blitz: sim.blitzT > 0, boost: sim.boostT > 0, guide: sim.guideQ, lift: sim.height,");
rep("    this.fxChip(this.el.glide, sim.glideT, 'glide');", "    this.fxChip(this.el.glide, sim.glideT, 'glide');\n    this.fxChip(this.el.boost, sim.boostT, 'boost');\n    this.fxChip(this.el.guide, sim.guideT, 'guide');");
rep("key: 'shield' | 'slow' | 'magnet' | 'blitz' | 'glide'", "key: 'shield' | 'slow' | 'magnet' | 'blitz' | 'glide' | 'boost' | 'guide'");
rep("else if (ev.type === 'glideStart') { this.renderer.burst('glide'); }", "else if (ev.type === 'glideStart') { this.renderer.burst('glide'); this.sound.setFlight(true); }");
rep("else if (ev.type === 'glideEnd') { this.renderer.burst('land'); this.sound.sfx('land'); }", "else if (ev.type === 'glideEnd') { this.renderer.burst('land'); this.sound.sfx('land'); this.sound.setFlight(false); }");
rep("    this.state.go('running');\n    this.input.reset();\n    this.input.active = true;\n    this.loop.reset();\n    this.sound.startLoops();\n  }", "    this.state.go('running');\n    this.input.reset();\n    this.input.active = true;\n    this.loop.reset();\n    this.sound.startLoops();\n    if (this.sim && this.sim.glideT > 0) this.sound.setFlight(true);\n  }");
rep("boostT: 0,", "boostT: 0,") ;
save();
