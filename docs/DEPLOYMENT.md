# Admin-Bereich: lokal testen und öffentlich betreiben

Voraussetzung: **Node.js ≥ 24.7** (eingebautes `node:sqlite` und Argon2id; keine weiteren Laufzeit-Abhängigkeiten).

## Lokal prüfen

```bash
npm install
npm run build                 # Spiel (dist), Admin-UI (dist-admin), Server (dist-server)
npm run db:init               # legt data/sunset.db an (Pfad: Umgebungsvariable DB_PATH)
npm run admin:passwd          # Passwort verdeckt eingeben (mind. 12 Zeichen) – gleicher Befehl ändert es später
npm start                     # http://127.0.0.1:8080  ·  Admin: http://127.0.0.1:8080/admin
```

Weitere Befehle: `npm run db:info` (Stand der Datenbank), `npm run admin:logout-all` (alle Sitzungen beenden).
Das Passwort wird nie im Klartext gespeichert (Argon2id, 19 MiB, 2 Durchgänge). Eine Passwortänderung – im Admin-Menü oder per CLI – beendet alle Sitzungen.
Abnahme im echten Chrome: `node scripts/admin_check.mjs admin-shots` (startet eigenen Server mit frischer Datenbank unter `data-accept/`).

## Öffentlich betreiben (eigene Domain, HTTPS)

1. **Server** mit Node ≥ 24.7 (VPS, Raspberry Pi, Container). DNS-A/AAAA-Eintrag der Domain auf den Server.
2. Projekt auf den Server kopieren, `npm ci && npm run build`.
3. **Umgebungsvariablen** (z. B. `/etc/sunset.env`):

   | Variable | Bedeutung |
   |---|---|
   | `NODE_ENV=production` | Cookie `__Host-ssw_admin` mit `Secure` |
   | `PUBLIC_ORIGIN=https://spiel.example.de` | Canonical, Sitemap, Origin-/CSRF-Prüfung, OAuth-Rückkehr |
   | `HOST=127.0.0.1`, `PORT=8080` | nur lokal lauschen, Proxy davor |
   | `TRUST_PROXY=1` | echte Client-Adresse für Anmelde-/API-Limits (letzter `X-Forwarded-For`-Eintrag) |
   | `DB_PATH=/var/lib/sunset/sunset.db` | Datenbank (regelmäßig sichern) |
   | `RETENTION_DAYS=30` | Rohdaten werden nach 30 Tagen gelöscht |
   | `SESSION_IDLE_HOURS=12`, `SESSION_ABSOLUTE_DAYS=7` | Sitzungsablauf |
   | `APP_SECRET`, `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET` | optional: Search Console (siehe unten) |

4. **Passwort setzen** (auf dem Server): `set -a; . /etc/sunset.env; set +a; npm run admin:passwd`
5. **Dienst** (systemd `/etc/systemd/system/sunset.service`):

   ```ini
   [Service]
   WorkingDirectory=/opt/sunset
   EnvironmentFile=/etc/sunset.env
   ExecStart=/usr/bin/node dist-server/index.mjs
   Restart=always
   User=sunset
   ```
   `systemctl enable --now sunset`
6. **HTTPS-Proxy** – am einfachsten Caddy (holt Zertifikate selbst, leitet HTTP auf HTTPS um, komprimiert):

   ```
   spiel.example.de {
     reverse_proxy 127.0.0.1:8080
   }
   ```
7. Fertig: Spiel unter `https://spiel.example.de/`, Admin unter **`https://spiel.example.de/admin`**. Danach im Admin → SEO die Adresse eintragen und „Jetzt prüfen“.

Ohne Reverse-Proxy (nicht empfohlen): Dienst nicht öffentlich auf Port 80/443 binden – Cookies sind in Produktion `Secure` und funktionieren nur über HTTPS.

## Sicherheitsmodell (Kurzfassung)

* Eine Admin-Identität, Passwort nur per CLI/Admin-Menü; Sitzungstoken zufällig (256 Bit), in der Datenbank nur als SHA-256 gespeichert, widerrufbar, gleitender Ablauf + absolute Obergrenze.
* Jede private Seite **und** jede private API wird serverseitig gegen die Sitzung geprüft; ohne Sitzung gibt es nur die Login-Seite bzw. 401. Admin-Dateien (JS/CSS) werden nie anonym ausgeliefert.
* Cookies `HttpOnly`, `SameSite=Strict`, in Produktion `Secure` + `__Host-`-Präfix. Schreibende Aufrufe: JSON, gleiche Herkunft und CSRF-Token (`X-CSRF-Token`).
* Anmeldung: 8 Fehlversuche je Adresse / 15 Min (insgesamt 40), danach 429 mit `Retry-After`.
* Private Antworten: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, CSP, `X-Frame-Options: DENY`.
* Messung: Erstanbieter-API `/api/e`, keine Cookies, keine IP-Speicherung, zufällige Besuchs-ID nur im Arbeitsspeicher; Eingaben werden validiert, dedupliziert und ratenbegrenzt; Admin-Sitzungen, Testfahrten und QA-Läufe werden nicht gezählt.

## Spielkonfiguration im Betrieb

* Entwurf → „Testfahrt“ (30 Min gültiger Link, zählt weder für Kennzahlen noch Bestweite) → „Veröffentlichen“ (feste Versions-ID, atomar). Neue Fahrten übernehmen die Version beim Start; laufende Fahrten behalten ihren Stand.
* Ist `/api/config` nicht erreichbar, startet das Spiel mit den eingebauten Standardwerten (Profil „Arcade“).
* „Flugwoche“: Laufzeit beginnt beim Veröffentlichen und endet automatisch (serverseitige Zeit, kein Cron nötig).

## Search Console (optional, nur lesend)

1. Google Cloud → OAuth-Client „Webanwendung“, Weiterleitungs-URI `https://spiel.example.de/admin/api/gsc/callback`, Search-Console-API aktivieren.
2. `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET` und ein langes zufälliges `APP_SECRET` (verschlüsselt das gespeicherte Token) setzen, Dienst neu starten.
3. Admin → SEO → „Mit Google verbinden“, bestätigte Property wählen. Der technische SEO-Check funktioniert unabhängig davon.
