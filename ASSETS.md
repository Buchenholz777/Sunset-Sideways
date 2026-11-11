# Assetnachweis

Alle Grafiken, Sounds und Texte sind eigenständig für dieses Projekt erstellt (Pixelgrafik per Code/eigene Sprites, Audio per Web Audio synthetisiert).

| Datei | Herkunft | Lizenz |
| --- | --- | --- |
| `public/favicon.svg` | selbst erstellt | projekteigen |

Keine fremden Screenshots, Rips, Logos oder Melodien. Unklare Herkunft bedeutet: Asset vor Abgabe ersetzen.

## Grafikupdate

Alle Grafiken werden zur Laufzeit per Canvas aus Code gezeichnet; es gibt keine eingebundenen Bilddateien, Fonts oder Fremdassets.

| Element | Datei | Herkunft |
| --- | --- | --- |
| Neonlila Rennwagen (Heck, Turbo-/Grip-Look), Verkehr, Baken, Absperrungen, Pickup-Symbole Kurvengrip (Reifenprofil) und Zeitlupe (Sanduhr) | `src/render/sprites.ts` | selbst entworfen, keine Herstellervorlage, keine Logos/Embleme |
| 3D-Wagenmodell (`src/render/car3d.ts`), Sonne/Mond/Himmel (`scenery.ts`) und 80er-Musik (`sound.ts`) | selbst entworfen und synthetisiert |
| Pickup-Piktogramme (Doppelpfeil, Sechseck-Schild), HUD-Icons | `src/render/sprites.ts`, `index.html` | selbst gezeichnete Pixelraster bzw. SVG |
| Strip-Kulisse (Palmen, Motels, Art déco, Türme, Medienwände, Aussichtsrad, Wasseranlage, Portal), Skyline | `src/render/scenery.ts` | selbst entworfen, fiktive Formen ohne reale Landmarken oder Schilder |
| Mond, Flugzeug, Berge | `src/render/scenery.ts` | selbst gezeichnet |
| Sounds und Musik | `src/audio/sound.ts` | per Web Audio synthetisiert, eigene Komposition |

## Sunset Sideways

Neue Sounds (Nitro-Zündung, Nitro-bereit, Combo-Stufe) werden per Web Audio synthetisiert (`src/audio/sound.ts`); Sonne, Sterne und Flugzeug sind per Canvas gezeichnet (`src/render/scenery.ts`). Keine Fremdassets.
