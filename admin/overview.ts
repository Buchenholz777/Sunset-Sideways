import { api } from './api';
import { clear, dt, h, km, n0, n1, pct } from './dom';
import { columnChart, hbars, lineChart, tableToggle } from './charts';
import type { Overview, RunMetrics, Pct } from '../server/kpi';
import { PICKUP_LABEL, type PickupKey } from '../src/config/runtime';

const CAUSE: Record<string, string> = { taxi: 'Taxi', cabrio: 'Cabrio', sedan: 'Limousine', truck: 'Lkw', baken: 'Baken', barrier: 'Absperrung', unbekannt: 'Unbekannt' };

interface Q { period: string; dev: string; ver: string; ev: string; cfg: string }
const saved = (): Q => { try { return { period: '7d', dev: 'all', ver: 'all', ev: 'all', cfg: 'all', ...(JSON.parse(localStorage.getItem('ssw-kpi') ?? '{}') as Partial<Q>) }; } catch { return { period: '7d', dev: 'all', ver: 'all', ev: 'all', cfg: 'all' }; } };
const store = (q: Q): void => { try { localStorage.setItem('ssw-kpi', JSON.stringify(q)); } catch { /* optional */ } };

function delta(cur: number | null, prev: number | null, unit: 'rel' | 'pp'): HTMLElement {
  if (cur === null || prev === null) return h('span', { class: 'delta none' }, 'Vergleich: keine Daten');
  if (unit === 'pp') {
    const d = (cur - prev) * 100;
    return h('span', { class: `delta ${d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat'}` }, `${d > 0.05 ? '▲' : d < -0.05 ? '▼' : '■'} ${d >= 0 ? '+' : ''}${n1(d)} Prozentpunkte zur Vorperiode`);
  }
  if (prev === 0) return h('span', { class: 'delta none' }, cur === 0 ? 'Vorperiode: 0' : 'Vorperiode: 0 (kein Prozentvergleich)');
  const d = ((cur - prev) / prev) * 100;
  return h('span', { class: `delta ${d > 0.5 ? 'up' : d < -0.5 ? 'down' : 'flat'}` }, `${d > 0.5 ? '▲' : d < -0.5 ? '▼' : '■'} ${d >= 0 ? '+' : ''}${n1(d)} % zur Vorperiode`);
}

function card(title: string, value: string, sub: string, d: HTMLElement, help: string): HTMLElement {
  return h('article', { class: 'kpi', title: help }, h('h3', null, title), h('p', { class: 'kpi-v' }, value), h('p', { class: 'kpi-s' }, sub), d);
}
const ratio = (p: Pct | null): string => (p === null || p.value === null ? '–' : pct(p.value));
const basis = (p: Pct | null, what: string): string => (p === null ? 'nicht pro Version messbar' : `${n0(p.num)} von ${n0(p.den)} ${what}`);

