# Soundtrack „Ride Into the Neon Night“ – Produktionspaket

**Status: Konzept und Integration fertig – die Aufnahme selbst fehlt noch.**
In dieser Umgebung gibt es keinen Musik- oder Gesangsgenerator. Es existiert deshalb *keine* produzierte Gesangsaufnahme. Bis die Audiodatei geliefert wird, spielt weiter die eingebaute Synth-Musik („Neon Vegas“).

## 1. Eckdaten
| | |
|---|---|
| Stil | Originale 80er-Rock-Power-Ballade, melodisch, nostalgisch, leicht heroisch |
| Tempo | 108 BPM (4/4), konstant |
| Tonart | E-Moll (Strophe), G-Dur/E-Moll im Refrain, Gitarrensolo in E-Moll |
| Länge | ca. 2:20 (Takte: 4 Intro, 16 Strophe, 8 Pre, 16 Refrain, 16 Solo, 16 Final-Refrain, 4 Outro) |
| Gesang | Englisch, kraftvolle melodische Rockstimme, keine Rap-/Dance-Vocals |

## 2. Harmonien
- Intro / Strophe: `Em – C – G – D` (je 1 Takt)
- Pre-Chorus: `Am – C – D – D(sus4)`
- Refrain: `G – D – Em – C` und `G – D – C – D`
- Solo: `Em – C – G – D`, zweite Hälfte `Am – C – D – B7`
- Outro: `Em – C – G – D` (Takt 4 endet auf D, führt nahtlos zum Em-Intro = Loop)

## 3. Arrangement
- **Intro:** weite Synth-Pads, Gitarrenthema (Clean-Gitarre mit Chorus/Delay), ab Takt 3 Hi-Hat, dann Kick
- **Strophe:** Bass legato, gedämpfte Gitarren-Achtel, Snare mit großem Gated-Reverb, leises Piano
- **Refrain:** breite Distortion-Akkorde, volle Drums, Streicherflächen, Backing-Vocals, Gitarrenthema als Hook
- **Solo:** melodisches Lead-Solo, Synth-Arpeggio im Hintergrund
- **Final-Refrain:** eine Tonart höher als Option (+2 Halbtöne) oder doppelte Backing-Vocals
- **Rush-Layer:** zusätzliche Spur (zweite Leadgitarre mit Oktav-Doppelung + Arpeggio-Synth), gleiche Länge, gleiche Takte

## 4. Songtext (Original)
**Verse 1**
Engines hum beneath the fading sun
Chrome and sky are melting into one
Every mile a promise I can keep
The city lights are waking from their sleep

**Pre-Chorus**
Hold the line, don't look behind
There's a fire in my mind

**Chorus**
Ride into the neon night
Chasing every burning light
Never gonna let it go
Never gonna fall too low
Ride into the neon night
Running free, we'll be alright
When the road is all we know
We ride on, we ride on

**Verse 2**
Empty highways, painted in the rain
Every heartbeat echoing my name
Taillights glowing like a distant sea
Somewhere out ahead is where I'll be

**Pre-Chorus**
Hold the line, don't look behind
Sunset sideways in my mind

**Chorus** (wie oben, Schlusszeile: „We ride on, we ride on, we ride on“)

**Bridge / Solo-Ansage**
When the stars come down to meet the road
I'll keep on going, I won't slow

Die Marke „Sunset Sideways“ erscheint nur einmal (Pre-Chorus 2) und nicht im Refrain – kein Werbejingle.

## 5. Produktionsprompt für einen KI-Musikgenerator
> Original 80s rock power ballad, 108 BPM, E minor, 2 minutes 20 seconds. Warm melodic lead electric guitar with chorus and delay playing a memorable main hook, wide overdriven rhythm guitars in the chorus, big gated-reverb snare, driving kick, clear hi-hats, restrained toms, melodic fingered electric bass, atmospheric analog synth pads, subtle arpeggios, occasional piano accents and string pads. Emotional, nostalgic, slightly heroic, night-drive feeling. Powerful melodic male or female rock vocal in English, clear diction, big memorable chorus with backing harmonies. Structure: 4-bar intro, 16-bar verse, 8-bar pre-chorus, 16-bar chorus, 16-bar guitar solo, 16-bar final chorus, 4-bar outro that returns to the intro chord (Em). Must not imitate any existing song, melody, lyric or artist voice. No rap, no dance beats. Lyrics: *(Text aus Abschnitt 4 einfügen)*.

