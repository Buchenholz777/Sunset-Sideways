import { KINDS, type ObjKind, type PickupType } from '../sim/world';

export const PAL = {
  ink: '#070a24', ice: '#8fe3ff', mint: '#7fe3c4', white: '#f4f1e6', red: '#ff2a2a', orange: '#ff8a1f',
  lilacHi: '#c9a8ff', purple: '#7a2fd0', violet: '#4a1a9a', deep: '#2a0f5e', magenta: '#ff4fd8',
};

/** Pixelmaßstab-Faktor für Mindestgrößen (2 / Skalierung), vom Renderer gesetzt. */
export const gfx = { u: 1, /** 1 = tiefe Sonne … 0 = Nacht */ sun: 1, /** 0 = alles aus … 1 = volle Beleuchtung */ lights: 0 };

export function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  const x0 = Math.round(x), y0 = Math.round(y);
  ctx.fillRect(x0, y0, Math.max(1, Math.round(x + w) - x0), Math.max(1, Math.round(y + h) - y0));
}

// ---------------------------------------------------------------- Verkehr & Baustelle
/** Farbvarianten je Typ (zusätzlich zur Form), gewählt über die Objekt-ID. */
const PAINT: Record<string, { body: string; dark: string; light: string }[]> = {
  taxi: [{ body: '#f2c21a', dark: '#a87d08', light: '#fff0a0' }, { body: '#f4f0e0', dark: '#a8a290', light: '#ffffff' }, { body: '#e8861a', dark: '#9a5208', light: '#ffd08a' }],
  cabrio: [{ body: '#2fb7a8', dark: '#176a62', light: '#9af2e6' }, { body: '#d8453f', dark: '#8a1f1c', light: '#ff9d94' }, { body: '#f0ece0', dark: '#9a968a', light: '#ffffff' }],
  sedan: [{ body: '#8b93a8', dark: '#4d556b', light: '#d4daea' }, { body: '#3f6fb5', dark: '#1f3f78', light: '#9fc4ff' }, { body: '#4f8a5e', dark: '#27523a', light: '#a8e0b8' }],
  truck: [{ body: '#d8d2c0', dark: '#8f8a78', light: '#ffffff' }, { body: '#3a6fb0', dark: '#1d3f6e', light: '#8fb6ee' }, { body: '#d9792a', dark: '#8a4510', light: '#ffc08a' }],
};

