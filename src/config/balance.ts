/** Alle Balancingwerte an einer Stelle. Längen in Metern, Zeiten in Sekunden, Tempo in km/h. */
export const BALANCE = {
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
    knots: [[0, 210], [1000, 325], [2000, 370], [6000, 430], [12000, 480], [16000, 520], [20000, 550], [27000, 600]] as ReadonlyArray<readonly [number, number]>,
    slowFactor: 0.78, slowTau: 0.18,
    /** Phantom-Turbo: Tempofaktor und Ein-/Ausblendzeit. */
    boostFactor: 1.2, boostTau: 0.35,
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
    fast: { vKey: 44, tauUp: 0.018, tauStop: 0.022, vTouch: 85, tauTouch: 0.016, lag: 0.008 },
    vLo: 210, vHi: 600,
    /** Empfindlichkeit (Admin): Tastatur und Touch; skaliert Querzielgeschwindigkeit bzw. Fingerweg. Die Erreichbarkeitsprüfung rechnet mit dem kleineren Wert. */
    sens: { key: 1, touch: 1 },
  },
  /** Fingerweg in Bildbreiten → Meter (22 m je Bildbreite: ein Drittel Breite = Außenspur zu Außenspur), Totzone gegen Zittern; das Ziel bleibt nach dem Loslassen `settle` Sekunden bestehen. */
  touch: { deadPx: 8, mPerWidth: 22, settle: 0.8 },
  /** Erster klarer Ausweichmoment nach ≈ 3 s (175 m), Hindernis in der Mitte ⇒ zwei Ausweichwege. */
  start: { firstAnchor: 175 },
  /** Verkehrstempo je Tempoklasse in km/h (Lkw nur in der langsamen Klasse). */
  traffic: {
    fast: 58, mid: 48, slow: 36,
    /** Relative Häufigkeit der Fahrzeugtypen und Schalter der statischen Hindernisse (Admin). */
    weights: { taxi: 1, cabrio: 1, sedan: 1, truck: 1 },
    baken: true, barrier: true,
  },
  /** Power-up-Angebot (Admin): Gesamthäufigkeit, Schalter und relative Anteile je Typ, Event-Aufschlag für Fliegen. */
  pickups: {
    freq: 1,
    on: { shield: true, slow: true, clear: true, magnet: true, glide: true, boost: true, guide: true } as Record<string, boolean>,
    share: { shield: 1, slow: 1, clear: 1, magnet: 1, glide: 0.3, boost: 1, guide: 1 } as Record<string, number>,
    glideBoost: 0,
  },
  /** Kulisse nach Strecke (Admin): Lichtstützpunkte in Metern, Mondaufstieg, Neon-Intensität, Schalter. */
  scenery: { keys: [0, 15000, 17000, 20000] as number[], moonFrom: 17500, moonSpan: 13500, neon: 1, planes: true, peds: true, fountains: true },
  /** Standardpegel (Admin) für Musik, Motor, Effekte und Effekte; persönliche Einstellungen der Spieler haben Vorrang. */
  audio: { music: 1, engine: 1, sfx: 1 },
  /** Spurblitz: Reichweite und Zahl entfernter Hindernisse; Magnet: Reichweite der Anziehung. */
  powers: { blitzRange: 90, blitzMax: 2, magnetRange: 130 },
  /** Gleitflug: Abheben, Sinken und Flughöhe (m); Gesamtdauer effects.glide, der Rest ist Flug. */
  glide: { up: 0.5, down: 1.0, height: 4.2, minT: 25, /** erstes Fliegen-Angebot frühestens nach dieser Strecke (m) */ firstFrom: 550 },
  restartDelayMs: 450,
  /** Leichte Bögen, die automatisch mitgefahren werden. */
  curves: { firstStart: 300, firstLen: 260, firstK: 1 / 1100, minR: 650, varR: 550 },
  briefingSeconds: 1.7,
  gen: {
    /** Mindest-Vorlauf der erzeugten Begegnungen (m); bei hohem Tempo mindestens 2,3 s. */
    horizon: 300, horizonSec: 2.3,
    visibleDist: 220,
    gapBase: 1.25, gapGain: 1.1, gapTau: 80,
    /** Begegnungsdichte (Admin): Abstände werden mit 1 / Dichte skaliert. */
    gapScale: 1,
    /** Mindestabstand zwischen dichten Ausweichstellen (s Fahrzeit bei Nenntempo; Admin). */
    minGap: 0.6,
    rowBase: 1.0, rowGain: 0.45, rowTau: 90,
    /**
     * Konservative Erreichbarkeitsprüfung: nach `react` Sekunden Reaktionszeit wird seitlich mit
     * reachEff · steer.vKey verschoben.
     */
    react: 0.4, reachEff: 0.6, blockMargin: 0.45, speedMargin: 1.04,
    mults: [1, 1.3, 1.7, 2.4, 3.5],
    /** Erstes Power-up nach ≈ 6–9 s (Platzierung vor der nächsten Begegnung), danach alle 9–14 s. */
    pickupFirst: [4.6, 6.4], pickupEvery: [9, 14],
  },
} as const;
