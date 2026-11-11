# ABNAHME · GLIMMER MILE

Stand: 2026-11-10. Startbefehl: `npm run dev` (→ `http://localhost:5173`). Build: `npm run build` → `dist/`, ansehen mit `npm run preview` (Port 4173).

**Automatisch geprüft:** `npm test` = 69 Tests bestanden (7 Dateien). `npm run test:browser` = 39/39 (Chrome-Emulation, 1366×768, 390×844, 320×568, 844×390). `npm run test:lifecycle` = 14/14.
**Testumgebung:** Windows 11, Chrome (Playwright, Headless, Touch/Mobile nur emuliert). **Keine** echten Smartphones, **kein** Firefox, **kein** WebKit/Safari (dafür müssten diese Browser erst heruntergeladen bzw. Geräte bereitgestellt werden). **Nicht von Hand gespielt, nichts gehört.**

## A01–A14 (Bauprompt)

| A | Status | Nachweis |
| --- | --- | --- |
| A01 Start, Fahrt, Wiedereinstieg | bestanden | `scripts/smoke.mjs` (Start, Pause, Crash, Ergebnis, Neustart); `scripts/lifecycle.mjs`: Wiederstart-Button 147 ms nach Ergebnisanzeige (≈ 450 ms nach Crash), gehaltene Taste startet nicht neu, Fokusverlust pausiert und wartet auf Fortsetzen |
| A02 Arcade-Kamera, Pseudo-3D | bestanden | `src/render/projection.ts`, `tests/visual.test.ts` (Wagen 80–85 %, Horizont oberes Drittel); Bilder in `docs/update-tempo-drift/` |
| A03 Lenken (Pfeile, Daumen) | teilweise | `tests/sim.test.ts`, `tests/drift.test.ts` (Spurwechsel 0,34–0,48 s, Halten, Rand, relative Touch-Zielposition, Abbruch); Pointer-Capture/zweiter Finger/Lostcapture im Code (`src/input/input.ts`), aber nur per Smoke-Touch geprüft, nicht als eigener Test |
| A04 Tempo, Schwierigkeit, Highscore | bestanden | Tempokurve ersetzt durch U02 (`tests/core.test.ts`); Bestweite/Reload/gesperrter und beschädigter Speicher: `scripts/lifecycle.mjs`, `tests/core.test.ts` |
| A05 Verkehr, erreichbare Ausweichwege | bestanden | `tests/sim.test.ts`: 100 Seeds × 180 s und 100 Seeds × 60 s bei Höchsttempo mit Dauer-Turbo, Testfahrer ohne Crash |
| A06 Treffer, Fahrverhalten | bestanden | `tests/sim.test.ts` (zentral, knapp, dünnes Objekt bei grobem Schritt, Schild, Gleichstand Pickup/Hindernis, einmaliger Crash) |
| A07 Turbo und Schild | ersetzt | durch U05 (vier Power-ups, andere Laufzeiten); `tests/drift.test.ts` |
| A08 Art Direction, Animation | teilweise | Eigenentwurf aller Grafiken (`ASSETS.md`); Qualität nur nach Bildern beurteilt, nicht im Spiel von Hand |
| A09 HUD, Desktop, Smartphone | teilweise | alle fünf Viewports im Smoke-Test, Rotation mitten im Lauf; Buttons 48 px, Safe-Areas per CSS; echte Geräte/dynamische Browserleisten nicht geprüft |
| A10 Sounddesign | teilweise | `tests/sound.test.ts` (eine Schleife je Quelle, kein Stapeln nach 20 Neustarts, Stumm unterdrückt Effekte, kein Fehler ohne Web Audio); Klang und Mischung nicht angehört |
| A11 Stabilität, Leistung, Lieferung | teilweise | Build, README, Lockfile, relative Pfade, keine externen Anfragen (Smoke); Frame-Kosten nur in Headless-Chrome ohne GPU gemessen (Ø 1,7–2,3 ms) |
| A12 Automatisierte Abnahme | bestanden | 1 Fahrverlauf `tests/sim.test.ts`, `tests/loop.test.ts` (30/60/120 FPS identisch, Unterbrechung ⇒ Pause); 2 Lenkung `tests/sim.test.ts`/`drift.test.ts`; 3 Kollision/Effekte `tests/sim.test.ts`/`drift.test.ts`; 4 Generator `tests/sim.test.ts`; 5 Lebenszyklus `scripts/lifecycle.mjs` (20 Neustarts ohne zusätzliche Handler, eine Render-Schleife 61 → 61 FPS) |
| A13 Browser- und Spielgefühl-Abnahme | teilweise | Chromium-Emulation und Bilder ja; Firefox, WebKit, echte Geräte und Spielgefühl von Hand **nicht geprüft** |
| A14 Fertigmeldung | dieses Dokument | |

## V01–V08 (Grafikupdate)

