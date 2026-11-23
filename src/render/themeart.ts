/**
 * Vektorkunst der Themenwelten (Tunnel und Casinos), gezeichnet in Metern auf einer Fläche (X nach rechts, Y nach unten, Ursprung je Motiv unten Mitte).
 * Alles reine Dekoration: keine Hitbox, keine Spiellogik. Sauber gezeichnete Neonkonturen (Linienbreite in Metern), Glow nur bei voller Qualität und in Nähe.
 */
export interface Art { clock: number; detail: boolean; glow: boolean; v: number; reduced: boolean }

const TAU = Math.PI * 2;
const hash = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** Neonröhre: heller Kern, bei `glow` zusätzlich weicher Lichtsaum. */
function tube(ctx: CanvasRenderingContext2D, col: string, w: number, glow: boolean, path: () => void): void {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (glow) { ctx.globalAlpha *= 0.24; ctx.strokeStyle = col; ctx.lineWidth = w * 3.2; ctx.beginPath(); path(); ctx.stroke(); ctx.globalAlpha /= 0.24; }
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); path(); ctx.stroke();
}
const circle = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };

// ============================================================================ COSMIC HIGHWAY
export function cosmicPlanet(ctx: CanvasRenderingContext2D, a: Art, r = 1.25): void {
  const cy = -3.6;
  const g = ctx.createRadialGradient(-r * 0.4, cy - r * 0.4, r * 0.1, 0, cy, r * 1.1);
  const warm = a.v % 2 === 0;
  g.addColorStop(0, warm ? '#ffb8f0' : '#9ff4ff'); g.addColorStop(0.55, warm ? '#9a2fd0' : '#2a6ad8'); g.addColorStop(1, '#10104a');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, cy, r, 0, TAU); ctx.fill();
  if (a.detail) { ctx.globalAlpha *= 0.35; ctx.strokeStyle = warm ? '#ff4fd8' : '#2ee6ff'; ctx.lineWidth = 0.1; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.ellipse(0, cy + i * r * 0.38, r * Math.sqrt(1 - (i * 0.38) ** 2), r * 0.1, 0, 0, TAU); ctx.stroke(); } ctx.globalAlpha /= 0.35; }
  tube(ctx, warm ? '#2ee6ff' : '#ff4fd8', 0.09, a.glow, () => { ctx.ellipse(0, cy, r * 1.75, r * 0.42, -0.35, 0, TAU); });
  circle(ctx, r * 1.6, cy - r * 0.9, 0.2, '#e8f4ff'); circle(ctx, -r * 1.5, cy + r * 0.8, 0.13, '#ffd0f4');
}
export function cosmicGalaxy(ctx: CanvasRenderingContext2D, a: Art): void {
  const cy = -3.5, rot = a.reduced ? 0 : a.clock * 0.25;
  for (let arm = 0; arm < 3; arm++) for (let i = 0; i < (a.detail ? 26 : 14); i++) {
    const t = i / 26, r = 0.12 + 1.5 * t, an = arm * 2.094 + t * 4.4 + rot;
    ctx.fillStyle = t < 0.5 ? '#ff79e6' : '#7fe9ff'; ctx.globalAlpha *= 0.4 + 0.6 * (1 - t); ctx.fillRect(Math.cos(an) * r - 0.04, cy + Math.sin(an) * r * 0.55 - 0.04, 0.09, 0.09); ctx.globalAlpha /= 0.4 + 0.6 * (1 - t);
  }
  circle(ctx, 0, cy, 0.22, '#ffffff');
  if (a.glow) { ctx.globalAlpha *= 0.25; circle(ctx, 0, cy, 0.8, '#ff79e6'); ctx.globalAlpha /= 0.25; }
}
export function cosmicHolo(ctx: CanvasRenderingContext2D, a: Art): void {
  // drehender Drahtgitter-Würfel als Hologramm mit Sockelring
  const cy = -3.6, an = a.reduced ? 0.6 : a.clock * 0.7, s = 0.85;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) { const x = (i & 1 ? 1 : -1) * s, y = (i & 2 ? 1 : -1) * s, z = (i & 4 ? 1 : -1) * s; const xr = x * Math.cos(an) - z * Math.sin(an), zr = x * Math.sin(an) + z * Math.cos(an); pts.push([xr, cy + y * 0.95 + zr * 0.25]); }
  tube(ctx, '#2ee6ff', 0.06, a.glow, () => { for (let i = 0; i < 8; i++) for (const b of [1, 2, 4]) if (!(i & b)) { ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[i | b][0], pts[i | b][1]); } });
  tube(ctx, '#ff4fd8', 0.08, a.glow, () => { ctx.ellipse(0, -1.5, 1.1, 0.26, 0, 0, TAU); });
  ctx.globalAlpha *= 0.18; ctx.fillStyle = '#7fe9ff'; ctx.beginPath(); ctx.moveTo(-1.0, -1.5); ctx.lineTo(1.0, -1.5); ctx.lineTo(0.7, -2.6); ctx.lineTo(-0.7, -2.6); ctx.fill(); ctx.globalAlpha /= 0.18;
}
/** Große Fläche in der Wandebene: Planet mit Ring und ferne Sterne (Wandfenster in den Weltraum). */
export function cosmicWindow(ctx: CanvasRenderingContext2D, a: Art): void {
  ctx.fillStyle = '#04041a'; ctx.fillRect(-3.4, -5.6, 6.8, 5.2);
  for (let i = 0; i < 14; i++) { ctx.fillStyle = '#ffffff'; ctx.globalAlpha *= 0.4 + 0.6 * hash(i + a.v * 9); ctx.fillRect(-3.3 + hash(i * 3 + a.v) * 6.6, -5.5 + hash(i * 7 + a.v) * 5, 0.09, 0.09); ctx.globalAlpha /= 0.4 + 0.6 * hash(i + a.v * 9); }
  ctx.save(); ctx.translate(0.5, 1.3); ctx.scale(1.5, 1.5); cosmicPlanet(ctx, a, 1.0); ctx.restore();
  ctx.strokeStyle = '#2ee6ff'; ctx.lineWidth = 0.1; ctx.strokeRect(-3.4, -5.6, 6.8, 5.2);
}

