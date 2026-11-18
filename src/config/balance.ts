/** Alle Balancingwerte an einer Stelle. Längen in Metern, Zeiten in Sekunden, Tempo in km/h. */
export const BALANCE = {
  /** Fester Simulationsschritt. */
  dt: 1 / 120,
  maxCatchUpSteps: 8,
  /** Lücken über dieser Dauer (ms) gelten als Unterbrechung ⇒ Pause. */
  stallMs: 250,
  /** Ab dieser Lückendauer (ms) wird automatisch pausiert; kürzere Lücken (> stallMs) werden still verworfen, ohne Weltzeit nachzuholen. */
  pauseStallMs: 1000,
  /**
   * Grundtempo nach der gefahrenen Strecke des Versuchs (Stützpunkte [Meter, km/h], dazwischen stetig interpoliert):
   * 210 → 325 (1 km) → 370 (2 km) → 430 (6 km) → 480 (12 km) → 520 (16 km) → 550 (20 km) → 600 (27 km), danach konstant.
   */
  speed: {
    knots: [[0, 210], [1000, 325], [2000, 370], [6000, 430], [12000, 480], [16000, 520], [20000, 550], [27000, 600]] as ReadonlyArray<readonly [number, number]>,
    slowFactor: 0.6, slowTau: 0.18,
    /** Phantom-Turbo: Tempofaktor und Ein-/Ausblendzeit. */
    boostFactor: 1.35, boostTau: 0.3,
  },
  /**
   * Dauer der Power-ups in aktiver Spielzeit (P1-Rebalancing). Spurblitz: gespeicherte Aktivierung – wirkt einmal, sobald in der
   * aktuellen Spur ein Hindernis in Reichweite kommt, und verfällt nach dieser Zeit.
   */
  effects: { shield: 15, slow: 3.5, magnet: 7, blitz: 5, glide: 3, boost: 2.25, guide: 5 },
  /**
   * P1: Near Miss, Combo und Neon Rush. Zeiten in aktiver Spielzeit (Sim-Zeit; Pause und Tab-Wechsel zählen nicht).
   * nearMiss: Gefahrenfenster `ttcMax` (s bis zum Zusammenstoß, ab dem eine Ausweichbewegung als knapp gilt), `courseMargin` (m seitlich über die
   * Hitboxen hinaus, die noch als Kollisionskurs gelten), `maxGap` (größter seitlicher Randabstand beim Passieren), `minShift` (m Querverschiebung durch Eingabe).
   */
  style: {
    nearMiss: { points: 100, ttcMax: 1.5, courseMargin: 0.35, maxGap: 2.4, minShift: 1.0 },
    combo: { window: 4, windowMagnet: 6, maxMult: 5 },
    rush: { chargePerMiss: 20, chargeSlow: 10, duration: 5, cooldown: 6, pointsMult: 2 },
    /** Zeitblase: Near-Miss-Punkte (einmal, in der zentralen Punkteberechnung). */
    slowPointsMult: 0.5,
  },
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
    /** Relative Anteile = Auswahlgewicht (P1: Schild 20 %, Zeitblase 18 %, Spurblitz 14 %, Magnet 12 %, Fliegen 9 %, Phantom 14 %, Pfadfinder 13 %). */
    share: { shield: 1, slow: 0.9, clear: 0.7, magnet: 0.6, glide: 0.45, boost: 0.7, guide: 0.65 } as Record<string, number>,
    glideBoost: 0,
  },
  /** Kulisse nach Strecke (Admin): Lichtstützpunkte in Metern, Mondaufstieg, Neon-Intensität, Schalter. */
  scenery: { keys: [0, 15000, 17000, 20000] as number[], moonFrom: 17500, moonSpan: 13500, /** Maßstab der Kulissenabschnitte (1 = normal; Sprint komprimiert). */ stageScale: 1, neon: 1, planes: true, peds: true, fountains: true },
  /** Standardpegel (Admin) für Musik, Motor, Effekte und Effekte; persönliche Einstellungen der Spieler haben Vorrang. */
  audio: { music: 1, engine: 1, sfx: 1 },
  /**
   * Spurblitz: Wirkbereich als Kollisionszeit (s) auf der aktuellen Spur und Höchstzahl entfernter Hindernisse. Magnet: Anziehungsradius in Spurbreiten,
   * Reichweite nach vorn (m). Schutzphasen (s) nach abgefangenem Treffer und nach dem Phantom-Turbo. Fliegen: längstes Verlängern der Landung (s).
   */
  powers: { blitzTtc: 2.0, blitzMax: 3, magnetLanes: 1.1, magnetRange: 130, graceShield: 0.5, graceBoost: 0.5, glideHoldMax: 1.0 },
  /** Gleitflug: Abheben, Sinken und Flughöhe (m); Gesamtdauer effects.glide, der Rest ist Flug. */
  glide: { up: 0.5, down: 1.0, height: 4.2, minT: 25, /** erstes Fliegen-Angebot frühestens nach dieser Strecke (m) */ firstFrom: 550, /** Das erste Angebot ist ein Tor über drei Spuren (aus: normale gewichtete Auswahl). */ firstGate: false },
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
    /** Erstes Power-up nach ≈ 12–18 s (Platzierung vor der nächsten Begegnung), danach alle ≈ 18–25 s. */
    pickupFirst: [12, 18], pickupEvery: [18, 25],
  },
  /**
   * P1.2 dynamischer Verkehr. Phasen nach aktiver Fahrzeit (s): 0–20 Einstieg, 20–45 Aufbau, 45–90 Arcade Flow, ab 90 High-Score.
   * Je Phase: Anteil der Spurwechsler an geeigneten Fahrzeugen, gleichzeitige Spurwechsel (hart begrenzt), Dichte-Faktor (Lücken ÷ Faktor).
   * lc: Vorwarnung (s) mit Blinker, Dauer der Querbewegung, Entscheidungsfenster (s Annäherungszeit), Mindestannäherungszeit bei Warnbeginn,
   * Sicherheitsabstände; horizon = Prüfhorizont des Fairness-Validators.
   */
  dynamic: {
    on: true,
    phaseStart: [0, 20, 45, 90] as readonly number[],
    changerShare: [0, 0.08, 0.15, 0.2] as readonly number[],
    maxActive: [0, 1, 1, 2] as readonly number[],
    density: [1, 1.08, 1.18, 1.28] as readonly number[],
    lc: { warn: 1.1, move: 0.9, decideMin: 2.0, decideMax: 4.4, minTtc: 2.0, visible: 430, zMargin: 7, laneGap: 1.4 },
    horizon: 2.8, step: 0.05, playerReact: 0.4,
  },
} as const;