| V | Status | Nachweis |
| --- | --- | --- |
| V01 Basis | bestanden | `tests/golden.test.ts` (Fahrkern unverändert, danach bewusst für U02 neu erzeugt) |
| V02 Hindernisse früher sehen | bestanden (gerechnet) | `tests/visual.test.ts`: Vorwarnzeit 320×568 Anfang 2,53 s, 384 km/h 1,61 s; alle fünf Viewports ≥ 2,0 s / ≥ 1,25 s; Warnmarkierung nur für vorhandene Hindernisse |
| V03 Pickups lesbar | bestanden | Bilder `docs/update-tempo-drift/pickups-farbe.png` / `pickups-grau.png`; vier unterscheidbare Silhouetten |
| V04 Neonlila Rennwagen | bestanden | `src/render/sprites.ts`, Bilder `heck-*.png` |
| V05 Strip wächst mit der Strecke | bestanden | Bilder `abschnitt-*-0m/250m/800m/1600m.png`, `tests/visual.test.ts` |
| V06 Flugzeuge | bestanden | `tests/visual.test.ts` (Flugplan, Richtung); kein Video |
| V07 Mondaufgang | bestanden | `tests/visual.test.ts`; Bilder `mond-*-t*.png` |
| V08 Testen und vergleichen | teilweise | Vorher/Nachher in `docs/vergleich/`; keine echten Geräte |

## U01–U10 (Update Tempo, Drift, Grafik)

Finale Balancingwerte (`src/config/balance.ts`): `vBase = 155 + 165·(1 − e^(−t/32))`; Turbo ×1,2 (max. 384), Zeitlupe ×0,78; Turbo 6 s, Schild 9 s, Kurvengrip 8 s, Zeitlupe 6 s; erster Hindernis-Anker 215 m, erste Kurve z = 270–520 m; Drift: Bestätigung 150 ms, Schlupf ≤ 0,72 m, 8–14°, Touch-Haltezeit 0,6 s.

| U | Status | Nachweis |
| --- | --- | --- |
| U01 Basis | bestanden | Fahrkern erhalten, `tests/golden.json` neu; Seeds/Viewports/Eingaben in `scripts/frames.mjs` |
| U02 Tempo und Einstieg | bestanden | `tests/core.test.ts` (155/199/255/295 km/h); `tests/drift.test.ts` (Kurve bei 5,5–7 s bis 9–11 s); Erstkontakt ungelenkt 4,6 s; Vorwarnzeit siehe V02; Pfad-Erreichbarkeit ohne Drift und ohne Pickup durch Testfahrer (100 Seeds) |
| U03 Kurven | bestanden | `src/sim/road.ts`, `tests/drift.test.ts` (Krümmung stetig, Übergang ≥ 80 m, Seeds); Kamera mit Vorhalt; Bilder zeigen echte Bögen. Rechts/Links je vom Rand nicht einzeln geprüft |
| U04 Drift | bestanden (Simulation, Browser-Emulation) | `tests/drift.test.ts` (Tastatur/Touch, Gerade, Gegenlenken, Impuls, Tipp, vertikal, Abbruch); Browser: Auslösung ≈ 0,24 s, Schlupf 0,5 m, ≈ 12°, danach 0 (`messwerte.json`); Bilder `drift-*.png`; Quietschen nur als Logik getestet, nicht gehört |
| U05 Vier Power-ups | bestanden | `tests/drift.test.ts` (Dauern, Erneuern, Ende, Zeitlupe ×0,78 inkl. Verkehr/Tacho, Turbo-Deckel); Erstangebot 8–12 s, alle vier bis ≈ 55 s (`tests/sim.test.ts`); Kurvengrip: gleicher Drift weniger Schlupf (max. 0,35 m statt 0,46 m) und schnelleres Abklingen (0,151 statt 0,281 m nach 50 ms) |
| U06 Mehr Detail | teilweise | feinere Auflösung (Hochformat 1:1), neue Palmen/Fassaden, Wagen-Details; Bewertung nur nach Bildern |
| U07 Ruhige Kulisse | teilweise | Spurwechsel verändert das Horizontband kaum (33,95 % mit gegenüber 32,29 % ohne Spurwechsel; Rest durch Fahrweg/Kurve); eine aufgenommene Kurvenfahrt als Video fehlt |
| U08 Mobile Eingabe, Leistung | teilweise | 30/60/120 FPS identischer Verlauf (`tests/loop.test.ts`); Grafikprofil (`Renderer.quality`) und Partikelgrenzen im Code, auf langsamen Geräten ungetestet |
| U09 Tests und Spielabnahme | teilweise | siehe oben; Video und Handspiel fehlen |
| U10 Fertigmeldung | dieses Dokument | |

## Offen / nicht prüfbar in dieser Umgebung

- Echte Geräte (Android Chrome, iOS Safari), Firefox, WebKit.
- Handspiel: Fahr- und Drift-Gefühl, Balancing, Tonmischung inkl. Reifenquietschen.
- Videos (Mond/Flugzeug, Kurvenfahrt, Drift); stattdessen Bildfolgen in `docs/`.
- Bildrate auf echter Hardware (hier nur auf 60 FPS begrenzte Headless-Messung).
