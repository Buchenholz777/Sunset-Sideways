# Mobile First 2.0 – Bericht

Stand: Commits 32d83aa, 7c57f52, 86f28dc, 6301e21 und dieser. Desktop-Verhalten, Gameplay und Wertung sind unverändert.

## A. Ausgangszustand
Hochformat nutzte die Querformat-Kamera: Straße schmal, Wagen und Hindernisse in die Länge gezogen, Lenkung nur per Ziehen, HUD und Game-Over-Panel zu groß für kleine Displays (`before_*.png`).

## B. Ursachen
Gemeinsames Layout für beide Ausrichtungen (Horizont/Brennweite auf Höhe ausgelegt), Desktop-Texte und -HUD auch auf Touch, kein Tippen-Modell, Fenstergröße reagierte nur auf `resize`/`orientationchange`.

## C. Umsetzung
- Eigene Hochformat-Kamera (`makeLayout`: Horizont 0,42·h, Wagenzeile 0,84·h, Straße füllt die Breite, stärkere Fernsicht-Stauchung).
- Tipp-Steuerung (links/rechts = eine Spur) zusätzlich zum Wischen; Touch-Texte.
- Kompaktes HUD, aktive Effekte als Symbolzeile; Safe-Areas.
- Game-Over: großer NOCHMAL FAHREN-Button, sekundärer RANGLISTE-Button nur auf Touch; passt ab 320×568 ohne Scrollen.
- Grafikprofile HIGH/MEDIUM/LOW (adaptiv nach Frame-Kosten); schwache Phones (≤4 Kerne oder ≤3 GB) starten in MEDIUM.
- Resize auch über `visualViewport` und `ResizeObserver` (Browserleisten, Split-Screen).
- Eingabe-Härtung: `overscroll-behavior: none`, `touch-action: none` auf der Zeichenfläche, `touch-action: manipulation` und `-webkit-touch-callout: none` auf der App, keine Textauswahl (außer in Eingabefeldern).
- Vollbild beim Start-Tipp auf Touch, nur wo `requestFullscreen` existiert (Android; iPhone-Safari nicht), Fehler werden ignoriert.
- Analytics: bestehende Telemetrie, keine neuen Tracker; Start-Event um `ori` (p/l) und `q`, End-Event um `q` ergänzt (zusätzlich zum vorhandenen `dev`).

## D. Vorher/Nachher
`before_390x844_run.png` / `after_390x844_run.png`, `before_390x844_start.png` / `after_390x844_start.png`, `before_320x568_run.png` / `after_320x568_run.png`; weitere Größen in `scratch/mob` (lokal, nicht im Repo). Themenwelten im Hochformat: `tunnel-390x844.png`, `casino-nacht-390x844.png`; Game-Over: `gameover-390x844.png`.

## E. Performance
Headless Chrome, Touch-Emulation, 12 Größen: ca. 60 fps, 0 Seitenfehler. Das ist keine Messung auf echten Geräten und sagt nichts über Mittelklasse-Phones.

## F. Testabdeckung
Vitest 402 Tests, `tsc`, `vite build` grün. Playwright-Matrix 320×568, 360×640, 375×667, 390×844, 393×852, 412×915, 430×932, 768×1024 hoch und quer (ohne Scrollen, Canvas folgt der Rotation). Tunnel, Casino/Nacht und Standardwelt im Hochformat (390×844, 320×568) per Screenshot gesichtet, keine Fehler.

## G. Offen / nicht getestet
- Echte iOS- und Android-Geräte (Safari, Chrome): ausstehend.
- Vollbild-Verhalten auf echten Geräten, Pull-to-Refresh und Doppeltipp-Zoom nur über CSS abgesichert, nicht auf Geräten geprüft.
- Optionaler Tipp-Zonen-Hinweis, englische Texte: nicht umgesetzt.
- Lizenzierte Rock-Ballade (Audio) und Rückmeldung zum Rampengefühl: weiter offen.

## H. Deployment
Push auf `main` löst Cloudflare Pages aus (www.sunsetsideways.com). Noch nicht gepusht (wartet auf Freigabe).