// ============================================================================ ATLANTIS
export function coral(ctx: CanvasRenderingContext2D, col: string, seed: number, glow: boolean): void {
  const branch = (x: number, y: number, ang: number, len: number, depth: number): void => {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    ctx.moveTo(x, y); ctx.lineTo(x2, y2);
    if (depth > 0) { branch(x2, y2, ang - 0.5 - hash(seed + depth) * 0.3, len * 0.7, depth - 1); branch(x2, y2, ang + 0.5 + hash(seed + depth * 3) * 0.3, len * 0.7, depth - 1); }
  };
  tube(ctx, col, 0.14, glow, () => { branch(0, 0, -Math.PI / 2, 0.9, 3); });
}
export function crystal(ctx: CanvasRenderingContext2D, a: Art, h = 1.6): void {
  const pulse = a.reduced ? 1 : 0.85 + 0.15 * Math.sin(a.clock * 2 + a.v);
  ctx.globalAlpha *= pulse;
  ctx.fillStyle = '#7ff8e8'; ctx.beginPath(); ctx.moveTo(0, -h * 1.9); ctx.lineTo(0.5, -h * 1.1); ctx.lineTo(0.35, 0); ctx.lineTo(-0.35, 0); ctx.lineTo(-0.5, -h * 1.1); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d9fff8'; ctx.beginPath(); ctx.moveTo(0, -h * 1.9); ctx.lineTo(0.5, -h * 1.1); ctx.lineTo(0, -h * 1.0); ctx.closePath(); ctx.fill();
  tube(ctx, '#ffffff', 0.04, a.glow, () => { ctx.moveTo(0, -h * 1.9); ctx.lineTo(0, 0); });
  ctx.globalAlpha /= pulse;
}
export function goldColumn(ctx: CanvasRenderingContext2D, h: number, broken: boolean, a: Art): void {
  ctx.fillStyle = '#c9a23a'; ctx.fillRect(-0.55, -0.35, 1.1, 0.35);                // Sockel
  ctx.fillStyle = '#e8c860'; ctx.fillRect(-0.42, -h, 0.84, h - 0.35);               // Schaft
  ctx.fillStyle = '#9a7a22'; for (let i = -1; i <= 1; i++) ctx.fillRect(i * 0.24 - 0.025, -h, 0.05, h - 0.35);   // Kanneluren
  if (broken) { ctx.fillStyle = '#0a3a4a'; ctx.beginPath(); ctx.moveTo(-0.5, -h - 0.02); ctx.lineTo(-0.2, -h + 0.45); ctx.lineTo(0.05, -h + 0.1); ctx.lineTo(0.3, -h + 0.55); ctx.lineTo(0.5, -h - 0.02); ctx.fill(); }
  else { ctx.fillStyle = '#c9a23a'; ctx.fillRect(-0.6, -h - 0.3, 1.2, 0.3); ctx.fillRect(-0.5, -h - 0.5, 1.0, 0.2); }
  if (a.glow) { ctx.globalAlpha *= 0.18; ctx.fillStyle = '#4cf2e0'; ctx.fillRect(-0.9, -h, 1.8, h); ctx.globalAlpha /= 0.18; }
}
export function atlantisPylon(ctx: CanvasRenderingContext2D, a: Art): void {
  goldColumn(ctx, a.v % 2 ? 4.4 : 5.2, a.v % 2 === 1, a);
  ctx.save(); ctx.translate(-1.15, 0); coral(ctx, '#ff79c8', a.v, a.glow); ctx.restore();
  ctx.save(); ctx.translate(1.1, 0); coral(ctx, '#4cf2e0', a.v + 5, a.glow); ctx.restore();
  ctx.save(); ctx.translate(0.2, -0.2); ctx.scale(0.8, 0.8); crystal(ctx, a); ctx.restore();
}
/** Tempelruine als Silhouette (hinter der Glaswand). */
export function atlantisTemple(ctx: CanvasRenderingContext2D, a: Art): void {
  ctx.fillStyle = '#0d5a68';
  ctx.beginPath(); ctx.moveTo(-3.2, -3.6); ctx.lineTo(0, -5.2); ctx.lineTo(3.2, -3.6); ctx.closePath(); ctx.fill();
  ctx.fillRect(-3.3, -3.6, 6.6, 0.35);
  for (let i = 0; i < 5; i++) { const h = i === 3 ? 2.0 : 3.2; ctx.fillRect(-2.8 + i * 1.4 - 0.25, -h, 0.5, h); }
  ctx.fillRect(-3.5, -0.2, 7, 0.2);
  tube(ctx, '#4cf2e0', 0.06, a.glow, () => { ctx.moveTo(-3.2, -3.6); ctx.lineTo(0, -5.2); ctx.lineTo(3.2, -3.6); ctx.lineTo(-3.2, -3.6); });
}
export function fishSchool(ctx: CanvasRenderingContext2D, a: Art, seed: number, dir: number): void {
  for (let i = 0; i < (a.detail ? 9 : 5); i++) {
    const t = (a.reduced ? 0.3 : (a.clock * 0.16 + hash(seed + i) * 0.9)) % 1;
    const x = (t - 0.5) * 8 * dir, y = -2.5 - hash(seed + i * 3) * 2.6 + Math.sin(a.clock * 1.6 + i) * 0.12;
    ctx.fillStyle = i % 3 === 0 ? '#ffe08a' : '#4cf2e0';
    ctx.beginPath(); ctx.ellipse(x, y, 0.34, 0.15, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 0.3 * dir, y); ctx.lineTo(x - 0.62 * dir, y - 0.14); ctx.lineTo(x - 0.62 * dir, y + 0.14); ctx.closePath(); ctx.fill();
  }
}
/** Wal (v ≠ 1) oder Manta (v = 1): große, ruhige Silhouette hinter der transparenten Wand, rein dekorativ. */
export function seaGiant(ctx: CanvasRenderingContext2D, a: Art): void {
  const sw = a.reduced ? 0 : Math.sin(a.clock * 0.9);
  if (a.v % 3 === 1) {                                     // Manta
    ctx.fillStyle = '#0b3a66';
    ctx.beginPath(); ctx.moveTo(-5.2, -2.6 + sw * 0.5); ctx.quadraticCurveTo(-2, -4.2, 0, -2.4); ctx.quadraticCurveTo(2, -4.2, 5.2, -2.6 + sw * 0.5); ctx.quadraticCurveTo(2.2, -1.4, 0, -0.6); ctx.quadraticCurveTo(-2.2, -1.4, -5.2, -2.6 + sw * 0.5); ctx.fill();
    ctx.strokeStyle = '#0b3a66'; ctx.lineWidth = 0.18; ctx.beginPath(); ctx.moveTo(0, -0.7); ctx.quadraticCurveTo(0.6, 0.6, 1.6 + sw * 0.4, 1.8); ctx.stroke();
    ctx.fillStyle = '#4cf2e0'; ctx.globalAlpha *= 0.4; ctx.beginPath(); ctx.ellipse(0, -2.3, 1.1, 0.45, 0, 0, TAU); ctx.fill(); ctx.globalAlpha /= 0.4;
    return;
  }
  ctx.fillStyle = '#0c3d70';
  ctx.beginPath(); ctx.moveTo(-6.5, -2.2); ctx.quadraticCurveTo(-5, -4.6, -0.5, -4.4); ctx.quadraticCurveTo(4.2, -4.2, 5.8, -2.6 + sw * 0.4);
  ctx.lineTo(7.4, -4.0 + sw * 0.9); ctx.lineTo(7.1, -2.2 + sw * 0.3); ctx.lineTo(7.6, -0.7 + sw * 0.6); ctx.lineTo(5.6, -1.6); ctx.quadraticCurveTo(1, -0.1, -3.6, -0.5); ctx.quadraticCurveTo(-6, -0.9, -6.5, -2.2); ctx.fill();
  ctx.fillStyle = '#5ec8e8'; ctx.globalAlpha *= 0.45; ctx.beginPath(); ctx.moveTo(-5.8, -1.7); ctx.quadraticCurveTo(0, -0.2, 4.6, -1.5); ctx.quadraticCurveTo(0, -0.9, -5.8, -1.7); ctx.fill(); ctx.globalAlpha /= 0.45;
  ctx.fillStyle = '#0c3d70'; ctx.beginPath(); ctx.moveTo(-1.6, -1.0); ctx.lineTo(-0.2, 0.9 + sw * 0.2); ctx.lineTo(0.6, -0.9); ctx.fill();
  circle(ctx, -4.8, -2.7, 0.14, '#d9fff8');
  tube(ctx, '#4cf2e0', 0.05, a.glow, () => { ctx.moveTo(-6.5, -2.2); ctx.quadraticCurveTo(-5, -4.6, -0.5, -4.4); ctx.quadraticCurveTo(4.2, -4.2, 5.8, -2.6 + sw * 0.4); });
}