Zusätzlich separat erzeugen: **Instrumental-Fassung** (ohne Gesang) und **Rush-Layer** (nur zusätzliche Gitarren-/Synth-Spur, Stem-Export).

## 6. Benötigte Dateien (`public/audio/`)
| Datei | Pflicht | Anforderung |
|---|---|---|
| `soundtrack.json` | ja | Beschreibung, siehe unten |
| `ride-into-the-neon-night.ogg` | ja | Stereo, 44,1/48 kHz, Vorbis q5 (~160 kbps), maximal ~4 MB, Pegel ca. −16 LUFS, True Peak ≤ −1 dBTP |
| `ride-into-the-neon-night-rush.ogg` | nein | gleiche Länge/Takte wie Hauptspur, nur Zusatz-Layer |

Ein Webm/Opus- oder MP3-Fallback ist möglich (`main` in der JSON auf `.mp3` setzen), Safari <18 kann kein Ogg. Für volle Safari-Unterstützung die Hauptspur als `.m4a` (AAC) ausliefern.

Loop-Anforderungen: Schleifenstart und -ende auf Taktgrenzen (1 Takt = 2,222 s bei 108 BPM), Gesang endet vor dem Loop-Ende, Hall-Ausklang ist in den Anfang eingerechnet (Tail in Intro kopiert), kein Pegelsprung zwischen Ende und Anfang.

```json
{
  "main": "ride-into-the-neon-night.ogg",
  "rush": "ride-into-the-neon-night-rush.ogg",
  "loopStart": 0,
  "loopEnd": 140.0,
  "license": "Eigene Produktion / Generator <Name>, kommerzielle Nutzung laut Plan <…> am <Datum> geprüft"
}
```
**Ohne Eintrag `license` wird die Aufnahme absichtlich nicht abgespielt.**

## 7. Rechte-Checkliste (vor Veröffentlichung)
- [ ] Generator/Studio erlaubt kommerzielle Nutzung in Spielen/Websites (Nutzungsbedingungen des Abos zum Erzeugungszeitpunkt sichern)
- [ ] Kein erkennbarer Bezug zu bestehenden Songs, Melodien, Texten oder Künstlerstimmen (Hörprüfung, ggf. Content-ID-Test)
- [ ] Gesang: Stimme ist generiert/lizenziert, keine Nachahmung einer realen Person
- [ ] Songtext (Abschnitt 4) ist Eigenleistung des Projekts
- [ ] Quelle, Datum, Plan, Prompt und Export-Dateien im Repository dokumentiert (hier ergänzen)

## 8. Wiedergabe im Spiel
- Lädt `/audio/soundtrack.json` erst nach der ersten Nutzergeste (Autoplay-Regeln); fehlt die Datei oder scheitert die Dekodierung, bleibt die Synth-Musik.
- Stummschaltung und Musikpegel (Admin) wirken wie bisher über Master- und Musikbus.
- Neon Rush blendet die Rush-Spur weich ein (≈ 0,25 s) und danach aus (≈ 0,6 s); Tempo unverändert.
- Tunnel-/Casino-Ambience liegt auf eigenen Bussen mit sehr niedrigem Pegel und läuft neben der Musik.

## 9. Aktuell eingebundene Musik (Übergang)
Bis die Ballade aus Abschnitt 1–5 produziert ist, läuft eine Abspielliste aus drei CC0-Stücken (lückenlos, ca. 3:44, danach von vorn): MintoDog „Pure Raceway“ (96 s), Of Far Different Nature „Oldskool“ (32 s), Pro Sensory / Alex McCulloch „Background Music (LOOP)“ (96 s). Alle ohne Gesang, alle von opengameart.org, Lizenz CC0 1.0 (Download 2026-11-23, Dateien in `public/audio/`). Das ist **nicht** der geplante Rock-Song. Ersetzen: `soundtrack.json` anpassen.
