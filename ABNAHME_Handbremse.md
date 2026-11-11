# ABNAHME · Update Handbremsdrift, Sonnenuntergang, 80er-Sound (H01–H09)

Stand: 2026-11-10. Start: `npm run dev` (→ `http://localhost:5173`). Build: `npm run build` → `dist/`.

**Geprüft:** `npm test` 81/81 · `npm run test:browser` 39/39 · `npm run test:lifecycle` 14/14 · `npm run test:input` 44/44 (Touch-/Tastaturrollen) · `node scripts/audio.mjs` (Pegelmessung). Umgebung: Windows 11, Chrome per Playwright (Headless, Touch **emuliert**).
**Nicht geprüft:** echte Smartphones (iOS Safari, Android Chrome), Firefox, WebKit, Handspiel, Klang nach Gehör, Videos (nur Bildfolgen).

## Finale Balancingwerte (`src/config/balance.ts`)

Handbremsdrift: Bestätigung 0,12 s, Touch-Absicht 0,45 s, Lenkung im Drift ×0,3, Schlupf ≤ 0,8 m, Schrägstand 16–24°, Tempoentlastung bis 8 % (Aufbau 0,2 s, Rücklauf 0,5 s), Kurvengrip −25 % Schlupf. Licht (`LIGHT_KEYS` in `src/render/scenery.ts`): 0 / 700 / 1400 / 2800 m. Musikbus 0,675 (≈ +2,6 dB gegenüber 0,5). Effektzeiten unverändert 6 / 9 / 8 / 6 s.

## Nachweise

| H | Status | Nachweis |
| --- | --- | --- |
| H01 Basis, Designentscheidung | bestanden | Automatischer Drift entfernt: ohne Handbremse nie Drift (`tests/drift.test.ts` „normales Lenken … löst nie einen Drift aus“); normale Fahrt unverändert (`tests/golden.test.ts` wurde nach Änderung der Tempokurve neu erzeugt); Tempo/Strecke/Power-ups wie zuvor |
| H02 Handbremse am PC | bestanden | `tests/drift.test.ts`: Leertaste + Lenken in Kurvenrichtung, Taste schon vor der Kurve, Gerade / gegen die Kurve / ohne Lenkung kein Drift, Gegenlenken beendet sofort, nach Drift-Ende neues Drücken nötig (auch bei durchgehend gehaltener Taste). `scripts/input.mjs` (Browser): beim Start gehaltene Leertaste zählt nicht, nach Loslassen + Drücken schon; fokussierter Ton-Button behält Leertasten-Verhalten. Hinweistext: „← → Lenken · Leertaste in Kurven halten zum Driften“ |
| H03 Handbremse Smartphone | bestanden (Emulation) | `scripts/input.mjs` mit echten Mehrfinger-Touch-Ereignissen (CDP) in 390×844, 844×390, 320×568: DRIFT-Taste 76×76 px, im Bild, verdeckt weder Pause noch Ton; zwei Daumen in beiden Reihenfolgen; Loslassen der Taste beendet nur die Handbremse; Ein-Daumen-Geste (Start ohne Lenksprung, relatives Ziehen auch außerhalb der Taste, vertikal lenkt nicht); Übergabe an einen Lenkfinger ohne Sprung; `touchcancel` und Pause löschen alles. Nicht geprüft: echte Geräte, dynamische Browserleisten |
| H04 Kurve, Physik, Flanke | bestanden (Simulation, Bild) | Drift 16–24° (gemessen bis 21,5°), Schlupf ≤ 0,8 m (0,56 m), Tempo 193 → 185 km/h im Drift (−4,1 % in dieser Kurve, Grenze 8 %), danach zurück (`tests/drift.test.ts`, `docs/update-handbremse/messwerte.json`). Fahrzeug aus eigenem 3D-Modell (`src/render/car3d.ts`): gerade Heck, ± Dreiviertel-Heck mit sichtbarer Flanke, Spiegelbild und stetiger Übergang getestet (`tests/light.test.ts`); Bilder `drift-rechts-*`, `drift-links-*`. Rauch/Reifenspuren an der Strecke verankert. Kollisionen bei Turbo/Schild/Grip/Zeitlupe: `tests/sim.test.ts`, `tests/drift.test.ts` (Kollision nutzt Querposition mit Schlupf) |
| H05 Sonnenuntergang → Nacht | bestanden (Bild) | `lightT(s)` stetig, monoton, 0 / ⅓ / ⅔ / 1 bei 0 / 0,7 / 1,4 / 2,8 km (`tests/light.test.ts`); Bilder `licht-*-0000m … 3600m` (Desktop und Hochformat): Sonne sinkt, Himmel Gold → Violett → Nacht, Sterne und Mond erscheinen, Fenster gruppenweise an, lange Schatten. Pause/Neustart folgen der Distanz. Hindernis-Kontrast bei Abendlicht nur nach Bild beurteilt |
| H06 80er-Sound | bestanden (Messung), Klang nicht gehört | `src/audio/sound.ts`: 118 BPM, Bass, Arpeggio, Pad, Hook ab Takt 1, Kick, Snare mit Gated-Reverb, Hi-Hat, Lagen nach Lichtphase ohne Rhythmusbruch, Ducking für wichtige Signale. `scripts/audio.mjs`: Ausgang −19 dBFS RMS, Spitze 0,77 (kein Clipping, auch mit Drift 0,65 und Turbo 0,70), Stumm −180 dBFS, Pause −122 dBFS. Keine parallelen Schleifen (`tests/sound.test.ts`). Nicht geprüft: Laptop-/Smartphone-Lautsprecher, Mobilbrowser, Ohrvergleich der +2,6 dB |
| H07 Integration, Leistung | teilweise | 30/60/120-FPS-Gleichheit inkl. Handbremse (`tests/loop.test.ts`); Frame-Kosten Ø 1,1–1,7 ms (Headless-Chrome ohne GPU, dichte Kulisse); Grafikprofil und Partikelgrenzen im Code; auf echter Hardware nicht gemessen |
| H08 Abnahme in Fahrt | teilweise | siehe H02–H06; keine Videos, kein Handspiel, keine echten Geräte, keine Mobilbrowser-Audiotests |
| H09 Lieferung | dieses Dokument | Geänderte Dateien: `src/sim/sim.ts`, `src/input/input.ts`, `src/game.ts`, `src/render/{car3d,renderer,scenery,sprites}.ts`, `src/audio/sound.ts`, `src/config/{balance,meta}.ts`, `index.html`, `src/ui/style.css`, Tests und Skripte |

## Offene Punkte

1. Echte Geräte, Firefox, WebKit.
2. Handspiel: Gefühl der Handbremse (Schwellen in `balance.ts → drift`), Tonmischung (Musikbus, Drums), Lesbarkeit orangefarbener Hindernisse bei Abendlicht.
3. Videos für Drift (beide Richtungen), Smartphone-Geste und Lichtphasen.
4. Der Fahrzeugkörper wirkt im 3D-Modell noch kantig (Boxen); Feinschliff möglich.