// ============================================================================ NEON KINGDOM
export function flame(ctx: CanvasRenderingContext2D, a: Art, x: number, y: number, s = 1): void {
  const f = a.reduced ? 1 : 1 + 0.18 * Math.sin(a.clock * 9 + x * 3 + a.v) + 0.08 * Math.sin(a.clock * 14.3 + a.v * 2);
  if (a.glow) { ctx.globalAlpha *= 0.22; circle(ctx, x, y - 0.3 * s, 0.85 * s, '#ff9a2a'); ctx.globalAlpha /= 0.22; }
  ctx.fillStyle = '#ff6a1a'; ctx.beginPath(); ctx.moveTo(x - 0.24 * s, y); ctx.quadraticCurveTo(x - 0.3 * s, y - 0.5 * s * f, x, y - 0.95 * s * f); ctx.quadraticCurveTo(x + 0.3 * s, y - 0.5 * s * f, x + 0.24 * s, y); ctx.fill();
  ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.moveTo(x - 0.12 * s, y); ctx.quadraticCurveTo(x - 0.14 * s, y - 0.35 * s * f, x, y - 0.6 * s * f); ctx.quadraticCurveTo(x + 0.14 * s, y - 0.35 * s * f, x + 0.12 * s, y); ctx.fill();
}
export function banner(ctx: CanvasRenderingContext2D, a: Art, x: number, top: number): void {
  const cols = ['#2d4fd8', '#a01830', '#6a2fb0', '#1a7a56'], c = cols[a.v % cols.length];
  ctx.fillStyle = '#c9a23a'; ctx.fillRect(x - 0.62, top, 1.24, 0.12);
  ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - 0.52, top + 0.12); ctx.lineTo(x + 0.52, top + 0.12); ctx.lineTo(x + 0.52, top + 2.2); ctx.lineTo(x, top + 1.8); ctx.lineTo(x - 0.52, top + 2.2); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 0.06; ctx.stroke();
  ctx.fillStyle = '#ffcf6b'; const cy = top + 0.85;
  switch (a.v % 4) {
    case 0: ctx.fillRect(x - 0.06, cy - 0.35, 0.12, 0.7); ctx.fillRect(x - 0.3, cy - 0.08, 0.6, 0.12); break;                      // Kreuz
    case 1: ctx.beginPath(); ctx.moveTo(x - 0.35, cy + 0.25); ctx.lineTo(x - 0.35, cy - 0.15); ctx.lineTo(x - 0.17, cy + 0.05); ctx.lineTo(x, cy - 0.3); ctx.lineTo(x + 0.17, cy + 0.05); ctx.lineTo(x + 0.35, cy - 0.15); ctx.lineTo(x + 0.35, cy + 0.25); ctx.fill(); break;   // Krone
    case 2: circle(ctx, x, cy, 0.3, '#ffcf6b'); circle(ctx, x, cy, 0.14, c); break;                                              // Sonne
    default: ctx.beginPath(); ctx.moveTo(x, cy - 0.4); ctx.lineTo(x + 0.3, cy + 0.2); ctx.lineTo(x - 0.3, cy + 0.2); ctx.fill();   // Dreieck
  }
}
export function shield(ctx: CanvasRenderingContext2D, a: Art, x: number, y: number): void {
  const p = (): void => { ctx.moveTo(x - 0.55, y - 0.7); ctx.lineTo(x + 0.55, y - 0.7); ctx.lineTo(x + 0.55, y); ctx.quadraticCurveTo(x + 0.5, y + 0.55, x, y + 0.8); ctx.quadraticCurveTo(x - 0.5, y + 0.55, x - 0.55, y); ctx.closePath(); };
  ctx.fillStyle = a.v % 2 ? '#a01830' : '#2d4fd8'; ctx.beginPath(); p(); ctx.fill();
  ctx.fillStyle = '#ffcf6b'; ctx.fillRect(x - 0.55, y - 0.28, 1.1, 0.22);
  tube(ctx, '#ffcf6b', 0.07, false, p);
}
export function knight(ctx: CanvasRenderingContext2D, a: Art): void {
  const steel = '#8c92b8', dark = '#4a4f78';
  ctx.fillStyle = dark; ctx.fillRect(-0.34, -1.6, 0.26, 1.6); ctx.fillRect(0.08, -1.6, 0.26, 1.6);        // Beine
  ctx.fillStyle = steel; ctx.fillRect(-0.5, -3.1, 1.0, 1.6);                                              // Brustpanzer
  ctx.fillRect(-0.85, -3.0, 0.38, 1.5); ctx.fillRect(0.47, -3.0, 0.38, 1.5);                              // Arme
  ctx.beginPath(); ctx.arc(0, -3.55, 0.42, Math.PI, 0); ctx.lineTo(0.42, -3.1); ctx.lineTo(-0.42, -3.1); ctx.closePath(); ctx.fill();   // Helm
  ctx.fillStyle = '#10143a'; ctx.fillRect(-0.3, -3.52, 0.6, 0.09);                                        // Visier
  ctx.fillStyle = '#c9a23a'; ctx.fillRect(-0.05, -4.35, 0.1, 0.4);                                        // Helmbusch-Schaft
  ctx.fillStyle = a.v % 2 ? '#ff4fd8' : '#2ee6ff'; ctx.fillRect(-0.09, -4.6, 0.18, 0.4);                   // Federbusch
  ctx.strokeStyle = '#d8dcff'; ctx.lineWidth = 0.1; ctx.beginPath(); ctx.moveTo(1.05, -0.2); ctx.lineTo(1.05, -4.1); ctx.stroke();   // Lanze
  tube(ctx, '#2ee6ff', 0.05, a.glow, () => { ctx.rect(-0.5, -3.1, 1.0, 1.6); });
}
export function gothicWindow(ctx: CanvasRenderingContext2D, a: Art): void {
  const w = 2.2, h = 4.4;
  const outline = (): void => { ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h * 0.62); ctx.quadraticCurveTo(-w / 2, -h, 0, -h * 1.12); ctx.quadraticCurveTo(w / 2, -h, w / 2, -h * 0.62); ctx.lineTo(w / 2, 0); ctx.closePath(); };
  ctx.save(); ctx.beginPath(); outline(); ctx.clip();
  const cols = ['#d83a4a', '#2d6ad8', '#ffcf6b', '#6a2fb0', '#1a9a6a'];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) {
    ctx.fillStyle = cols[Math.floor(hash(r * 3 + c + a.v * 7) * cols.length)];
    ctx.globalAlpha *= a.reduced ? 0.85 : 0.75 + 0.15 * Math.sin(a.clock * 0.9 + r + c); ctx.fillRect(-w / 2 + c * (w / 3), -h * 1.12 + r * ((h * 1.12) / 6), w / 3, (h * 1.12) / 6);
    ctx.globalAlpha /= a.reduced ? 0.85 : 0.75 + 0.15 * Math.sin(a.clock * 0.9 + r + c);
  }
  ctx.restore();
  ctx.strokeStyle = '#14102a'; ctx.lineWidth = 0.08; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -h * 1.1); ctx.moveTo(-w / 2, -h * 0.4); ctx.lineTo(w / 2, -h * 0.4); ctx.moveTo(-w / 2, -h * 0.8); ctx.lineTo(w / 2, -h * 0.8); ctx.stroke();
  tube(ctx, '#ffcf6b', 0.1, a.glow, outline);
}
export function rune(ctx: CanvasRenderingContext2D, a: Art, x: number, y: number, k: number): void {
  const p = a.reduced ? 1 : 0.55 + 0.45 * Math.sin(a.clock * 1.3 + k * 1.7);
  ctx.globalAlpha *= p;
  tube(ctx, '#4ee8ff', 0.09, a.glow, () => {
    const s = 0.45;
    switch (k % 4) {
      case 0: ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.moveTo(x, y - s * 0.4); ctx.lineTo(x + s * 0.7, y - s); break;
      case 1: ctx.moveTo(x - s * 0.6, y - s); ctx.lineTo(x + s * 0.6, y + s); ctx.moveTo(x + s * 0.6, y - s); ctx.lineTo(x - s * 0.6, y + s); break;
      case 2: ctx.moveTo(x - s * 0.6, y + s); ctx.lineTo(x, y - s); ctx.lineTo(x + s * 0.6, y + s); ctx.moveTo(x - s * 0.4, y + s * 0.1); ctx.lineTo(x + s * 0.4, y + s * 0.1); break;
      default: ctx.moveTo(x - s * 0.5, y - s); ctx.lineTo(x - s * 0.5, y + s); ctx.lineTo(x + s * 0.5, y); ctx.lineTo(x - s * 0.5, y - s * 0.1);
    }
  });
  ctx.globalAlpha /= p;
}
export function kingdomPylon(ctx: CanvasRenderingContext2D, a: Art): void {
  ctx.fillStyle = '#3a2c5c'; ctx.fillRect(-1.3, -6.2, 2.6, 6.2);                              // Steinpfeiler
  ctx.strokeStyle = '#241a40'; ctx.lineWidth = 0.05; ctx.beginPath(); for (let y = -0.5; y > -6.2; y -= 0.55) { ctx.moveTo(-1.3, y); ctx.lineTo(1.3, y); } ctx.stroke();
  switch (a.v % 3) {
    case 0: banner(ctx, a, 0, -5.9); flame(ctx, a, -0.9, -2.3, 0.9); flame(ctx, a, 0.9, -2.3, 0.9); ctx.fillStyle = '#4a4f78'; ctx.fillRect(-1.05, -2.3, 0.3, 0.14); ctx.fillRect(0.75, -2.3, 0.3, 0.14); break;
    case 1: ctx.save(); ctx.translate(0, 0); knight(ctx, a); ctx.restore(); break;
    default: shield(ctx, a, 0, -4.2); flame(ctx, a, 0, -2.4, 1.1); ctx.fillStyle = '#4a4f78'; ctx.fillRect(-0.3, -2.4, 0.6, 0.16); rune(ctx, a, 0, -1.1, a.v);
  }
}

