# ABNAHME · Fahrkern-Update (F01–F10)

Stand: 2026-11-10. Start: `npm run dev` (→ `http://localhost:5173`). Build: `npm run build` → `dist/`.

**Geprüft:** `npm test` 136/136 · `npm run test:browser` 39/39 · `npm run test:lifecycle` 14/14 · `npm run test:input` 68/68 · `node scripts/audio.mjs` · `node scripts/frames_f.mjs` (Kamera-/Straßenmessung, Debug-Bilder in `docs/update-fahrphysik/`).
**Umgebung:** Chrome per Playwright (Headless, Touch emuliert). **Nicht geprüft:** echte Geräte, Firefox, WebKit, Spielen in Echtzeit von Hand, Klang nach Gehör.

## Ursachen (ehrlich: nur teilweise reproduziert)

- **Straße „schwimmt/springt“:** Ursache im Code gefunden und behoben: Die Kamera folgte dem Wagen seitlich mit Nachlauf (τ = 0,25 s) und mischte ihre Blickrichtung zu 20 % aus der Straßentangente – beim Lenken, Driften und Gegenlenken wanderte dadurch die ganze Straße relativ zum Wagen. Jetzt sitzt die Kamera exakt hinter dem Wagen, die Blickrichtung folgt dem Bewegungskurs mit 0,15 s Dämpfung und höchstens 6° Vorhalt (einmal verrechnet). Messung: größte Bildspalten-Änderung der Straßenmitte zwischen zwei Bildern 0,35 px (Tiefe 40) bzw. 0,53 px (Tiefe 120) am Desktop, 0,19 / 0,32 px bei 320 px Breite, in Links- und Rechtskurve inkl. Drift-Beginn und -Ende. **Ein Abschnittswechsel im Messfenster ist nicht gesondert nachgewiesen**; die Strecke selbst ist über 30 km stetig (`tests/contacts.test.ts`).
- **Pickups reagieren nicht / Hindernisse durchfahren:** Eine fehlerhafte Kontaktprüfung ließ sich in der Simulation **nicht reproduzieren** (kontinuierlicher Test, 400 Zufallsfälle gegen Feinschritt-Referenz, 0 verpasste Treffer; Pickups auf allen Spuren, in beiden Kurvenrichtungen, bis 384 km/h und mit 1/20-s-Schritt). Gefundene Teilursache: Der Wagen wurde seitlich an der Tiefe des Hecks statt an der Wagenmitte (Bezugspunkt der Physik) gezeichnet; bei Kamerawinkel zum Kurs verschob das die Karosserie um bis zu ≈ 0,4 m gegenüber der Trefferfläche – korrigiert. Ein **Platzierungsfehler** (Pickup ohne erreichbare Annäherung) ist weiter nicht ausgeschlossen: Pickups liegen nur in freien Spuren, ihre Erreichbarkeit ist nicht separat bewiesen.

## Finale Werte (`src/config/balance.ts`)

Lenkung (F03): Kursrate = u · min(0,55 rad/s, 14 m/s² / max(v, 12 m/s)), Antwortzeit 60 ms (Drift 85 ms, Gegenlenken/Loslassen 45 ms), Tasten direkt ±1 (nur im Fahrmodell geglättet), Touch analog: Totzone 6 px, Vollausschlag 20 % der Breite (50–80 px). Drift (F04): frische Handbremse + Tempo > 65 km/h + |u| ≥ 0,30 (keine Kurvenzone), Schrägstand in ≈ 0,1 s auf 14–24° (Eintrittsrichtung), Gegenlenken verkleinert, ≥ 0,6 deutlich Gegenlenken/Loslassen/> 0,2 s neutral beenden, Erholung ≈ 0,2 s, 6–8 % weniger Vortrieb. Nitro lädt bei |Schrägstand| ≥ 10°, |Kursrate| ≥ 0,025 rad/s, auf Asphalt und nach 0,25 s kontrollierter Phase. Strecke (F07): Krümmung ≤ 0,65 · 14 / v² (Tempo inkl. Boost, bis 384 km/h), Richtung der Straße bleibt begrenzt.

## Nachweise