/** Heckansicht. `k` = Pixel pro Meter; Mindestgröße nur für die Darstellung, nie für Hitboxen. */
export function drawObstacle(ctx: CanvasRenderingContext2D, kind: ObjKind, sx: number, sy: number, k: number, clock: number, id = 0): void {
  const def = KINDS[kind];
  const W = def.w;
  const kk = Math.max(k, ((kind === 'baken' ? 3.5 : 4.5) * gfx.u) / W);
  const L = (x0: number, top: number, w: number, h: number, c: string) => rect(ctx, sx + (x0 - W / 2) * kk, sy - top * kk, w * kk, h * kk, c);
  // dunkle Bodenauflage
  L(-0.2, 0.12, W + 0.4 + 1.6 * gfx.sun, 0.3, 'rgba(0,0,10,0.6)');
  if (kind === 'baken') {
    L(0.05, 0.22, 0.8, 0.2, '#14142a');
    L(0.12, 0.6, 0.66, 0.4, PAL.orange);
    L(0.2, 0.9, 0.5, 0.3, PAL.white);
    L(0.27, 1.15, 0.36, 0.25, PAL.orange);
    L(0.32, 1.3, 0.26, 0.15, PAL.white);
    L(0.37, 1.45, 0.16, 0.15, Math.floor(clock) % 2 ? '#ffd36b' : '#ffb040');
    L(0.12, 0.6, 0.66, 0.06, '#ffd2a0'); // Kante
    return;
  }
  if (kind === 'barrier') {
    L(0.25, 0.7, 0.2, 0.55, '#14142a'); L(W - 0.45, 0.7, 0.2, 0.55, '#14142a');
    const n = 6;
    for (let i = 0; i < n; i++) {
      const c = i % 2 ? PAL.white : PAL.orange;
      L((i * W) / n, 1.2, W / n, 0.3, c);
      L((i * W) / n, 0.8, W / n, 0.28, i % 2 ? PAL.orange : PAL.white);
    }
    L(0, 1.2, W, 0.05, '#ffe1b0');
    L(0.1, 1.38, 0.28, 0.14, Math.floor(clock) % 2 ? '#ffd36b' : '#ffb040');
    return;
  }
  const P = PAINT[kind][id % 3];
  const nl = gfx.lights;
  /** Nachts: Lichthof und heller Kern an den Rückleuchten sowie farbiges Unterbodenlicht – Verkehr bleibt gut lesbar. */
  const glowAt = (x0: number, top: number, w: number, h: number) => {
    if (nl < 0.12) return;
    ctx.globalAlpha = 0.4 * nl; L(x0 - 0.2, top + 0.2, w + 0.4, h + 0.4, '#ff2a2a');
    ctx.globalAlpha = 0.9 * nl; L(x0 + w * 0.15, top - h * 0.1, w * 0.7, h * 0.4, '#ffe0d8');
    ctx.globalAlpha = 1;
  };
  const underglow = () => { if (nl < 0.15) return; ctx.globalAlpha = 0.38 * nl; L(-0.12, 0.2, W + 0.24, 0.22, id % 2 ? '#ff4fd8' : '#2ee6d6'); ctx.globalAlpha = 1; };
  const wheels = () => { L(0.1, 0.42, 0.36, 0.4, '#07070f'); L(W - 0.46, 0.42, 0.36, 0.4, '#07070f'); underglow(); };
  const tail = (top: number, h: number, w: number) => {
    L(0.07, top, w, h, PAL.red); L(W - 0.07 - w, top, w, h, PAL.red);
    glowAt(0.07, top, w, h); glowAt(W - 0.07 - w, top, w, h);
    L(0.07, top, w, h * 0.3, '#ff9a9a'); L(W - 0.07 - w, top, w, h * 0.3, '#ff9a9a');
  };
  if (kind === 'truck') {
    // hoher Kofferaufbau auf dunklem Fahrgestell, zwei Hecktüren, Warnstreifen, Unterfahrschutz
    L(0.05, 0.62, W - 0.1, 0.22, '#1b1b2c');
    wheels(); L(0.06, 0.5, 0.42, 0.4, '#0a0a14'); L(W - 0.48, 0.5, 0.42, 0.4, '#0a0a14');
    L(0, 3.6, W, 2.95, P.body);
    L(0, 3.6, W, 0.1, P.light);
    L(W / 2 - 0.02, 3.4, 0.04, 2.6, P.dark);
    L(0.12, 2.1, 0.08, 0.5, P.dark); L(W - 0.2, 2.1, 0.08, 0.5, P.dark);
    for (let i = 0; i < 8; i++) L((i * W) / 8, 1.0, W / 8, 0.2, i % 2 ? '#ffd23a' : '#d8332b');
    L(0.04, 0.9, 0.22, 0.34, PAL.red); L(W - 0.26, 0.9, 0.22, 0.34, PAL.red);
    glowAt(0.04, 0.9, 0.22, 0.34); glowAt(W - 0.26, 0.9, 0.22, 0.34);
    L(0.04, 2.9, 0.12, 0.2, '#ffb040'); L(W - 0.16, 2.9, 0.12, 0.2, '#ffb040');   // Umrissleuchten
    return;
  }
  wheels();
  if (kind === 'taxi') {
    L(0, 0.88, W, 0.6, P.body); L(0, 0.88, W, 0.07, P.light);
    L(0.05, 0.34, W - 0.1, 0.12, '#15152a');
    for (let i = 0; i < 8; i++) L(0.04 + (i * (W - 0.08)) / 8, 0.66, (W - 0.08) / 8, 0.1, i % 2 ? '#101018' : '#f4f1e6');   // Schachbrettstreifen
    L(0.2, 1.42, W - 0.4, 0.55, P.dark); L(0.2, 1.42, W - 0.4, 0.06, P.light);
    L(0.3, 1.36, W - 0.6, 0.42, '#0e1530');
    tail(0.86, 0.2, 0.34);
    // Dachleuchte: gelber Kasten mit hellem Rand, eigenes Licht (kein Pickup-Symbol)
    L(W / 2 - 0.3, 1.62, 0.6, 0.2, '#fff3a0'); L(W / 2 - 0.3, 1.62, 0.6, 0.05, '#ffffff');
    L(W / 2 - 0.34, 1.44, 0.68, 0.06, '#3a3a2a');
    ctx.globalAlpha = 0.18 + 0.45 * gfx.lights; L(W / 2 - 0.8, 1.9, 1.6, 0.75, '#fff3a0'); ctx.globalAlpha = 1;
    return;
  }
  if (kind === 'cabrio') {
    // offener Innenraum: dunkle Sitzmulde mit zwei Kopfstützen, niedriger Scheibenrahmen
    L(0, 0.8, W, 0.5, P.body); L(0, 0.8, W, 0.07, P.light);
    L(0.05, 0.34, W - 0.1, 0.12, '#15152a');
    L(0.12, 1.05, W - 0.24, 0.3, '#1c0f26');
    L(0.28, 1.2, 0.24, 0.32, P.dark); L(W - 0.52, 1.2, 0.24, 0.32, P.dark);
    L(0.1, 1.28, W - 0.2, 0.05, '#0e1530');
    tail(0.78, 0.17, 0.4);
    return;
  }
  // Limousine: gestreckte Karosserie mit Stufenheck und eigener Kabine
  L(0, 0.9, W, 0.62, P.body); L(0, 0.9, W, 0.07, P.light);
  L(0.05, 0.34, W - 0.1, 0.12, '#15152a');
  const cw = W * 0.78;
  L((W - cw) / 2, 1.42, cw, 0.52, P.dark); L((W - cw) / 2, 1.42, cw, 0.06, P.light);
  L((W - cw) / 2 + 0.1, 1.34, cw - 0.2, 0.38, '#0e1530');
  tail(0.88, 0.17, 0.42);
  L(W / 2 - 0.25, 0.7, 0.5, 0.14, P.dark);
}

