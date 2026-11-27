/**
 * Sprachumschaltung Englisch / Deutsch. Standard: Englisch. Die Auswahl wird im Browser gemerkt.
 * Dynamische Texte im Code stehen auf Deutsch als Schlüssel: tr('Deutscher Text {n}', { n }) liefert im Englischen die Übersetzung aus EN.
 * Statische Texte der Seite (index.html) werden über die Tabelle STATIC gesetzt.
 */
export type Lang = 'en' | 'de';
const KEY = 'ss.lang';
const listeners: Array<(l: Lang) => void> = [];

function readStored(): Lang {
  try { const v = localStorage.getItem(KEY); if (v === 'de' || v === 'en') return v; } catch { /* kein Speicher */ }
  return 'en';
}
let lang: Lang = readStored();

export const getLang = (): Lang => lang;
/** Zahlenformat passend zur Sprache. */
export const locale = (): string => (lang === 'de' ? 'de-DE' : 'en-US');
export const onLang = (fn: (l: Lang) => void): void => { listeners.push(fn); };

const EN: Record<string, string> = {
  // Absturzursachen, Ziele, Pause
  'Taxi getroffen': 'Hit a taxi', 'Cabrio getroffen': 'Hit a convertible', 'Limousine getroffen': 'Hit a sedan', 'Lkw getroffen': 'Hit a truck', 'Bake getroffen': 'Hit a beacon', 'Absperrung getroffen': 'Hit a barrier',
  'Ziel: Sammle ein Power-up ein.': 'Goal: Collect a power-up.',
  'Ziel: Schaffe 1 km.': 'Goal: Reach 1 km.',
  'Ziel: Noch {n} m bis zu deiner Bestweite.': 'Goal: {n} m to go to your best distance.',
  'Ziel: Das {km}-km-Schild.': 'Goal: The {km} km sign.',
  'Automatisch pausiert: Das Fenster hat den Fokus verloren.': 'Paused automatically: the window lost focus.',
  'Automatisch pausiert: Der Tab war im Hintergrund.': 'Paused automatically: the tab was in the background.',
  'Automatisch pausiert: Das Gerät oder der Browser war kurz blockiert.': 'Paused automatically: your device or browser stalled briefly.',
  // Spiel
  'Testfahrt · Entwurf – zählt nicht': 'Test drive · draft – does not count',
  'Abgefangen!': 'Blocked!', 'Sprung': 'Jump', 'Fliegen': 'Fly', 'Normales Tempo': 'Normal speed', 'Schild abgelaufen': 'Shield expired',
  'Vorgemerkt: {x}': 'Queued: {x}',
  'Rush verloren': 'Rush lost', 'Rush vorbei': 'Rush over', 'Combo vorbei': 'Combo over',
  'Ziel erreicht!': 'Goal reached!', 'Dein Sprint': 'Your sprint', 'Deine Strecke': 'Your run',
  'Ziel erreicht ({n}×)': 'Goal reached ({n}×)',
  'Du hast die Neonnacht erreicht.': 'You reached the neon night.',
  'Teile den Sprint und fordere einen Freund heraus.': 'Share the sprint and challenge a friend.',
  'Ich habe den Sunset Sprint bis in die Neonnacht geschafft. Schaffst du das auch?': 'I made it through the Sunset Sprint to the neon night. Can you do it too?',
  'Ich bin im Sunset Sprint {km} km weit gekommen. Schaffst du mehr?': 'I got {km} km in the Sunset Sprint. Can you go further?',
  'Link kopiert. Du kannst ihn jetzt einfügen und verschicken.': 'Link copied. You can now paste and send it.',
  'Ton einschalten': 'Turn sound on', 'Ton ausschalten': 'Turn sound off',
  'Bestweite:': 'Best distance:', 'Stil-Rekord:': 'Style record:',
  // Steuerung
  'Mit den Pfeiltasten lenken': 'Steer with the arrow keys',
  'WISCHEN ODER TIPPEN ZUM LENKEN': 'SWIPE OR TAP TO STEER',
  '← → Lenken · Power-ups einsammeln, Hindernissen ausweichen.': '← → Steer · Collect power-ups, dodge obstacles.',
  'Wischen oder tippen zum Lenken · Power-ups einsammeln, Hindernissen ausweichen.': 'Swipe or tap to steer · Collect power-ups, dodge obstacles.',
  '← → Lenken': '← → Steer', 'Wischen oder tippen zum Lenken': 'Swipe or tap to steer',
  // Power-ups
  'Impulsschild': 'Pulse Shield', 'Zeitblase': 'Time Bubble', 'Spurblitz': 'Lane Flash', 'Magnetfeld': 'Magnet Field', 'Phantom-Turbo': 'Phantom Turbo', 'Pfadfinder': 'Pathfinder', 'Phantom': 'Phantom', 'Magnet': 'Magnet',
  // Rangliste
  'Lädt …': 'Loading …',
  'Die Weltrangliste ist gerade nicht erreichbar. Das Spiel funktioniert weiterhin.': 'The world leaderboard is unavailable right now. The game still works.',
  'Noch keine Einträge – veröffentliche nach einem Lauf deinen Namen und sei der Erste.': 'No entries yet – publish your name after a run and be the first.',
  'Top {n} · Punkte = Stilpunkte, bei Gleichstand zählt die Distanz': 'Top {n} · Points = style points, ties are decided by distance',
  'In diesem Modus und Zeitraum hast du noch keinen Eintrag.': 'You have no entry in this mode and period yet.',
  'Du hast noch keinen Score veröffentlicht.': 'You have not published a score yet.',
  'Dein bester Score': 'Your best score', 'Dein globaler Platz': 'Your global rank', 'Platz {n} weltweit': 'Rank {n} worldwide',
  'Die Weltrangliste ist für diesen Lauf nicht verfügbar.': 'The leaderboard is not available for this run.',
  'Aktuell: Platz {r} weltweit · dein bester Score {s}': 'Currently: rank {r} worldwide · your best score {s}',
  'Wird veröffentlicht …': 'Publishing …',
  'Veröffentlicht – neue persönliche Bestleistung!': 'Published – new personal best!',
  'Dieser Lauf ist bereits veröffentlicht.': 'This run has already been published.',
  'Veröffentlicht. Dein bisheriger Bestwert bleibt erhalten.': 'Published. Your previous best is kept.',
  'Platz {r} weltweit': 'Rank {r} worldwide',
  ' · {n}. in den letzten 7 Tagen': ' · #{n} in the last 7 days',
  'Für diesen Lauf ist keine Veröffentlichung möglich (keine Verbindung beim Start).': 'This run cannot be published (no connection at the start).',
  'Zu viele Anfragen. Bitte später erneut versuchen.': 'Too many requests. Please try again later.',
  'Die Weltrangliste ist gerade nicht erreichbar. Dein Ergebnis bleibt auf diesem Gerät.': 'The leaderboard is unavailable right now. Your result stays on this device.',
  'Die Weltrangliste ist gerade nicht erreichbar. Bitte später erneut versuchen.': 'The leaderboard is unavailable right now. Please try again later.',
  'Veröffentlichung nicht möglich.': 'Publishing is not possible.',
  // Namensprüfung
  'Bitte einen Namen eingeben.': 'Please enter a name.',
  'Der Name braucht mindestens {n} Zeichen.': 'The name needs at least {n} characters.',
  'Der Name darf höchstens {n} Zeichen haben.': 'The name may have at most {n} characters.',
  'Erlaubt sind Buchstaben, Ziffern, Leerzeichen sowie . _ -': 'Allowed: letters, digits, spaces and . _ -',
  'Bitte einen Namen mit Buchstaben oder Ziffern wählen.': 'Please choose a name with letters or digits.',
  'Dieser Name ist nicht erlaubt. Bitte einen anderen wählen.': 'This name is not allowed. Please choose another.',
  // Einwilligung
  'Datenschutz-Einwilligung': 'Privacy consent',
  'Statistik mit Google?': 'Statistics with Google?',
  ' Wir möchten mit dem Google Tag Manager anonyme Nutzungsstatistik erfassen. ': ' We would like to collect anonymous usage statistics with Google Tag Manager. ',
  'Dabei werden Daten an Google übertragen und eventuell Cookies gesetzt. ': 'This transfers data to Google and may set cookies. ',
  'Ohne deine Zustimmung wird nichts geladen – das Spiel läuft in jedem Fall. ': 'Nothing is loaded without your consent – the game runs either way. ',
  'Datenschutz': 'Privacy',
  'Ablehnen': 'Decline', 'Akzeptieren': 'Accept',
  // weitere Spieltexte
  'Sprint-Bestleistung:': 'Sprint best:',
  'Diese Herausforderung gibt es nicht mehr. Starte den aktuellen Sunset Sprint oder fahre Endless.': 'This challenge no longer exists. Start the current Sunset Sprint or play Endless.',
  ' Absender: Ziel erreicht (Angabe des Absenders).': ' Sender: reached the goal (as stated by the sender).',
  ' Absender: {km} km weit (Angabe des Absenders).': ' Sender: {km} km (as stated by the sender).',
  'Herausforderung: Sunset Sprint – erreiche die Neonnacht nach {km} km.{from} Starte, wenn du bereit bist.': 'Challenge: Sunset Sprint – reach the neon night after {km} km.{from} Start when you are ready.',
  'Geteilt.': 'Shared.',
  'Markiert: Link bitte selbst kopieren.': 'Selected: please copy the link yourself.',
  'Ziel: Noch {n} m bis zur Neonnacht.': 'Goal: {n} m to the neon night.',
  'Landung': 'Landing',
  'Kette: {n} Near Misses': 'Chain: {n} near misses',
  'in {n} s': 'in {n} s',
};

