# Sunset Sideways (früher GLIMMER MILE)

Pseudo-3D-Arcade-Racer für den Browser (TypeScript, Vite, Canvas 2D). Stand: **Session 1 – Grundgerüst**.

## Befehle

```bash
npm install        # Installation
npm run dev        # Entwicklungsserver (auch im WLAN erreichbar)
npm run build      # Typprüfung + Produktionsbuild nach dist/
npm run preview    # Build lokal ansehen
npm test           # Unit-Tests (Vitest)
```

Der Build liegt in `dist/` (relative Pfade, läuft unter jedem Hosting-Unterpfad, keine externen Abhängigkeiten).

## Smartphone im selben WLAN

`npm run dev` und `npm run preview` starten mit `--host`. Die ausgegebene `Network`-URL (z. B. `http://192.168.x.x:5173`) auf dem Handy öffnen.

## Steuerung

Desktop: ← → lenken. Smartphone: mit dem Daumen nach links oder rechts ziehen.

## Struktur

`src/config` Balancing und Texte · `src/core` Zustand, Loop, Tempo, RNG · `src/input` · `src/sim` · `src/gen` · `src/render` · `src/ui` · `src/audio` · `src/storage`

## Stand Session 2

Spielbarer Fahrkreislauf: Pseudo-3D-Straße, Lenkung (Pfeile/Daumen), Tempokurve, Generator mit Erreichbarkeitsprüfung, Swept-Kollision, Turbo/Schild, HUD, Pause, Crash/Ergebnis/Neustart. **Noch offen:** Sound-Synthese (Tonbutton schaltet nur den gespeicherten Zustand), Feinschliff der Grafik, Gerätetests.

- `npm test` – Unit-/Simulationstests inkl. Testfahrer (100 Seeds × 180 s, Höchsttempo mit Dauer-Turbo)
- `npm run test:browser` – Browser-Smoke-Test gegen `npm run preview` (Port 4173), benötigt installiertes Chrome (`playwright-core`)
- Testseed: URL-Parameter `?seed=12` (unsichtbar, keine QA-Steuerung)

## Grafikupdate (V01–V08)

- Fernsicht: `src/render/projection.ts` (lineare Perspektive bis 12 m, dahinter gestauchte Tiefe; Hochformat stärker) – Fahrkern unverändert (`tests/golden.test.ts` vergleicht Seeds mit dem Stand vor dem Update).
- Spurgebundene Warnmarkierung auf dem Asphalt nur für tatsächlich existierende Hindernisse (`Renderer.markers`).
- Kulisse wächst mit der Strecke: 0 / 250 / 800 / 1600 m (`STAGES` in `src/render/scenery.ts`). Mond und Flugzeuge laufen auf aktiver Szenenzeit.
- Testeinstieg (unsichtbar, nur per URL): `?seed=12&qa=1&startS=1700&startT=45&turbo=1`; mit `qa=1` steht `window.__qa` für Bildfolgen bereit.
- `node scripts/frames.mjs http://localhost:4173 <ordner>` erzeugt Abschnitts-, Warn-, Pickup-, Mond- und Heckbilder; `node scripts/compare.mjs <URL> <label> <ordner>` Vorher/Nachher-Bilder samt Frame-Kosten. Ergebnisse liegen in `docs/abnahme/` und `docs/vergleich/`.

## Update Tempo/Drift (U01–U10)

Schnellerer Einstieg (155 km/h), echte Kurven (`src/sim/road.ts`), Arcade-Drift (Pfeil in Kurvenrichtung kurz halten bzw. mit dem Daumen in Kurvenrichtung ziehen), vier Power-ups (Turbo 6 s, Schild 9 s, Kurvengrip 8 s, Zeitlupe 6 s), feinere Grafik und ruhigere Kulisse. Details und Messwerte: `HANDOFF.md`, Bilder: `docs/update-tempo-drift/`.

## Update Handbremsdrift, Sonnenuntergang, 80er-Sound

Drift nur mit Handbremse: **Leertaste halten und in die Kurve lenken** (Touch: **DRIFT**-Taste halten und seitlich ziehen oder mit dem zweiten Daumen lenken). Jeder Versuch beginnt beim Sonnenuntergang und läuft über die Distanz in die Neon-Nacht. Details: `ABNAHME_Handbremse.md`, Bilder: `docs/update-handbremse/`.
