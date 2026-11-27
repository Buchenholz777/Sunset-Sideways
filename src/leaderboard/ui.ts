import { cleanName, NAME_MAX } from './names';
import { tr, trLoose, locale, onLang } from '../i18n';
import { LeaderboardClient, loadLocal, type LbEntry, type LbMe, type LbMode, type LbPeriod, type RunClaim } from './client';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const nf = { format: (n: number): string => n.toLocaleString(locale()) };
const fmtDist = (m: number): string => (m >= 1000 ? `${(m / 1000).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km` : `${nf.format(m)} m`);
/** Textknoten statt innerHTML: Namen werden nie als HTML ausgewertet. */
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

/**
 * Oberfläche der Weltrangliste: Ranglisten-Ansicht (Start- und Ergebnismenü) und das Veröffentlichen eines Laufs nach Spielende (ausdrückliche Aktion,
 * nie verpflichtend, unterbricht den Spielfluss nicht: „Nochmal fahren“ bleibt immer sofort möglich).
 */
export class LeaderboardUi {
  readonly api = new LeaderboardClient();
  private mode: LbMode = 'endless';
  private period: LbPeriod = 'all';
  private claim: RunClaim | null = null;
  private published = false;
  private seq = 0;
  private opener: HTMLElement | null = null;
  private root = $('screen-lb');

