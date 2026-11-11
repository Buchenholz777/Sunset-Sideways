import { api, ApiError } from './api';
import { clear, dt, dur, h, n0, n1, n2, pct, s } from './dom';
import { hbars } from './charts';
import {
  DEFAULT_CONFIG, FIELD_BY_PATH, KINDS_LABEL, PICKUPS, PICKUP_LABEL, PROFILES, detectProfile, fromDisplay, getPath, knotsFor, pickupShares, setPath, toDisplay, trafficShares,
  type Diff, type Field, type GameConfig, type Issue, type PickupKey, type VehicleKey,
} from '../src/config/runtime';
import { setSpeedKnots, speedAtDist } from '../src/core/speed';
import { BASE_KNOTS } from '../src/config/runtime';
import type { Analysis } from '../src/config/analyze';

interface StateBody {
  now: number; draft: GameConfig; issues: Issue[]; analysis: Analysis; defaults: GameConfig;
  published: { id: number; publishedAt: number; label: string | null; config: GameConfig } | null;
  dirty: boolean; diff: Diff[];
  event: { state: 'off' | 'active' | 'expired'; endsAt: number | null; remainingMs: number; boost: number };
  versions: Array<{ id: number; label: string | null; publishedAt: number; eventStart: number | null; eventEnd: number | null; eventOn: boolean; profile: string }>;
}

const decimals = (f: Field): number => { const st = f.step * (f.scale ?? 1); return st >= 1 ? 0 : st >= 0.1 ? 1 : 2; };
const fmtVal = (f: Field, v: number): string => `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: decimals(f), maximumFractionDigits: decimals(f) }).format(toDisplay(f, v))} ${f.unit}`;