export async function renderOverview(root: HTMLElement): Promise<void> {
  const q = saved();
  const box = h('div', { class: 'view-body' });
  const bar = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter' });
  clear(root);
  root.append(bar, box);

  const sel = (label: string, key: keyof Q, opts: Array<[string, string]>): HTMLElement => {
    const s = h('select', { id: `f-${key}`, onchange: (e: Event) => { q[key] = (e.target as HTMLSelectElement).value; store(q); void load(); } }, ...opts.map(([v, t]) => h('option', { value: v, selected: v === q[key] }, t)));
    return h('label', { class: 'f' }, h('span', null, label), s);
  };
  const periods = (): HTMLElement => h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Zeitraum' },
    ...([['24h', 'Letzte 24 Std'], ['7d', '7 Tage'], ['30d', '30 Tage']] as const).map(([v, t]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(q.period === v), class: q.period === v ? 'on' : '', onclick: () => { q.period = v; store(q); void load(); } }, t)));

  async function load(): Promise<void> {
    clear(box);
    box.append(h('p', { class: 'muted', role: 'status' }, 'Lädt Kennzahlen …'));
    const qs = new URLSearchParams({ period: q.period, dev: q.dev, ver: q.ver, ev: q.ev, cfg: q.cfg }).toString();
    let o: Overview;
    try { o = await api<Overview>('GET', `/kpi?${qs}`); } catch (e) {
      clear(box);
      box.append(h('div', { class: 'notice err', role: 'alert' }, h('strong', null, 'Kennzahlen konnten nicht geladen werden. '), (e as Error).message, ' ', h('button', { type: 'button', class: 'link', onclick: () => void load() }, 'Erneut versuchen')));
      return;
    }
    draw(o);
  }

  function draw(o: Overview): void {
    clear(bar);
    bar.append(periods(),
      sel('Gerät', 'dev', [['all', 'Alle'], ['phone', 'Smartphone'], ['tablet', 'Tablet'], ['desktop', 'Desktop']]),
      sel('Spielversion', 'ver', [['all', 'Alle'], ...o.filters.versions.map((v): [string, string] => [v, v])]),
      sel('Ereignis', 'ev', [['all', 'Alle Fahrten'], ['event', 'Nur Flugwoche'], ['regular', 'Ohne Ereignis']]),
      sel('Konfiguration', 'cfg', [['all', 'Alle'], ['builtin', 'Eingebaute Werte'], ...o.filters.configs.map((c): [string, string] => [String(c.id), `Version ${c.id}${c.label ? ' · ' + c.label : ''}`])]));
    clear(box);
    const m = o.metrics, c = o.cards, p = o.prevCards;
    const range = `${dt(o.from, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} bis ${dt(o.to, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    box.append(h('p', { class: 'period-line' }, `Zeitraum: ${range} · Vergleich: gleich lange Vorperiode davor`));
    if (o.coverage.status === 'nodata') box.append(h('div', { class: 'notice warn', role: 'status' }, h('strong', null, 'Noch keine Messdaten. '), 'Es wurde noch kein Spielbesuch erfasst. Sobald das Spiel über diese Domain gespielt wird, erscheinen hier Werte. Das ist kein Fehler – nur fehlende Daten, keine Nullwerte.'));
    else if (o.coverage.status === 'partial') box.append(h('div', { class: 'notice info', role: 'status' }, `Die Messung läuft erst seit ${dt(o.coverage.firstEventAt!, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. Frühere Zeiträume zeigen deshalb 0, obwohl dort nicht gemessen wurde.`));
    if (q.cfg !== 'all' || q.ev !== 'all') box.append(h('p', { class: 'muted' }, 'Hinweis: Seitenaufrufe und Startrate sind keiner Konfiguration zugeordnet und werden mit Konfigurations- oder Ereignisfilter nicht angezeigt.'));

    box.append(h('section', { class: 'kpis', 'aria-label': 'Kennzahlen' },
      card('Seitenaufrufe', c.views === null ? '–' : n0(c.views), c.views === null ? 'mit diesem Filter nicht messbar' : `Vorperiode ${p.views === null ? '–' : n0(p.views)}`, delta(c.views, p.views, 'rel'), 'Besuche mit mindestens einem Messereignis'),
      card('Gestartete Fahrten', n0(c.runs), `Vorperiode ${n0(p.runs)}${m.eventRuns ? ` · davon ${n0(m.eventRuns)} in der Flugwoche` : ''}`, delta(c.runs, p.runs, 'rel'), 'Jeder Start eines Versuchs'),
      card('Startrate', ratio(c.startRate), basis(c.startRate, 'Besuchen mit Fahrt'), delta(c.startRate?.value ?? null, p.startRate?.value ?? null, 'pp'), 'Besuche mit mindestens einer Fahrt / gemessene Besuche'),
      card('Wiederholungsrate', ratio(c.repeatRate), basis(c.repeatRate, 'Spielern mit Fahrt'), delta(c.repeatRate.value, p.repeatRate.value, 'pp'), 'Besuche mit mindestens zwei Fahrten / Besuche mit mindestens einer Fahrt'),
      card('Mittlere Strecke (Median)', km(c.medianDist.value), `Stichprobe: ${n0(c.medianDist.n)} Fahrten mit Endereignis`, delta(c.medianDist.value, p.medianDist.value, 'rel'), 'Median der Strecke bei Fahrtende')));

    // Starts im Zeitverlauf
    const fmtX = (t: number): string => (o.step === 'hour' ? dt(t, { hour: '2-digit', minute: '2-digit' }) + ' Uhr' : dt(t, { weekday: 'short', day: '2-digit', month: '2-digit' }));
    const total = o.series.cur.reduce((a, b) => a + b, 0);
    box.append(h('section', { class: 'panel' }, h('h2', null, 'Gestartete Fahrten im Zeitverlauf'),
      total === 0 && o.coverage.status !== 'nodata' ? h('p', { class: 'muted' }, 'Im gewählten Zeitraum wurden 0 Fahrten gestartet (Messung läuft).') : null,
      lineChart({
        title: 'Gestartete Fahrten', yLabel: `Fahrten je ${o.step === 'hour' ? 'Stunde' : 'Tag'}`, xLabel: o.step === 'hour' ? 'Uhrzeit' : 'Datum',
        xs: o.series.labels, xFmt: fmtX, series: [{ name: 'Aktuell', values: o.series.cur, cls: 'a' }, { name: 'Vorperiode', values: o.series.prev, cls: 'b', dashed: true }],
        markers: o.markers.publishes.map((x) => ({ at: x.ts, kind: 'publish' as const, label: `Version ${x.id} veröffentlicht${x.label ? ' (' + x.label + ')' : ''}, ${dt(x.ts)}` })),
        bands: o.markers.events.map((e) => ({ from: Math.max(e.from, o.from), to: Math.min(e.to, o.to), label: `Flugwoche (Version ${e.id})` })),
        summary: `${n0(total)} Fahrten insgesamt, Vorperiode ${n0(o.series.prev.reduce((a, b) => a + b, 0))}.`,
      })));

    box.append(h('div', { class: 'grid2' }, reachPanel(m), crashPanel(m)), pickupPanel(m));
    box.append(comparePanel(o, q));
  }

  await load();
}

function reachPanel(m: RunMetrics): HTMLElement {
  const label = (at: number): string => `${at / 1000} km`;
  return h('section', { class: 'panel' }, h('h2', null, 'Erreichte Strecke'),
    h('p', { class: 'muted' }, `Anteil der gestarteten Fahrten (Basis: ${n0(m.runs)}), die die Marke erreicht haben.`),
    m.runs === 0 ? h('p', { class: 'muted' }, 'Keine Fahrten im Zeitraum.') : hbars(m.reach.map((r) => ({ label: label(r.at), frac: r.share, text: `${pct(r.share)} · ${n0(r.count)} Fahrten` }))),
    tableToggle(m.reach.map((r) => label(r.at)), [{ name: 'Anteil', values: m.reach.map((r) => (r.share ?? 0) * 100), cls: 'a' }, { name: 'Fahrten', values: m.reach.map((r) => r.count), cls: 'b' }], (v) => n1(v), 'Marke'));
}

function crashPanel(m: RunMetrics): HTMLElement {
  const bars = m.crash.bins.map((b) => ({ label: b.to === null ? '30+' : String(b.from / 1000), value: b.count, text: `${b.to === null ? 'ab 30 km' : `${b.from / 1000}–${b.to / 1000} km`}: ${n0(b.count)} Abstürze` }));
  const d = m.dist;
  return h('section', { class: 'panel' }, h('h2', null, 'Wo Fahrten enden'),
    h('p', { class: 'muted' }, `Absturz-Strecken (${n0(m.crash.n)} Abstürze) in Kilometer-Klassen.`),
    columnChart({ title: 'Absturzstrecken', xLabel: 'Strecke (km)', yLabel: 'Abstürze', bars, xTickEvery: 5, summary: `Median ${km(d.median)}, 90. Perzentil ${km(d.p90)}.` }),
    h('dl', { class: 'facts' },
      h('div', null, h('dt', null, 'Median'), h('dd', null, km(d.median))),
      h('div', null, h('dt', null, '90. Perzentil'), h('dd', null, km(d.p90))),
      h('div', null, h('dt', null, 'Mit Endereignis'), h('dd', null, `${n0(m.withEnd)} Fahrten`)),
      h('div', null, h('dt', null, 'Ohne Endereignis'), h('dd', null, `${n0(m.noEnd)} Fahrten (getrennt gezählt)`))),
    h('h3', null, 'Häufigste Absturzursachen'),
    m.crash.causes.length === 0 ? h('p', { class: 'muted' }, 'Keine Abstürze erfasst.') : hbars(m.crash.causes.map((c) => ({ label: CAUSE[c.cause] ?? c.cause, frac: m.crash.n ? c.count / m.crash.n : 0, text: `${n0(c.count)} · ${pct(c.count / m.crash.n)}` }))));
}

function pickupPanel(m: RunMetrics): HTMLElement {
  const rows = m.pickups.filter((p) => p.seen > 0 || true);
  const max = Math.max(1, ...rows.map((r) => r.seen));
  return h('section', { class: 'panel' }, h('h2', null, 'Power-ups: sichtbar vs. eingesammelt'),
    h('p', { class: 'muted' }, 'Jedes Power-up zählt je Fahrt und Objekt höchstens einmal als sichtbar und einmal als eingesammelt (Fliegen-Tor = ein Objekt).'),
    hbars(rows.map((r) => ({ label: PICKUP_LABEL[r.type as PickupKey] ?? r.type, frac: r.taken / max, frac2: r.seen / max, text: r.seen ? `${n0(r.taken)} von ${n0(r.seen)} · Quote ${pct(r.rate)}` : 'keine sichtbar', sub: undefined })), 'a'),
    h('p', { class: 'legend-line' }, h('i', { class: 'sw a' }), 'eingesammelt ', h('i', { class: 'sw b' }), 'sichtbar'),
    h('p', null, h('strong', null, 'Fliegen – typische Strecke des ersten sichtbaren Angebots: '), m.glideFirst.n ? `${km(m.glideFirst.median)} (Median, ${n0(m.glideFirst.n)} Fahrten)` : 'noch keine Daten'),
    tableToggle(rows.map((r) => PICKUP_LABEL[r.type as PickupKey] ?? r.type), [{ name: 'Sichtbar', values: rows.map((r) => r.seen), cls: 'b' }, { name: 'Eingesammelt', values: rows.map((r) => r.taken), cls: 'a' }, { name: 'Quote %', values: rows.map((r) => (r.rate ?? 0) * 100), cls: 'a' }], (v) => n1(v), 'Power-up'));
}

function comparePanel(o: Overview, q: Q): HTMLElement {
  const out = h('div', { class: 'cmp-out' });
  const opts = o.filters.configs;
  const mk = (id: string, def: string): HTMLSelectElement => h('select', { id }, ...[['builtin', 'Eingebaute Werte'], ...opts.map((c): [string, string] => [String(c.id), `Version ${c.id}${c.label ? ' · ' + c.label : ''}`])].map(([v, t]) => h('option', { value: v, selected: v === def }, t)));
  const a = mk('cmp-a', opts[1] ? String(opts[1].id) : 'builtin'), b = mk('cmp-b', opts[0] ? String(opts[0].id) : 'builtin');
  const run = async (): Promise<void> => {
    clear(out);
    try {
      const r = await api<{ a: RunMetrics; b: RunMetrics }>('GET', `/compare?${new URLSearchParams({ period: q.period, dev: q.dev, ver: q.ver, ev: q.ev, a: a.value, b: b.value })}`);
      const row = (name: string, f: (x: RunMetrics) => string): HTMLElement => h('tr', null, h('th', { scope: 'row' }, name), h('td', null, f(r.a)), h('td', null, f(r.b)));
      out.append(h('div', { class: 'tbl-scroll' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Kennzahl'), h('th', { scope: 'col' }, `A: ${a.selectedOptions[0].text}`), h('th', { scope: 'col' }, `B: ${b.selectedOptions[0].text}`))),
        h('tbody', null,
          row('Gestartete Fahrten', (x) => n0(x.runs)),
          row('Median-Strecke', (x) => `${km(x.dist.median)} (n=${n0(x.dist.n)})`),
          row('90. Perzentil', (x) => km(x.dist.p90)),
          row('Wiederholungsrate', (x) => `${pct(x.repeat.value)} (${n0(x.repeat.num)}/${n0(x.repeat.den)})`),
          ...[1, 2, 3, 4].map((i) => row(`Erreicht ${[1, 5, 15, 20, 27][i]} km`, (x) => pct(x.reach[i].share))),
          ...(['glide', 'shield', 'boost'] as const).map((t) => row(`Sammelquote ${PICKUP_LABEL[t]}`, (x) => { const p = x.pickups.find((z) => z.type === t); return p && p.seen ? `${pct(p.rate)} (${n0(p.taken)}/${n0(p.seen)})` : '–'; }))))));
      if (r.a.runs === 0 || r.b.runs === 0) out.append(h('p', { class: 'muted' }, 'Für mindestens eine Version gibt es im Zeitraum keine Fahrten – der Vergleich ist nicht belastbar.'));
    } catch (e) { out.append(h('div', { class: 'notice err', role: 'alert' }, (e as Error).message)); }
  };
  return h('section', { class: 'panel' }, h('h2', null, 'Zwei veröffentlichte Versionen vergleichen'),
    h('p', { class: 'muted' }, 'Gleiche Filter wie oben (Zeitraum, Gerät, Spielversion). Es zählen nur Fahrten, die mit der jeweiligen Version gestartet wurden.'),
    h('div', { class: 'cmp-sel' }, h('label', { class: 'f' }, h('span', null, 'Version A'), a), h('label', { class: 'f' }, h('span', null, 'Version B'), b), h('button', { type: 'button', class: 'btn', onclick: () => void run() }, 'Vergleichen')), out);
}