  constructor() {
    this.root.querySelectorAll<HTMLButtonElement>('[data-lb-mode]').forEach((b) => b.addEventListener('click', () => { this.mode = b.dataset.lbMode as LbMode; void this.load(); }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-lb-period]').forEach((b) => b.addEventListener('click', () => { this.period = b.dataset.lbPeriod as LbPeriod; void this.load(); }));
    $('lb-close').addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => { if (e.target === this.root) this.close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen) { e.preventDefault(); e.stopPropagation(); this.close(); } }, true);
    // Veröffentlichen: Eingaben im Ergebnisbereich dürfen den Neustart per Klick auf die Fläche nicht auslösen
    const box = $('res-lb');
    for (const t of ['click', 'pointerdown', 'touchstart'] as const) box.addEventListener(t, (e) => e.stopPropagation());
    $<HTMLFormElement>('lb-form').addEventListener('submit', (e) => { e.preventDefault(); void this.publish(); });
    $('lb-view').addEventListener('click', () => this.open(this.claim?.mode ?? this.mode));
    onLang(() => { if (this.isOpen) void this.load(); });
  }

  get isOpen(): boolean { return !this.root.hidden; }

  open(mode: LbMode = this.mode): void {
    this.mode = mode;
    this.opener = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    $('lb-close').focus();
    void this.load();
  }
  close(): void {
    this.root.hidden = true;
    this.seq++;
    this.opener?.focus?.();
  }

  private paintTabs(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-lb-mode]').forEach((b) => { const on = b.dataset.lbMode === this.mode; b.setAttribute('aria-selected', String(on)); b.classList.toggle('on', on); });
    this.root.querySelectorAll<HTMLButtonElement>('[data-lb-period]').forEach((b) => { const on = b.dataset.lbPeriod === this.period; b.setAttribute('aria-selected', String(on)); b.classList.toggle('on', on); });
  }

  private async load(): Promise<void> {
    const my = ++this.seq;
    this.paintTabs();
    const body = $('lb-body'), me = $('lb-me'), note = $('lb-note');
    body.replaceChildren();
    me.textContent = ''; note.textContent = tr('Lädt …');
    const [list, mine] = await Promise.all([this.api.top(this.mode, this.period), this.api.me(this.mode, this.period)]);
    if (my !== this.seq) return;                                    // veraltete Antwort (Tab inzwischen gewechselt oder geschlossen)
    if (list === null) { note.textContent = tr('Die Weltrangliste ist gerade nicht erreichbar. Das Spiel funktioniert weiterhin.'); return; }
    this.paintMe(mine);
    this.paintList(list);
    note.textContent = list.length === 0 ? tr('Noch keine Einträge – veröffentliche nach einem Lauf deinen Namen und sei der Erste.') : tr('Top {n} · Punkte = Stilpunkte, bei Gleichstand zählt die Distanz', { n: list.length });
  }

  private paintMe(m: LbMe | null): void {
    const me = $('lb-me');
    me.replaceChildren();
    if (!m || !m.has) { me.append(el('span', 'lb-me-none', tr(loadLocal().token ? 'In diesem Modus und Zeitraum hast du noch keinen Eintrag.' : 'Du hast noch keinen Score veröffentlicht.'))); return; }
    me.append(el('span', 'lb-me-k', tr('Dein bester Score')), el('strong', 'lb-me-v', `${nf.format(m.score ?? 0)} · ${fmtDist(m.dist ?? 0)}`), el('span', 'lb-me-k', tr('Dein globaler Platz')), el('strong', 'lb-me-v', tr('Platz {n} weltweit', { n: nf.format(m.rank ?? 0) })));
  }

  private paintList(list: LbEntry[]): void {
    const body = $('lb-body');
    const mine = loadLocal().name;
    for (const e of list) {
      const tr = el('tr', `lb-r${e.rank <= 3 ? ` top${e.rank}` : ''}${mine && e.name === mine ? ' mine' : ''}`);
      tr.append(el('td', 'rk', String(e.rank)), el('td', 'nm', e.name), el('td', 'sc', nf.format(e.score)), el('td', 'ds', fmtDist(e.dist)));
      body.append(tr);
    }
  }

  // ---------------------------------------------------------------- Veröffentlichen nach dem Lauf
  /** Nach Spielende: Veröffentlichung anbieten (claim) oder ausblenden (null, z. B. Testfahrt). */
  offer(claim: RunClaim | null): void {
    const box = $('res-lb');
    this.claim = claim; this.published = false;
    $('lb-msg').textContent = ''; $('lb-msg').className = 'lb-msg';
    $('lb-rank').textContent = '';
    box.hidden = !claim;
    if (!claim) return;
    $<HTMLFormElement>('lb-form').hidden = !this.api.hasTicket;
    $('lb-view').hidden = false;
    if (!this.api.hasTicket) $('lb-msg').textContent = tr('Die Weltrangliste ist für diesen Lauf nicht verfügbar.');
    const inp = $<HTMLInputElement>('lb-name');
    inp.value = loadLocal().name ?? inp.value;
    $<HTMLButtonElement>('lb-publish').disabled = false;
    // vorhandener Rang (falls schon veröffentlicht wurde)
    const my = this.seq;
    void this.api.me(claim.mode, 'all').then((m) => { if (my === this.seq && m?.has && !this.published) $('lb-rank').textContent = tr('Aktuell: Platz {r} weltweit · dein bester Score {s}', { r: nf.format(m.rank ?? 0), s: nf.format(m.score ?? 0) }); });
  }

  private async publish(): Promise<void> {
    const c = this.claim;
    if (!c || this.published) return;
    const msg = $('lb-msg'), btn = $<HTMLButtonElement>('lb-publish');
    const nm = cleanName($<HTMLInputElement>('lb-name').value);
    if (!nm.ok) { msg.className = 'lb-msg err'; msg.textContent = trLoose(nm.error); return; }
    btn.disabled = true; msg.className = 'lb-msg'; msg.textContent = tr('Wird veröffentlicht …');
    const r = await this.api.publish(nm.name, c);
    if (this.claim !== c) return;                                   // inzwischen neuer Lauf
    if (!r.ok) { msg.className = 'lb-msg err'; msg.textContent = trLoose(r.error); btn.disabled = false; return; }
    this.published = true;
    const a = r.res.all;
    const best = a.has && a.score === c.score && a.dist === c.dist;
    msg.className = 'lb-msg ok';
    msg.textContent = tr(best ? 'Veröffentlicht – neue persönliche Bestleistung!' : r.res.duplicate ? 'Dieser Lauf ist bereits veröffentlicht.' : 'Veröffentlicht. Dein bisheriger Bestwert bleibt erhalten.');
    $('lb-rank').textContent = a.has ? tr('Platz {r} weltweit', { r: nf.format(a.rank ?? 0) }) + (r.res.week.has ? tr(' · {n}. in den letzten 7 Tagen', { n: nf.format(r.res.week.rank ?? 0) }) : '') : '';
    $<HTMLFormElement>('lb-form').hidden = true;
  }

  /** Name-Eingabe auf die erlaubte Länge begrenzen (Zusatz zum maxlength-Attribut). */
  static readonly maxName = NAME_MAX;
}
