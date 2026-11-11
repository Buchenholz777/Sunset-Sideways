# ABNAHME · Sunset Sideways (S01–S10)

Stand: 2026-11-10. Start: `npm run dev` (→ `http://localhost:5173`). Build: `npm run build` → `dist/`, ansehen mit `npm run preview`.

**Geprüft:** `npm test` 106/106 · `npm run test:browser` 39/39 · `npm run test:lifecycle` 14/14 · `npm run test:input` 68/68 (Mehrfinger-Touch, Tastatur) · `node scripts/audio.mjs` (Pegel) · `node scripts/frames_s.mjs` (Bildfolgen, Messwerte in `docs/update-sunset-sideways/messwerte.json`).
**Umgebung:** Windows 11, Chrome per Playwright (Headless, Touch emuliert). **Nicht geprüft:** echte Smartphones, Firefox, WebKit, Handspiel, Klang nach Gehör, Videos (Bildfolgen statt Aufnahme).

## Finale Balancingwerte (`src/config/balance.ts`)

Lenkung: Gierrate ω = δ·50/v (`steer.latAccel`), Tasten-Rampe 4/s, maximaler Winkel zur Straße 0,55; Touch: Totzone 5 px, Vollausschlag 0,28 × Breite (max. 110 px). Seitenstreifen ab |q| > 4,45 m (−20 % Tempo, weich), Streckenaustritt ab 6,6 m. Drift: Bestätigung 0,12 s, Schrägstand 16–24°, bis 8 % weniger Vortrieb, Haftung im Drift 1,4/s (normal 16/s). Combo: +1 Stufe je 0,6 s bis ×5, Laden 12 / 16 / 20 / 24 / 28 %/s. Nitro: ab 40 % bereit, Kosten 40, 2,5 s, +20 % (Deckel 384 km/h). Licht: 0 / 2,0 / 3,4 / 5,0 km. Bedienhinweis 1,7 s.

## Nachweise