| F | Status | Nachweis |
| --- | --- | --- |
| F01 Diagnose | teilweise | Ursachen siehe oben; Kamera-Messung, Debug-Ansicht (`?qa=1&debug=1`, nicht im normalen Spiel). Kein Mitschnitt der vom Spieler gemeldeten Fehler (kein Gerät) |
| F02 Strecke | bestanden | `src/sim/road.ts` (Krümmung → Richtung → Mittellinie; Anschlüsse stetig); `tests/contacts.test.ts` (30 km, 3 Seeds: Position/Richtung/Krümmung ohne Sprung, Krümmungsgrenze nach Tempo). Neutral: `tests/physics.test.ts` (3 Startspuren × 2 Richtungen: Weltkurs konstant, Wandern nach außen, Randkontakt, Crash `edge`, Schild schützt nicht). Weltursprung wird nicht umgesetzt (nicht nötig) |
| F03 Lenkung | bestanden (Sim/Emulation) | `Sim.step`: u → Kursrate → Kurs → Position (`tests/physics.test.ts`, `tests/handbrake.test.ts`); Touch analog (`scripts/input.mjs`, 68/68). **Nicht umgesetzt:** zeitgestempelte Eingabeereignisse und interpolierte Render-Posen (Eingabe wird je Simulationsschritt abgetastet, Rendern zeigt den letzten Schritt) |
| F04 Handbremsdrift | bestanden (Sim, Bild) | `tests/handbrake.test.ts` (Auslösung ohne Kurve, nur mit Lenkabsicht/Tempo, Aufbau 100–150 ms, 14–24° links/rechts, Gegenlenken leicht/deutlich, 0,2-s-Toleranz, frische Handbremse, 6–8 % Tempo, Nitro-Schwellen, kurze Berührung lädt nicht); Bilder `drift-*.png` (max. 20,2° Schrägstand in der Messung) |
| F05 Kamera | teilweise | Messung oben; Debug-Bilder `debug-*.png`; die Hitbox-Darstellung im Debug-Bild `debug-rechts-desktop.png` zeigt ein verzerrtes Rechteck (Darstellung der Debug-Ansicht nicht verlässlich verifiziert). Hoch-/Querformat-Anpassung der Vorschau unverändert |
| F06 Kontakte | bestanden (Simulation) | `tests/contacts.test.ts`: 4 Typen × 3 Spuren × Gerade/2 Kurven/Höchsttempo genau einmal, Nachbarspur nichts, Streifschuss 1,3 m trifft / 1,8 m nicht, 1/20-s-Schritt bei 384 km/h, Tunnel-Zufallstest (0 verpasst), Driftpose trifft Streifschuss, Schild läuft im selben Schritt aus |
| F07 Schwierigkeit | teilweise | Krümmung nach Tempo (`kCap`), Generator-Reichweite auf neue Lenkreserve umgestellt (`react 0,55`, `reachEff 0,45`). Testfahrer (nur Lenken, kein Drift, keine Power-ups): 100 Seeds × 90 s mit 2 Fehlern, 100 Seeds × 45 s bei Höchsttempo (Start-Anker ausgenommen) mit 4 Fehlern – **kein fehlerfreier Pfadnachweis** (`tests/physics.test.ts`). Vergleichsfahrten von Hand fehlen |
| F08 Bedienung, Nitro | bestanden (Emulation) | unverändert aus dem vorigen Update, `scripts/input.mjs` 68/68, `scripts/lifecycle.mjs` 14/14, `tests/nitro.test.ts` |
| F09 Abnahme | teilweise | Tests oben; 30/60/120-FPS-Gleichheit (`tests/loop.test.ts`); keine Geräte, kein Echtzeitspiel |
| F10 Lieferung | dieses Dokument | Build erfolgreich, Start `npm run dev` |

## Offen

1. Echtzeit-Spieltest von Hand (Tastenlenkung ist jetzt direkter/schwächer, Drift früher auslösbar) und echte Geräte.
2. Pfadnachweis fehlerfrei; Pickup-Platzierung beweisen.
3. Zeitgestempelte Eingabe und interpolierte Render-Posen; Debug-Ansicht prüfen.