/** Übersetzt einen deutschen Schlüsseltext und setzt {Platzhalter} ein. */
export function tr(de: string, params?: Record<string, string | number>): string {
  let s = lang === 'en' ? (EN[de] ?? de) : de;
  if (params) for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]));
  return s;
}

/** Wie tr, erkennt zusätzlich fertig eingesetzte Texte mit Zahl (z. B. Fehlermeldungen aus gemeinsam genutztem Code). */
export function trLoose(s: string): string {
  if (lang !== 'en') return s;
  if (EN[s]) return EN[s];
  const m = /^Der Name (braucht mindestens|darf höchstens) (\d+) Zeichen/.exec(s);
  if (m) return tr(m[1] === 'braucht mindestens' ? 'Der Name braucht mindestens {n} Zeichen.' : 'Der Name darf höchstens {n} Zeichen haben.', { n: m[2] });
  return s;
}

type Mode = 'text' | 'html' | string;   // 'text', 'html' oder Attributname (z. B. aria-label)
const T = 'text';
/** [Selektor, Modus, Deutsch, Englisch] */
const STATIC: Array<[string, Mode, string, string]> = [
  ['#stage', 'aria-label', 'Spielfläche', 'Game canvas'],
  ['.hud-left > .stat:first-child .lbl', T, 'Strecke', 'Distance'],
  ['#hud-best-wrap .lbl', T, 'Bestweite', 'Best'],
  ['#hud-style', 'aria-label', 'Stilwertung', 'Style score'],
  ['#hud-style .st-score .lbl', T, 'Stil', 'Style'],
  ['#hud-combo .cap', T, 'Combo', 'Combo'],
  ['#hud-effects', 'aria-label', 'Aktive Effekte', 'Active effects'],
  ['#fx-shield .fx-name', T, 'Impulsschild', 'Pulse Shield'],
  ['#fx-magnet .fx-name', T, 'Magnet', 'Magnet'],
  ['#fx-blitz .fx-name', T, 'Spurblitz', 'Lane Flash'],
  ['#fx-glide .fx-name', T, 'Fliegen', 'Fly'],
  ['#fx-boost .fx-name', T, 'Phantom', 'Phantom'],
  ['#fx-guide .fx-name', T, 'Pfadfinder', 'Pathfinder'],
  ['#fx-slow .fx-name', T, 'Zeitblase', 'Time Bubble'],
  ['#sprint-bar span', T, 'Ziel', 'Goal'],
  ['#btn-pause', 'aria-label', 'Pause', 'Pause'],
  ['#hint .hint-text', T, 'Weiche aus', 'Dodge'],
  ['#screen-start', 'aria-label', 'Start', 'Start'],
  ['#screen-start .tagline .t-desk', T, 'Weiche dem Verkehr aus. Wie weit kommst du?', 'Dodge the traffic. How far can you get?'],
  ['#screen-start .tagline .t-touch', T, 'WEICHE AUS. ÜBERLEBE. SCHLAGE DEN REKORD.', 'DODGE. SURVIVE. BEAT THE RECORD.'],
  ['#start-best-label', T, 'Bestweite:', 'Best distance:'],
  ['#btn-start .t-desk', T, 'Fahren', 'Drive'],
  ['#btn-start .t-touch', T, 'JETZT SPIELEN', 'PLAY NOW'],
  ['#btn-sprint span', T, 'Erreiche die Neonnacht', 'Reach the neon night'],
  ['#btn-lb', T, 'Weltrangliste', 'World leaderboard'],
  ['#about summary', T, 'So funktioniert Sunset Sideways', 'How Sunset Sideways works'],
  ['#about-text', 'html',
    `<h2>Das Rennspiel für den Browser</h2>
          <p>Du fährst einen Sportwagen über einen dreispurigen Boulevard. Das Auto fährt von allein nach vorn und wird mit der Strecke immer schneller – du lenkst nur nach links und rechts. Weiche Taxis, Cabrios, Limousinen, Lkw, Baken und Absperrungen aus und komme so weit wie möglich. Die Bestweite wird in deinem Browser gespeichert.</p>
          <p>Aus dem warmen Sonnenuntergang wird Dämmerung und schließlich eine Neonnacht mit aufgehendem Mond. Sunset Sideways ist kostenlos, braucht keinen Download und keine Anmeldung und läuft am Computer und auf dem Smartphone.</p>
          <h3>Steuerung</h3>
          <ul>
            <li><strong>Computer:</strong> mit den Pfeiltasten ← und → lenken, mit Enter oder der Leertaste starten, mit Esc pausieren.</li>
            <li><strong>Smartphone und Tablet:</strong> den Daumen nach links oder rechts wischen oder links bzw. rechts auf den Bildschirm tippen (eine Spur pro Tipp).</li>
          </ul>
          <h3>Power-ups</h3>
          <ul>
            <li><strong>Impulsschild:</strong> schützt vor einem Aufprall.</li>
            <li><strong>Zeitblase:</strong> verlangsamt das Geschehen.</li>
            <li><strong>Spurblitz:</strong> räumt Hindernisse aus deiner Spur.</li>
            <li><strong>Magnetfeld:</strong> zieht Power-ups heran.</li>
            <li><strong>Fliegen:</strong> hebt das Auto über den Verkehr.</li>
            <li><strong>Phantom-Turbo:</strong> beschleunigt kurzzeitig.</li>
            <li><strong>Pfadfinder:</strong> zeigt dir die freie Spur.</li>
          </ul>`,
    `<h2>The racing game for your browser</h2>
          <p>You drive a sports car along a three-lane boulevard. The car moves forward on its own and gets faster the further you go – you only steer left and right. Dodge taxis, convertibles, sedans, trucks, beacons and barriers and get as far as you can. Your best distance is saved in your browser.</p>
          <p>The warm sunset turns into dusk and finally a neon night with a rising moon. Sunset Sideways is free, needs no download and no sign-up, and runs on computers and smartphones.</p>
          <h3>Controls</h3>
          <ul>
            <li><strong>Computer:</strong> steer with the left and right arrow keys, start with Enter or Space, pause with Esc.</li>
            <li><strong>Smartphone and tablet:</strong> swipe your thumb left or right, or tap the left or right side of the screen (one lane per tap).</li>
          </ul>
          <h3>Power-ups</h3>
          <ul>
            <li><strong>Pulse Shield:</strong> protects you from one crash.</li>
            <li><strong>Time Bubble:</strong> slows everything down.</li>
            <li><strong>Lane Flash:</strong> clears obstacles from your lane.</li>
            <li><strong>Magnet Field:</strong> pulls power-ups towards you.</li>
            <li><strong>Fly:</strong> lifts the car over the traffic.</li>
            <li><strong>Phantom Turbo:</strong> a short burst of speed.</li>
            <li><strong>Pathfinder:</strong> shows you the free lane.</li>
          </ul>`],
  ['.legal', 'aria-label', 'Rechtliches', 'Legal'],
  ['.legal a[href="/datenschutz"]', T, 'Datenschutz', 'Privacy (German)'],
  ['.legal a[href="/impressum"]', T, 'Impressum', 'Legal notice (German)'],
  ['#consent-settings', T, 'Cookie-Einstellungen', 'Cookie settings'],
  ['#screen-pause', 'aria-label', 'Pause', 'Pause'],
  ['#screen-pause h2', T, 'Pause', 'Paused'],
  ['#btn-resume', T, 'Fortsetzen', 'Resume'],
  ['#btn-restart', T, 'Neu starten', 'Restart'],
  ['#screen-result', 'aria-label', 'Ergebnis', 'Result'],
  ['#res-record', T, 'Neuer Rekord!', 'New record!'],
  ['#res-stats', 'aria-label', 'Stilwertung dieses Laufs', 'Style score of this run'],
  ['#res-stats li:nth-child(1) .l', T, 'Stilpunkte', 'Style points'],
  ['#res-stats li:nth-child(2) .l', T, 'Near Misses', 'Near misses'],
  ['#res-stats li:nth-child(3) .l', T, 'Beste Combo', 'Best combo'],
  ['#res-stats li:nth-child(4) .l', T, 'Neon Rush', 'Neon Rush'],
  ['#res-style-record', T, 'Neuer Stil-Rekord!', 'New style record!'],
  ['#btn-again .t-desk', T, 'Nochmal fahren', 'Drive again'],
  ['#btn-again .t-touch', T, 'NOCHMAL FAHREN', 'DRIVE AGAIN'],
  ['.res-lb-t', T, 'Weltrangliste', 'World leaderboard'],
  ['label[for="lb-name"]', T, 'Dein Name für die Weltrangliste', 'Your name for the leaderboard'],
  ['#lb-name', 'placeholder', 'Dein Name', 'Your name'],
  ['#lb-publish', T, 'Veröffentlichen', 'Publish'],
  ['#lb-view', T, 'Weltrangliste ansehen', 'View leaderboard'],
  ['.lb-priv', T, 'Name und Ergebnis werden öffentlich angezeigt. Ohne Veröffentlichung bleibt alles auf diesem Gerät.', 'Name and result are shown publicly. Without publishing, everything stays on this device.'],
  ['#btn-res-lb', T, 'RANGLISTE', 'LEADERBOARD'],
  ['#btn-share', T, 'Freund herausfordern', 'Challenge a friend'],
  ['#btn-endless', T, 'Endless fahren', 'Drive Endless'],
  ['label[for="share-url"]', T, 'Link zur Herausforderung', 'Challenge link'],
  ['#btn-copy', T, 'Link kopieren', 'Copy link'],
  ['#lb-title', T, 'Weltrangliste', 'World leaderboard'],
  ['.lb-tabs:not(.lb-tabs-period)', 'aria-label', 'Spielmodus', 'Game mode'],
  ['.lb-tabs-period', 'aria-label', 'Zeitraum', 'Period'],
  ['[data-lb-period="all"]', T, 'Gesamt', 'All time'],
  ['[data-lb-period="7d"]', T, 'Letzte 7 Tage', 'Last 7 days'],
  ['.lb-table th:nth-child(1)', T, 'Platz', 'Rank'],
  ['.lb-table th:nth-child(2)', T, 'Spieler', 'Player'],
  ['.lb-table th:nth-child(3)', T, 'Punkte', 'Points'],
  ['.lb-table th:nth-child(4)', T, 'Distanz', 'Distance'],
  ['#lb-close', T, 'Schließen', 'Close'],
  ['#hud-rush-lbl', T, 'Neon Rush', 'Neon Rush'],
  ['#res-best-label', T, 'Bestweite:', 'Best distance:'],
  ['#res-style-best-label', T, 'Stil-Rekord:', 'Style record:'],
  ['#about img', 'alt', 'Sunset Sideways: Sportwagen fährt bei Sonnenuntergang auf einer dreispurigen Straße zwischen Verkehr', 'Sunset Sideways: a sports car drives at sunset on a three-lane road between traffic'],
];
export const STATIC_TABLE = STATIC;

