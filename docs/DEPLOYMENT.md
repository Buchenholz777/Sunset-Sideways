# Admin-Bereich auf Cloudflare Pages (Functions + D1)

Alles läuft in **einem** Cloudflare-Pages-Projekt: das Spiel als statische Dateien, der Admin-Bereich (`/admin`) und die Schnittstellen (`/api/…`) als Pages Function, die Daten in einer **D1-Datenbank**. Bereitgestellt wird per `git push`.

## Einmalige Einrichtung

1. **Build-Einstellungen** (Pages-Projekt → Einstellungen → Builds):
   * Build-Befehl: `npm run build:pages`
   * Ausgabeverzeichnis: `dist`
   * Umgebungsvariable `NODE_VERSION` = `22`
2. **D1-Datenbank anlegen:** Cloudflare → *Speicher & Datenbanken → D1 → Datenbank erstellen* (Name z. B. `sunset-db`). Tabellen legt die Function beim ersten Aufruf selbst an.
3. **Datenbank verbinden:** Pages-Projekt → *Einstellungen → Bindings → Binding hinzufügen → D1-Datenbank*: Variablenname **`DB`**, Datenbank `sunset-db` (für *Produktion*, bei Bedarf auch *Vorschau*).
4. **Admin-Passwort-Hash erzeugen** (lokal, Passwort wird verdeckt eingegeben, mind. 12 Zeichen):
   ```bash
   npm install
   npm run build:server
   npm run admin:hash
   ```
   Die ausgegebene Zeile `pbkdf2-sha256$100000$…` kopieren.
5. **Variablen und Secrets** (Pages → Einstellungen → Variablen und Secrets, Produktion):
   | Name | Typ | Wert |
   |---|---|---|
   | `ADMIN_PASSWORD_HASH` | **Secret** (verschlüsselt) | die Zeile aus Schritt 4 |
   | `PUBLIC_ORIGIN` | Variable | `https://www.sunsetsideways.com` |
   | `RETENTION_DAYS` | Variable (optional) | `30` (Rohdaten-Aufbewahrung) |
   | `SESSION_IDLE_HOURS`, `SESSION_ABSOLUTE_DAYS` | optional | `12`, `7` |
6. **Neu bereitstellen** (Deployments → *Retry*, oder ein beliebiger `git push`). Danach: `https://www.sunsetsideways.com/admin`.
7. **Eigene Domain:** *Custom domains* → `www.sunsetsideways.com` (und `sunsetsideways.com` mit Weiterleitung auf `www`, z. B. per Cloudflare-Redirect-Regel). Zertifikat stellt Cloudflare aus.

## Betrieb

* **Passwort ändern:** im Admin über „Passwort“ (beendet alle Sitzungen). **Vergessen:** neuen Hash mit `npm run admin:hash` erzeugen, das Secret `ADMIN_PASSWORD_HASH` ersetzen und neu bereitstellen – ein ausgetauschtes Secret gewinnt immer und macht alle alten Sitzungen ungültig.
* **Konfiguration:** Entwurf → *Testfahrt* → *Veröffentlichen*. Neue Fahrten übernehmen die Version beim Start. Ist `/api/config` nicht erreichbar, startet das Spiel mit den eingebauten Standardwerten.
* **Ereignis „Flugwoche“:** Laufzeit beginnt beim Veröffentlichen und endet automatisch (serverseitige Zeit).
* **Daten:** Rohereignisse werden nach `RETENTION_DAYS` (Standard 30) gelöscht (läuft opportunistisch bei Messungen und Kennzahlen-Aufrufen).

## Sicherheitsmodell

* Eine Admin-Identität. Passwort: PBKDF2-HMAC-SHA-256 mit 100 000 Iterationen (Cloudflare Workers erlauben nicht mehr; Argon2id ist dort nicht verfügbar – daher mindestens 12 Zeichen und ein langes Zufallspasswort empfohlen). Der Hash liegt als Secret bzw. in D1, nie das Klartextpasswort.
* Jede private Seite (`/admin`, `/_admin/*`) und jede private API (`/api/admin/*`) wird serverseitig gegen die Sitzung geprüft. Ohne Sitzung gibt es nur die Login-Seite bzw. 401 – die Admin-Dateien werden nie anonym ausgeliefert (Pages leitet diese Pfade dank `public/_routes.json` an die Function).
* Sitzungstoken zufällig (256 Bit), in D1 nur als SHA-256 gespeichert, widerrufbar, gleitender Ablauf + absolute Obergrenze, an das aktuelle Passwort gebunden.
* Cookie `__Host-ssw_admin`: `HttpOnly`, `Secure`, `SameSite=Strict`. Schreibende Aufrufe: JSON, gleiche Herkunft und CSRF-Token.
* Anmeldung: 8 Fehlversuche je Adresse / 15 Min (insgesamt 40), in D1 gezählt, danach 429 mit `Retry-After`.
* Private Antworten: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, CSP, `X-Frame-Options: DENY`.
* Messung: `/api/e`, keine Cookies, keine IP-Speicherung, Besuchs-ID nur im Arbeitsspeicher; Eingaben validiert, dedupliziert, größenbegrenzt; Admin-Sitzungen, Testfahrten und QA-Läufe zählen nie. Die Ratenbegrenzung dieses Endpunkts gilt je Cloudflare-Instanz (bestmöglich) – für harten Schutz eine Cloudflare-WAF-„Rate limiting“-Regel auf `/api/e` anlegen.

## Grenzen der kostenlosen Pläne

* D1 (Free): 100 000 geschriebene Zeilen/Tag. Eine Fahrt schreibt ca. 10–40 Zeilen → grob 3 000 Fahrten/Tag.
* Pages Functions (Free): 100 000 Aufrufe/Tag, 10 ms CPU je Aufruf. Der Anmelde-Hash (PBKDF2) ist der teuerste Schritt; erscheint dabei Fehler 1102, hilft der Workers-Paid-Plan (5 $/Monat).

## Lokal prüfen

```bash
npm install
npm run build                     # Pages-Build (dist/) + lokaler Server (dist-server/)
npm run admin:passwd              # Passwort in der LOKALEN SQLite-Datei setzen (data/sunset.db)
npm start                         # http://127.0.0.1:8080  ·  Admin: /admin   (gleiche Handler-Logik wie in Cloudflare)
```
Mit echter Cloudflare-Laufzeit: `npx wrangler pages dev dist --d1=DB --binding ADMIN_PASSWORD_HASH="<hash>"`.
Browser-Abnahme: `node scripts/admin_check.mjs admin-shots`.

## Search Console (optional, nur lesend)

1. Google Cloud → OAuth-Client „Webanwendung“, Weiterleitungs-URI `https://www.sunsetsideways.com/api/admin/gsc/callback`, Search-Console-API aktivieren.
2. `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET` (Secret) und ein langes zufälliges `APP_SECRET` (Secret; verschlüsselt das gespeicherte Token) setzen, neu bereitstellen.
3. Admin → SEO → „Mit Google verbinden“. Der technische SEO-Check funktioniert unabhängig davon.