| S | Status | Nachweis |
| --- | --- | --- |
| S01 Titel, Bestand | bestanden | `GAME_TITLE = Sunset Sideways` (Startbildschirm, Seitentitel, README); alte Rekorde/Ton aus `glimmer-mile:v1` werden gelesen und nach `sunset-sideways:v1` kopiert, der alte Schlüssel bleibt (`tests/storage.test.ts`) |
| S02 Ohne Lenken geradeaus | bestanden | Auto-Gieren/Spurbindung entfernt: Sim führt Weltpose (X, ψ, φ) (`src/sim/sim.ts`). `tests/physics.test.ts`: je 3 Startspuren (links/Mitte/rechts) × beide Bogenrichtungen: Weltausrichtung bleibt auf 1e-9, Weltbahn ist eine Gerade, relativer Querabstand wandert streng nach außen; langer Bogen ⇒ Randkontakt und Crash `edge`; Schild schützt nicht vor Streckenaustritt; Seitenstreifen verlangsamt, Rückkehr mit Lenken möglich; Rekordmeter monoton. Browser-Messwerte (`messwerte.json`, rechte Kurve): q nach 2 s von −3,6 / 0 / 3,6 auf −11,3 / −9,2 / −6,4 m (nach außen), Bilder `physik-*`. Ein Test, in dem neutrale Eingabe die Spur hält, würde an `monotone`/`toBeLessThan(-0.3)` scheitern |
| S03 PC/Smartphone-Steuerung | bestanden (Emulation) | `scripts/input.mjs`: analoges Lenken (Aufsetzen = nur Bezugspunkt, Totzone, Halten hält den Ausschlag, über die Mitte Gegenlenken, Loslassen neutral), DRIFT/NITRO ≥ 64 px, verdecken Pause/Ton nicht (390×844, 844×390, 320×568), zwei Daumen in beiden Reihenfolgen, Ein-Daumen aus der Taste, NITRO-Tipp unterbricht den Lenkfinger nicht, Übergabe ohne Sprung, Abbruch/Pause räumen auf; Tastatur: E nur frisch (Halten/Wiederholung zählt nicht), bei Start gehaltene Leertaste/E zählen erst nach Loslassen. Nicht geprüft: echte Geräte, dynamische Browserleisten |
| S04 Bedienhinweis | bestanden | vor jedem Versuch 1,7 s, Simulation steht still (Zeit/Strecke gleich), danach automatisch (`scripts/input.mjs`); Desktop- und Mobiltext + „Driften lädt Nitro.“ (Bilder `hinweis-*`, auch 320 px); Modus folgt der tatsächlichen Eingabe; Pause im Hinweis hält ihn an |
| S05 Handbremsdrift, Combo | bestanden (Sim, Browser-Bild) | `tests/drift.test.ts`: nur mit frischer Handbremse + Lenkung in Kurvenrichtung; nie ohne Handbremse; Gerade/ohne Lenkung/gegen die Kurve kein Drift; Gegenlenken beendet sofort, neues Drücken nötig; Schrägstand 15–24°, Tempo bis 8 % geringer und zurück; Hitbox folgt der Pose (`physics.test.ts`). `tests/nitro.test.ts`: Combo-Stufen ×1…×5 alle 0,6 s, Ladeanzeige, Combo-Ende mit kurzer Anzeige des letzten Werts, Energie bleibt, neuer Drift ×1, Crash/Austritt beenden. Bilder `drift-rechts|links-*` zeigen Flanke, Combo über dem Wagen, bunte Funken, Rauch; Combo ×1…×4 in 2,2 s (messwerte). Nicht geprüft: Aufnahme als Video |
| S06 Nitro | bestanden | `tests/nitro.test.ts`: leerer Start, alle fünf Laderaten, Deckel 100 %, Auslösung bei exakt 40 %, 39,9 % ohne Wirkung/ohne Vormerken, gehaltenes E verbraucht nichts, kein Nachladen im Boost, Restladung bleibt, Überlagerung mit Turbo/Zeitlupe/Schild ohne Multiplikation, kein Kollisionsschutz, Neustart leer. Bilder `nitro-bereit.png`, `nitro-aktiv.png` |
| S07 Wagen, Westküste | teilweise | flacher Keil (80 % Höhe), schräge Heckscheibe, schmale versetzte Rücklichter, echte Flanke aus 3D-Modell (`tests/light.test.ts`: gerade, ±Winkel, spiegelbildlich, stetig); Vorher/Nachher: `docs/update-handbremse/` (alt) gegen `docs/update-sunset-sideways/` (neu). Das Modell wirkt weiter kantig; „Wirkung als kleine Silhouette“ nur nach Bild beurteilt |
| S08 Sunset, Sterne, Flugzeuge | bestanden (Bild/Test) | `lightT` 0 / 2,0 / 3,4 / 5,0 km (`tests/light.test.ts`), Bilder `licht-*` (0 … 5,2 km, Desktop und Hochformat); Sterne funkeln langsam und unterschiedlich (feste Positionen, bei reduzierter Bewegung statisch); Flugzeug ≈ 35 % kleiner mit rotem, langsam pulsierendem Licht (`flugzeug-*`) |
| S09 80er-Sound | teilweise | Musik: Lead und Drums lauter, neue Sounds Nitro-Zündung, Nitro-bereit, Combo-Stufe; Pegel Headless: kein Clipping, Stumm/Pause −180 dBFS (`scripts/audio.mjs`); `tests/sound.test.ts`. Der Loop wurde nicht neu komponiert, nur nachgeschärft; **nicht angehört**, nicht auf Smartphone-Lautsprechern geprüft |
| S10 Abnahme, Lieferung | teilweise | siehe oben; Testfahrer (kein Drift, keine Power-ups, nur Lenken) fährt 100 Seeds × 90 s mit 2 Fehlern (Seed 3664 t = 29,9 s s = 1765 m Baken; Seed 4182 t = 88,1 s s = 3734 m Baken) und 100 Seeds × 45 s bei Höchsttempo mit Dauer-Turbo mit 3 Fehlern (Seeds 1370, 3997, 4478); frühere 60-Seed-Läufe über 150 s zeigten vereinzelte Fehler nach > 120 s. **Der Pfadnachweis ist damit nicht fehlerfrei**, die Fehlergrenzen stehen als Testschwelle (≤ 5 % bzw. ≤ 8 %). Die Streckenplanung (`src/gen/fairness.ts`) rechnet nun mit quadratischer Lenkreichweite (`reachEff 0,4`, `react 0,4`), Warnzeiten bleiben (`tests/visual.test.ts`) |

## Geänderte Dateien (Auswahl)

`src/sim/sim.ts` (Weltpose-Physik, Nitro, Combo), `src/input/input.ts`, `src/game.ts`, `src/core/state.ts`, `src/render/{renderer,scenery,sprites,car3d}.ts`, `src/audio/sound.ts`, `src/gen/fairness.ts`, `src/config/{balance,meta}.ts`, `src/storage/storage.ts`, `index.html`, `src/ui/style.css`, `tests/*` (neu: `physics`, `drift`, `nitro`, `storage`), `scripts/{input,frames_s}.mjs`.

## Offene Punkte

1. Handspiel: Lenkempfindlichkeit (Tastenrampe, `latAccel`), Drift- und Nitro-Gefühl, Seitenstreifen-Härte; Schwellen in `balance.ts`.
2. Echte Geräte, Firefox, WebKit; Klang und Mischung anhören.
3. Fehlerfreier Pfadnachweis über lange Läufe (Generator konservativer oder Testfahrer verbessern).
4. Videos statt Bildfolgen; kantiges Fahrzeugmodell feiner ausarbeiten.