export async function renderSettings(root: HTMLElement): Promise<void> {
  let st = await api<StateBody>('GET', '/state');
  let draft: GameConfig = JSON.parse(JSON.stringify(st.draft));
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saving: 'idle' | 'pending' | 'saving' | 'saved' | 'error' = 'idle';
  const updaters: Array<() => void> = [];
  const issueSlots = new Map<string, HTMLElement[]>();

  const statusBar = h('div', { class: 'statusbar', role: 'region', 'aria-label': 'Status und Aktionen' });
  const body = h('div', { class: 'view-body' });
  const toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  clear(root);
  root.append(statusBar, body, toast);

  const say = (msg: string, kind: 'ok' | 'err' = 'ok'): void => { toast.textContent = msg; toast.className = `toast show ${kind}`; setTimeout(() => { toast.className = 'toast'; }, 6000); };

  // ---------------------------------------------------------------- Speichern des Entwurfs
  const scheduleSave = (): void => {
    saving = 'pending'; paintStatus();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saving = 'saving'; paintStatus();
      try { const r = await api<StateBody>('PUT', '/draft', { config: draft }); st = { ...r }; saving = 'saved'; }
      catch (e) { saving = 'error'; say(`Entwurf konnte nicht gespeichert werden: ${(e as Error).message}`, 'err'); }
      paintAll();
    }, 500);
  };
  const changed = (): void => { draft.profile = detectProfile(draft); paintAll(); scheduleSave(); };

  // ---------------------------------------------------------------- Bausteine
  function slider(path: string): HTMLElement {
    const f = FIELD_BY_PATH[path];
    const id = `c-${path.replace(/\./g, '-')}`;
    const lo = toDisplay(f, f.min), hi = toDisplay(f, f.max), step = f.step * (f.scale ?? 1);
    const range = h('input', { id, type: 'range', min: lo, max: hi, step, 'aria-describedby': `${id}-e ${id}-i` });
    const num = h('input', { type: 'number', min: lo, max: hi, step, inputmode: 'decimal', 'aria-label': `${f.label} als Zahl (${f.unit})`, class: 'num' });
    const val = h('output', { for: id, class: 'val' });
    const def = h('span', { class: 'def' });
    const reset = h('button', { type: 'button', class: 'link', 'aria-label': `${f.label} auf Standard zurücksetzen` }, 'Standard');
    const issue = h('div', { class: 'issue', id: `${id}-i`, role: 'status' });
    const apply = (disp: number): void => {
      if (!Number.isFinite(disp)) return;
      const raw = Math.min(f.max, Math.max(f.min, fromDisplay(f, disp)));
      setPath(draft, path, Math.round(raw / f.step) * f.step);
      changed();
    };
    range.addEventListener('input', () => apply(Number(range.value)));
    num.addEventListener('change', () => apply(Number(num.value)));
    reset.addEventListener('click', () => { setPath(draft, path, getPath(DEFAULT_CONFIG, path)); changed(); });
    const upd = (): void => {
      const v = getPath(draft, path) as number;
      range.value = String(toDisplay(f, v));
      if (document.activeElement !== num) num.value = String(toDisplay(f, v));
      val.textContent = fmtVal(f, v);
      const d = getPath(DEFAULT_CONFIG, path) as number;
      def.textContent = `Standard: ${fmtVal(f, d)}`;
      reset.hidden = v === d;
      const pct01 = ((toDisplay(f, v) - lo) / (hi - lo)) * 100;
      range.style.setProperty('--fill', `${pct01}%`);
    };
    updaters.push(upd);
    const slot: HTMLElement[] = issueSlots.get(path) ?? []; slot.push(issue); issueSlots.set(path, slot);
    return h('div', { class: 'ctl' },
      h('div', { class: 'ctl-head' }, h('label', { for: id }, f.label), val),
      h('div', { class: 'ctl-row' }, range, h('span', { class: 'numwrap' }, num, h('span', { class: 'unit' }, f.unit))),
      h('div', { class: 'ctl-meta' }, def, reset),
      h('p', { class: 'effect', id: `${id}-e` }, f.effect), issue);
  }

  function toggle(path: string, label: string, hint = ''): HTMLElement {
    const id = `t-${path.replace(/\./g, '-')}`;
    const input = h('input', { type: 'checkbox', role: 'switch', id });
    input.addEventListener('change', () => { setPath(draft, path, input.checked); changed(); });
    const state = h('span', { class: 'sw-state' });
    updaters.push(() => { const v = getPath(draft, path) as boolean; input.checked = v; state.textContent = v ? 'an' : 'aus'; });
    const issue = h('div', { class: 'issue', role: 'status' });
    const slot: HTMLElement[] = issueSlots.get(path) ?? []; slot.push(issue); issueSlots.set(path, slot);
    return h('div', { class: 'ctl tog' }, h('label', { class: 'switch', for: id }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', { class: 'sw-label' }, label), state), hint ? h('p', { class: 'effect' }, hint) : null, issue);
  }

  const card = (id: string, title: string, intro: string, ...kids: Array<Node | null>): HTMLElement =>
    h('section', { class: 'panel setting', id: `sec-${id}`, 'aria-labelledby': `h-${id}` }, h('h2', { id: `h-${id}` }, title), h('p', { class: 'muted intro' }, intro), ...kids);
  const details = (summary: string, ...kids: Node[]): HTMLElement => h('details', { class: 'more' }, h('summary', null, summary), h('div', { class: 'more-body' }, ...kids));
  const derived = (render: () => Node): HTMLElement => { const box = h('div', { class: 'derived' }); updaters.push(() => { clear(box); box.append(render()); }); return box; };

  // ---------------------------------------------------------------- Abschnitte
  function curveSvg(): Node {
    const W = 560, H = 190, L = 46, R = 10, T = 10, B = 36;
    const xMax = 45000, yMax = 720;
    const px = (m: number): number => L + (m / xMax) * (W - L - R), py = (v: number): number => T + (1 - v / yMax) * (H - T - B);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg curve', role: 'img', 'aria-label': `Tempo über der Strecke: Start ${draft.tempo.startKmh} km/h, Höchsttempo ${draft.tempo.maxKmh} km/h nach ${draft.tempo.distToMaxKm} km.` });
    for (const v of [0, 200, 400, 600]) { svg.append(s('line', { x1: L, x2: W - R, y1: py(v), y2: py(v), class: 'grid' })); const t = s('text', { x: L - 6, y: py(v) + 4, class: 'tick', 'text-anchor': 'end' }); t.textContent = String(v); svg.append(t); }
    for (const k of [0, 10, 20, 30, 40]) { const t = s('text', { x: px(k * 1000), y: H - B + 16, class: 'tick', 'text-anchor': 'middle' }); t.textContent = String(k); svg.append(t); }
    const xt = s('text', { x: (L + W - R) / 2, y: H - 4, class: 'axis-title', 'text-anchor': 'middle' }); xt.textContent = 'Strecke (km)'; svg.append(xt);
    const yt = s('text', { x: 11, y: (T + H - B) / 2, class: 'axis-title', 'text-anchor': 'middle', transform: `rotate(-90 11 ${(T + H - B) / 2})` }); yt.textContent = 'km/h'; svg.append(yt);
    const path = (knots: ReadonlyArray<readonly [number, number]>): string => {
      setSpeedKnots(knots);
      let d = '';
      for (let i = 0; i <= 90; i++) { const m = (i / 90) * xMax; d += `${i ? 'L' : 'M'}${px(m).toFixed(1)} ${py(speedAtDist(m)).toFixed(1)} `; }
      return d;
    };
    svg.append(s('path', { d: path(BASE_KNOTS), class: 'line b dashed', fill: 'none' }));
    svg.append(s('path', { d: path(knotsFor(draft.tempo)), class: 'line a', fill: 'none' }));
    return svg;
  }

  const tempo = card('tempo', 'Tempo & Schwierigkeit', 'Wie schnell das Spiel wird und wie dicht die Ausweichstellen kommen.',
    (() => {
      const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Schwierigkeitsprofil' });
      const text = h('p', { class: 'muted' });
      const paint = (): void => {
        clear(seg);
        for (const k of ['relaxed', 'arcade', 'hard'] as const) {
          const on = draft.profile === k;
          seg.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'on' : '', onclick: async () => { st = await api<StateBody>('POST', '/draft/profile', { profile: k }); draft = JSON.parse(JSON.stringify(st.draft)); paintAll(); say(`Profil „${PROFILES[k].label}“ in den Entwurf geladen – danach frei anpassbar.`); } }, PROFILES[k].label));
        }
        text.textContent = draft.profile === 'custom' ? 'Eigene Werte (weicht von allen Profilen ab).' : PROFILES[draft.profile].text;
      };
      updaters.push(paint);
      return h('div', { class: 'profiles' }, seg, text);
    })(),
    slider('tempo.startKmh'), slider('tempo.maxKmh'), slider('tempo.distToMaxKm'), slider('tempo.density'),
    derived(() => h('figure', { class: 'curve-fig' }, curveSvg(), h('figcaption', { class: 'muted' }, 'Tempo über der Strecke (durchgezogen: Entwurf, gestrichelt: bisherige Standardkurve).'))));

  const traffic = card('traffic', 'Verkehr', 'Welche Hindernisse vorkommen und wie dicht sie aufeinander folgen.',
    toggle('traffic.baken', 'Baken', 'Statische Warnbaken als Hindernis.'), toggle('traffic.barrier', 'Absperrungen', 'Statische Absperrung als Hindernis.'),
    slider('traffic.minGap'),
    derived(() => {
      const sh = trafficShares(draft.traffic);
      const rows = (['taxi', 'cabrio', 'sedan', 'truck'] as VehicleKey[]).map((k) => ({ label: KINDS_LABEL[k], frac: sh[k], text: pct(sh[k], 0) })) as Array<{ label: string; frac: number; text: string }>;
      if (draft.traffic.baken) rows.push({ label: 'Baken', frac: sh.baken, text: pct(sh.baken, 0) });
      if (draft.traffic.barrier) rows.push({ label: 'Absperrung', frac: sh.barrier, text: pct(sh.barrier, 0) });
      return h('div', null, h('h3', null, 'Resultierende Verteilung der Hindernisse'), hbars(rows), h('p', { class: 'muted' }, 'Näherung aus den Gewichten; die Verteilung im Spiel schwankt zufällig.'));
    }),
    details('Details: relative Häufigkeit je Fahrzeugtyp', ...(['taxi', 'cabrio', 'sedan', 'truck'] as const).map((k) => slider(`traffic.${k}`))));

  const pickups = card('pickups', 'Power-ups', 'Wie oft Power-ups angeboten werden und welche.',
    slider('pickups.freq'),
    derived(() => {
      const perMin = draft.pickups.freq <= 0 ? 0 : (60 * draft.pickups.freq) / 11.5;
      const sh = pickupShares(draft.pickups, 0);
      const anyOn = PICKUPS.some((k) => draft.pickups.on[k]);
      return h('div', null, h('p', null, h('strong', null, 'Zusammenspiel: '), draft.pickups.freq <= 0 ? 'Es werden keine Power-ups angeboten.' : anyOn ? `etwa ${n1(perMin)} Angebote pro Minute Fahrzeit (Häufigkeit ${n2(draft.pickups.freq)}×). Verteilung nach Anteil:` : 'Alle Power-ups sind ausgeschaltet.'),
        hbars(PICKUPS.map((k) => ({ label: PICKUP_LABEL[k], frac: sh[k], text: draft.pickups.on[k] ? `${pct(sh[k], 0)} · ca. ${n1(perMin * sh[k])} / Min` : 'aus' }))));
    }),
    h('div', { class: 'pu-list' }, ...PICKUPS.map((k: PickupKey) => h('div', { class: 'pu' }, toggle(`pickups.on.${k}`, PICKUP_LABEL[k]), details('Anteil & Dauer', slider(`pickups.share.${k}`), slider(`pickups.dur.${k}`))))),
    details('Fliegen: Zeitpunkt des ersten Angebots', slider('pickups.glideFirstM')));

  const controls = card('controls', 'Steuerung', 'Die Empfindlichkeit fließt in die Fairness-Prüfung der Strecke ein: Sehr niedrige Werte lassen den Generator Begegnungen weiter auseinanderziehen.',
    slider('controls.key'), slider('controls.touch'),
    derived(() => {
      const a = st.analysis.samples;
      return h('div', { class: 'tbl-scroll' }, h('table', { class: 'data' }, h('caption', null, 'Prüfung mit der Streckengenerator-Logik (Entwurf)'),
        h('thead', null, h('tr', null, ...['Strecke', 'Tempo', 'Ein Spurwechsel dauert', 'Abstand der Reihen', 'Begegnungen/km', 'gestreckt'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, ...a.map((x) => h('tr', null, h('th', { scope: 'row' }, `${x.km} km`), h('td', null, `${n0(x.kmh)} km/h`), h('td', null, `${n2(x.laneChangeS)} s`), h('td', null, `${n2(x.rowGapS)} s`), h('td', null, n1(x.perKm)), h('td', null, pct(x.fallback, 0)))))));
    }));

  const scenery = card('scenery', 'Kulisse', 'Dämmerung, Nacht und Mond nach Strecke sowie die Neon-Kulisse.',
    slider('scenery.duskKm'), slider('scenery.nightKm'), slider('scenery.moonHighKm'), slider('scenery.neon'),
    toggle('scenery.planes', 'Flugzeuge am Himmel'), toggle('scenery.peds', 'Fußgänger am Straßenrand'), toggle('scenery.fountains', 'Brunnen'));

  const audio = card('audio', 'Sound & Effekte', 'Standardpegel. Die persönliche Ton-Einstellung der Spielenden hat immer Vorrang; Warn- und Power-up-Signale bleiben mindestens bei 40 % hörbar.',
    slider('audio.music'), slider('audio.engine'), slider('audio.sfx'));

  const eventCard = card('event', 'Zeitlich begrenztes Ereignis: Flugwoche', 'Erhöht vorübergehend den Fliegen-Anteil. Die Laufzeit beginnt mit dem Veröffentlichen und endet automatisch; danach gilt wieder die normale Konfiguration.',
    toggle('event.on', 'Flugwoche aktiv'), slider('event.glideBoost'), slider('event.days'),
    derived(() => {
      const base = pickupShares(draft.pickups, 0).glide, withEv = pickupShares(draft.pickups, draft.event.glideBoost).glide;
      const ev = st.event;
      return h('div', { class: 'event-box' },
        h('p', null, h('strong', null, 'Wirkung: '), `Fliegen-Anteil am Angebot ${pct(base, 0)} → ${pct(withEv, 0)} während des Ereignisses.`),
        h('p', null, h('strong', null, 'Ende bei Veröffentlichung jetzt: '), dt(Date.now() + draft.event.days * 86400_000, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' Uhr'),
        h('p', { class: `ev-state ${ev.state}` }, h('strong', null, 'Veröffentlichter Stand: '), ev.state === 'active' ? `läuft noch ${dur(ev.remainingMs)} (bis ${dt(ev.endsAt!, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr)` : ev.state === 'expired' ? `abgelaufen am ${dt(ev.endsAt!, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr – reguläre Konfiguration gilt` : 'kein Ereignis aktiv'),
        h('p', { class: 'muted' }, 'Fahrten während des Ereignisses werden in den Kennzahlen getrennt ausgewertet (Filter „Ereignis“).'));
    }));

  const history = card('history', 'Versionsverlauf', 'Jede Veröffentlichung ist eine feste Version. „Wiederherstellen“ lädt sie in den Entwurf – veröffentlicht wird erst danach.',
    derived(() => st.versions.length === 0 ? h('p', { class: 'muted' }, 'Noch nichts veröffentlicht – das Spiel läuft mit den eingebauten Standardwerten.') :
      h('div', { class: 'tbl-scroll' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, ...['Version', 'Veröffentlicht', 'Name', 'Profil', 'Ereignis', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, ...st.versions.map((v) => h('tr', null,
          h('th', { scope: 'row' }, `${v.id}${st.published?.id === v.id ? ' (aktuell)' : ''}`), h('td', null, dt(v.publishedAt, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })), h('td', null, v.label ?? '–'),
          h('td', null, v.profile === 'custom' ? 'Eigene Werte' : PROFILES[v.profile as 'arcade']?.label ?? v.profile), h('td', null, v.eventOn ? 'Flugwoche' : '–'),
          h('td', null, h('button', { type: 'button', class: 'btn small', onclick: async () => { st = await api<StateBody>('POST', '/restore', { id: v.id }); draft = JSON.parse(JSON.stringify(st.draft)); paintAll(); say(`Version ${v.id} wurde in den Entwurf geladen. Zum Aktivieren veröffentlichen.`); } }, 'Wiederherstellen')))))))));

  body.append(tempo, traffic, pickups, controls, scenery, audio, eventCard, history);

  // ---------------------------------------------------------------- Status & Aktionen
  const dlg = h('dialog', { class: 'dlg', 'aria-labelledby': 'dlg-t' });
  root.append(dlg);

  function openPublish(): void {
    clear(dlg);
    const label = h('input', { type: 'text', maxlength: '80', placeholder: 'z. B. „Mehr Verkehr ab 10 km“', id: 'pub-label', autocomplete: 'off' });
    const err = h('div', { class: 'issue show', role: 'alert' });
    const go = h('button', { type: 'button', class: 'btn primary' }, 'Jetzt veröffentlichen');
    go.addEventListener('click', async () => {
      go.disabled = true; err.textContent = '';
      try {
        const r = await api<{ version: number; state: StateBody }>('POST', '/publish', { label: label.value.trim() || null });
        st = r.state; draft = JSON.parse(JSON.stringify(st.draft)); dlg.close(); paintAll();
        say(`Version ${r.version} ist veröffentlicht. Neue Fahrten nutzen sie sofort; laufende Fahrten behalten ihren Stand.`);
      } catch (e) {
        const d = (e as ApiError).data as { blocking?: Issue[] };
        err.textContent = d?.blocking?.length ? `Nicht veröffentlicht – Konflikte: ${d.blocking.map((i) => FIELD_BY_PATH[i.path]?.label ?? i.path).join(', ')}. Details stehen an den Reglern.` : (e as Error).message;
        go.disabled = false;
      }
    });
    dlg.append(h('h2', { id: 'dlg-t' }, 'Veröffentlichen?'),
      st.diff.length === 0 ? h('p', null, 'Der Entwurf stimmt mit der veröffentlichten Version überein.') : h('div', null, h('p', null, `${st.diff.length} Änderung${st.diff.length > 1 ? 'en' : ''} gegenüber ${st.published ? 'Version ' + st.published.id : 'den eingebauten Standardwerten'}:`),
        h('ul', { class: 'difflist' }, ...st.diff.map((d) => h('li', null, h('strong', null, d.label), ': ', h('span', { class: 'from' }, d.from), ' → ', h('span', { class: 'to' }, d.to))))),
      h('label', { for: 'pub-label', class: 'f' }, h('span', null, 'Name der Version (optional)'), label), err,
      h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Abbrechen'), go));
    dlg.showModal();
  }

  async function testDrive(): Promise<void> {
    const w = window.open('', '_blank');
    try {
      if (saveTimer) { clearTimeout(saveTimer); const r = await api<StateBody>('PUT', '/draft', { config: draft }); st = r; paintAll(); }
      const r = await api<{ url: string }>('POST', '/testdrive');
      if (w) { w.opener = null; w.location.href = r.url; } else say(`Testfahrt-Link: ${r.url}`);
      say('Testfahrt mit dem Entwurf geöffnet. Sie zählt weder für Kennzahlen noch für die Bestweite (30 Minuten gültig).');
    } catch (e) { w?.close(); say(`Testfahrt nicht möglich: ${(e as Error).message}`, 'err'); }
  }

  async function loadDefaults(): Promise<void> {
    if (!confirm('Alle Werte des Entwurfs auf die Standardwerte (Profil „Arcade“) zurücksetzen? Veröffentlicht wird dadurch noch nichts.')) return;
    st = await api<StateBody>('POST', '/draft/defaults'); draft = JSON.parse(JSON.stringify(st.draft)); paintAll(); say('Standardwerte sind im Entwurf geladen.');
  }

  function paintStatus(): void {
    clear(statusBar);
    const dirty = st.dirty || saving === 'pending' || saving === 'saving';
    const saveTxt = saving === 'pending' ? 'Änderung wird gespeichert …' : saving === 'saving' ? 'Speichert …' : saving === 'error' ? 'Speichern fehlgeschlagen' : st.dirty ? 'Entwurf gespeichert' : '';
    const errors = st.issues.filter((i) => i.level === 'error').length, warns = st.issues.filter((i) => i.level === 'warn').length;
    statusBar.append(
      h('div', { class: 'sb-left' },
        h('span', { class: `badge ${dirty ? 'draft' : 'live'}` }, dirty ? 'Entwurf – nicht veröffentlicht' : 'Veröffentlicht'),
        h('span', { class: 'sb-info' }, st.published ? `Aktiv: Version ${st.published.id} seit ${dt(st.published.publishedAt, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Aktiv: eingebaute Standardwerte', saveTxt ? ` · ${saveTxt}` : '', st.diff.length ? ` · ${st.diff.length} Änderung${st.diff.length > 1 ? 'en' : ''}` : ''),
        errors || warns ? h('a', { class: 'sb-issues', href: '#sec-tempo', onclick: (e: Event) => { e.preventDefault(); document.querySelector('.issue.show')?.scrollIntoView({ block: 'center' }); } }, `${errors ? errors + ' Konflikt' + (errors > 1 ? 'e' : '') : ''}${errors && warns ? ', ' : ''}${warns ? warns + ' Hinweis' + (warns > 1 ? 'e' : '') : ''}`) : null),
      h('div', { class: 'sb-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => void loadDefaults() }, 'Standardwerte laden'),
        h('button', { type: 'button', class: 'btn accent', onclick: () => void testDrive() }, 'Testfahrt'),
        h('button', { type: 'button', class: 'btn primary', onclick: openPublish, disabled: errors > 0 ? true : null, title: errors > 0 ? 'Zuerst die Konflikte lösen' : null }, 'Veröffentlichen')));
  }

  function paintIssues(): void {
    for (const [path, slots] of issueSlots) {
      const list = st.issues.filter((i) => i.path === path);
      for (const el of slots) {
        clear(el);
        el.classList.toggle('show', list.length > 0);
        for (const i of list) el.append(h('p', { class: i.level }, h('strong', null, i.level === 'error' ? 'Konflikt: ' : 'Hinweis: '), i.msg));
      }
    }
  }

  function paintAll(): void { for (const u of updaters) u(); paintIssues(); paintStatus(); }
  paintAll();
  const tick = setInterval(() => { if (!document.body.contains(root)) { clearInterval(tick); return; } if (st.event.state === 'active') { st.event.remainingMs = Math.max(0, (st.event.endsAt ?? 0) - Date.now()); paintAll(); } }, 30_000);
}