// ============================================================================ MIDNIGHT JAZZ
export function sax(ctx: CanvasRenderingContext2D, col: string, a: Art, s = 1): void {
  const p = a.reduced ? 1 : 0.7 + 0.3 * Math.sin(a.clock * 3.3 + a.v);
  ctx.globalAlpha *= p;
  tube(ctx, col, 0.14 * s, a.glow, () => {
    ctx.moveTo(-0.7 * s, -5.4 * s); ctx.quadraticCurveTo(-0.35 * s, -5.5 * s, -0.2 * s, -4.9 * s);                // Mundstück + Hals
    ctx.lineTo(0.15 * s, -1.9 * s); ctx.quadraticCurveTo(0.35 * s, -0.5 * s, 1.2 * s, -0.9 * s);                  // Korpus-Bogen
    ctx.quadraticCurveTo(1.7 * s, -1.2 * s, 1.55 * s, -2.1 * s);                                                  // Becher
  });
  tube(ctx, col, 0.1 * s, a.glow, () => { ctx.ellipse(1.5 * s, -2.25 * s, 0.4 * s, 0.14 * s, -0.3, 0, TAU); });
  for (let i = 0; i < 4; i++) circle(ctx, 0.02 * s + i * 0.015 * s, (-4.4 + i * 0.7) * s, 0.07 * s, '#fff2c8');   // Klappen
  ctx.globalAlpha /= p;
}
export function note(ctx: CanvasRenderingContext2D, col: string, x: number, y: number, s: number, double: boolean): void {
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 0.08 * s;
  ctx.beginPath(); ctx.ellipse(x, y, 0.28 * s, 0.2 * s, -0.4, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + 0.25 * s, y - 0.05 * s); ctx.lineTo(x + 0.25 * s, y - 1.3 * s); ctx.stroke();
  if (double) { ctx.beginPath(); ctx.ellipse(x + 0.9 * s, y + 0.1 * s, 0.28 * s, 0.2 * s, -0.4, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(x + 1.15 * s, y + 0.05 * s); ctx.lineTo(x + 1.15 * s, y - 1.2 * s); ctx.moveTo(x + 0.25 * s, y - 1.3 * s); ctx.lineTo(x + 1.15 * s, y - 1.2 * s); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(x + 0.25 * s, y - 1.3 * s); ctx.quadraticCurveTo(x + 0.8 * s, y - 1.0 * s, x + 0.55 * s, y - 0.5 * s); ctx.stroke(); }
}
export function decoFan(ctx: CanvasRenderingContext2D, a: Art, r: number): void {
  tube(ctx, '#ffcf6b', 0.08, a.glow, () => { for (let i = 0; i < 6; i++) { ctx.moveTo(0, 0); ctx.arc(0, 0, r * (0.3 + 0.14 * i), Math.PI, 0); } for (let k = 0; k <= 6; k++) { const an = Math.PI + (k / 6) * Math.PI; ctx.moveTo(Math.cos(an) * r * 0.25, Math.sin(an) * r * 0.25); ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r); } });
}
export function pianoKeys(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const n = Math.max(4, Math.round(w / 0.35));
  ctx.fillStyle = '#f2ead8'; ctx.fillRect(-w / 2, -h, w, h);
  ctx.fillStyle = '#0c0608'; ctx.beginPath(); for (let i = 0; i < n; i++) { const k = i % 7; if (k === 2 || k === 6) continue; ctx.rect(-w / 2 + ((i + 0.68) * w) / n, -h, (w / n) * 0.6, h * 0.62); } ctx.fill();
  ctx.strokeStyle = '#8a6a30'; ctx.lineWidth = 0.03; ctx.beginPath(); for (let i = 1; i < n; i++) { ctx.moveTo(-w / 2 + (i * w) / n, -h * 0.38); ctx.lineTo(-w / 2 + (i * w) / n, 0); } ctx.stroke();
}
export function jazzPylon(ctx: CanvasRenderingContext2D, a: Art): void {
  ctx.fillStyle = '#1a0a0e'; ctx.fillRect(-1.4, -6.3, 2.8, 6.3);
  ctx.strokeStyle = '#d9a93a'; ctx.lineWidth = 0.07; ctx.strokeRect(-1.4, -6.3, 2.8, 6.3);
  switch (a.v % 3) {
    case 0: ctx.save(); ctx.translate(-0.3, 0.2); ctx.scale(0.95, 0.95); sax(ctx, '#ffcf6b', a); ctx.restore(); break;
    case 1: { const t = a.reduced ? 0 : Math.sin(a.clock * 2.4); note(ctx, '#ff8a3a', -0.5, -2.2 + t * 0.12, 1.2, true); note(ctx, '#b46bff', 0.2, -4.6 - t * 0.12, 1, false); break; }
    default: ctx.save(); ctx.translate(0, -3.6); decoFan(ctx, a, 1.3); ctx.restore(); pianoKeys(ctx, 2.4, 0.8);
  }
}
/** Bühne hinter einer Glasfläche (Wandebene, ca. 10 × 4,5 m): Saxofonist und Schlagzeuger, einfache, aber erkennbare Animationen. */
export function jazzStage(ctx: CanvasRenderingContext2D, a: Art): void {
  const t = a.reduced ? 0 : a.clock;
  ctx.fillStyle = '#1a0a10'; ctx.fillRect(-5.2, -4.8, 10.4, 4.8);                                  // Raum
  ctx.fillStyle = '#6a3a1a'; ctx.fillRect(-5.2, -0.9, 10.4, 0.9);                                  // Bühnenboden
  ctx.fillStyle = '#a01830'; ctx.fillRect(-5.2, -4.8, 0.9, 4.8); ctx.fillRect(4.3, -4.8, 0.9, 4.8); // Vorhänge
  ctx.globalAlpha *= 0.22; ctx.fillStyle = '#ffd98a';                                               // Scheinwerferkegel
  ctx.beginPath(); ctx.moveTo(-1.6, -4.8); ctx.lineTo(-3.2, -0.9); ctx.lineTo(-0.2, -0.9); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(2.2, -4.8); ctx.lineTo(0.6, -0.9); ctx.lineTo(3.8, -0.9); ctx.closePath(); ctx.fill();
  ctx.globalAlpha /= 0.22;
  // Saxofonist (links): Stand, Körper wiegt sich im Takt, Saxofon gold
  const sway = Math.sin(t * 2.4) * 0.12;
  ctx.save(); ctx.translate(-2.1, -0.9); ctx.rotate(sway * 0.4);
  ctx.fillStyle = '#16122e'; ctx.fillRect(-0.3, -1.7, 0.24, 1.7); ctx.fillRect(0.06, -1.7, 0.24, 1.7);
  ctx.fillStyle = '#e8e0d0'; ctx.fillRect(-0.4, -3.1, 0.8, 1.45);                                  // Hemd
  ctx.fillStyle = '#1a1840'; ctx.fillRect(-0.4, -3.1, 0.18, 1.45); ctx.fillRect(0.22, -3.1, 0.18, 1.45);   // Weste
  circle(ctx, 0, -3.5, 0.3, '#e0a880'); ctx.fillStyle = '#10101e'; ctx.fillRect(-0.34, -3.85, 0.68, 0.18);   // Kopf, Hut
  ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 0.12; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0.1, -3.3); ctx.quadraticCurveTo(0.2, -2.3, 0.5, -1.7); ctx.quadraticCurveTo(0.9, -1.5, 0.95, -2.1); ctx.stroke();
  ctx.fillStyle = '#e0a880'; ctx.fillRect(0.1, -2.7 + Math.sin(t * 7) * 0.03, 0.4, 0.1);          // Hände
  ctx.restore();
  // Schlagzeuger (rechts): sitzt hinter dem Set, Arme schlagen abwechselnd
  ctx.save(); ctx.translate(1.9, -0.9);
  circle(ctx, -1.0, -1.4, 0.55, '#c9a23a'); circle(ctx, 1.1, -1.5, 0.5, '#c9a23a'); circle(ctx, 0, -0.45, 0.6, '#a01830');         // Becken, Trommeln
  ctx.fillStyle = '#e0a880'; circle(ctx, 0, -2.5, 0.28, '#e0a880'); ctx.fillStyle = '#e8e0d0'; ctx.fillRect(-0.36, -2.2, 0.72, 1.0);
  const l = Math.sin(t * 9) > 0 ? 1 : 0, r = Math.sin(t * 9 + Math.PI) > 0 ? 1 : 0;
  ctx.strokeStyle = '#e0a880'; ctx.lineWidth = 0.12; ctx.beginPath(); ctx.moveTo(-0.34, -2.0); ctx.lineTo(-0.9, -1.2 - l * 0.35); ctx.moveTo(0.34, -2.0); ctx.lineTo(0.9, -1.2 - r * 0.35); ctx.stroke();
  if (l || r) { ctx.globalAlpha *= 0.7; circle(ctx, l ? -1.0 : 1.1, l ? -1.4 : -1.5, 0.62, '#fff2c8'); ctx.globalAlpha /= 0.7; }      // Becken blitzt kurz auf
  ctx.restore();
  // Noten steigen auf
  for (let i = 0; i < 3; i++) { const u = (t * 0.35 + i / 3) % 1; ctx.globalAlpha *= (1 - u); note(ctx, i % 2 ? '#ff8a3a' : '#ffcf6b', -3.0 + i * 1.1 + Math.sin(t + i) * 0.2, -3.2 - u * 1.4, 0.7, i === 1); ctx.globalAlpha /= (1 - u) || 1; }
  tube(ctx, '#ffcf6b', 0.1, a.glow, () => { ctx.rect(-5.2, -4.8, 10.4, 4.8); });
}

