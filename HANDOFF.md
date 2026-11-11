# HANDOFF · Sunset Sideways

Stand: 2026-11-11 (Update 3: Wagen/Heckwinkel, Tempo 210, schnellere Lenkung, Gehwege + Passanten, längere Power-ups, Gleitflug). Projektordner `C:\Users\alex-\Desktop\Autorennen`, kein Git. Zuerst nur diese Datei lesen, dann gezielt einzelne Dateien öffnen.

## Spiel in einem Satz
Endless-Racer (TypeScript, Vite, Canvas 2D): automatischer Vortrieb, nur Querlenkung (← → bzw. horizontales Ziehen), Verkehr ausweichen, Power-ups per Überfahren einsammeln. Bestweite = gefahrene Distanz. **Drift, Handbremse, Nitro, Combo und Turbo sind entfernt.**

## Befehle
| Zweck | Befehl |
| --- | --- |
| Entwicklung | `npm run dev` → `http://localhost:5173` |
| Tests | `npm.cmd test` (113 Tests) |
| Build | `npm.cmd run build` → `dist/` |
| Build ansehen | `npx vite preview --port 4173` |
| Fahrprobe im echten Chrome | `node scripts/drive_check.mjs http://localhost:4173 <Ordner>` (45 Prüfungen, Tastatur + Touch-Emulation, Testfahrer in Echtzeit) |
| Bildproben (Wagen, Verkehr; Desktop/Hochformat) | `node scripts/shots.mjs http://localhost:4173 <Ordner>` |

QA-URL (aktive Kollisionen, kein ghost): `?qa=1&debug=1&seed=12&startS=700&startT=30`. `window.__qa`: `state`, `freeze` (Generator an, Strecke leeren), `place({k:'obstacle'|'pickup',kind|type,x,dz,vz})`, `give(shield,slow,magnet)`, `advance(sec,targetQ)`, `setQ`, `noPickups(on)`, `pause`. QA-Läufe ändern die Bestweite nicht. Alte Skripte `smoke/lifecycle/input/audio/compare/frames*.mjs` gehören zur früheren Drift-Fassung und sind veraltet.

Tooling: Bash-Heredocs mit Apostrophen scheitern → Write-Werkzeug oder `.mjs`-Skripte; Write auf vorhandene Dateien braucht frisches Lesen (sonst `rm` und neu schreiben).

## Balancing (`src/config/balance.ts`)
- Tempo nach gefahrener Strecke `speedAtDist(s)` (`core/speed.ts`, Stützpunkte in `balance.speed.knots`, monotone Hermite-Interpolation): 210 → 325 (1 km) → 370 (2 km) → 430 (6 km) → 480 (12 km) → 520 (16 km) → 550 (20 km) → 600 (27 km), danach konstant. Sim, Generator (`plan()` mit `travelTime`) und Erreichbarkeitsprüfung nutzen dieselbe Kurve. Zeitblase ×0,78 auf das Grundtempo an der erreichten Stelle. Spawn-Vorlauf mindestens 2,3 s (`gen.horizonSec`), Zeichenweite `DRAW` 460 m, Motor/Tempolinien skalieren bis 600 km/h.
- Lenkung wächst mit dem Tempo (`steerAt(kmh)` in `core/speed.ts`, Werte `balance.steer.base/fast`, 210 → 600 km/h): Tasten-Zielquergeschwindigkeit 18 → 44 m/s, Anstieg τ 30 → 18 ms, Auslaufen 35 → 22 ms; Touch-Folgegeschwindigkeit 30 → 85 m/s, τ 30 → 16 ms. Gemessen: Nachbarspur ≈ 0,23 s bei 210 km/h und ≈ 0,11 s bei 600 km/h, Außenspur ↔ Außenspur ≈ 0,44 s bzw. ≈ 0,2 s. Touch: 22 m je Bildbreite (Drittel der Breite = 7,2 m), Totzone 8 px, Ziel bleibt nach dem Loslassen 0,8 s bestehen. Erreichbarkeitsprüfung (`fairness.ts`) und Pfadfinder nutzen die tempoabhängige Lenkgeschwindigkeit.
- Erster Ausweichmoment bei 175 m (QA-Starts mit hohem Tempo: mindestens 2,6 s Vorlauf) (≈ 3 s): statisches Hindernis in der Mitte. Verkehr: schnell 58 (Taxi, Cabrio), mittel 48, langsam 36 km/h (Lkw, Limousine). Erreichbarkeit: react 0,4 s, reachEff 0,6 × 16 m/s.
- Power-ups (aktive Spielzeit): Impulsschild 10 s (ein Treffer), Zeitblase 7 s, Magnetfeld 15 s, Spurblitz 6-s-Fenster (bis zu 2 Hindernisse seiner Spur in 90 m), **Fliegen** 8 s (0,5 s Abheben, 6,5 s Flug, 1 s Sinken, 4,2 m; erstes Angebot jedes Versuchs als Tor über 3 Spuren ab 550 m, später selten ab ≈ 25 s), **Phantom-Turbo** 6 s (+20 % Tempo weich, Auto wird schwarz, nur Rückleuchten mit Lichtschlieren; Tacho zeigt das effektive Tempo), **Pfadfinder** 10 s (grüne Chevrons auf der freien, erreichbaren Spur; `sim/guide.ts`). Im Flug keine Kontakte/Boden-Pickups; beim Aufsetzen gelten überlappte Objekte bis zur Trennung (+ 0,3 m) als passiert (`Sim.passed`).
- Darstellung: Wagen wird in Kamerakoordinaten gezeichnet (Heck waagerecht, Achse geschert entlang des Kamerablicks, Mittelpunkt über `X`); `Renderer.visYaw` (≈ rel·0,55, max. 5°, τ 0,11 s) dreht ihn nur beim Lenken. Länge in Z auf 60 % gestaucht. Fahrbahnrand + Bordstein (0,4 m) + Gehweg (2,9 m) in `road2`, Passanten `render/people.ts` (Chunks à 20 m, 6 Outfits, Gruppen 1–3, Limit 24 bzw. 10 auf kleinen Geräten).