const META_DE = {
  title: 'Sunset Sideways – Arcade-Rennspiel im Browser',
  desc: 'Browser-Rennspiel: Weiche dem Verkehr aus, sammle Power-ups und rase vom Sonnenuntergang in die Neonnacht. Kostenlos, per Tastatur oder Touch.',
  social: 'Weiche dem Verkehr aus, sammle Power-ups und rase vom Sonnenuntergang in die Neonnacht – kostenlos im Browser.',
};
const META_EN = {
  title: 'Sunset Sideways – Arcade Racing Game in Your Browser',
  desc: 'Browser racing game: dodge the traffic, collect power-ups and race from sunset into the neon night. Free, with keyboard or touch.',
  social: 'Dodge the traffic, collect power-ups and race from sunset into the neon night – free in your browser.',
};

function setMeta(sel: string, attr: string, v: string): void { document.querySelector(sel)?.setAttribute(attr, v); }

/** Statische Texte der Seite, Dokumentsprache und Meta-Angaben an die gewählte Sprache anpassen. */
export function applyStatic(): void {
  if (typeof document === 'undefined') return;
  const en = lang === 'en';
  document.documentElement.lang = lang;
  for (const [sel, mode, de, eng] of STATIC) {
    const v = en ? eng : de;
    document.querySelectorAll<HTMLElement>(sel).forEach((n) => {
      if (mode === 'text') n.textContent = v; else if (mode === 'html') n.innerHTML = v; else n.setAttribute(mode, v);
    });
  }
  const m = en ? META_EN : META_DE;
  document.title = m.title;
  setMeta('meta[name="description"]', 'content', m.desc);
  setMeta('meta[property="og:title"]', 'content', m.title);
  setMeta('meta[property="og:description"]', 'content', m.social);
  setMeta('meta[property="og:locale"]', 'content', en ? 'en_US' : 'de_DE');
  setMeta('meta[name="twitter:title"]', 'content', m.title);
  setMeta('meta[name="twitter:description"]', 'content', m.social);
  document.querySelectorAll<HTMLButtonElement>('#lang-switch button[data-lang]').forEach((b) => {
    const on = b.dataset.lang === lang;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('on', on);
  });
}

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignorieren */ }
  applyStatic();
  for (const fn of listeners) fn(l);
}

/** Umschalter oben rechts im Startbildschirm verdrahten. */
export function initLangSwitch(): void {
  document.querySelectorAll<HTMLButtonElement>('#lang-switch button[data-lang]').forEach((b) => {
    b.addEventListener('click', (e) => { e.stopPropagation(); setLang(b.dataset.lang as Lang); });
  });
  applyStatic();
}
