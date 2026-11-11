var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/pages-KJ2lWG/functionsWorker-0.14183769054992557.mjs
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var BALANCE = {
  /** Fester Simulationsschritt. */
  dt: 1 / 120,
  maxCatchUpSteps: 8,
  /** Lücken über dieser Dauer (ms) gelten als Unterbrechung ⇒ Pause. */
  stallMs: 250,
  /**
   * Grundtempo nach der gefahrenen Strecke des Versuchs (Stützpunkte [Meter, km/h], dazwischen stetig interpoliert):
   * 210 → 325 (1 km) → 370 (2 km) → 430 (6 km) → 480 (12 km) → 520 (16 km) → 550 (20 km) → 600 (27 km), danach konstant.
   */
  speed: {
    knots: [[0, 210], [1e3, 325], [2e3, 370], [6e3, 430], [12e3, 480], [16e3, 520], [2e4, 550], [27e3, 600]],
    slowFactor: 0.78,
    slowTau: 0.18,
    /** Phantom-Turbo: Tempofaktor und Ein-/Ausblendzeit. */
    boostFactor: 1.2,
    boostTau: 0.35
  },
  /** Dauer der Power-ups in aktiver Spielzeit. Spurblitz: Zeitfenster, in dem er bis zu zwei Hindernisse seiner Spur räumt. */
  effects: { shield: 10, slow: 7, magnet: 15, blitz: 6, glide: 8, boost: 6, guide: 10 },
  road: { lanes: 3, laneWidth: 3.6, halfWidth: 5.4 },
  player: { width: 1.9, len: 4.2, hitInsetX: 0.07, hitInsetZ: 0.2, maxX: 4.45 },
  obstacle: { hitInset: 0.05 },
  pickup: { len: 1.2, width: 1.4 },
  /**
   * Reine Querbewegung: Der Wagen fährt automatisch, der Spieler bestimmt nur die Querposition q.
   * Tasten: Zielquergeschwindigkeit vKey, Anstieg tauUp, Auslaufen tauStop (alles tempoabhängig, siehe steerAt). Touch: der Wagen folgt dem Finger
   * (Zielposition = Position beim Aufsetzen + Fingerweg), Geschwindigkeitsgrenze vTouch, Glättung tauTouch.
   */
  steer: {
    /** Bei 210 km/h … */
    base: { vKey: 18, tauUp: 0.03, tauStop: 0.035, vTouch: 30, tauTouch: 0.03, lag: 0.02 },
    /** … und bei 600 km/h (dazwischen stetig): je schneller, desto schneller der Spurwechsel. */
    fast: { vKey: 44, tauUp: 0.018, tauStop: 0.022, vTouch: 85, tauTouch: 0.016, lag: 8e-3 },
    vLo: 210,
    vHi: 600,
    /** Empfindlichkeit (Admin): Tastatur und Touch; skaliert Querzielgeschwindigkeit bzw. Fingerweg. Die Erreichbarkeitsprüfung rechnet mit dem kleineren Wert. */
    sens: { key: 1, touch: 1 }
  },
  /** Fingerweg in Bildbreiten → Meter (22 m je Bildbreite: ein Drittel Breite = Außenspur zu Außenspur), Totzone gegen Zittern; das Ziel bleibt nach dem Loslassen `settle` Sekunden bestehen. */
  touch: { deadPx: 8, mPerWidth: 22, settle: 0.8 },
  /** Erster klarer Ausweichmoment nach ≈ 3 s (175 m), Hindernis in der Mitte ⇒ zwei Ausweichwege. */
  start: { firstAnchor: 175 },
  /** Verkehrstempo je Tempoklasse in km/h (Lkw nur in der langsamen Klasse). */
  traffic: {
    fast: 58,
    mid: 48,
    slow: 36,
    /** Relative Häufigkeit der Fahrzeugtypen und Schalter der statischen Hindernisse (Admin). */
    weights: { taxi: 1, cabrio: 1, sedan: 1, truck: 1 },
    baken: true,
    barrier: true
  },
  /** Power-up-Angebot (Admin): Gesamthäufigkeit, Schalter und relative Anteile je Typ, Event-Aufschlag für Fliegen. */
  pickups: {
    freq: 1,
    on: { shield: true, slow: true, clear: true, magnet: true, glide: true, boost: true, guide: true },
    share: { shield: 1, slow: 1, clear: 1, magnet: 1, glide: 0.3, boost: 1, guide: 1 },
    glideBoost: 0
  },
  /** Kulisse nach Strecke (Admin): Lichtstützpunkte in Metern, Mondaufstieg, Neon-Intensität, Schalter. */
  scenery: { keys: [0, 15e3, 17e3, 2e4], moonFrom: 17500, moonSpan: 13500, neon: 1, planes: true, peds: true, fountains: true },
  /** Standardpegel (Admin) für Musik, Motor, Effekte und Effekte; persönliche Einstellungen der Spieler haben Vorrang. */
  audio: { music: 1, engine: 1, sfx: 1 },
  /** Spurblitz: Reichweite und Zahl entfernter Hindernisse; Magnet: Reichweite der Anziehung. */
  powers: { blitzRange: 90, blitzMax: 2, magnetRange: 130 },
  /** Gleitflug: Abheben, Sinken und Flughöhe (m); Gesamtdauer effects.glide, der Rest ist Flug. */
  glide: {
    up: 0.5,
    down: 1,
    height: 4.2,
    minT: 25,
    /** erstes Fliegen-Angebot frühestens nach dieser Strecke (m) */
    firstFrom: 550
  },
  restartDelayMs: 450,
  /** Leichte Bögen, die automatisch mitgefahren werden. */
  curves: { firstStart: 300, firstLen: 260, firstK: 1 / 1100, minR: 650, varR: 550 },
  briefingSeconds: 1.7,
  gen: {
    /** Mindest-Vorlauf der erzeugten Begegnungen (m); bei hohem Tempo mindestens 2,3 s. */
    horizon: 300,
    horizonSec: 2.3,
    visibleDist: 220,
    gapBase: 1.25,
    gapGain: 1.1,
    gapTau: 80,
    /** Begegnungsdichte (Admin): Abstände werden mit 1 / Dichte skaliert. */
    gapScale: 1,
    /** Mindestabstand zwischen dichten Ausweichstellen (s Fahrzeit bei Nenntempo; Admin). */
    minGap: 0.6,
    rowBase: 1,
    rowGain: 0.45,
    rowTau: 90,
    /**
     * Konservative Erreichbarkeitsprüfung: nach `react` Sekunden Reaktionszeit wird seitlich mit
     * reachEff · steer.vKey verschoben.
     */
    react: 0.4,
    reachEff: 0.6,
    blockMargin: 0.45,
    speedMargin: 1.04,
    mults: [1, 1.3, 1.7, 2.4, 3.5],
    /** Erstes Power-up nach ≈ 6–9 s (Platzierung vor der nächsten Begegnung), danach alle 9–14 s. */
    pickupFirst: [4.6, 6.4],
    pickupEvery: [9, 14]
  }
};
var X = [];
var Y = [];
var TAN = [];
function setSpeedKnots(knots) {
  X = knots.map((k) => k[0]);
  Y = knots.map((k) => k[1]);
  const n = X.length;
  const d = Array.from({ length: n - 1 }, (_, i) => (Y[i + 1] - Y[i]) / (X[i + 1] - X[i]));
  const m = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = 0;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const aa = m[i] / d[i], bb = m[i + 1] / d[i], h = Math.hypot(aa, bb);
    if (h > 3) {
      m[i] = 3 * aa * d[i] / h;
      m[i + 1] = 3 * bb * d[i] / h;
    }
  }
  TAN = m;
}
__name(setSpeedKnots, "setSpeedKnots");
__name2(setSpeedKnots, "setSpeedKnots");
setSpeedKnots(BALANCE.speed.knots);
function speedAtDist(s) {
  if (s <= X[0]) return Y[0];
  if (s >= X[X.length - 1]) return Y[Y.length - 1];
  let i = 0;
  while (s > X[i + 1]) i++;
  const h = X[i + 1] - X[i], t = (s - X[i]) / h;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * Y[i] + (t3 - 2 * t2 + t) * h * TAN[i] + (-2 * t3 + 3 * t2) * Y[i + 1] + (t3 - t2) * h * TAN[i + 1];
}
__name(speedAtDist, "speedAtDist");
__name2(speedAtDist, "speedAtDist");
function travelTime(s0, s1) {
  if (s1 <= s0) return 0;
  const n = Math.max(2, 2 * Math.ceil((s1 - s0) / 20));
  const h = (s1 - s0) / n;
  const f = /* @__PURE__ */ __name2((s) => 3.6 / speedAtDist(s), "f");
  let sum = f(s0) + f(s1);
  for (let i = 1; i < n; i++) sum += f(s0 + i * h) * (i % 2 ? 4 : 2);
  return sum * h / 3;
}
__name(travelTime, "travelTime");
__name2(travelTime, "travelTime");
function steerAt(kmh) {
  const S = BALANCE.steer;
  const f = Math.max(0, Math.min(1.25, (kmh - S.vLo) / (S.vHi - S.vLo)));
  const mix = /* @__PURE__ */ __name2((a, b) => a + (b - a) * f, "mix");
  return {
    vKey: mix(S.base.vKey, S.fast.vKey),
    tauUp: mix(S.base.tauUp, S.fast.tauUp),
    tauStop: mix(S.base.tauStop, S.fast.tauStop),
    vTouch: mix(S.base.vTouch, S.fast.vTouch),
    tauTouch: mix(S.base.tauTouch, S.fast.tauTouch),
    lag: mix(S.base.lag, S.fast.lag)
  };
}
__name(steerAt, "steerAt");
__name2(steerAt, "steerAt");
var PICKUPS = ["shield", "slow", "clear", "magnet", "glide", "boost", "guide"];
var PICKUP_LABEL = { shield: "Impulsschild", slow: "Zeitblase", clear: "Spurblitz", magnet: "Magnetfeld", glide: "Fliegen", boost: "Phantom-Turbo", guide: "Pfadfinder" };
var KINDS_LABEL = { taxi: "Taxi", cabrio: "Cabrio", sedan: "Limousine", truck: "Lkw" };
var rec = /* @__PURE__ */ __name2((v) => ({ shield: v, slow: v, clear: v, magnet: v, glide: v, boost: v, guide: v }), "rec");
var DEFAULT_CONFIG = {
  profile: "arcade",
  tempo: { startKmh: 210, maxKmh: 600, distToMaxKm: 27, density: 1 },
  traffic: { taxi: 1, cabrio: 1, sedan: 1, truck: 1, baken: true, barrier: true, minGap: 0.6 },
  pickups: {
    freq: 1,
    on: rec(true),
    share: { shield: 1, slow: 1, clear: 1, magnet: 1, glide: 0.3, boost: 1, guide: 1 },
    dur: { shield: 10, slow: 7, clear: 6, magnet: 15, glide: 8, boost: 6, guide: 10 },
    glideFirstM: 550
  },
  controls: { key: 1, touch: 1 },
  scenery: { duskKm: 15, nightKm: 20, moonHighKm: 31, neon: 1, planes: true, peds: true, fountains: true },
  audio: { music: 1, engine: 1, sfx: 1 },
  event: { on: false, glideBoost: 0.7, days: 3 }
};
var BASE_KNOTS = [[0, 210], [1e3, 325], [2e3, 370], [6e3, 430], [12e3, 480], [16e3, 520], [2e4, 550], [27e3, 600]];
function knotsFor(t) {
  const [, y0] = BASE_KNOTS[0], [x1, y1] = BASE_KNOTS[BASE_KNOTS.length - 1];
  return BASE_KNOTS.map(([x, y]) => [Math.round(x / x1 * t.distToMaxKm * 1e3), t.startKmh + (y - y0) / (y1 - y0) * (t.maxKmh - t.startKmh)]);
}
__name(knotsFor, "knotsFor");
__name2(knotsFor, "knotsFor");
var PROFILES = {
  relaxed: { label: "Entspannt", text: "Langsamer Anstieg, weniger Verkehr, mehr Zeit zum Reagieren.", patch: { startKmh: 180, maxKmh: 520, distToMaxKm: 32, density: 0.8, minGap: 1 } },
  arcade: { label: "Arcade", text: "Das bisherige Spielgef\xFChl.", patch: { startKmh: 210, maxKmh: 600, distToMaxKm: 27, density: 1, minGap: 0.6 } },
  hard: { label: "Anspruchsvoll", text: "Schneller Start, hohes Tempo fr\xFCh, dichtere Begegnungen.", patch: { startKmh: 240, maxKmh: 640, distToMaxKm: 20, density: 1.25, minGap: 0.8 } }
};
function withProfile(cfg, p) {
  const c = clone(cfg);
  const { minGap, ...tempo } = PROFILES[p].patch;
  c.tempo = { ...c.tempo, ...tempo };
  if (minGap !== void 0) c.traffic.minGap = minGap;
  c.profile = p;
  return normalize(c);
}
__name(withProfile, "withProfile");
__name2(withProfile, "withProfile");
var clone = /* @__PURE__ */ __name2((x) => JSON.parse(JSON.stringify(x)), "clone");
var pk = /* @__PURE__ */ __name2((k) => PICKUP_LABEL[k], "pk");
var FIELDS = [
  { path: "tempo.startKmh", label: "Starttempo", unit: "km/h", min: 120, max: 320, step: 5, group: "tempo", important: true, effect: "So schnell f\xE4hrt der Wagen beim Losfahren." },
  { path: "tempo.maxKmh", label: "H\xF6chstes Grundtempo", unit: "km/h", min: 300, max: 700, step: 10, group: "tempo", important: true, effect: "Das Tempo, bei dem die Kurve endet und die Fahrt gleichm\xE4\xDFig weitergeht." },
  { path: "tempo.distToMaxKm", label: "Strecke bis zum H\xF6chsttempo", unit: "km", min: 8, max: 45, step: 1, group: "tempo", important: true, effect: "K\xFCrzere Strecke = das Spiel wird schneller schwer." },
  { path: "tempo.density", label: "Begegnungsdichte", unit: "\xD7", min: 0.6, max: 1.6, step: 0.05, group: "tempo", important: true, effect: "Wie dicht Ausweichstellen aufeinander folgen (1 = bisher)." },
  { path: "traffic.minGap", label: "Mindestabstand dichter Ausweichstellen", unit: "s", min: 0.4, max: 2.5, step: 0.05, group: "traffic", effect: "Kleinster zeitlicher Abstand zwischen zwei Ausweichstellen." },
  ...["taxi", "cabrio", "sedan", "truck"].map((k) => ({ path: `traffic.${k}`, label: `H\xE4ufigkeit ${KINDS_LABEL[k]}`, unit: "\xD7", min: 0, max: 3, step: 0.1, group: "traffic", detail: true, effect: `Relative H\xE4ufigkeit des Typs ${KINDS_LABEL[k]} (0 = kommt nicht vor).` })),
  { path: "pickups.freq", label: "Power-up-Angebot gesamt", unit: "\xD7", min: 0, max: 3, step: 0.1, group: "pickups", important: true, effect: "Wie oft Power-ups angeboten werden (0 = gar nicht, 1 = bisher)." },
  { path: "pickups.glideFirstM", label: "Fliegen: fr\xFChestes erstes Angebot", unit: "m", min: 200, max: 4e3, step: 50, group: "pickups", effect: "Fr\xFChestens ab dieser Strecke erscheint das erste Fliegen-Angebot." },
  ...PICKUPS.map((k) => ({ path: `pickups.share.${k}`, label: `Anteil ${pk(k)}`, unit: "\xD7", min: 0, max: 3, step: 0.1, group: "pickups", detail: true, effect: `Relativer Anteil von ${pk(k)} am Angebot.` })),
  ...PICKUPS.map((k) => ({ path: `pickups.dur.${k}`, label: `Dauer ${pk(k)}`, unit: "s", min: k === "glide" ? 4 : 3, max: 40, step: 1, group: "pickups", detail: true, effect: `Wie lange ${pk(k)} wirkt.` })),
  { path: "controls.key", label: "Tastatur-Empfindlichkeit", unit: "\xD7", min: 0.5, max: 1.5, step: 0.05, group: "controls", important: true, effect: "Wie schnell der Wagen auf Pfeiltasten quer zieht." },
  { path: "controls.touch", label: "Touch-Empfindlichkeit", unit: "\xD7", min: 0.5, max: 1.5, step: 0.05, group: "controls", important: true, effect: "Wie weit der Wagen pro Fingerweg wandert." },
  { path: "scenery.duskKm", label: "D\xE4mmerung ab", unit: "km", min: 3, max: 30, step: 0.5, group: "scenery", important: true, effect: "Ab hier sinkt die Sonne, das Licht wird violett." },
  { path: "scenery.nightKm", label: "Nacht ab", unit: "km", min: 6, max: 40, step: 0.5, group: "scenery", important: true, effect: "Ab hier ist es Nacht; die Strip-Kulisse blendet ein." },
  { path: "scenery.moonHighKm", label: "Mond hoch am Himmel ab", unit: "km", min: 8, max: 50, step: 0.5, group: "scenery", effect: "Bis hier steigt der Mond auf seine h\xF6chste Position." },
  { path: "scenery.neon", label: "Neon-Intensit\xE4t der Strip-Kulisse", unit: "%", min: 0, max: 1, step: 0.05, scale: 100, group: "scenery", effect: "Sichtbarkeit der Neon-Kulisse ab der Nacht." },
  { path: "audio.music", label: "Synthwave-Musik (Standard)", unit: "%", min: 0, max: 1.5, step: 0.05, scale: 100, group: "audio", effect: "Standardlautst\xE4rke der Musik; pers\xF6nliche Stummschaltung hat Vorrang." },
  { path: "audio.engine", label: "Motor (Standard)", unit: "%", min: 0, max: 1.5, step: 0.05, scale: 100, group: "audio", effect: "Standardlautst\xE4rke des Motors." },
  { path: "audio.sfx", label: "Effekte (Standard)", unit: "%", min: 0.4, max: 1.5, step: 0.05, scale: 100, group: "audio", effect: "Standardpegel von Kollisions- und Power-up-Signalen (nie unter 40 %, damit sie h\xF6rbar bleiben)." },
  { path: "event.glideBoost", label: "Flugwoche: zus\xE4tzlicher Fliegen-Anteil", unit: "\xD7", min: 0, max: 2, step: 0.1, group: "event", effect: "Wird zum Fliegen-Anteil addiert, solange das Ereignis l\xE4uft." },
  { path: "event.days", label: "Flugwoche: Dauer", unit: "Tage", min: 1, max: 7, step: 1, group: "event", effect: "Das Ereignis endet automatisch nach dieser Dauer." }
];
var FIELD_BY_PATH = Object.fromEntries(FIELDS.map((f) => [f.path, f]));
function getPath(o, path) {
  return path.split(".").reduce((a, k) => a && typeof a === "object" ? a[k] : void 0, o);
}
__name(getPath, "getPath");
__name2(getPath, "getPath");
function setPath(o, path, v) {
  const ks = path.split(".");
  let a = o;
  for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]];
  a[ks[ks.length - 1]] = v;
}
__name(setPath, "setPath");
__name2(setPath, "setPath");
var num = /* @__PURE__ */ __name2((v, d) => typeof v === "number" && Number.isFinite(v) ? v : d, "num");
var bool = /* @__PURE__ */ __name2((v, d) => typeof v === "boolean" ? v : d, "bool");
function normalize(input) {
  const c = clone(DEFAULT_CONFIG);
  const src = input && typeof input === "object" ? input : {};
  for (const f of FIELDS) {
    const d = getPath(DEFAULT_CONFIG, f.path);
    const raw = num(getPath(src, f.path), d);
    const q = Math.round(raw / f.step) * f.step;
    setPath(c, f.path, Math.min(f.max, Math.max(f.min, Math.round(q * 1e3) / 1e3)));
  }
  const s = src;
  c.traffic.baken = bool(s.traffic?.baken, true);
  c.traffic.barrier = bool(s.traffic?.barrier, true);
  for (const k of PICKUPS) c.pickups.on[k] = bool(s.pickups?.on?.[k], true);
  c.scenery.planes = bool(s.scenery?.planes, true);
  c.scenery.peds = bool(s.scenery?.peds, true);
  c.scenery.fountains = bool(s.scenery?.fountains, true);
  c.event.on = bool(s.event?.on, false);
  c.profile = s.profile === "relaxed" || s.profile === "hard" || s.profile === "custom" ? s.profile : "arcade";
  return c;
}
__name(normalize, "normalize");
__name2(normalize, "normalize");
function validate(input) {
  const out = [];
  const src = input && typeof input === "object" ? input : {};
  for (const f of FIELDS) {
    const v = getPath(src, f.path);
    if (typeof v !== "number" || !Number.isFinite(v)) out.push({ path: f.path, level: "error", msg: "Zahl erwartet." });
    else if (v < f.min - 1e-9 || v > f.max + 1e-9) out.push({ path: f.path, level: "error", msg: `Erlaubt sind ${f.min * (f.scale ?? 1)} bis ${f.max * (f.scale ?? 1)} ${f.unit}.` });
  }
  const c = normalize(src);
  if (c.tempo.maxKmh - c.tempo.startKmh < 100) out.push({ path: "tempo.maxKmh", level: "error", msg: "H\xF6chsttempo muss mindestens 100 km/h \xFCber dem Starttempo liegen." });
  if (c.scenery.nightKm < c.scenery.duskKm + 2) out.push({ path: "scenery.nightKm", level: "error", msg: "Die Nacht muss mindestens 2 km nach der D\xE4mmerung beginnen." });
  if (c.scenery.moonHighKm < c.scenery.nightKm) out.push({ path: "scenery.moonHighKm", level: "error", msg: "Der Mond kann erst ab Nachtbeginn ganz oben stehen." });
  const movers = c.traffic.taxi + c.traffic.cabrio + c.traffic.sedan + c.traffic.truck;
  if (movers <= 0 && !c.traffic.baken && !c.traffic.barrier) out.push({ path: "traffic.baken", level: "error", msg: "Mindestens ein Hindernistyp muss aktiv sein." });
  if (!c.pickups.on.glide && c.pickups.glideFirstM !== DEFAULT_CONFIG.pickups.glideFirstM) out.push({ path: "pickups.glideFirstM", level: "warn", msg: "Fliegen ist ausgeschaltet \u2013 dieser Wert hat keine Wirkung." });
  if (c.pickups.freq === 0) out.push({ path: "pickups.freq", level: "warn", msg: "Es werden keine Power-ups angeboten." });
  if (c.event.on && !c.pickups.on.glide) out.push({ path: "event.glideBoost", level: "warn", msg: "Fliegen ist ausgeschaltet \u2013 die Flugwoche hat keine Wirkung." });
  return out;
}
__name(validate, "validate");
__name2(validate, "validate");
function effectiveGlideBoost(c, eventActive) {
  return eventActive && c.event.on ? c.event.glideBoost : 0;
}
__name(effectiveGlideBoost, "effectiveGlideBoost");
__name2(effectiveGlideBoost, "effectiveGlideBoost");
function applyConfig(cfg, eventActive = false) {
  const c = normalize(cfg);
  const B = BALANCE;
  const knots = knotsFor(c.tempo);
  B.speed.knots = knots;
  setSpeedKnots(knots);
  B.gen.gapScale = c.tempo.density;
  B.gen.minGap = c.traffic.minGap;
  B.traffic.weights.taxi = c.traffic.taxi;
  B.traffic.weights.cabrio = c.traffic.cabrio;
  B.traffic.weights.sedan = c.traffic.sedan;
  B.traffic.weights.truck = c.traffic.truck;
  B.traffic.baken = c.traffic.baken;
  B.traffic.barrier = c.traffic.barrier;
  B.pickups.freq = c.pickups.freq;
  for (const k of PICKUPS) {
    B.pickups.on[k] = c.pickups.on[k];
    B.pickups.share[k] = c.pickups.share[k];
  }
  B.pickups.glideBoost = effectiveGlideBoost(c, eventActive);
  B.glide.firstFrom = c.pickups.glideFirstM;
  B.effects.shield = c.pickups.dur.shield;
  B.effects.slow = c.pickups.dur.slow;
  B.effects.blitz = c.pickups.dur.clear;
  B.effects.magnet = c.pickups.dur.magnet;
  B.effects.glide = c.pickups.dur.glide;
  B.effects.boost = c.pickups.dur.boost;
  B.effects.guide = c.pickups.dur.guide;
  B.steer.sens.key = c.controls.key;
  B.steer.sens.touch = c.controls.touch;
  const sc = B.scenery;
  const dusk = c.scenery.duskKm * 1e3, night = c.scenery.nightKm * 1e3;
  sc.keys[0] = 0;
  sc.keys[1] = dusk;
  sc.keys[2] = Math.round(dusk + 0.4 * (night - dusk));
  sc.keys[3] = night;
  sc.moonFrom = Math.max(dusk, night - 2500);
  sc.moonSpan = Math.max(2e3, c.scenery.moonHighKm * 1e3 - sc.moonFrom);
  sc.neon = c.scenery.neon;
  sc.planes = c.scenery.planes;
  sc.peds = c.scenery.peds;
  sc.fountains = c.scenery.fountains;
  B.audio.music = c.audio.music;
  B.audio.engine = c.audio.engine;
  B.audio.sfx = c.audio.sfx;
}
__name(applyConfig, "applyConfig");
__name2(applyConfig, "applyConfig");
function diffConfigs(a, b) {
  const out = [];
  const fmt = /* @__PURE__ */ __name2((f, v) => typeof v === "boolean" ? v ? "an" : "aus" : f ? `${Math.round(Number(v) * (f.scale ?? 1) * 100) / 100} ${f.unit}` : String(v), "fmt");
  for (const f of FIELDS) {
    const x = getPath(a, f.path), y = getPath(b, f.path);
    if (x !== y) out.push({ path: f.path, label: f.label, from: fmt(f, x), to: fmt(f, y) });
  }
  const sw = [["traffic.baken", "Baken"], ["traffic.barrier", "Absperrung"], ["scenery.planes", "Flugzeuge"], ["scenery.peds", "Fu\xDFg\xE4nger"], ["scenery.fountains", "Brunnen"], ["event.on", "Flugwoche"], ...PICKUPS.map((k) => [`pickups.on.${k}`, pk(k)])];
  for (const [p, label] of sw) {
    const x = getPath(a, p), y = getPath(b, p);
    if (x !== y) out.push({ path: p, label, from: fmt(void 0, x), to: fmt(void 0, y) });
  }
  return out;
}
__name(diffConfigs, "diffConfigs");
__name2(diffConfigs, "diffConfigs");
var HEX = /^[0-9a-f]{8,32}$/;
var DEVS = /* @__PURE__ */ new Set(["phone", "tablet", "desktop"]);
var MILES = [1e3, 5e3, 15e3, 2e4, 27e3];
var TYPES = /* @__PURE__ */ new Set(["shield", "slow", "clear", "magnet", "glide", "boost", "guide"]);
var CAUSES = /* @__PURE__ */ new Set(["taxi", "cabrio", "sedan", "truck", "baken", "barrier"]);
var REASONS = /* @__PURE__ */ new Set(["crash", "restart", "leave"]);
var MAX_BODY = 32 * 1024;
var MAX_EVENTS = 50;
var MAX_PICKUPS_PER_RUN = 60;
var int = /* @__PURE__ */ __name2((v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.floor(v) : null, "int");
async function ingest(db, body, now) {
  const res = { accepted: 0, ignored: 0 };
  if (!body || typeof body !== "object") return res;
  const b = body;
  if (typeof b.v !== "string" || !HEX.test(b.v) || !Array.isArray(b.events)) return res;
  const dev = typeof b.dev === "string" && DEVS.has(b.dev) ? b.dev : "desktop";
  const ver = typeof b.ver === "string" && /^[\w.+-]{1,24}$/.test(b.ver) ? b.ver : "unbekannt";
  const visit = b.v;
  const events = b.events.slice(0, MAX_EVENTS);
  const wanted = /* @__PURE__ */ new Set();
  for (const e of events) {
    const d = e?.d;
    if (e?.t === "start" && typeof d?.cfg === "string" && /^\d{1,9}$/.test(d.cfg)) wanted.add(d.cfg);
  }
  const known = /* @__PURE__ */ new Set(["builtin"]);
  if (wanted.size) for (const r of await db.all(`SELECT id FROM config_versions WHERE id IN (${[...wanted].map(() => "?").join(",")})`, ...[...wanted].map(Number))) known.add(String(r.id));
  const stmts = [["INSERT OR IGNORE INTO visits (visit, ts, dev, ver) VALUES (?, ?, ?, ?)", visit, now, dev, ver]];
  const counted = [];
  const at = [];
  const add = /* @__PURE__ */ __name2((s) => {
    if (s) {
      at.push(stmts.length);
      stmts.push(s);
    } else at.push(-1);
    counted.push(true);
  }, "add");
  for (const raw of events) {
    if (!raw || typeof raw !== "object") {
      at.push(-2);
      counted.push(false);
      continue;
    }
    const e = raw;
    const d = e.d && typeof e.d === "object" ? e.d : {};
    const run = typeof e.r === "string" && HEX.test(e.r) ? e.r : null;
    switch (e.t) {
      case "view":
        add(null);
        break;
      case "start": {
        const cfg = typeof d.cfg === "string" && known.has(d.cfg) ? d.cfg : "builtin";
        const ev = typeof d.ev === "string" && /^[\w-]{1,40}$/.test(d.ev) ? d.ev : null;
        add(run ? ["INSERT OR IGNORE INTO runs (run, visit, ts, dev, ver, cfg, ev) VALUES (?, ?, ?, ?, ?, ?, ?)", run, visit, now, dev, ver, cfg, ev] : null);
        if (!run) at[at.length - 1] = -2;
        break;
      }
      case "mile": {
        const i = typeof e.k === "string" ? MILES.indexOf(Number(e.k)) : -1;
        if (run && i >= 0) add(["UPDATE runs SET miles = miles | ? WHERE run = ? AND visit = ?", 1 << i, run, visit]);
        else {
          at.push(-2);
          counted.push(false);
        }
        break;
      }
      case "seen":
      case "taken": {
        const key = typeof e.k === "string" && /^[\w@#.-]{1,30}$/.test(e.k) ? e.k : null;
        const type = typeof d.type === "string" && TYPES.has(d.type) ? d.type : null;
        const s = int(d.s, 0, 5e6);
        if (run && key && type && s !== null) {
          add([`INSERT OR IGNORE INTO pickups (run, k, type, seen_s, taken, ts) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM runs WHERE run = ? AND visit = ?) AND (SELECT COUNT(*) FROM pickups WHERE run = ?) < ${MAX_PICKUPS_PER_RUN}`, run, key, type, s, e.t === "taken" ? 1 : 0, now, run, visit, run]);
          if (e.t === "taken") {
            stmts.push(["UPDATE pickups SET taken = 1 WHERE run = ? AND k = ? AND taken = 0 AND EXISTS (SELECT 1 FROM runs WHERE run = ? AND visit = ?)", run, key, run, visit]);
          }
        } else {
          at.push(-2);
          counted.push(false);
        }
        break;
      }
      case "end": {
        const dist = int(d.dist, 0, 5e6);
        const reason = typeof d.reason === "string" && REASONS.has(d.reason) ? d.reason : null;
        const cause = typeof d.cause === "string" && CAUSES.has(d.cause) ? d.cause : null;
        if (run && dist !== null && reason) add(["UPDATE runs SET end_ts = ?, end_dist = ?, end_reason = ?, cause = ? WHERE run = ? AND visit = ? AND end_ts IS NULL", now, dist, reason, cause, run, visit]);
        else {
          at.push(-2);
          counted.push(false);
        }
        break;
      }
      default:
        at.push(-2);
        counted.push(false);
    }
  }
  const changes = await db.batch(stmts);
  for (const i of at) {
    if (i === -2) res.ignored++;
    else if (i === -1) res.accepted++;
    else if (changes[i] > 0) res.accepted++;
    else res.ignored++;
  }
  void counted;
  return res;
}
__name(ingest, "ingest");
__name2(ingest, "ingest");
var enc = new TextEncoder();
var b64 = /* @__PURE__ */ __name2((u) => {
  let s = "";
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s);
}, "b64");
var unb64 = /* @__PURE__ */ __name2((s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)), "unb64");
var hex = /* @__PURE__ */ __name2((u) => Array.from(new Uint8Array(u), (b) => b.toString(16).padStart(2, "0")).join(""), "hex");
var randomBytes = /* @__PURE__ */ __name2((n) => crypto.getRandomValues(new Uint8Array(n)), "randomBytes");
var randomToken = /* @__PURE__ */ __name2((n = 32) => b64(randomBytes(n)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "randomToken");
var sha256Hex = /* @__PURE__ */ __name2(async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s))), "sha256Hex");
function safeEqual(a, b) {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
__name(safeEqual, "safeEqual");
__name2(safeEqual, "safeEqual");
var PBKDF2_ITER = 1e5;
async function pbkdf2(password, salt, iter, len = 32) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, len * 8));
}
__name(pbkdf2, "pbkdf2");
__name2(pbkdf2, "pbkdf2");
async function hashPassword(password) {
  const salt = randomBytes(16);
  return `pbkdf2-sha256$${PBKDF2_ITER}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITER))}`;
}
__name(hashPassword, "hashPassword");
__name2(hashPassword, "hashPassword");
async function verifyPassword(password, stored) {
  const m = /^pbkdf2-sha256\$(\d{1,7})\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(stored.trim());
  if (!m || Number(m[1]) > 1e5) return false;
  try {
    const want = unb64(m[3]);
    const got = await pbkdf2(password, unb64(m[2]), Number(m[1]), want.length);
    return safeEqual(b64(got), b64(want));
  } catch {
    return false;
  }
}
__name(verifyPassword, "verifyPassword");
__name2(verifyPassword, "verifyPassword");
var DUMMY_HASH = "pbkdf2-sha256$100000$" + "A".repeat(22) + "==$" + "A".repeat(43) + "=";
async function aesKey(secret) {
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode("gsc:" + secret)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
__name(aesKey, "aesKey");
__name2(aesKey, "aesKey");
async function seal(secret, text) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(text)));
  return `${b64(iv)}.${b64(ct)}`;
}
__name(seal, "seal");
__name2(seal, "seal");
async function unseal(secret, blob) {
  try {
    const [iv, ct] = blob.split(".").map(unb64);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(secret), ct));
  } catch {
    return null;
  }
}
__name(unseal, "unseal");
__name2(unseal, "unseal");
var MIN_PASSWORD = 12;
function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) return `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`;
  if (pw.length > 200) return "Das Passwort ist zu lang (h\xF6chstens 200 Zeichen).";
  if (/^(.)\1+$/.test(pw)) return "Das Passwort darf nicht nur aus einem wiederholten Zeichen bestehen.";
  return null;
}
__name(passwordProblem, "passwordProblem");
__name2(passwordProblem, "passwordProblem");
async function effectiveHash(db, envHash) {
  const envFp = envHash ? await sha256Hex(envHash) : "";
  const row = await db.get("SELECT pw_hash, env_fp, updated_at FROM admin WHERE id = 1");
  if (row && row.env_fp === envFp) return { hash: row.pw_hash, fp: await sha256Hex(`${row.pw_hash}|${row.updated_at}`) };
  if (envHash) return { hash: envHash, fp: await sha256Hex(envHash) };
  return { hash: null, fp: "" };
}
__name(effectiveHash, "effectiveHash");
__name2(effectiveHash, "effectiveHash");
async function setPassword(db, envHash, password, now) {
  const p = passwordProblem(password);
  if (p) throw new Error(p);
  const envFp = envHash ? await sha256Hex(envHash) : "";
  await db.run("INSERT INTO admin (id, pw_hash, env_fp, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET pw_hash = excluded.pw_hash, env_fp = excluded.env_fp, updated_at = excluded.updated_at", await hashPassword(password), envFp, now);
  await db.run("UPDATE sessions SET revoked = 1");
}
__name(setPassword, "setPassword");
__name2(setPassword, "setPassword");
async function checkPassword(db, envHash, password) {
  const e = await effectiveHash(db, envHash);
  if (!e.hash) {
    await verifyPassword(password, DUMMY_HASH);
    return { ok: false, configured: false, fp: "" };
  }
  return { ok: await verifyPassword(password, e.hash), configured: true, fp: e.fp };
}
__name(checkPassword, "checkPassword");
__name2(checkPassword, "checkPassword");
async function createSession(db, now, o, ua, fp) {
  const token = randomToken(32), csrf = randomToken(24);
  const id = await sha256Hex(token);
  await db.run("INSERT INTO sessions (id, csrf, pwfp, created_at, last_seen, expires_at, revoked, ua) VALUES (?, ?, ?, ?, ?, ?, 0, ?)", id, csrf, fp, now, now, now + o.idleMs, ua.slice(0, 160));
  return { token, session: { id, csrf, createdAt: now } };
}
__name(createSession, "createSession");
__name2(createSession, "createSession");
async function findSession(db, envHash, token, now, o) {
  if (!token || token.length < 20 || token.length > 200) return null;
  const r = await db.get("SELECT id, csrf, pwfp, created_at, last_seen, expires_at, revoked FROM sessions WHERE id = ?", await sha256Hex(token));
  if (!r || r.revoked || now > r.expires_at || now > r.created_at + o.absoluteMs) return null;
  if ((await effectiveHash(db, envHash)).fp !== r.pwfp) return null;
  if (now - r.last_seen > 6e4) await db.run("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?", now, Math.min(now + o.idleMs, r.created_at + o.absoluteMs), r.id);
  return { id: r.id, csrf: r.csrf, createdAt: r.created_at };
}
__name(findSession, "findSession");
__name2(findSession, "findSession");
var revokeSession = /* @__PURE__ */ __name2(async (db, id) => {
  await db.run("UPDATE sessions SET revoked = 1 WHERE id = ?", id);
}, "revokeSession");
var DbLimiter = class {
  static {
    __name(this, "DbLimiter");
  }
  constructor(db, max, windowMs) {
    this.db = db;
    this.max = max;
    this.windowMs = windowMs;
  }
  db;
  max;
  windowMs;
  static {
    __name2(this, "DbLimiter");
  }
  async count(key, now) {
    const r = await this.db.get("SELECT COUNT(*) AS n, MIN(ts) AS o FROM attempts WHERE k = ? AND ts > ?", key, now - this.windowMs);
    return { n: r?.n ?? 0, oldest: r?.o ?? now };
  }
  async blocked(key, now) {
    return (await this.count(key, now)).n >= this.max;
  }
  async hit(key, now) {
    await this.db.run("INSERT INTO attempts (k, ts) VALUES (?, ?)", key, now);
  }
  async retryAfter(key, now) {
    const c = await this.count(key, now);
    return Math.max(1, Math.ceil((c.oldest + this.windowMs - now) / 1e3));
  }
  async reset(key) {
    await this.db.run("DELETE FROM attempts WHERE k = ?", key);
  }
};
var Limiter = class {
  static {
    __name(this, "Limiter");
  }
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
  }
  max;
  windowMs;
  static {
    __name2(this, "Limiter");
  }
  hits = /* @__PURE__ */ new Map();
  hit(key, now) {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 5e3) {
      for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    }
    return true;
  }
};
function d1Db(d1) {
  const st = /* @__PURE__ */ __name2((sql, args) => d1.prepare(sql).bind(...args), "st");
  return {
    async all(sql, ...args) {
      return (await st(sql, args).all()).results;
    },
    async get(sql, ...args) {
      return await st(sql, args).first() ?? void 0;
    },
    async run(sql, ...args) {
      const r = await st(sql, args).run();
      return { changes: r.meta.changes, lastId: r.meta.last_row_id };
    },
    async batch(stmts) {
      return (await d1.batch(stmts.map(([sql, ...a]) => st(sql, a)))).map((r) => r.meta.changes);
    }
  };
}
__name(d1Db, "d1Db");
__name2(d1Db, "d1Db");
var SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK (id = 1), pw_hash TEXT NOT NULL, env_fp TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, pwfp TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, ua TEXT)`,
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS config_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, config TEXT NOT NULL, label TEXT, published_at INTEGER NOT NULL, event_start INTEGER, event_end INTEGER)`,
  `CREATE TABLE IF NOT EXISTS visits (visit TEXT PRIMARY KEY, ts INTEGER NOT NULL, dev TEXT NOT NULL, ver TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS visits_ts ON visits (ts)`,
  `CREATE TABLE IF NOT EXISTS runs (run TEXT PRIMARY KEY, visit TEXT NOT NULL, ts INTEGER NOT NULL, dev TEXT NOT NULL, ver TEXT NOT NULL, cfg TEXT NOT NULL, ev TEXT, miles INTEGER NOT NULL DEFAULT 0, end_ts INTEGER, end_dist INTEGER, end_reason TEXT, cause TEXT)`,
  `CREATE INDEX IF NOT EXISTS runs_ts ON runs (ts)`,
  `CREATE INDEX IF NOT EXISTS runs_visit ON runs (visit)`,
  `CREATE TABLE IF NOT EXISTS pickups (run TEXT NOT NULL, k TEXT NOT NULL, type TEXT NOT NULL, seen_s INTEGER NOT NULL, taken INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL, PRIMARY KEY (run, k))`,
  `CREATE INDEX IF NOT EXISTS pickups_ts ON pickups (ts)`,
  `CREATE TABLE IF NOT EXISTS attempts (k TEXT NOT NULL, ts INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS attempts_k ON attempts (k, ts)`
];
var ready = /* @__PURE__ */ new WeakSet();
async function ensureSchema(db, key) {
  if (ready.has(key)) return;
  await db.batch(SCHEMA.map((s) => [s]));
  ready.add(key);
}
__name(ensureSchema, "ensureSchema");
__name2(ensureSchema, "ensureSchema");
var kvGet = /* @__PURE__ */ __name2(async (db, key) => (await db.get("SELECT value FROM kv WHERE key = ?", key))?.value ?? null, "kvGet");
var kvSet = /* @__PURE__ */ __name2(async (db, key, value) => {
  await db.run("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
}, "kvSet");
var kvDel = /* @__PURE__ */ __name2(async (db, key) => {
  await db.run("DELETE FROM kv WHERE key = ?", key);
}, "kvDel");
async function purge(db, now, days) {
  const cutoff = now - days * 864e5;
  await db.batch([
    ["DELETE FROM pickups WHERE run IN (SELECT run FROM runs WHERE ts < ?)", cutoff],
    ["DELETE FROM runs WHERE ts < ?", cutoff],
    ["DELETE FROM visits WHERE ts < ?", cutoff],
    ["DELETE FROM sessions WHERE expires_at < ? OR revoked = 1", now - 864e5],
    ["DELETE FROM attempts WHERE ts < ?", now - 864e5]
  ]);
}
__name(purge, "purge");
__name2(purge, "purge");
function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
__name(createRng, "createRng");
__name2(createRng, "createRng");
var PICKUP_TYPES = ["shield", "slow", "clear", "magnet", "glide", "boost", "guide"];
var KINDS = {
  taxi: { w: 1.85, len: 4.6, moving: true },
  cabrio: { w: 1.8, len: 4.1, moving: true },
  sedan: { w: 1.9, len: 4.8, moving: true },
  truck: { w: 2.45, len: 10, moving: true },
  baken: { w: 0.9, len: 0.9, moving: false },
  barrier: { w: 2.6, len: 0.7, moving: false }
};
var laneX = /* @__PURE__ */ __name2((i) => (i - 1) * BALANCE.road.laneWidth, "laneX");
var laneOf = /* @__PURE__ */ __name2((x) => Math.max(0, Math.min(2, Math.round(x / BALANCE.road.laneWidth) + 1)), "laneOf");
var XM = BALANCE.player.maxX;
var MIN_WIDTH = 0.25;
function normalize2(iv) {
  const s = iv.filter((i) => i[1] - i[0] >= MIN_WIDTH).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const i of s) {
    const last = out[out.length - 1];
    if (last && i[0] <= last[1]) last[1] = Math.max(last[1], i[1]);
    else out.push([i[0], i[1]]);
  }
  return out;
}
__name(normalize2, "normalize2");
__name2(normalize2, "normalize");
function expand(reach, d) {
  return normalize2(reach.map(([a, b]) => [Math.max(-XM, a - d), Math.min(XM, b + d)]));
}
__name(expand, "expand");
__name2(expand, "expand");
function subtract(reach, l, r) {
  const out = [];
  for (const [a, b] of reach) {
    if (r <= a || l >= b) out.push([a, b]);
    else {
      if (l > a) out.push([a, l]);
      if (r < b) out.push([r, b]);
    }
  }
  return normalize2(out);
}
__name(subtract, "subtract");
__name2(subtract, "subtract");
function checkChain(reach, sEnd, gates, vFast) {
  let cur = reach.map((i) => [i[0], i[1]]);
  let end = sEnd;
  const sorted2 = [...gates].sort((a, b) => a.sa - b.sa);
  for (const g of sorted2) {
    const dt = Math.max(0, g.sa - end) / vFast;
    const e = Math.max(0, dt - BALANCE.gen.react);
    const d = BALANCE.gen.reachEff * steerAt(vFast * 3.6).vKey * Math.min(1, BALANCE.steer.sens.key, BALANCE.steer.sens.touch) * e;
    cur = subtract(expand(cur, d), g.l, g.r);
    if (cur.length === 0) return { ok: false, reach: cur, sEnd: end };
    end = Math.max(end, g.sb);
  }
  return { ok: true, reach: cur, sEnd: end };
}
__name(checkChain, "checkChain");
__name2(checkChain, "checkChain");
var GROUP_KINDS = { fast: ["taxi", "cabrio"], mid: ["sedan", "cabrio"], slow: ["truck", "truck", "sedan"] };
var groupV = /* @__PURE__ */ __name2((g) => BALANCE.traffic[g] / 3.6, "groupV");
var statics = /* @__PURE__ */ __name2(() => [BALANCE.traffic.baken ? "baken" : null, BALANCE.traffic.barrier ? "barrier" : null].filter(Boolean), "statics");
var W = /* @__PURE__ */ __name2((k) => BALANCE.traffic.weights[k] ?? 1, "W");
var groupWeight = /* @__PURE__ */ __name2((g) => GROUP_KINDS[g].reduce((a, k) => a + W(k), 0) / GROUP_KINDS[g].length, "groupWeight");
var GROUP_BASE = { fast: 0.4, mid: 0.35, slow: 0.25 };
var Generator = class {
  static {
    __name(this, "Generator");
  }
  constructor(seed, opts = {}) {
    this.opts = opts;
    this.rng = createRng(seed ^ 2654435769);
    this.origin = opts.startS ?? 0;
    this.sEnd = this.origin;
    this.lastEnd = this.origin;
    this.nextPickupT = this.range(BALANCE.gen.pickupFirst) / this.freq();
  }
  opts;
  static {
    __name2(this, "Generator");
  }
  rng;
  reach = [[-XM, XM]];
  sEnd;
  lastEnd;
  origin;
  encounters = 0;
  nextPickupT;
  queue = [];
  lastType = null;
  pickupCount = 0;
  /** Das erste Angebot jedes Versuchs ist Fliegen (ab 550 m nach dem ersten Ausweichmanöver). */
  firstDone = false;
  log = [];
  /** Angebotshäufigkeit (≥ 0,05); 0 ist „aus“ und wird vor dem Aufruf abgefangen. */
  freq() {
    return Math.max(0.05, BALANCE.pickups.freq);
  }
  pickupGap() {
    return this.range(BALANCE.gen.pickupEvery) / this.freq();
  }
  /** Erster Ausweichmoment nach ≈ 3 s; bei Einstieg mit hohem Tempo (QA) mindestens 2,6 s Vorlauf. */
  firstAnchorDist() {
    return Math.max(BALANCE.start.firstAnchor, 2.6 * speedAtDist(this.origin) / 3.6);
  }
  range(r) {
    return r[0] + (r[1] - r[0]) * this.rng();
  }
  int(n) {
    return Math.min(n - 1, Math.floor(this.rng() * n));
  }
  /** Erzeugt Begegnungen, bis der Horizont gefüllt ist. */
  update(w) {
    let guard2 = 0;
    const hz = Math.max(BALANCE.gen.horizon, BALANCE.gen.horizonSec * speedAtDist(w.s) / 3.6);
    while (this.nextAnchor(w) - w.s < hz && guard2++ < 6) this.spawn(w);
  }
  nextAnchor(w) {
    if (this.encounters === 0) return this.origin + this.firstAnchorDist();
    return this.lastEnd + this.gapDist(w, this.lastEnd);
  }
  /** Zeit und Tempo bis zum Streckenmeter anchor – dieselbe Tempokurve wie die Simulation. */
  plan(w, anchor) {
    const dist = Math.max(0, anchor - w.s);
    const vNow = speedAtDist(w.s) / 3.6;
    const T = travelTime(w.s, anchor);
    const tArr = w.t + T;
    const vNom = speedAtDist(anchor) / 3.6;
    const vAvg = T > 1e-6 ? dist / T : vNow;
    const m = BALANCE.gen.speedMargin;
    return { tArr, vNom, vAvg, vFast: vNom * m, vAvgFast: vAvg * m };
  }
  gapDist(w, from) {
    const p = this.plan(w, from);
    return Math.max(BALANCE.gen.minGap, (BALANCE.gen.gapBase + BALANCE.gen.gapGain * Math.exp(-p.tArr / BALANCE.gen.gapTau)) / Math.max(0.2, BALANCE.gen.gapScale)) * p.vNom;
  }
  /** Muster nach Fahrzeit und Strecke: mit wachsender Distanz öfter zwei bis drei zusammenhängende Entscheidungen. */
  pickPattern(t, km) {
    const f = /* @__PURE__ */ __name2((x) => Math.max(0, Math.min(1, x)), "f");
    const opts = [["single", 45 * (1 - 0.7 * f(km / 8))], ["stagger", 40]];
    if (t >= 12) opts.push(["wall2", 25]);
    if (t >= 20) opts.push(["slalom", 25 + 25 * f(km / 4)]);
    if (t >= 35) opts.push(["weave", 20 + 45 * f(km / 6)]);
    if (km >= 3) opts.push(["chain", 15 + 45 * f((km - 3) / 12)]);
    const total = opts.reduce((acc, o) => acc + o[1], 0);
    let r = this.rng() * total;
    for (const [p, wgt] of opts) {
      if ((r -= wgt) < 0) return p;
    }
    return "single";
  }
  rowsFor(p) {
    const a = this.int(3);
    const b = (a + 1 + this.int(2)) % 3;
    const c = 3 - a - b;
    switch (p) {
      case "first":
        return [[1]];
      // Mitte blockiert: links und rechts sind frei
      case "single":
        return [[a]];
      case "wall2":
        return [[b, c]];
      case "stagger":
        return [[a], [b]];
      case "slalom": {
        const n = 3 + this.int(2);
        return Array.from({ length: n }, (_, i) => [i % 2 === 0 ? a : b]);
      }
      case "weave":
        return [[a, b], [b, c]];
      case "chain":
        return [[a, b], [b, c], [c, a]];
    }
  }
  laneClasses(w) {
    const cls = [null, null, null];
    const sorted2 = [...w.obstacles].filter((o) => !o.hit && o.z + 12 > w.s).sort((x, y) => x.z - y.z);
    for (const o of sorted2) {
      const v = o.vz * 3.6;
      cls[laneOf(o.x)] = !KINDS[o.kind].moving ? "static" : v >= (BALANCE.traffic.fast + BALANCE.traffic.mid) / 2 ? "fast" : v >= (BALANCE.traffic.mid + BALANCE.traffic.slow) / 2 ? "mid" : "slow";
    }
    return cls;
  }
  /** Tempoklasse nach Gewicht der Fahrzeugtypen; null, wenn alle beweglichen Typen auf 0 stehen. */
  pickGroup() {
    const gs = ["fast", "mid", "slow"];
    const ws = gs.map((g) => GROUP_BASE[g] * groupWeight(g));
    const total = ws.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let r = this.rng() * total;
    for (let i = 0; i < 3; i++) {
      if ((r -= ws[i]) < 0) return gs[i];
    }
    return "slow";
  }
  pickKind(kinds) {
    const ws = kinds.map(W);
    const total = ws.reduce((a, b) => a + b, 0);
    if (total <= 0) return kinds[this.int(kinds.length)];
    let r = this.rng() * total;
    for (let i = 0; i < kinds.length; i++) {
      if ((r -= ws[i]) < 0) return kinds[i];
    }
    return kinds[kinds.length - 1];
  }
  pickClass(pat) {
    const st = statics();
    if (pat === "first") return st.length ? "static" : this.pickGroup() ?? "static";
    const wantStatic = this.rng() >= 0.65;
    if (wantStatic && st.length) return "static";
    return this.pickGroup() ?? "static";
  }
  build(w, pat, anchor) {
    const p = this.plan(w, anchor);
    const rowGap = (BALANCE.gen.rowBase + BALANCE.gen.rowGain * Math.exp(-p.tArr / BALANCE.gen.rowTau)) * p.vNom * (pat === "slalom" ? 0.95 : 1);
    const rows = this.rowsFor(pat);
    const cls = this.laneClasses(w);
    const L = BALANCE.player.len;
    const objs = [];
    const gates = [];
    const used = /* @__PURE__ */ new Set();
    let bad = false;
    rows.forEach((lanes, ri) => {
      const off = ri * rowGap;
      for (const lane of lanes) {
        used.add(lane);
        if (cls[lane] === null) cls[lane] = this.pickClass(pat);
        const lc = cls[lane];
        const st = statics();
        const kinds = lc === "static" ? st.length ? st : ["baken"] : GROUP_KINDS[lc];
        const kind = lc === "static" ? kinds[this.int(kinds.length)] : this.pickKind(kinds);
        const def = KINDS[kind];
        const x = laneX(lane);
        const half = def.w / 2 + BALANCE.player.width / 2 + BALANCE.gen.blockMargin;
        const saN = anchor + off;
        if (lc === "static") {
          objs.push({ lane, kind, z: saN, vz: 0, gate: gates.length });
          gates.push({ sa: saN - 3, sb: saN + L + def.len + 3, l: x - half, r: x + half });
        } else {
          const vo = groupV(lc);
          const s0 = w.s;
          const oz0 = (saN * (p.vAvg - vo) + vo * s0) / p.vAvg;
          if (oz0 < s0 + 15) {
            bad = true;
            return;
          }
          const span = L + def.len;
          const saF = oz0 + vo * (oz0 - s0) / (p.vAvgFast - vo);
          const sbN = saN + span * p.vAvg / (p.vAvg - vo);
          const sbF = saF + span * p.vAvgFast / (p.vAvgFast - vo);
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
  spawn(w) {
    const first = this.encounters === 0;
    const base = first ? this.origin + this.firstAnchorDist() : this.lastEnd;
    const gapFor = /* @__PURE__ */ __name2((a) => first ? 0 : this.gapDist(w, a), "gapFor");
    const gap0 = gapFor(base);
    const tries = [];
    if (first) tries.push({ pat: "first", mult: 1 });
    else {
      const tArr = this.plan(w, base + gap0).tArr;
      const km = (base + gap0) / 1e3;
      const pats = [this.pickPattern(tArr, km), this.pickPattern(tArr, km), "single"];
      if (this.firstDone && this.queue.length === 0) this.refillQueue();
      const mults = this.firstDone && tArr >= this.nextPickupT && this.queue[0] === "magnet" ? [1.9, 2.4, 3.5] : BALANCE.gen.mults;
      for (const m of mults) for (const pat2 of pats) tries.push({ pat: pat2, mult: m });
      tries.push({ pat: "single", mult: 5 }, { pat: "single", mult: 8 });
    }
    let accepted = null;
    for (const tr of tries) {
      const anchor2 = first ? base : base + gap0 * tr.mult;
      const c2 = this.build(w, tr.pat, anchor2);
      if (!c2) continue;
      const r2 = checkChain(this.reach, this.sEnd, c2.gates, this.plan(w, anchor2).vFast);
      if (r2.ok) {
        accepted = { c: c2, r: r2, pat: tr.pat, mult: tr.mult, anchor: anchor2 };
        break;
      }
    }
    if (!accepted) {
      const anchor2 = base + gap0 * 10;
      this.reach = [[-XM, XM]];
      this.sEnd = anchor2 - 400;
      const c2 = this.build(w, "single", anchor2);
      accepted = { c: c2, r: checkChain(this.reach, this.sEnd, c2.gates, this.plan(w, anchor2).vFast), pat: "single", mult: 10, anchor: anchor2 };
    }
    const { c, pat, mult, anchor } = accepted;
    let r = accepted.r;
    for (const o of c.objs) {
      w.obstacles.push({ id: w.nextId++, kind: o.kind, x: laneX(o.lane), z: o.z, vz: o.vz, hit: false, knockT: 0, knockVx: 0 });
    }
    const pk2 = this.placePickup(w, c, anchor);
    if (pk2) r = pk2;
    this.reach = r.reach;
    this.sEnd = r.sEnd;
    this.lastEnd = c.endA;
    this.encounters++;
    if (this.opts.record) this.log.push({ pattern: pat, mult, fallback: mult >= 5, anchor, gates: c.gates });
  }
  /** Gemischte Reihenfolge aller vier Typen; nie derselbe Typ direkt hintereinander. */
  refillQueue() {
    const all = [];
    for (const t of [...PICKUP_TYPES.filter((x) => x !== "glide"), "glide"]) {
      if (!BALANCE.pickups.on[t]) continue;
      const sh = Math.max(0, BALANCE.pickups.share[t] + (t === "glide" ? BALANCE.pickups.glideBoost : 0));
      const frac = sh - Math.floor(sh);
      const n = Math.floor(sh) + (frac > 1e-9 && this.rng() < frac ? 1 : 0);
      for (let i = 0; i < n; i++) all.push(t);
    }
    for (let i = all.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [all[i], all[j]] = [all[j], all[i]];
    }
    if (all.length > 1 && all[0] === this.lastType) {
      const k = all.findIndex((t) => t !== this.lastType);
      if (k > 0) [all[0], all[k]] = [all[k], all[0]];
    }
    this.queue = all;
  }
  /**
   * Erstes Angebot jedes Versuchs: Fliegen als Tor über alle drei Spuren (kein Verfehlen durch die Spurwahl),
   * ab 550 m vor einer Begegnung, nur wenn alle Spuren dort frei sind.
   */
  placeFirstGlide(w, c, anchor) {
    const p = this.plan(w, anchor);
    const first = Math.min(...c.gates.map((g) => g.sa));
    const zp = first - 1.3 * p.vNom;
    if (zp < this.origin + BALANCE.glide.firstFrom || zp < this.sEnd + 6 || zp < w.s + 40) return null;
    if ([0, 1, 2].some((l) => w.obstacles.some((o) => !o.hit && laneOf(o.x) === l && Math.abs(o.z - zp) < 25))) return null;
    const r = checkChain(this.reach, this.sEnd, c.gates, p.vFast);
    if (!r.ok) return null;
    for (const lane of [0, 1, 2]) w.pickups.push({ id: w.nextId++, type: "glide", x: laneX(lane), z: zp, taken: false });
    this.firstDone = true;
    this.lastType = "glide";
    this.pickupCount++;
    this.nextPickupT = this.plan(w, zp).tArr + this.pickupGap();
    return r;
  }
  /** Zwangstore, die den Wagen an einer Pickup-Position in dessen Sammelbreite halten. */
  must(zp, x) {
    return [
      { sa: zp, sb: zp, l: -XM - 1, r: x - 0.9 },
      { sa: zp, sb: zp, l: x + 0.9, r: XM + 1 }
    ];
  }
  /**
   * Setzt höchstens ein Power-up vor die neue Begegnung. Der Weg über den Pickup (Umweg) muss anfahrbar und
   * danach weiter lösbar sein; der einfache Weg ist durch die ohnehin geprüfte Kette gesichert.
   * - Spurblitz: nur in einer Spur, in der innerhalb von 90 m ein Hindernis folgt.
   * - Magnetfeld: mit einem Folge-Pickup (Impulsschild oder Zeitblase) in der Nachbarspur, den der Magnet anzieht.
   * Liefert den Erreichbarkeitszustand nach dem Einsammeln oder null.
   */
  placePickup(w, c, anchor) {
    if (this.encounters < 1 || BALANCE.pickups.freq <= 0) return null;
    if (!this.firstDone) {
      if (BALANCE.pickups.on.glide && BALANCE.pickups.share.glide + BALANCE.pickups.glideBoost > 0) return this.placeFirstGlide(w, c, anchor);
      this.firstDone = true;
    }
    const p = this.plan(w, anchor);
    const first = Math.min(...c.gates.map((g) => g.sa));
    if (this.firstDone && this.queue.length === 0) this.refillQueue();
    const blockedNear = /* @__PURE__ */ __name2((lane, z) => w.obstacles.some((o) => !o.hit && laneOf(o.x) === lane && Math.abs(o.z - z) < 25), "blockedNear");
    const order = this.firstDone ? this.queue : ["glide"];
    for (let qi = 0; qi < order.length; qi++) {
      const type = order[qi];
      const lanes = [0, 1, 2];
      for (let i = lanes.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
      }
      for (const lane of lanes) {
        let zp = first - 1.3 * p.vNom;
        let musts = [];
        let extra = null;
        const x = laneX(lane);
        if (type === "clear") {
          if (!c.usedLanes.has(lane)) continue;
        } else if (type === "glide" && this.firstDone && this.plan(w, first).tArr < BALANCE.glide.minT) continue;
        else if (type === "magnet") {
          zp = first - 2 * p.vNom;
          const nb = [lane - 1, lane + 1].filter((l) => l >= 0 && l <= 2);
          const nl = nb[this.int(nb.length)];
          const zb = first - 0.8 * p.vNom;
          if (blockedNear(nl, zb)) continue;
          const helpers = ["shield", "slow"].filter((t) => BALANCE.pickups.on[t]);
          if (helpers.length === 0) continue;
          extra = { type: helpers[this.int(helpers.length)], lane: nl, z: zb };
          musts = [...this.must(zp, x), ...this.must(zb, laneX(nl))];
        }
        if (zp < this.sEnd + 6 || zp < w.s + 40) continue;
        if (!this.firstDone ? zp < this.origin + BALANCE.glide.firstFrom : this.plan(w, zp).tArr < this.nextPickupT) continue;
        if (blockedNear(lane, zp)) continue;
        if (musts.length === 0) musts = this.must(zp, x);
        const r = checkChain(this.reach, this.sEnd, [...musts, ...c.gates], p.vFast);
        if (!r.ok) continue;
        if (extra) {
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
};
function analyze(input, seeds = [11, 23, 37, 59]) {
  const cfg = normalize(input);
  applyConfig(cfg, false);
  const issues = [];
  const samples = [];
  const dist = cfg.tempo.distToMaxKm;
  for (const km of [0, Math.round(dist * 0.35), dist + 3]) {
    const startS = km * 1e3;
    let enc2 = 0, fb = 0;
    const SPAN = 1500;
    for (const seed of seeds) {
      const g = new Generator(seed, { record: true, startS });
      const w = { s: startS, t: 0, obstacles: [], pickups: [], nextId: 1 };
      while (w.s < startS + SPAN) {
        const dt = travelTime(w.s, w.s + 20);
        for (const o of w.obstacles) o.z += o.vz * dt;
        w.s += 20;
        w.t += dt;
        g.update(w);
        w.obstacles = w.obstacles.filter((o) => o.z > w.s - 40);
      }
      for (const e of g.log) {
        if (e.anchor < startS + SPAN) {
          enc2++;
          if (e.mult >= 1.7) fb++;
        }
      }
    }
    const kmh = speedAtDist(startS);
    const vKey = steerAt(kmh).vKey * Math.min(1, cfg.controls.key, cfg.controls.touch);
    const laneChangeS = BALANCE.road.laneWidth / (BALANCE.gen.reachEff * vKey) + 0.12;
    const t = startS > 0 ? travelTime(0, startS) : 0;
    samples.push({
      km,
      kmh,
      perKm: enc2 / (seeds.length * SPAN / 1e3),
      fallback: enc2 ? fb / enc2 : 0,
      laneChangeS,
      rowGapS: BALANCE.gen.rowBase + BALANCE.gen.rowGain * Math.exp(-t / BALANCE.gen.rowTau)
    });
  }
  const worst = Math.max(...samples.map((s) => s.fallback));
  const hardest = samples.reduce((a, b) => b.laneChangeS / b.rowGapS > a.laneChangeS / a.rowGapS ? b : a);
  if (worst > 0.5) issues.push({ path: "tempo.density", level: "error", msg: `Bei dieser Dichte zieht der Generator ${(worst * 100).toFixed(0)} % der Begegnungen auseinander, weil sie sonst nicht erreichbar w\xE4ren. Dichte senken, Mindestabstand erh\xF6hen oder Empfindlichkeit anheben.` });
  else if (worst > 0.2) issues.push({ path: "tempo.density", level: "warn", msg: `Hohe Dichte: ${(worst * 100).toFixed(0)} % der Begegnungen werden aus Fairness-Gr\xFCnden auseinandergezogen \u2013 die wirksame Dichte ist niedriger als eingestellt.` });
  if (hardest.laneChangeS > 0.6) issues.push({ path: Math.min(cfg.controls.key, cfg.controls.touch) < 1 ? cfg.controls.key <= cfg.controls.touch ? "controls.key" : "controls.touch" : "tempo.maxKmh", level: hardest.laneChangeS > 0.75 ? "error" : "warn", msg: `Ein Spurwechsel dauert bei ${Math.round(hardest.kmh)} km/h und dieser Empfindlichkeit ${hardest.laneChangeS.toFixed(2)} s.` });
  if (hardest.laneChangeS * 2 > hardest.rowGapS) issues.push({ path: "traffic.minGap", level: "warn", msg: `Zwei Spurwechsel (${(hardest.laneChangeS * 2).toFixed(2)} s) passen kaum in den Reihenabstand (${hardest.rowGapS.toFixed(2)} s).` });
  return { samples, issues };
}
__name(analyze, "analyze");
__name2(analyze, "analyze");
var rowToVersion = /* @__PURE__ */ __name2((r) => ({ id: r.id, label: r.label, publishedAt: r.published_at, eventStart: r.event_start, eventEnd: r.event_end, config: normalize(JSON.parse(r.config)) }), "rowToVersion");
async function listVersions(db, limit = 50) {
  return (await db.all("SELECT * FROM config_versions ORDER BY id DESC LIMIT ?", limit)).map(rowToVersion);
}
__name(listVersions, "listVersions");
__name2(listVersions, "listVersions");
async function getVersion(db, id) {
  const r = await db.get("SELECT * FROM config_versions WHERE id = ?", id);
  return r ? rowToVersion(r) : null;
}
__name(getVersion, "getVersion");
__name2(getVersion, "getVersion");
async function currentVersion(db) {
  const id = await kvGet(db, "current_version");
  return id ? getVersion(db, Number(id)) : null;
}
__name(currentVersion, "currentVersion");
__name2(currentVersion, "currentVersion");
async function getDraft(db) {
  const raw = await kvGet(db, "draft");
  if (raw) return normalize(JSON.parse(raw));
  return clone((await currentVersion(db))?.config ?? DEFAULT_CONFIG);
}
__name(getDraft, "getDraft");
__name2(getDraft, "getDraft");
async function saveDraft(db, cfg) {
  const n = normalize(cfg);
  await kvSet(db, "draft", JSON.stringify(n));
  return n;
}
__name(saveDraft, "saveDraft");
__name2(saveDraft, "saveDraft");
function activeEvent(v, now) {
  if (!v || !v.config.event.on || v.eventEnd === null || v.eventStart === null || now >= v.eventEnd || now < v.eventStart) return null;
  return { id: `flugwoche-${v.eventStart}`, endsAt: v.eventEnd };
}
__name(activeEvent, "activeEvent");
__name2(activeEvent, "activeEvent");
async function publicConfig(db, now) {
  const v = await currentVersion(db);
  if (!v) return { id: "builtin", config: DEFAULT_CONFIG, event: null };
  return { id: String(v.id), config: v.config, event: activeEvent(v, now) };
}
__name(publicConfig, "publicConfig");
__name2(publicConfig, "publicConfig");
function check(cfg) {
  const issues = validate(cfg);
  const analysis = analyze(cfg);
  const all = [...issues, ...analysis.issues];
  return { issues: all, analysis, blocking: all.filter((i) => i.level === "error") };
}
__name(check, "check");
__name2(check, "check");
async function publish(db, now, label) {
  const draft = await getDraft(db);
  const c = check(draft);
  if (c.blocking.length) return { ok: false, blocking: c.blocking };
  const prev = await currentVersion(db);
  let evStart = null, evEnd = null;
  if (draft.event.on) {
    const same = prev && prev.config.event.on && activeEvent(prev, now) && prev.config.event.glideBoost === draft.event.glideBoost && prev.config.event.days === draft.event.days;
    if (same && prev) {
      evStart = prev.eventStart;
      evEnd = prev.eventEnd;
    } else {
      evStart = now;
      evEnd = now + draft.event.days * 864e5;
    }
  }
  const r = await db.run("INSERT INTO config_versions (config, label, published_at, event_start, event_end) VALUES (?, ?, ?, ?, ?)", JSON.stringify(draft), label ? label.slice(0, 80) : null, now, evStart, evEnd);
  await kvSet(db, "current_version", String(r.lastId));
  return { ok: true, version: await getVersion(db, r.lastId) };
}
__name(publish, "publish");
__name2(publish, "publish");
async function draftDiff(db) {
  return diffConfigs((await currentVersion(db))?.config ?? DEFAULT_CONFIG, await getDraft(db));
}
__name(draftDiff, "draftDiff");
__name2(draftDiff, "draftDiff");
async function isDirty(db) {
  return (await draftDiff(db)).length > 0;
}
__name(isDirty, "isDirty");
__name2(isDirty, "isDirty");
var REACH = [1e3, 5e3, 15e3, 2e4, 27e3];
var PERIOD_MS = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5 };
var pct = /* @__PURE__ */ __name2((num3, den) => ({ num: num3, den, value: den > 0 ? num3 / den : null }), "pct");
function runWhere(f, alias = "r") {
  const a = [f.from, f.to];
  let sql = `${alias}.ts >= ? AND ${alias}.ts < ?`;
  if (f.dev) {
    sql += ` AND ${alias}.dev = ?`;
    a.push(f.dev);
  }
  if (f.ver) {
    sql += ` AND ${alias}.ver = ?`;
    a.push(f.ver);
  }
  if (f.ev === "event") sql += ` AND ${alias}.ev IS NOT NULL`;
  if (f.ev === "regular") sql += ` AND ${alias}.ev IS NULL`;
  if (f.cfg) {
    sql += ` AND ${alias}.cfg = ?`;
    a.push(f.cfg);
  }
  return { sql, args: a };
}
__name(runWhere, "runWhere");
__name2(runWhere, "runWhere");
var sorted = /* @__PURE__ */ __name2((xs) => [...xs].sort((a, b) => a - b), "sorted");
function percentile(xs, p) {
  if (!xs.length) return null;
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p / 100 * s.length) - 1))];
}
__name(percentile, "percentile");
__name2(percentile, "percentile");
async function runMetrics(db, f) {
  const w = runWhere(f);
  const runs = await db.all(`SELECT r.run, r.visit, r.ev, r.miles, r.end_ts, r.end_dist, r.end_reason, r.cause FROM runs r WHERE ${w.sql}`, ...w.args);
  const n = runs.length;
  const perVisit = /* @__PURE__ */ new Map();
  for (const r of runs) perVisit.set(r.visit, (perVisit.get(r.visit) ?? 0) + 1);
  const twice = [...perVisit.values()].filter((c) => c >= 2).length;
  const ends = runs.filter((r) => r.end_ts !== null && r.end_dist !== null);
  const dists = ends.map((r) => r.end_dist);
  const reach = REACH.map((at, i) => {
    const count = runs.filter((r) => (r.miles & 1 << i) !== 0 || (r.end_dist ?? 0) >= at).length;
    return { at, count, share: n > 0 ? count / n : null };
  });
  const crashes = runs.filter((r) => r.end_reason === "crash" && r.end_dist !== null);
  const bins = [];
  for (let k = 0; k < 30; k++) bins.push({ from: k * 1e3, to: (k + 1) * 1e3, count: 0 });
  bins.push({ from: 3e4, to: null, count: 0 });
  for (const c of crashes) bins[Math.min(30, Math.floor(c.end_dist / 1e3))].count++;
  const causes = /* @__PURE__ */ new Map();
  for (const c of crashes) causes.set(c.cause ?? "unbekannt", (causes.get(c.cause ?? "unbekannt") ?? 0) + 1);
  const byReason = {};
  for (const r of ends) byReason[r.end_reason ?? "?"] = (byReason[r.end_reason ?? "?"] ?? 0) + 1;
  const pw = runWhere(f, "r");
  const pk2 = await db.all(`SELECT p.type AS type, COUNT(*) AS seen, SUM(p.taken) AS taken FROM pickups p JOIN runs r ON r.run = p.run WHERE ${pw.sql} GROUP BY p.type`, ...pw.args);
  const gf = await db.all(`SELECT MIN(p.seen_s) AS s FROM pickups p JOIN runs r ON r.run = p.run WHERE p.type = 'glide' AND ${pw.sql} GROUP BY p.run`, ...pw.args);
  const types = ["shield", "slow", "clear", "magnet", "glide", "boost", "guide"];
  return {
    runs: n,
    eventRuns: runs.filter((r) => r.ev !== null).length,
    repeat: pct(twice, perVisit.size),
    withEnd: ends.length,
    noEnd: n - ends.length,
    dist: { median: percentile(dists, 50), p90: percentile(dists, 90), n: dists.length },
    reach,
    crash: { n: crashes.length, bins, causes: [...causes].map(([cause, count]) => ({ cause, count })).sort((a, b) => b.count - a.count).slice(0, 6), byReason },
    pickups: types.map((t) => {
      const x = pk2.find((p) => p.type === t);
      const seen = x?.seen ?? 0, taken = x?.taken ?? 0;
      return { type: t, seen, taken, rate: seen > 0 ? taken / seen : null };
    }),
    glideFirst: { median: percentile(gf.map((g) => g.s), 50), n: gf.length }
  };
}
__name(runMetrics, "runMetrics");
__name2(runMetrics, "runMetrics");
async function cards(db, f, rm) {
  const runLevelOnly = !!f.cfg || f.ev && f.ev !== "all";
  if (runLevelOnly) return { views: null, runs: rm.runs, startRate: null, repeatRate: rm.repeat, medianDist: { value: rm.dist.median, n: rm.dist.n } };
  const a = [f.from, f.to];
  let vsql = "v.ts >= ? AND v.ts < ?";
  if (f.dev) {
    vsql += " AND v.dev = ?";
    a.push(f.dev);
  }
  if (f.ver) {
    vsql += " AND v.ver = ?";
    a.push(f.ver);
  }
  const views = (await db.get(`SELECT COUNT(*) AS n FROM visits v WHERE ${vsql}`, ...a)).n;
  const counts = await db.all(`SELECT COUNT(*) AS c FROM runs r JOIN visits v ON v.visit = r.visit WHERE ${vsql} GROUP BY r.visit`, ...a);
  const withRun = counts.length, twice = counts.filter((c) => c.c >= 2).length;
  return { views, runs: rm.runs, startRate: pct(withRun, views), repeatRate: pct(twice, withRun), medianDist: { value: rm.dist.median, n: rm.dist.n } };
}
__name(cards, "cards");
__name2(cards, "cards");
async function series(db, f, buckets) {
  const w = runWhere(f);
  const step = (f.to - f.from) / buckets;
  const rows = await db.all(`SELECT CAST((r.ts - ?) / ? AS INTEGER) AS b, COUNT(*) AS n FROM runs r WHERE ${w.sql} GROUP BY b`, f.from, step, ...w.args);
  const out = new Array(buckets).fill(0);
  for (const r of rows) if (r.b >= 0 && r.b < buckets) out[r.b] = r.n;
  return out;
}
__name(series, "series");
__name2(series, "series");
async function overview(db, period, now, extra) {
  const len = PERIOD_MS[period];
  const cur = { ...extra, from: now - len, to: now + 1 };
  const prev = { ...extra, from: now - 2 * len, to: now - len };
  const rm = await runMetrics(db, cur), pm = await runMetrics(db, prev);
  const buckets = period === "24h" ? 24 : period === "7d" ? 7 : 30;
  const stepMs = len / buckets;
  const first = (await db.get("SELECT MIN(ts) AS t FROM visits")).t;
  const publishes = await db.all("SELECT id, published_at AS ts, label FROM config_versions WHERE published_at >= ? AND published_at < ? ORDER BY id", cur.from, cur.to);
  const events = await db.all('SELECT id, event_start AS "from", event_end AS "to" FROM config_versions WHERE event_start IS NOT NULL AND event_end IS NOT NULL AND event_end > ? AND event_start < ? ORDER BY id', cur.from, cur.to);
  const versions = (await db.all("SELECT DISTINCT ver FROM visits ORDER BY ver")).map((r) => r.ver);
  const configs = await db.all("SELECT id, published_at AS publishedAt, label FROM config_versions ORDER BY id DESC LIMIT 30");
  return {
    period,
    from: cur.from,
    to: cur.to,
    step: period === "24h" ? "hour" : "day",
    coverage: { status: first === null ? "nodata" : first > cur.from ? "partial" : "ok", firstEventAt: first },
    cards: await cards(db, cur, rm),
    prevCards: await cards(db, prev, pm),
    metrics: rm,
    prevMetrics: pm,
    series: { labels: Array.from({ length: buckets }, (_, i) => Math.round(cur.from + i * stepMs)), cur: await series(db, cur, buckets), prev: await series(db, prev, buckets) },
    markers: { publishes, events },
    filters: { versions, configs }
  };
}
__name(overview, "overview");
__name2(overview, "overview");
async function compare(db, period, now, a, b, extra) {
  const len = PERIOD_MS[period];
  const base = { ...extra, from: now - len, to: now + 1 };
  return { a: await runMetrics(db, { ...base, cfg: a }), b: await runMetrics(db, { ...base, cfg: b }) };
}
__name(compare, "compare");
__name2(compare, "compare");
var isPrivate = /* @__PURE__ */ __name2((ip) => {
  if (ip === "::1" || ip === "::" || /^f[cd]/i.test(ip) || /^fe80/i.test(ip)) return true;
  const m = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127;
}, "isPrivate");
async function guard(url, o) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Nur http(s)-Adressen sind erlaubt.");
  if (o.allowLocal || o.allowHosts.includes(url.host)) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":") || isPrivate(host)) throw new Error("Diese Adresse zeigt auf ein privates Netz und wird nicht gepr\xFCft.");
}
__name(guard, "guard");
__name2(guard, "guard");
async function get(urlStr, o, method = "GET", maxBytes = 1e6) {
  const f = o.fetchImpl ?? fetch;
  let url = new URL(urlStr);
  const chain = [];
  for (let i = 0; i < 6; i++) {
    await guard(url, o);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6e3);
    try {
      const r = await f(url, { method, redirect: "manual", signal: ctl.signal, headers: { "user-agent": "SunsetSidewaysSeoCheck/1.0", accept: "text/html,application/xml,text/plain,image/*;q=0.8" } });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
        chain.push(`${r.status} ${url.href}`);
        url = new URL(r.headers.get("location"), url);
        continue;
      }
      let body = "";
      if (method === "GET" && r.body) {
        const ct = r.headers.get("content-type") ?? "";
        if (/text|xml|json/i.test(ct)) {
          const reader = r.body.getReader();
          let got = 0;
          const parts = [];
          for (; ; ) {
            const { done, value } = await reader.read();
            if (done) break;
            got += value.length;
            parts.push(value);
            if (got > maxBytes) {
              void reader.cancel();
              break;
            }
          }
          body = Buffer.concat(parts).toString("utf8");
        } else void r.body.cancel();
      }
      return { status: r.status, headers: r.headers, body, url: url.href, chain };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Zu viele Weiterleitungen.");
}
__name(get, "get");
__name2(get, "get");
var attr = /* @__PURE__ */ __name2((tag, name) => {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? "").trim() : null;
}, "attr");
var metas = /* @__PURE__ */ __name2((html) => {
  const out = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = attr(m[0], "name") ?? attr(m[0], "property");
    const content = attr(m[0], "content");
    if (key && content !== null) out.push({ key: key.toLowerCase(), content });
  }
  return out;
}, "metas");
var decode = /* @__PURE__ */ __name2((s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"), "decode");
var stripTags = /* @__PURE__ */ __name2((s) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(), "stripTags");
var norm = /* @__PURE__ */ __name2((u) => u.replace(/\/+$/, "").toLowerCase(), "norm");
async function checkSite(originIn, o) {
  const origin = new URL(originIn).origin;
  const checks = [];
  const add = /* @__PURE__ */ __name2((id, label, status, found, fix) => {
    checks.push({ id, label, status, found, fix });
  }, "add");
  const now = (o.now ?? Date.now)();
  let page = null;
  try {
    page = await get(origin + "/", o);
  } catch (e) {
    add("http", "Startseite erreichbar", "fail", e.message, "Domain, DNS, HTTPS-Zertifikat und Server pr\xFCfen; die Startseite muss ohne Anmeldung mit Status 200 antworten.");
    return finish(origin, now, null, checks);
  }
  const html = page.body;
  const hop = page.chain.length ? ` (nach ${page.chain.length} Weiterleitung${page.chain.length > 1 ? "en" : ""}: ${page.chain.join(" \u2192 ")})` : "";
  add(
    "http",
    "HTTP-Status der Startseite",
    page.status === 200 ? page.chain.length > 1 ? "warn" : "ok" : "fail",
    `Status ${page.status}${hop}`,
    page.status === 200 ? page.chain.length > 1 ? "Mehrere Weiterleitungen nacheinander vermeiden \u2013 h\xF6chstens eine (z. B. http \u2192 https)." : "-" : "Die Startseite muss mit Status 200 antworten. Fehlerursache im Server-Log suchen."
  );
  const isHttps = new URL(page.url).protocol === "https:";
  const local = /^(localhost|127\.|\[::1\])/.test(new URL(page.url).host);
  add("https", "HTTPS", isHttps ? "ok" : local ? "info" : "fail", isHttps ? "Seite wird \xFCber HTTPS ausgeliefert." : local ? "Lokale Adresse \xFCber HTTP \u2013 f\xFCr den Test in Ordnung." : "Seite wird unverschl\xFCsselt (HTTP) ausgeliefert.", "Ein Zertifikat einrichten (z. B. Caddy oder Let's Encrypt) und HTTP auf HTTPS weiterleiten.");
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const t = title ? stripTags(title[1]) : "";
  add("title", "Seitentitel (title)", !t ? "fail" : t.length < 10 || t.length > 65 ? "warn" : "ok", t ? `\u201E${t}\u201C (${t.length} Zeichen)` : "Kein Titel gefunden.", !t ? "<title> im <head> der Startseite erg\xE4nzen, 10\u201360 Zeichen mit Spielname und Kernaussage." : t.length < 10 ? "Titel auf 10\u201360 Zeichen erweitern." : t.length > 65 ? "Titel auf h\xF6chstens 60 Zeichen k\xFCrzen, sonst wird er in der Suche abgeschnitten." : "-");
  const ms = metas(html);
  const desc = ms.find((m) => m.key === "description")?.content ?? "";
  add("description", "Meta-Beschreibung", !desc ? "fail" : desc.length < 70 || desc.length > 165 ? "warn" : "ok", desc ? `\u201E${desc.slice(0, 120)}${desc.length > 120 ? "\u2026" : ""}\u201C (${desc.length} Zeichen)` : "Keine Meta-Beschreibung gefunden.", !desc ? '<meta name="description" content="\u2026"> mit 70\u2013160 Zeichen erg\xE4nzen.' : desc.length < 70 ? "Beschreibung auf 70\u2013160 Zeichen erweitern." : desc.length > 165 ? "Beschreibung auf h\xF6chstens 160 Zeichen k\xFCrzen." : "-");
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1]));
  add("h1", "Haupt\xFCberschrift (H1)", h1s.length === 1 ? "ok" : "fail", h1s.length ? `${h1s.length}\xD7 H1: \u201E${h1s[0]}\u201C` : "Keine H1 im ausgelieferten HTML.", h1s.length === 0 ? "Genau eine <h1> mit dem Spielnamen im HTML der Startseite erg\xE4nzen." : h1s.length > 1 ? "Nur eine <h1> je Seite verwenden." : "-");
  const lang = /<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i.exec(html)?.[1] ?? "";
  add("lang", "Sprache (html lang)", lang ? "ok" : "fail", lang ? `lang="${lang}"` : "Kein lang-Attribut am <html>-Element.", '<html lang="de"> setzen.');
  const canon = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(html);
  const canonHref = canon ? attr(canon[0], "href") : null;
  const pageUrl = origin + "/";
  add("canonical", "Canonical-Link", !canonHref ? "fail" : norm(canonHref) === norm(pageUrl) ? "ok" : "warn", canonHref ? `canonical \u2192 ${canonHref}` : "Kein canonical-Link gefunden.", !canonHref ? `<link rel="canonical" href="${pageUrl}"> im <head> erg\xE4nzen.` : norm(canonHref) === norm(pageUrl) ? "-" : `Canonical zeigt auf eine andere Adresse als ${pageUrl}. Setze die Umgebungsvariable PUBLIC_ORIGIN auf die \xF6ffentliche Adresse.`);
  const robotsMeta = ms.find((m) => m.key === "robots")?.content ?? "";
  const xrobots = page.headers.get("x-robots-tag") ?? "";
  const noindex = /noindex/i.test(robotsMeta) || /noindex/i.test(xrobots);
  add("indexable", "Indexierbarkeit", noindex ? "fail" : "ok", noindex ? `noindex gesetzt (${robotsMeta || xrobots})` : "Keine Sperre per meta robots oder X-Robots-Tag.", "noindex von der \xF6ffentlichen Startseite entfernen.");
  add("viewport", "Mobile Darstellung (viewport)", ms.some((m) => m.key === "viewport") ? "ok" : "fail", ms.some((m) => m.key === "viewport") ? "viewport-Meta vorhanden." : "Kein viewport-Meta.", '<meta name="viewport" content="width=device-width, initial-scale=1"> erg\xE4nzen.');
  let sitemapUrl = origin + "/sitemap.xml";
  try {
    const r = await get(origin + "/robots.txt", o);
    const text = r.body;
    const blockAll = /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(\r?\n|$)/i.test(text) && !/^allow:\s*\/\s*$/im.test(text);
    const sm = /^sitemap:\s*(\S+)/im.exec(text)?.[1];
    if (sm) sitemapUrl = sm;
    add("robots", "robots.txt", r.status !== 200 ? "fail" : blockAll ? "fail" : sm ? "ok" : "warn", r.status !== 200 ? `Status ${r.status}` : blockAll ? "Disallow: / sperrt die ganze Seite." : sm ? `erreichbar, Sitemap: ${sm}` : "erreichbar, aber ohne Sitemap-Zeile.", r.status !== 200 ? "/robots.txt bereitstellen (der mitgelieferte Server tut das automatisch)." : blockAll ? "Disallow: / entfernen." : sm ? "-" : `Zeile \u201ESitemap: ${origin}/sitemap.xml\u201C erg\xE4nzen.`);
  } catch (e) {
    add("robots", "robots.txt", "fail", e.message, "/robots.txt bereitstellen.");
  }
  try {
    const r = await get(sitemapUrl, o);
    const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    const valid = r.status === 200 && /<urlset/i.test(r.body) && locs.length > 0;
    const hasStart = locs.some((l) => norm(l) === norm(pageUrl));
    const hasAdmin = locs.some((l) => /\/admin/i.test(l));
    add("sitemap", "Sitemap", !valid ? "fail" : !hasStart || hasAdmin ? "warn" : "ok", !valid ? `Status ${r.status}, keine g\xFCltige Sitemap` : `${locs.length} Adresse(n)${hasStart ? ", enth\xE4lt die Startseite" : ", Startseite fehlt"}${hasAdmin ? ", enth\xE4lt /admin!" : ", ohne /admin"}`, !valid ? `/sitemap.xml mit <urlset> und der Startseite ${pageUrl} bereitstellen.` : !hasStart ? `Startseite ${pageUrl} in die Sitemap aufnehmen.` : hasAdmin ? "/admin aus der Sitemap entfernen." : "-");
  } catch (e) {
    add("sitemap", "Sitemap", "fail", e.message, "/sitemap.xml bereitstellen.");
  }
  const og = /* @__PURE__ */ __name2((k) => ms.find((m) => m.key === k)?.content ?? "", "og");
  const missing = ["og:title", "og:description", "og:image", "og:url", "twitter:card"].filter((k) => !og(k));
  let imgNote = "";
  let imgOk = true;
  const img = og("og:image");
  if (img) {
    try {
      const r = await get(new URL(img, origin).href, o, "GET");
      imgOk = r.status === 200 && /^image\//i.test(r.headers.get("content-type") ?? "");
      imgNote = imgOk ? "Vorschaubild erreichbar." : `Vorschaubild nicht abrufbar (Status ${r.status}).`;
      if (!/^https?:\/\//i.test(img)) {
        imgOk = false;
        imgNote += " og:image muss eine absolute Adresse sein.";
      }
    } catch (e) {
      imgOk = false;
      imgNote = `Vorschaubild nicht abrufbar: ${e.message}`;
    }
  }
  add("social", "Social-Vorschau (Open Graph / Twitter)", missing.length || !imgOk ? missing.length > 2 || !img ? "fail" : "warn" : "ok", missing.length ? `Fehlend: ${missing.join(", ")}. ${imgNote}` : `Titel, Beschreibung, Bild und Karte vorhanden. ${imgNote}`, missing.length || !imgOk ? "Fehlende og:*-Tags und twitter:card im <head> erg\xE4nzen; das Bild (1200\xD7630) muss unter einer absoluten HTTPS-Adresse erreichbar sein." : "-");
  try {
    const r = await get(origin + "/admin", o);
    const ok = /noindex/i.test(r.headers.get("x-robots-tag") ?? "") && /no-store/i.test(r.headers.get("cache-control") ?? "") && (r.status === 200 || r.status === 401 || r.status === 403);
    add("admin", "Admin-Bereich nicht indexierbar", ok ? "ok" : "fail", `/admin: Status ${r.status}, X-Robots-Tag \u201E${r.headers.get("x-robots-tag") ?? "-"}\u201C, Cache-Control \u201E${r.headers.get("cache-control") ?? "-"}\u201C`, "Der Server muss /admin mit \u201EX-Robots-Tag: noindex, nofollow\u201C und \u201ECache-Control: no-store\u201C ausliefern.");
  } catch (e) {
    add("admin", "Admin-Bereich nicht indexierbar", "warn", e.message, "/admin pr\xFCfen.");
  }
  return finish(origin, now, page.url, checks);
}
__name(checkSite, "checkSite");
__name2(checkSite, "checkSite");
function finish(origin, checkedAt, finalUrl, checks) {
  const c = /* @__PURE__ */ __name2((s) => checks.filter((x) => x.status === s).length, "c");
  return { origin, checkedAt, finalUrl, checks, summary: { ok: c("ok"), warn: c("warn"), fail: c("fail") } };
}
__name(finish, "finish");
__name2(finish, "finish");
var gscAvailable = /* @__PURE__ */ __name2((e) => !!(e.clientId && e.clientSecret && e.appSecret), "gscAvailable");
var redirectUri = /* @__PURE__ */ __name2((e) => `${e.origin}/admin/api/gsc/callback`, "redirectUri");
function authUrl(e, state) {
  const p = new URLSearchParams({ client_id: e.clientId, redirect_uri: redirectUri(e), response_type: "code", scope: "https://www.googleapis.com/auth/webmasters.readonly", access_type: "offline", prompt: "consent", state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
__name(authUrl, "authUrl");
__name2(authUrl, "authUrl");
async function tokenCall(e, params, f) {
  const r = await f("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: e.clientId, client_secret: e.clientSecret, ...params }) });
  if (!r.ok) throw new Error(`Google-Anmeldung fehlgeschlagen (Status ${r.status}).`);
  return await r.json();
}
__name(tokenCall, "tokenCall");
__name2(tokenCall, "tokenCall");
async function connect(db, e, code, f = fetch) {
  const t = await tokenCall(e, { code, grant_type: "authorization_code", redirect_uri: redirectUri(e) }, f);
  if (!t.refresh_token) throw new Error("Google hat kein dauerhaftes Zugriffstoken geliefert (Zugriff erneut erteilen).");
  await kvSet(db, "gsc_token", await seal(e.appSecret, t.refresh_token));
  await kvDel(db, "gsc_site");
  await kvDel(db, "gsc_cache");
}
__name(connect, "connect");
__name2(connect, "connect");
var disconnect = /* @__PURE__ */ __name2(async (db) => {
  await kvDel(db, "gsc_token");
  await kvDel(db, "gsc_site");
  await kvDel(db, "gsc_cache");
}, "disconnect");
var isConnected = /* @__PURE__ */ __name2(async (db) => await kvGet(db, "gsc_token") !== null, "isConnected");
async function access(db, e, f) {
  const blob = await kvGet(db, "gsc_token");
  const refresh = blob && e.appSecret ? await unseal(e.appSecret, blob) : null;
  if (!refresh) throw new Error("Nicht mit der Search Console verbunden.");
  return (await tokenCall(e, { refresh_token: refresh, grant_type: "refresh_token" }, f)).access_token;
}
__name(access, "access");
__name2(access, "access");
async function listSites(db, e, f = fetch) {
  const at = await access(db, e, f);
  const r = await f("https://www.googleapis.com/webmasters/v3/sites", { headers: { authorization: `Bearer ${at}` } });
  if (!r.ok) throw new Error(`Seitenliste nicht abrufbar (Status ${r.status}).`);
  const j = await r.json();
  return (j.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
}
__name(listSites, "listSites");
__name2(listSites, "listSites");
var day = /* @__PURE__ */ __name2((t) => new Date(t).toISOString().slice(0, 10), "day");
async function fetchData(db, e, now, force = false, f = fetch) {
  const site = await kvGet(db, "gsc_site");
  if (!site) return null;
  const cached = await kvGet(db, "gsc_cache");
  if (cached && !force) {
    const c = JSON.parse(cached);
    if (c.site === site && now - c.fetchedAt < 6 * 36e5) return c;
  }
  const at = await access(db, e, f);
  const from = day(now - 31 * 864e5), to = day(now - 3 * 864e5);
  const q = /* @__PURE__ */ __name2(async (body) => {
    const r = await f(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, { method: "POST", headers: { authorization: `Bearer ${at}`, "content-type": "application/json" }, body: JSON.stringify({ startDate: from, endDate: to, ...body }) });
    if (!r.ok) throw new Error(`Search-Console-Abfrage fehlgeschlagen (Status ${r.status}).`);
    return await r.json();
  }, "q");
  const total = (await q({})).rows?.[0];
  const rows = (await q({ dimensions: ["query"], rowLimit: 10 })).rows ?? [];
  const data = {
    site,
    from,
    to,
    fetchedAt: now,
    totals: { impressions: total?.impressions ?? 0, clicks: total?.clicks ?? 0, ctr: total?.ctr ?? 0, position: total?.position ?? 0 },
    queries: rows.map((r) => ({ query: r.keys?.[0] ?? "", impressions: r.impressions, clicks: r.clicks, ctr: r.ctr, position: r.position }))
  };
  await kvSet(db, "gsc_cache", JSON.stringify(data));
  return data;
}
__name(fetchData, "fetchData");
__name2(fetchData, "fetchData");
var num2 = /* @__PURE__ */ __name2((v, d) => {
  const n = Number(v);
  return v !== void 0 && v !== "" && Number.isFinite(n) && n > 0 ? n : d;
}, "num");
var CSP_ADMIN = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
var PRIVATE = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "x-frame-options": "DENY", "content-security-policy": CSP_ADMIN, "x-content-type-options": "nosniff", "referrer-policy": "same-origin" };
var limiters = /* @__PURE__ */ new WeakMap();
var limitersFor = /* @__PURE__ */ __name2((k) => {
  let l = limiters.get(k);
  if (!l) {
    l = { ingest: new Limiter(120, 6e4), api: new Limiter(240, 6e4) };
    limiters.set(k, l);
  }
  return l;
}, "limitersFor");
function createHandler(d) {
  const { env, db } = d;
  const { ingest: ingestLim, api: apiLim } = limitersFor(d.schemaKey ?? db);
  const now = d.now ?? Date.now;
  const idleMs = num2(env.SESSION_IDLE_HOURS, 12) * 36e5;
  const sopts = { idleMs, absoluteMs: num2(env.SESSION_ABSOLUTE_DAYS, 7) * 864e5 };
  const retentionDays = num2(env.RETENTION_DAYS, 30);
  const loginFail = new DbLimiter(db, 8, 15 * 6e4), loginFailAll = new DbLimiter(db, 40, 15 * 6e4), pwFail = new DbLimiter(db, 5, 15 * 6e4);
  const ipOf = /* @__PURE__ */ __name2((req) => req.headers.get("cf-connecting-ip") ?? ((req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "lokal"), "ipOf");
  const urlOrigin = /* @__PURE__ */ __name2((u) => u.origin, "urlOrigin");
  const originOf = /* @__PURE__ */ __name2((u) => env.PUBLIC_ORIGIN ? new URL(env.PUBLIC_ORIGIN).origin : urlOrigin(u), "originOf");
  const respond = /* @__PURE__ */ __name2((status, body, headers = {}) => {
    const h = new Headers();
    for (const [k, v] of Object.entries(headers)) for (const x of Array.isArray(v) ? v : [v]) h.append(k, x);
    return new Response(body, { status, headers: h });
  }, "respond");
  const json = /* @__PURE__ */ __name2((status, data, extra = {}) => respond(status, JSON.stringify(data), { "content-type": "application/json; charset=utf-8", ...PRIVATE, ...extra }), "json");
  const publicJson = /* @__PURE__ */ __name2((status, data) => respond(status, JSON.stringify(data), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }), "publicJson");
  async function readJson(req, max = MAX_BODY) {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > max) throw Object.assign(new Error("Anfrage zu gro\xDF"), { status: 413 });
    const text = await req.text();
    if (text.length > max) throw Object.assign(new Error("Anfrage zu gro\xDF"), { status: 413 });
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw Object.assign(new Error("Ung\xFCltiges JSON"), { status: 400 });
    }
  }
  __name(readJson, "readJson");
  __name2(readJson, "readJson");
  const secureOf = /* @__PURE__ */ __name2((u) => u.protocol === "https:" || (env.PUBLIC_ORIGIN ?? "").startsWith("https://"), "secureOf");
  const cookieName = /* @__PURE__ */ __name2((u) => secureOf(u) ? "__Host-ssw_admin" : "ssw_admin", "cookieName");
  const cookieOf = /* @__PURE__ */ __name2((req, name) => {
    for (const part of (req.headers.get("cookie") ?? "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
    return void 0;
  }, "cookieOf");
  const setCookie = /* @__PURE__ */ __name2((u, token, maxAge) => `${cookieName(u)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureOf(u) ? "; Secure" : ""}`, "setCookie");
  const sessionOf = /* @__PURE__ */ __name2((req, u) => findSession(db, env.ADMIN_PASSWORD_HASH, cookieOf(req, cookieName(u)), now(), sopts), "sessionOf");
  const sameOrigin = /* @__PURE__ */ __name2((req, u) => {
    const o = req.headers.get("origin");
    return o === null || o === originOf(u) || o === urlOrigin(u);
  }, "sameOrigin");
  const isJson = /* @__PURE__ */ __name2((req) => /^application\/json\b/i.test(req.headers.get("content-type") ?? ""), "isJson");
  async function loginPage() {
    const nonce = randomToken(16);
    const configured = !!env.ADMIN_PASSWORD_HASH || !!await db.get("SELECT 1 AS x FROM admin WHERE id = 1");
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="dark light"><title>Anmeldung \xB7 Sunset Sideways</title>
<style nonce="${nonce}">:root{--bg:#0d1020;--card:#161a33;--ink:#eef0ff;--mut:#9aa1c9;--line:#2a3058;--acc:#ff5fa8;--acc2:#5fe0ff}@media (prefers-color-scheme:light){:root{--bg:#f2f3fa;--card:#fff;--ink:#16193a;--mut:#555b86;--line:#d6d9ee}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,Segoe UI,sans-serif}
main{width:min(420px,100%);background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 24px;box-shadow:0 0 40px rgba(95,224,255,.07)}
h1{margin:0 0 4px;font-size:1.35rem}p{margin:0 0 18px;color:var(--mut)}label{display:block;font-weight:600;margin-bottom:6px}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);font:inherit}
input:focus-visible,button:focus-visible{outline:3px solid var(--acc2);outline-offset:2px}
button{margin-top:16px;width:100%;padding:13px;border:0;border-radius:10px;font:inherit;font-weight:700;color:#10122a;background:linear-gradient(90deg,var(--acc),var(--acc2));cursor:pointer}
button[disabled]{opacity:.6;cursor:wait}#msg{min-height:1.5em;margin-top:12px;color:#ff8a8a}</style></head>
<body><main><h1>Sunset Sideways \xB7 Admin</h1><p>${configured ? "Bitte mit dem Admin-Passwort anmelden." : "Noch kein Passwort gesetzt. Siehe docs/DEPLOYMENT.md: ADMIN_PASSWORD_HASH setzen."}</p>
<form id="f" autocomplete="on"><label for="pw">Passwort</label><input id="pw" name="password" type="password" autocomplete="current-password" required ${configured ? "" : "disabled"} autofocus><button id="go" type="submit" ${configured ? "" : "disabled"}>Anmelden</button><div id="msg" role="alert" aria-live="polite"></div></form></main>
<script nonce="${nonce}">const f=document.getElementById('f'),m=document.getElementById('msg'),b=document.getElementById('go');f.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;m.textContent='';try{const r=await fetch('/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value}),credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(r.ok){location.replace('/admin');return}m.textContent=r.status===429?'Zu viele Versuche. Bitte in '+(j.retryAfter||15)+' Sekunden erneut versuchen.':(j.error||'Anmeldung fehlgeschlagen.')}catch{m.textContent='Server nicht erreichbar.'}b.disabled=false});<\/script></body></html>`;
    return respond(200, html, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "x-frame-options": "DENY", "x-content-type-options": "nosniff", "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` });
  }
  __name(loginPage, "loginPage");
  __name2(loginPage, "loginPage");
  const eventState = /* @__PURE__ */ __name2(async (t) => {
    const v = await currentVersion(db);
    if (!v || !v.config.event.on) return { state: "off", endsAt: null, remainingMs: 0, boost: 0 };
    const a = activeEvent(v, t);
    if (a) return { state: "active", endsAt: a.endsAt, remainingMs: a.endsAt - t, boost: v.config.event.glideBoost };
    return { state: "expired", endsAt: v.eventEnd, remainingMs: 0, boost: 0 };
  }, "eventState");
  async function stateBody(t) {
    const draft = await getDraft(db);
    const c = check(draft);
    const cur = await currentVersion(db);
    return {
      now: t,
      draft,
      issues: c.issues,
      analysis: c.analysis,
      defaults: DEFAULT_CONFIG,
      published: cur ? { id: cur.id, publishedAt: cur.publishedAt, label: cur.label, config: cur.config } : null,
      dirty: await isDirty(db),
      diff: await draftDiff(db),
      event: await eventState(t),
      versions: (await listVersions(db)).map((v) => ({ id: v.id, label: v.label, publishedAt: v.publishedAt, eventStart: v.eventStart, eventEnd: v.eventEnd, eventOn: v.config.event.on, profile: v.config.profile }))
    };
  }
  __name(stateBody, "stateBody");
  __name2(stateBody, "stateBody");
  const q1 = /* @__PURE__ */ __name2((u, k) => {
    const v = u.searchParams.get(k);
    return v && v !== "all" ? v : null;
  }, "q1");
  const periodOf = /* @__PURE__ */ __name2((u) => ["24h", "7d", "30d"].includes(u.searchParams.get("period") ?? "") ? u.searchParams.get("period") : "7d", "periodOf");
  const evOf = /* @__PURE__ */ __name2((u) => ["event", "regular"].includes(u.searchParams.get("ev") ?? "") ? u.searchParams.get("ev") : "all", "evOf");
  const gscEnv = /* @__PURE__ */ __name2((u) => ({ clientId: env.GSC_CLIENT_ID, clientSecret: env.GSC_CLIENT_SECRET, appSecret: env.APP_SECRET, origin: originOf(u) }), "gscEnv");
  const domainOf = /* @__PURE__ */ __name2(async (u) => await kvGet(db, "domain") ?? env.PUBLIC_ORIGIN ?? originOf(u), "domainOf");
  const seoOpts = /* @__PURE__ */ __name2((u) => ({ allowHosts: [u.host, ...env.PUBLIC_ORIGIN ? [new URL(env.PUBLIC_ORIGIN).host] : []], allowLocal: env.SEO_ALLOW_LOCAL === "1" || env.SEO_ALLOW_LOCAL === "true", fetchImpl: d.fetchImpl, now }), "seoOpts");
  async function adminApi(req, u) {
    const path = u.pathname.slice("/api/admin".length) || "/";
    const method = req.method;
    const t = now();
    if (path === "/login" && method === "POST") {
      if (!sameOrigin(req, u) || !isJson(req)) return json(403, { error: "Anfrage abgelehnt." });
      const ip = `login:${ipOf(req)}`;
      if (await loginFail.blocked(ip, t) || await loginFailAll.blocked("login:all", t)) {
        const ra = await loginFail.retryAfter(ip, t);
        return json(429, { error: "Zu viele Versuche.", retryAfter: ra }, { "retry-after": String(ra) });
      }
      const body = await readJson(req, 4096);
      if (typeof body.password !== "string" || body.password.length > 400) return json(400, { error: "Passwort fehlt." });
      const r = await checkPassword(db, env.ADMIN_PASSWORD_HASH, body.password);
      if (!r.configured) return json(503, { error: "Kein Passwort gesetzt (ADMIN_PASSWORD_HASH fehlt, siehe docs/DEPLOYMENT.md)." });
      if (!r.ok) {
        await loginFail.hit(ip, t);
        await loginFailAll.hit("login:all", t);
        return json(401, { error: "Anmeldung fehlgeschlagen." });
      }
      await loginFail.reset(ip);
      const { token, session } = await createSession(db, t, sopts, req.headers.get("user-agent") ?? "", r.fp);
      return json(200, { ok: true, csrf: session.csrf }, { "set-cookie": setCookie(u, token, Math.floor(idleMs / 1e3)) });
    }
    const s = await sessionOf(req, u);
    if (!s) return json(401, { error: "Nicht angemeldet." });
    if (!apiLim.hit(s.id, t)) return json(429, { error: "Zu viele Anfragen." });
    if (method !== "GET" && method !== "HEAD") {
      if (!sameOrigin(req, u)) return json(403, { error: "Herkunft nicht erlaubt." });
      if (!isJson(req)) return json(415, { error: "JSON erwartet." });
      if (!safeEqual(req.headers.get("x-csrf-token") ?? "", s.csrf)) return json(403, { error: "CSRF-Pr\xFCfung fehlgeschlagen." });
    }
    if (path === "/me" && method === "GET") return json(200, { ok: true, csrf: s.csrf });
    if (path === "/logout" && method === "POST") {
      await revokeSession(db, s.id);
      return json(200, { ok: true }, { "set-cookie": setCookie(u, "", 0) });
    }
    if (path === "/password" && method === "POST") {
      const b = await readJson(req, 4096);
      if (await pwFail.blocked("pw", t)) return json(429, { error: "Zu viele Versuche." });
      if (typeof b.current !== "string" || typeof b.next !== "string") return json(400, { error: "Angaben fehlen." });
      if (!(await checkPassword(db, env.ADMIN_PASSWORD_HASH, b.current)).ok) {
        await pwFail.hit("pw", t);
        return json(403, { error: "Das aktuelle Passwort stimmt nicht." });
      }
      const prob = passwordProblem(b.next);
      if (prob) return json(400, { error: prob });
      await setPassword(db, env.ADMIN_PASSWORD_HASH, b.next, t);
      return json(200, { ok: true, relogin: true }, { "set-cookie": setCookie(u, "", 0) });
    }
    if (path === "/settings" && method === "GET") return json(200, await stateBody(t));
    if (path === "/settings" && method === "PUT") {
      const b = await readJson(req);
      await saveDraft(db, b.config);
      return json(200, await stateBody(t));
    }
    if (path === "/check" && method === "POST") {
      const b = await readJson(req);
      const c = check(normalize(b.config));
      return json(200, { issues: c.issues, analysis: c.analysis });
    }
    if (path === "/settings/defaults" && method === "POST") {
      await saveDraft(db, clone(DEFAULT_CONFIG));
      return json(200, await stateBody(t));
    }
    if (path === "/settings/profile" && method === "POST") {
      const b = await readJson(req);
      if (b.profile !== "relaxed" && b.profile !== "arcade" && b.profile !== "hard") return json(400, { error: "Unbekanntes Profil." });
      await saveDraft(db, withProfile(await getDraft(db), b.profile));
      return json(200, await stateBody(t));
    }
    if (path === "/publish" && method === "POST") {
      const b = await readJson(req);
      const r = await publish(db, t, typeof b.label === "string" ? b.label : null);
      if (!r.ok) return json(409, { error: "Die Einstellungen enthalten Konflikte.", blocking: r.blocking });
      return json(200, { ok: true, version: r.version.id, state: await stateBody(t) });
    }
    if (path === "/restore" && method === "POST") {
      const b = await readJson(req);
      const v = typeof b.id === "number" ? await getVersion(db, b.id) : null;
      if (!v) return json(404, { error: "Version nicht gefunden." });
      await saveDraft(db, v.config);
      return json(200, await stateBody(t));
    }
    if (path === "/testdrive" && method === "POST") {
      const token = randomToken(18);
      await kvSet(db, `td:${token}`, String(t + 30 * 6e4));
      return json(200, { token, url: `${originOf(u)}/?testdrive=${token}`, expiresAt: t + 30 * 6e4 });
    }
    if (path === "/stats" && method === "GET") {
      if (d.wait) d.wait(purge(db, t, retentionDays).catch(() => void 0));
      return json(200, await overview(db, periodOf(u), t, { dev: q1(u, "dev"), ver: q1(u, "ver"), ev: evOf(u), cfg: q1(u, "cfg") }));
    }
    if (path === "/stats/compare" && method === "GET") {
      const a = q1(u, "a"), b = q1(u, "b");
      if (!a || !b) return json(400, { error: "Zwei Versionen angeben." });
      return json(200, { period: periodOf(u), ...await compare(db, periodOf(u), t, a, b, { dev: q1(u, "dev"), ver: q1(u, "ver"), ev: evOf(u) }) });
    }
    if (path === "/seo" && method === "GET") {
      const r = await kvGet(db, "seo_report");
      return json(200, { domain: await domainOf(u), publicOrigin: env.PUBLIC_ORIGIN ?? null, report: r ? JSON.parse(r) : null });
    }
    if (path === "/seo/check" && method === "POST") {
      const b = await readJson(req, 2048);
      let domain = await domainOf(u);
      if (typeof b.domain === "string" && b.domain.trim()) {
        try {
          const x = new URL(b.domain.trim());
          if (x.protocol !== "http:" && x.protocol !== "https:") throw new Error("x");
          domain = x.origin;
          await kvSet(db, "domain", domain);
        } catch {
          return json(400, { error: "Bitte eine vollst\xE4ndige Adresse wie https://www.sunsetsideways.com angeben." });
        }
      }
      try {
        const report = await checkSite(domain, seoOpts(u));
        await kvSet(db, "seo_report", JSON.stringify(report));
        return json(200, { domain, report });
      } catch (e) {
        return json(502, { error: e.message });
      }
    }
    if (path.startsWith("/gsc")) return gscApi(req, u, path, method, t);
    return json(404, { error: "Nicht gefunden." });
  }
  __name(adminApi, "adminApi");
  __name2(adminApi, "adminApi");
  async function gscApi(req, u, path, method, t) {
    const e = gscEnv(u);
    if (path === "/gsc" && method === "GET") {
      const connected = await isConnected(db);
      const base = { available: gscAvailable(e), connected, site: await kvGet(db, "gsc_site"), redirectUri: redirectUri(e) };
      if (!connected) return json(200, base);
      try {
        const sites = await listSites(db, e, d.fetchImpl);
        const data = base.site ? await fetchData(db, e, t, u.searchParams.get("force") === "1", d.fetchImpl) : null;
        return json(200, { ...base, sites, data });
      } catch (err) {
        return json(200, { ...base, error: err.message });
      }
    }
    if (path === "/gsc/connect" && method === "POST") {
      if (!gscAvailable(e)) return json(400, { error: "GSC_CLIENT_ID, GSC_CLIENT_SECRET und APP_SECRET sind nicht gesetzt." });
      const state = randomToken(18);
      await kvSet(db, "gsc_state", JSON.stringify({ h: await sha256Hex(state), exp: t + 10 * 6e4 }));
      return json(200, { url: authUrl(e, state) });
    }
    if (path === "/gsc/site" && method === "POST") {
      const b = await readJson(req, 2048);
      if (typeof b.site !== "string") return json(400, { error: "Property fehlt." });
      const sites = await listSites(db, e, d.fetchImpl).catch(() => []);
      if (!sites.some((x) => x.siteUrl === b.site)) return json(400, { error: "Diese Property ist nicht best\xE4tigt oder nicht verf\xFCgbar." });
      await kvSet(db, "gsc_site", b.site);
      await kvDel(db, "gsc_cache");
      return json(200, { ok: true });
    }
    if (path === "/gsc/disconnect" && method === "POST") {
      await disconnect(db);
      return json(200, { ok: true });
    }
    return json(404, { error: "Nicht gefunden." });
  }
  __name(gscApi, "gscApi");
  __name2(gscApi, "gscApi");
  async function privateAsset(path) {
    const r = d.assets ? await d.assets(path) : null;
    if (!r || !r.ok) return json(404, { error: "Nicht gefunden." });
    const h = new Headers(r.headers);
    for (const [k, v] of Object.entries(PRIVATE)) h.set(k, v);
    h.delete("etag");
    h.delete("last-modified");
    return new Response(r.body, { status: 200, headers: h });
  }
  __name(privateAsset, "privateAsset");
  __name2(privateAsset, "privateAsset");
  return async (req) => {
    const u = new URL(req.url);
    const p = u.pathname;
    const method = req.method;
    const t = now();
    const mine = p === "/admin" || p.startsWith("/admin/") || p.startsWith("/_admin/") || p.startsWith("/api/");
    if (!mine && p !== "/robots.txt" && p !== "/sitemap.xml") return null;
    if (p === "/api/health") return publicJson(200, { ok: true });
    await ensureSchema(db, d.schemaKey ?? db);
    if (p === "/api/admin/gsc/callback" && method === "GET") {
      const raw = await kvGet(db, "gsc_state");
      await kvDel(db, "gsc_state");
      const st = raw ? JSON.parse(raw) : null;
      const code = u.searchParams.get("code");
      const ok = !!st && st.exp > t && safeEqual(st.h, await sha256Hex(u.searchParams.get("state") ?? "")) && !!code;
      let msg = ok ? "gsc=ok" : "gsc=fehler";
      if (ok) {
        try {
          await connect(db, gscEnv(u), code, d.fetchImpl);
        } catch {
          msg = "gsc=fehler";
        }
      }
      return respond(302, null, { location: `/admin#seo?${msg}`, "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" });
    }
    if (p === "/api/admin" || p.startsWith("/api/admin/")) return adminApi(req, u);
    if (p === "/admin" || p.startsWith("/admin/") || p.startsWith("/_admin/")) {
      const s = await sessionOf(req, u);
      if (!s) {
        if (method !== "GET" && method !== "HEAD") return json(401, { error: "Nicht angemeldet." });
        return loginPage();
      }
      if (p.startsWith("/_admin/")) return privateAsset(p);
      return privateAsset("/_admin/");
    }
    if (p === "/api/config" && method === "GET") {
      const token = u.searchParams.get("preview");
      if (token) {
        const exp = /^[\w-]{8,64}$/.test(token) ? Number(await kvGet(db, `td:${token}`) ?? 0) : 0;
        if (!exp || exp < t) return publicJson(404, { error: "Testfahrt abgelaufen." });
        const dr = await getDraft(db);
        return publicJson(200, { id: "draft", config: dr, event: dr.event.on ? { id: "preview", endsAt: t + dr.event.days * 864e5 } : null });
      }
      return publicJson(200, await publicConfig(db, t));
    }
    if (p === "/api/e" && method === "POST") {
      if (!ingestLim.hit(ipOf(req), t)) return respond(429, null, { "retry-after": "30" });
      if (await sessionOf(req, u)) return respond(204, null);
      try {
        await ingest(db, await readJson(req), t);
      } catch (e) {
        const st = e.status;
        if (st) return respond(st, null);
      }
      if (d.wait && Math.random() < 0.01) d.wait(purge(db, t, retentionDays).catch(() => void 0));
      return respond(204, null);
    }
    if (p === "/robots.txt") return respond(200, `User-agent: *
Allow: /

Sitemap: ${originOf(u)}/sitemap.xml
`, { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" });
    if (p === "/sitemap.xml") return respond(200, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${originOf(u)}/</loc></url>
</urlset>
`, { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" });
    return publicJson(404, { error: "Nicht gefunden." });
  };
}
__name(createHandler, "createHandler");
__name2(createHandler, "createHandler");
var JSON_HEAD = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
var onRequest = /* @__PURE__ */ __name2(async (ctx) => {
  const { request, env } = ctx;
  if (!env.DB) {
    const p = new URL(request.url).pathname;
    if (p === "/api/health") return new Response('{"ok":true,"db":false}', { headers: JSON_HEAD });
    if (p === "/api/e") return new Response(null, { status: 204 });
    if (p === "/api/config") return new Response('{"error":"keine Datenbank"}', { status: 404, headers: JSON_HEAD });
    return new Response(JSON.stringify({ error: "D1-Datenbank \u201EDB\u201C ist nicht verbunden (siehe docs/DEPLOYMENT.md)." }), { status: 503, headers: { ...JSON_HEAD, "x-robots-tag": "noindex, nofollow" } });
  }
  const handler = createHandler({
    env,
    db: d1Db(env.DB),
    schemaKey: env.DB,
    assets: /* @__PURE__ */ __name2((path) => env.ASSETS.fetch(new Request(new URL(path, request.url).href)), "assets"),
    wait: /* @__PURE__ */ __name2((p) => ctx.waitUntil(p), "wait")
  });
  return await handler(request) ?? ctx.next();
}, "onRequest");
var routes = [
  {
    routePath: "/:path*",
    mountPath: "/",
    method: "",
    middlewares: [],
    modules: [onRequest]
  }
];
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
__name2(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name2(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name2(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name2(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name2(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name2(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
__name2(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
__name2(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode2 = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name2(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode2(value, key);
        });
      } else {
        params[key.name] = decode2(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
__name2(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
__name2(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
__name2(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
__name2(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
__name2(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
__name2(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
__name2(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");
__name2(pathToRegexp, "pathToRegexp");
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function getOriginalPathPrefix(requestPath, normalizedPrefix) {
  let end = 0;
  for (let index = 0; index < normalizedPrefix.length; index++) {
    end++;
    if (normalizedPrefix[index] === "/") {
      while (requestPath[end] === "/") {
        end++;
      }
    }
  }
  return requestPath.slice(0, end);
}
__name(getOriginalPathPrefix, "getOriginalPathPrefix");
__name2(getOriginalPathPrefix, "getOriginalPathPrefix");
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  const normalizedRequestPath = requestPath.replace(/\/+/g, "/");
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath) || routeMatcher(normalizedRequestPath);
    const originalMountMatch = mountMatcher(requestPath);
    const mountMatchResult = originalMountMatch || mountMatcher(normalizedRequestPath);
    if (matchResult && mountMatchResult) {
      const path = originalMountMatch ? originalMountMatch.path : getOriginalPathPrefix(requestPath, mountMatchResult.path);
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
__name2(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name2(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name2(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name2((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
var drainBody = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
__name2(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
__name2(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
__name2(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");
__name2(__facade_invoke__, "__facade_invoke__");
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  static {
    __name(this, "___Facade_ScheduledController__");
  }
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name2(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name2(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name2(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
__name2(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name2((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name2((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
__name2(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;

// ../../AppData/Local/npm-cache/_npx/c943b712072b77c4/node_modules/wrangler/templates/pages-dev-util.ts
function isRoutingRuleMatch(pathname, routingRule) {
  if (!pathname) {
    throw new Error("Pathname is undefined.");
  }
  if (!routingRule) {
    throw new Error("Routing rule is undefined.");
  }
  const ruleRegExp = transformRoutingRuleToRegExp(routingRule);
  return pathname.match(ruleRegExp) !== null;
}
__name(isRoutingRuleMatch, "isRoutingRuleMatch");
function transformRoutingRuleToRegExp(rule) {
  let transformedRule;
  if (rule === "/" || rule === "/*") {
    transformedRule = rule;
  } else if (rule.endsWith("/*")) {
    transformedRule = `${rule.substring(0, rule.length - 2)}(/*)?`;
  } else if (rule.endsWith("/")) {
    transformedRule = `${rule.substring(0, rule.length - 1)}(/)?`;
  } else if (rule.endsWith("*")) {
    transformedRule = rule;
  } else {
    transformedRule = `${rule}(/)?`;
  }
  transformedRule = `^${transformedRule.replaceAll(/\./g, "\\.").replaceAll(/\*/g, ".*")}$`;
  return new RegExp(transformedRule);
}
__name(transformRoutingRuleToRegExp, "transformRoutingRuleToRegExp");

// .wrangler/tmp/pages-KJ2lWG/iuwhvl66zb.js
var define_ROUTES_default = {
  version: 1,
  include: ["/api/*", "/admin", "/admin/*", "/_admin/*"],
  exclude: []
};
var routes2 = define_ROUTES_default;
var pages_dev_pipeline_default = {
  fetch(request, env, context) {
    const { pathname } = new URL(request.url);
    for (const exclude of routes2.exclude) {
      if (isRoutingRuleMatch(pathname, exclude)) {
        return env.ASSETS.fetch(request);
      }
    }
    for (const include of routes2.include) {
      if (isRoutingRuleMatch(pathname, include)) {
        const workerAsHandler = middleware_loader_entry_default;
        if (workerAsHandler.fetch === void 0) {
          throw new TypeError("Entry point missing `fetch` handler");
        }
        return workerAsHandler.fetch(request, env, context);
      }
    }
    return env.ASSETS.fetch(request);
  }
};

// ../../AppData/Local/npm-cache/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default2 = drainBody2;

// ../../AppData/Local/npm-cache/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError2(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError2(e.cause)
  };
}
__name(reduceError2, "reduceError");
var jsonError2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError2(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default2 = jsonError2;

// .wrangler/tmp/bundle-lmGdMg/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__2 = [
  middleware_ensure_req_body_drained_default2,
  middleware_miniflare3_json_error_default2
];
var middleware_insertion_facade_default2 = pages_dev_pipeline_default;

// ../../AppData/Local/npm-cache/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__2 = [];
function __facade_register__2(...args) {
  __facade_middleware__2.push(...args.flat());
}
__name(__facade_register__2, "__facade_register__");
function __facade_invokeChain__2(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__2(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__2, "__facade_invokeChain__");
function __facade_invoke__2(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__2(request, env, ctx, dispatch, [
    ...__facade_middleware__2,
    finalMiddleware
  ]);
}
__name(__facade_invoke__2, "__facade_invoke__");

// .wrangler/tmp/bundle-lmGdMg/middleware-loader.entry.ts
var __Facade_ScheduledController__2 = class ___Facade_ScheduledController__2 {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__2)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler2(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__2(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__2(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler2, "wrapExportedHandler");
function wrapWorkerEntrypoint2(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__2(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__2(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint2, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY2;
if (typeof middleware_insertion_facade_default2 === "object") {
  WRAPPED_ENTRY2 = wrapExportedHandler2(middleware_insertion_facade_default2);
} else if (typeof middleware_insertion_facade_default2 === "function") {
  WRAPPED_ENTRY2 = wrapWorkerEntrypoint2(middleware_insertion_facade_default2);
}
var middleware_loader_entry_default2 = WRAPPED_ENTRY2;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__2 as __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default2 as default
};
//# sourceMappingURL=iuwhvl66zb.js.map