## Struktur
- `src/sim/sim.ts` Fahrkern (q, vq, Tempo, Kontakte swept, Power-ups); `contacts.ts` orientierte Flächen + kontinuierlicher Kontakt; `road.ts` leichte Bögen (R ≥ 650 m), `world.ts` Typen (`taxi|cabrio|sedan|truck|baken|barrier`, Pickups `shield|slow|clear|magnet`).
- `src/gen/generator.ts` Begegnungen (Muster, Tempoklassen) + Pickup-Platzierung mit Zwangstoren; `fairness.ts` Erreichbarkeitskette (react 0,4 s, reachEff 0,6 × 10 m/s, speedMargin 1,04).
- `src/input/input.ts` Tasten + ein Finger; `src/game.ts` Ablauf (Start → sofort Fahrt, Pause, Crash → „Nochmal fahren“ direkt), HUD, QA-Hooks.
- `src/render/`: `car3d.ts` Sportwagen (Keil, Quad-Flächen, Painter), `sprites.ts` Verkehr (Farbvarianten über Objekt-ID) und Pickup-Symbole, `renderer.ts` Szene, Effekte (Spurblitz-Streifen, Impuls-Ring, Magnetfeld, Zeitblasen-Welle).
- `tests/`: `driving`, `contacts`, `gameplay` (Anlauf, 60 Seeds × 120 s ohne Power-ups, Vorwarnzeit, Verkehrstypen, Power-up-Wirkung, Platzierung), `visual`, `light`, `core`, `loop`, `golden` (bei Generatoränderung `tests/golden.json` löschen, wird neu erzeugt), `helpers/bot.ts`.

## Offen / nicht geprüft
Echtes Smartphone, Firefox/WebKit, Handspiel (Gefühl, Klang), Bildrate auf Geräten, Gefahrenvorschau-Streifen nur im Bild geprüft, nicht mit Testpersonen.

## Kulisse nach Strecke (`render/scenery.ts`)
- Licht (`LIGHT_KEYS` 0/15/17/20 km → lt 0/0,14/0,5/1): 0–15 km langer warmer Sunset (Sonne sinkt nur langsam), 15–17 km sinkt sie hinter die Berge (Gold/Koralle → Violett, erste Fenster), 17–20 km blaue Stunde mit Sternen, ab 20 km Nacht. Mond `moonAt(s)`: ab 17,5 km knapp über dem Horizont, stetig höher, deutlich hoch ab ≈ 27 km.
- Abschnitte `STAGES` 0 / 1,5 / 5 / 10 / 20 km: Wüste+Motels, Art déco, Hoteltürme, Zentrum, **Strip ab 20 km** (Eiffelturm am Straßenrand und in der Skyline, Fontänensee `lake`, Casino-Fassaden mit Lauflicht-Dach); Strip-Elemente blenden zwischen 19,8 und 20,7 km weich ein.
- Bildproben nach km: `node scripts/shots_km.mjs http://localhost:4173 <Ordner> 14.8,16,17,18.5,19.8,20.4,21.5,27`.