// ============================================================================ CASINO: Gäste, Tische (Billboard-Figuren, Meterkoordinaten)
const SKIN = ['#f2c6a0', '#d9a07a', '#a8704c', '#7a4a30'];
const CLOTH = ['#ff4fd8', '#2ee6d6', '#ffcf6b', '#7a5cff', '#e8e0d0', '#d8453f', '#3f6fb5'];
export type GuestPose = 'sit' | 'stand' | 'walk' | 'deal' | 'cheer' | 'sax';
/** Stilisierte Figur (≈ 1,7 m, Ursprung Fußpunkt Mitte). Haltung und Bewegung je Pose, Phase pro Figur versetzt. */
export function drawGuest(ctx: CanvasRenderingContext2D, pose: GuestPose, seed: number, clock: number, reduced: boolean, facing: number): void {
  const t = reduced ? 0 : clock + hash(seed) * 20;
  const skin = SKIN[Math.floor(hash(seed + 1) * SKIN.length)], cloth = CLOTH[Math.floor(hash(seed + 2) * CLOTH.length)], legs = hash(seed + 3) > 0.5 ? '#16122e' : '#2a2050';
  ctx.save(); ctx.scale(facing, 1);
  const bob = pose === 'walk' ? Math.abs(Math.sin(t * 4.2)) * 0.05 : pose === 'stand' ? Math.sin(t * 1.3) * 0.015 : 0;
  if (pose === 'sit') {
    ctx.fillStyle = '#6a2fb0'; ctx.fillRect(-0.28, -0.62, 0.56, 0.12); ctx.fillRect(-0.04, -0.52, 0.08, 0.52);       // Hocker
    ctx.fillStyle = legs; ctx.fillRect(-0.2, -0.78, 0.5, 0.2); ctx.fillRect(0.2, -0.78, 0.16, 0.78);
    ctx.fillStyle = cloth; ctx.fillRect(-0.24, -1.45, 0.48, 0.7);
    circle(ctx, 0.03, -1.65, 0.19, skin);
    // Arm zum Hebel: streckt sich alle ~4 s kurz nach vorn (Hebelzug), sonst am Knopf
    const pull = Math.sin(t * 1.6) > 0.82 ? 1 : 0;
    ctx.strokeStyle = skin; ctx.lineWidth = 0.11; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0.1, -1.35); ctx.lineTo(0.5, -1.15 - pull * 0.35); ctx.lineTo(0.62, -1.0 - pull * 0.45); ctx.stroke();
  } else {
    const sw = pose === 'walk' ? Math.sin(t * 4.2) : 0;
    ctx.fillStyle = legs; ctx.fillRect(-0.2 + sw * 0.1, -0.85 + bob, 0.18, 0.85 - bob); ctx.fillRect(0.02 - sw * 0.1, -0.85 + bob, 0.18, 0.85 - bob);
    ctx.fillStyle = cloth; ctx.fillRect(-0.26, -1.5 + bob, 0.52, 0.68);
    circle(ctx, 0, -1.7 + bob + (pose === 'stand' ? Math.sin(t * 0.9) * 0.01 : 0), 0.19, skin);
    ctx.strokeStyle = skin; ctx.lineWidth = 0.1; ctx.lineCap = 'round'; ctx.beginPath();
    if (pose === 'deal') { const d = Math.sin(t * 2.2); ctx.moveTo(0.2, -1.4); ctx.lineTo(0.55, -1.2 + d * 0.12); ctx.lineTo(0.78 + d * 0.1, -1.05); ctx.moveTo(-0.2, -1.4); ctx.lineTo(-0.5, -1.15); }
    else if (pose === 'cheer') { const u = Math.abs(Math.sin(t * 3)); ctx.moveTo(0.2, -1.4); ctx.lineTo(0.5, -1.75 - u * 0.25); ctx.moveTo(-0.2, -1.4); ctx.lineTo(-0.5, -1.7 - u * 0.2); }
    else if (pose === 'stand') { const g = Math.sin(t * 1.1) > 0.4 ? 1 : 0; ctx.moveTo(0.2, -1.4); ctx.lineTo(0.5, -1.2 - g * 0.3); ctx.lineTo(0.58, -1.05 - g * 0.4); ctx.moveTo(-0.2, -1.4); ctx.lineTo(-0.34, -0.95); }
    else { ctx.moveTo(0.2, -1.4); ctx.lineTo(0.3 + sw * 0.18, -0.95); ctx.moveTo(-0.2, -1.4); ctx.lineTo(-0.3 - sw * 0.18, -0.95); }
    ctx.stroke();
    if (pose === 'stand' || pose === 'cheer') { ctx.fillStyle = '#ffd98a'; ctx.globalAlpha *= 0.85; ctx.fillRect(0.5, -1.25, 0.1, 0.18); ctx.globalAlpha /= 0.85; }   // Glas
  }
  ctx.restore();
}
/** Spieltisch mit Filz, Chips und Kartenlicht (Seitenansicht, Meter, Ursprung Mitte unten). */
export function playTable(ctx: CanvasRenderingContext2D, felt: string, clock: number, reduced: boolean, seed: number): void {
  ctx.fillStyle = '#3a1a10'; ctx.fillRect(-1.3, -0.95, 2.6, 0.95);
  ctx.fillStyle = felt; ctx.beginPath(); ctx.ellipse(0, -0.97, 1.35, 0.3, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.ellipse(0, -0.97, 1.35, 0.3, 0, 0, TAU); ctx.stroke();
  const t = reduced ? 0 : clock;
  for (let i = 0; i < 4; i++) { circle(ctx, -0.8 + i * 0.5, -0.98 + (i % 2) * 0.05, 0.1, ['#d8453f', '#ffffff', '#2ee6d6', '#ffcf6b'][(i + seed) % 4]); }
  const card = Math.sin(t * 2.2 + seed) > 0.7;
  if (card) { ctx.fillStyle = '#f4f1e6'; ctx.fillRect(0.3, -1.12, 0.16, 0.22); }
}