// ---------------------------------------------------------------- Spielerwagen
export interface PlayerFx { turbo: boolean; grip: boolean; brake: number; steer: number; running: boolean }

/** Flacher, breiter Rennsportkeil in Neonlila (Heckansicht, Bodenkontakt bei sy). */
export function drawPlayer(ctx: CanvasRenderingContext2D, sx: number, sy: number, k: number, fx: PlayerFx): void {
  const W = 1.9;
  const L = (x0: number, top: number, w: number, h: number, c: string) => rect(ctx, (x0 - W / 2) * k, -top * k, w * k, h * k, c);
  ctx.save();
  ctx.translate(Math.round(sx), Math.round(sy));
  // Schatten und rote Bodenreflexion direkt hinter dem Wagen
  rect(ctx, -(W / 2 + 0.2) * k, -0.18 * k, (W + 0.4) * k, 0.34 * k, 'rgba(0,0,10,0.55)');
  ctx.globalAlpha = 0.12 + 0.3 * fx.brake;
  rect(ctx, -(W / 2 - 0.15) * k, 0.1 * k, 0.7 * k, 0.32 * k, '#ff2a2a');
  rect(ctx, (W / 2 - 0.85) * k, 0.1 * k, 0.7 * k, 0.32 * k, '#ff2a2a');
  ctx.globalAlpha = 1;
  // Hinterreifen (breit, sichtbar) und Radhäuser
  L(0, 0.5, 0.46, 0.5, '#07070f'); L(W - 0.46, 0.5, 0.46, 0.5, '#07070f');
  L(0.02, 0.5, 0.42, 0.06, '#2a2a40'); L(W - 0.44, 0.5, 0.42, 0.06, '#2a2a40');
  // Diffusor mit Lamellen, Auspuff
  L(0.5, 0.42, W - 1.0, 0.3, '#10061f');
  for (let i = 0; i < 5; i++) L(0.62 + i * 0.16, 0.4, 0.04, 0.26, '#3a1f6e');
  const flame = fx.turbo ? PAL.ice : '#ff7a3a';
  L(W / 2 - 0.42, 0.34, 0.26, 0.15, '#2b2b3a'); L(W / 2 + 0.16, 0.34, 0.26, 0.15, '#2b2b3a');
  L(W / 2 - 0.4, 0.31, 0.22, 0.04, '#9a9ab0'); L(W / 2 + 0.18, 0.31, 0.22, 0.04, '#9a9ab0');
  if (fx.running) {
    ctx.globalAlpha = fx.turbo ? 0.95 : 0.35;
    L(W / 2 - 0.4, 0.28, 0.22, fx.turbo ? 0.2 : 0.1, flame); L(W / 2 + 0.18, 0.28, 0.22, fx.turbo ? 0.2 : 0.1, flame);
    ctx.globalAlpha = 1;
  }
  // Heckpartie: breite Haunches (violett gestaffelt), eingezogene Mitte
  L(0, 0.84, W, 0.4, PAL.violet);
  L(0, 0.84, 0.55, 0.52, PAL.purple); L(W - 0.55, 0.84, 0.55, 0.52, PAL.purple);
  L(0.55, 0.78, W - 1.1, 0.3, PAL.deep);
  L(0.1, 0.86, 0.45, 0.06, PAL.lilacHi); L(W - 0.55, 0.86, 0.45, 0.06, PAL.lilacHi); // Reflexe
  L(0.0, 0.52, W, 0.05, PAL.magenta);
  // flache Kabine mit dunkler Heckscheibe, niedrige Dachlinie
  L(0.42, 1.17, W - 0.84, 0.36, PAL.purple);
  L(0.42, 1.17, W - 0.84, 0.05, PAL.lilacHi);
  L(0.52, 1.1, W - 1.04, 0.24, '#0b0d26');
  L(0.6, 1.07, 0.4, 0.05, '#3a3f8a');
  // Rücklichtgruppen: je Seite zwei kurze, versetzte horizontale Segmente
  const b = fx.brake;
  const core = b > 0.3 ? '#ff6a5a' : PAL.red;
  const lSteer = fx.steer < -0.2 ? 0.18 : 0, rSteer = fx.steer > 0.2 ? 0.18 : 0;
  ctx.globalAlpha = 0.3 + 0.35 * b;
  L(0.06, 0.92, 0.8, 0.3, '#ff2a2a'); L(W - 0.86, 0.92, 0.8, 0.3, '#ff2a2a'); // Leuchthof
  ctx.globalAlpha = 1;
  const seg = (x0: number, top: number, w: number, extra: number) => {
    L(x0, top, w, 0.1, core);
    if (b > 0.3 || extra > 0) L(x0, top, w, 0.04, '#ffd0c0');
  };
  seg(0.08, 0.8, 0.46, lSteer); seg(0.2, 0.66, 0.46, lSteer);
  seg(W - 0.54, 0.8, 0.46, rSteer); seg(W - 0.66, 0.66, 0.46, rSteer);
  if (fx.turbo) {
    // Turbo: über die gesamte Laufzeit helle violett-weiße Kanten, Unterbodenglühen, kurzer Lichtschweif
    ctx.globalAlpha = 0.95;
    L(0, 0.84, W, 0.05, '#e8dcff'); L(0.42, 1.17, W - 0.84, 0.05, '#ffffff'); L(0, 0.52, W, 0.04, '#bfe9ff');
    L(0, 0.84, 0.05, 0.4, '#e8dcff'); L(W - 0.05, 0.84, 0.05, 0.4, '#e8dcff');
    ctx.globalAlpha = 0.4;
    rect(ctx, -(W / 2 + 0.15) * k, 0.0, (W + 0.3) * k, 0.2 * k, PAL.ice);
    for (let i = 0; i < 3; i++) { ctx.globalAlpha = 0.55 - i * 0.17; rect(ctx, -0.55 * k, (0.2 + i * 0.22) * k, 1.1 * k, 0.1 * k, i === 0 ? '#ffffff' : PAL.ice); }
    ctx.globalAlpha = 1;
  }
  if (fx.grip) {
    // Kurvengrip: violetter Reifenprofil-Umriss und Lichtakzente an den Aufstandspunkten
    for (const x0 of [0, W - 0.46]) {
      L(x0 - 0.04, 0.54, 0.54, 0.05, '#d9b8ff'); L(x0 - 0.04, 0.54, 0.05, 0.54, '#d9b8ff'); L(x0 + 0.45, 0.54, 0.05, 0.54, '#d9b8ff');
      L(x0 + 0.08, 0.04, 0.3, 0.06, '#ffffff');
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- Pickups
const SHIELD_BIG = [
  '....###....', '..###.###..', '.##.....##.', '.#..sss..#.', '.#..sss..#.',
  '.#..sss..#.', '.#...s...#.', '.##.....##.', '..###.###..', '....###....',
];
const SHIELD_MINI = ['.###.', '#...#', '#.s.#', '#...#', '.###.'];
const SLOW_BIG = [
  '.#########.', '..#.....#..', '...#.s.#...', '....#s#....', '.....#.....', '....#s#....', '...#.s.#...', '..#.sss.#..', '.#########.',
];
const BLITZ_BIG = [
  '......###..', '.....###...', '....###....', '...#sss##..', '.....###...', '....###....', '...###.....', '..##.......', '.#.........',
];
const MAGNET_BIG = [
  '###.....###', '#s#.....#s#', '#s#.....#s#', '#s#.....#s#', '#s##...##s#', '.#ss###ss#.', '..##sss##..', '...#####...',
];
const GLIDE_BIG = [
  '.....#.....', '....#s#....', '...#sss#...', '#.##sss##.#', '##.#####.##', '.##.....##.', '..#.....#..',
];
const BOOST_BIG = [
  '.....#.....', '....#s#....', '...##s##...', '..##.s.##..', '.##..#..##.', '.....#.....', '....#s#....', '...##s##...', '..##...##..',
];
const BOOST_MINI = ['..#..', '.#s#.', '#.s.#', '..#..', '.#.#.'];
const GUIDE_BIG = [
  '.....#.....', '....###....', '...#####...', '..#######..', '.....#.....', '.....#.....', '.##..#..##.', '.##..#..##.',
];
const GUIDE_MINI = ['..#..', '.###.', '#.#.#', '..#..', '..#..'];
const GLIDE_MINI = ['..#..', '.#s#.', '#sss#', '##.##', '#...#'];
const BLITZ_MINI = ['...##', '..##.', '.###.', '.##..', '##...'];
const SLOW_MINI = ['#####', '.#.#.', '..#..', '.#.#.', '#####'];
const MAGNET_MINI = ['#.s.#', '#...#', '#s.s#', '##.##', '.###.'];
const LOOK: Record<PickupType, { big: string[]; mini: string[]; main: string }> = {
  shield: { big: SHIELD_BIG, mini: SHIELD_MINI, main: PAL.mint },
  clear: { big: BLITZ_BIG, mini: BLITZ_MINI, main: '#ffe95a' },
  magnet: { big: MAGNET_BIG, mini: MAGNET_MINI, main: '#6bb8ff' },
  glide: { big: GLIDE_BIG, mini: GLIDE_MINI, main: '#ff9ae0' },
  boost: { big: BOOST_BIG, mini: BOOST_MINI, main: '#ff3b3b' },
  guide: { big: GUIDE_BIG, mini: GUIDE_MINI, main: '#6bffa8' },
  slow: { big: SLOW_BIG, mini: SLOW_MINI, main: '#f4e9c8' },
};

function bitmap(ctx: CanvasRenderingContext2D, rows: string[], cx: number, cy: number, cell: number, main: string, accent: string, dark: boolean): void {
  const wc = rows[0].length, hc = rows.length;
  const ox = Math.round(cx - (wc * cell) / 2), oy = Math.round(cy - (hc * cell) / 2);
  const draw = (dx: number, dy: number, pick: (ch: string) => string | null) => {
    for (let r = 0; r < hc; r++) {
      for (let c = 0; c < wc; c++) {
        const col = pick(rows[r][c]);
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(ox + c * cell + dx, oy + r * cell + dy, cell, cell);
      }
    }
  };
  if (dark) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) draw(dx, dy, (ch) => (ch === '.' ? null : PAL.ink));
  }
  draw(0, 0, (ch) => (ch === '#' ? main : ch === 'o' || ch === 's' ? accent : null));
}

/** Schwebendes Sammelobjekt mit Negativraum, Konturlinie und Bodenprojektion in der Spur. */
export function drawPickup(ctx: CanvasRenderingContext2D, type: PickupType, sx: number, gy: number, k: number, clock: number, near: boolean, ground = true): void {
  const main = LOOK[type].main;
  const rr = Math.max(0.95 * k, 3 * gfx.u);
  const mini = rr < 5.5 * gfx.u;
  const bob = near ? Math.sin(clock * 2.2) * 0.1 * k : 0;
  const lift = Math.max(1.9 * k, rr * 1.7);
  const cy = gy - lift - bob;
  if (ground) {
    // UI-Feedback ohne Weltpose. Auf der Straße zeichnet der Renderer die tatsächliche Sammelfläche.
    const gw = Math.max(1.5 * k, 5 * gfx.u), gh = Math.max(0.4 * k, 1.5 * gfx.u);
    ctx.globalAlpha = 0.5;
    for (let i = -Math.floor(gh); i <= Math.floor(gh); i++) {
      const f = Math.sqrt(Math.max(0, 1 - (i / gh) ** 2));
      ctx.fillStyle = main;
      ctx.fillRect(Math.round(sx - gw * f), Math.round(gy + i), Math.max(1, Math.round(gw * 2 * f)), 1);
    }
    ctx.globalAlpha = 1;
  }
  if (ground && (type === 'glide' || type === 'boost')) {
    // auffälliges Signal: pulsierender Lichtkranz (Fliegen zusätzlich mit Lichtsäule)
    const pulse = 0.5 + 0.5 * Math.sin(clock * 6);
    ctx.globalAlpha = 0.22 + 0.22 * pulse; ctx.fillStyle = main;
    ctx.beginPath(); ctx.arc(sx, cy, rr * (1.5 + 0.25 * pulse), 0, Math.PI * 2); ctx.fill();
    if (type === 'glide') { ctx.globalAlpha = 0.18 + 0.12 * pulse; ctx.fillRect(Math.round(sx - rr * 0.25), Math.round(cy - rr * 7), Math.max(2, Math.round(rr * 0.5)), Math.round(rr * 7)); }
    ctx.globalAlpha = 1;
  }
  const rows = mini ? LOOK[type].mini : LOOK[type].big;
  const cell = Math.max(1, Math.round((rr * 2) / rows[0].length));
  bitmap(ctx, rows, sx, cy, cell, main, '#ffffff', true);
  void near;
}

/** Dünner, offener Schutzbogen um den Wagen (Einsammel-Feedback und Schildzustand). */
export function drawShieldArc(ctx: CanvasRenderingContext2D, sx: number, sy: number, k: number, alpha: number, clock: number): void {
  ctx.save();
  ctx.translate(Math.round(sx), Math.round(sy - 0.7 * k));
  ctx.globalAlpha = alpha * 0.08;
  ctx.fillStyle = PAL.mint;
  ctx.beginPath(); ctx.ellipse(0, 0, 1.55 * k, 1.25 * k, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = PAL.mint;
  ctx.lineWidth = Math.max(1, k * 0.07);
  const a0 = Math.PI * 1.08 + Math.sin(clock * 1.3) * 0.04;
  ctx.beginPath(); ctx.ellipse(0, 0, 1.55 * k, 1.25 * k, 0, a0, a0 + Math.PI * 0.84); ctx.stroke();
  ctx.restore();
}