## Hügel, Nacht, Sound (Update 6)
- Hügel: `Road.height(z)` (rein optisch, ≈ ±25 m, meist 3–7 % Steigung) ab 0,6 km, voll 3–17 km, ab 20 km flach; Renderer: `buildRows()` ordnet Bildzeilen den Tiefen mit Kuppenverdeckung zu, `projectWorld` verschiebt alle Objekte um die relative Höhe (`elev0` = Höhe unter dem Wagen).
- Nacht ab 17,5 km: Fenster größer/heller mit Schein, mehr/hellere/funkelnde Sterne, Laternen mit Lichthof, Verkehr mit Rücklicht-Lichthof und Unterbodenlicht, Taxi-Dachleuchte stärker.
- Sound (`audio/sound.ts`): 108 BPM Synthwave, 16 Takte (zwei Progressionen Am–F–C–G / F–G–Am), weiche Bassdrum mit Sidechain-Pumpen auf Pad/Bass, Clap mit Gated-Reverb, Echo (punktierte Achtel), Lead-Melodie nur in den Abschnitten 2 und 4, Arpeggio ab Abschnitt 2, Lagen nach Licht und Tempo; Motor leiser/weicher; **Flug**: `Sound.setFlight()` Düsenjet-Rauschen + Turbinenheulen, Start-/Lande-Effekte. Neue Effekte `boost`, `guide`.
- Bildproben: `node scripts/shots_new.mjs` (Hügel, Nacht, Phantom, Pfadfinder, Fliegen-Tor), `shots_km.mjs` (Kulisse nach km).

## Startbildschirm (Update 7)
- `#screen-start`: Logo (`.logo .l1/.l2`, Titel aus `GAME_TITLE`, in `main.ts` gesetzt), Bestweite, Button „Fahren“ (türkis), Lenkhilfe `#howto[data-mode=keys|touch]` (reines CSS, Tastenkappen bzw. Daumen + Mini-Auto, `prefers-reduced-motion` = statisch). `Game.syncHowto()` setzt Modus und Text bei Start und in `setMode()`. Auf dem Startbildschirm startet nur der Button, Enter oder Leertaste (Klick auf Titel/Erklärung wird ignoriert). Querformat mit < 520 px Höhe: Gruppe links neben dem Wagen.
- Prüfung: `node scripts/start_check.mjs http://localhost:4173 <Ordner>` (22 Prüfungen), Bilder `node scripts/shots_start.mjs http://localhost:4173 <Ordner>` (4 Formate × Tastatur/Touch).

## Hügel-Fix (Update 8)
- Ursache des Durchsehens: Objekte wurden mit Höhe projiziert, die Straße aber nur unterhalb des Horizonts und ohne Verdeckung gezeichnet. Jetzt: `buildRows()` ordnet auch Zeilen oberhalb des Horizonts dem Gelände zu und merkt sich die Geländekante (`occD/occY`); `scene()` schneidet jedes Objekt an der Kante der näheren Tiefen ab (`occlusionY`); Gefahrenstreifen (`markers`) nur auf passendem Gelände.
- Spielbarkeit: `Road.height()` begrenzt die Hügelkrümmung nach Tempo (`kAllowed`), sodass die Sichtlinie (Auge 3,4 m, Hindernis 1,3 m) ab 1,25 s Warnweite (bis 1,3-fach) nie hinter einer Kuppe liegt (Test in `contacts.test.ts`). Hügel dadurch ±5–9 m, Steigung ≤ 5 %.
- Prüfung: `node scripts/hill_run.mjs http://localhost:4173 <Ordner>` (Testfahrer in Echtzeit über Hügel), `node scripts/shots_hills.mjs ...`.

## Admin-Bereich (neu)
- Doku: `docs/DEPLOYMENT.md`. Code: `server/` (Node http, node:sqlite, Argon2id; gebündelt per `vite.server.config.ts` → `dist-server`), `admin/` (Vanilla-TS-UI → `dist-admin`), Konfig-Kern `src/config/runtime.ts` (Felder/Defaults/Validierung/applyConfig/Profile) + `src/config/analyze.ts` (Generator-Fairnessprüfung), Spielseite `src/net/remote.ts` (Konfig laden, Telemetrie).
- Spiel liest Konfig beim Fahrtstart (`applyConfig` in `startRun`), Fallback = eingebaute Defaults. `?testdrive=TOKEN` = Entwurf ohne Messung/Bestweite, `?qa=1` ohne Messung.
- Tests: `tests/server.test.ts`, `tests/config.test.ts`; Browser-Abnahme `node scripts/admin_check.mjs` (39 Prüfungen). Gesamt 175 Vitest-Tests.
- Nicht live verifiziert: Google-Search-Console-OAuth (kein Google-Zugang), echtes HTTPS/`__Host-`-Cookie hinter Proxy (nur per Test geprüft).
