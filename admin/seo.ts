import { api } from './api';
import { clear, dt, h, n0, n1, pct } from './dom';
import type { SeoReport, Status } from '../server/seo';
import type { GscData, SiteEntry } from '../server/gsc';

const LABEL: Record<Status, string> = { ok: 'In Ordnung', warn: 'Verbesserbar', fail: 'Fehlt / Fehler', info: 'Hinweis' };
const ICON: Record<Status, string> = { ok: '✓', warn: '!', fail: '✕', info: 'i' };

interface SeoState { domain: string; publicOrigin: string | null; report: SeoReport | null }
interface GscState { available: boolean; connected: boolean; site: string | null; redirectUri: string; sites?: SiteEntry[]; data?: GscData | null; error?: string }

export async function renderSeo(root: HTMLElement): Promise<void> {
  clear(root);
  const body = h('div', { class: 'view-body' });
  root.append(body);
  let st: SeoState;
  try { st = await api<SeoState>('GET', '/seo'); } catch (e) { body.append(h('div', { class: 'notice err', role: 'alert' }, `SEO-Daten nicht ladbar: ${(e as Error).message}`)); return; }

  const input = h('input', { type: 'url', id: 'seo-domain', value: st.domain, placeholder: 'https://spiel.example.de', inputmode: 'url', autocomplete: 'off', spellcheck: 'false' });
  const out = h('div', { class: 'seo-out' });
  const msg = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  const go = h('button', { type: 'button', class: 'btn primary' }, 'Jetzt prüfen');

  function paint(r: SeoReport | null): void {
    clear(out);
    if (!r) { out.append(h('p', { class: 'muted' }, 'Noch keine Prüfung durchgeführt.')); return; }
    out.append(
      h('p', { class: 'seo-sum' }, h('strong', null, `${r.summary.ok} in Ordnung`), ` · ${r.summary.warn} verbesserbar · ${r.summary.fail} fehlend/fehlerhaft`, h('span', { class: 'muted' }, ` · geprüft ${dt(r.checkedAt, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} Uhr · ${r.origin}`)),
      h('ul', { class: 'checks' }, ...r.checks.map((c) => h('li', { class: `check ${c.status}` },
        h('span', { class: 'ci', 'aria-hidden': 'true' }, ICON[c.status]),
        h('div', { class: 'cb' }, h('h3', null, c.label, h('span', { class: 'cs' }, LABEL[c.status])),
          h('p', { class: 'found' }, h('span', { class: 'k' }, 'Gefunden: '), c.found),
          c.status === 'ok' || c.status === 'info' ? null : h('p', { class: 'fix' }, h('span', { class: 'k' }, 'So beheben: '), c.fix))))));
  }
  go.addEventListener('click', async () => {
    go.disabled = true; msg.textContent = 'Prüft die Startseite, robots.txt, Sitemap und Vorschau …';
    try { const r = await api<{ report: SeoReport }>('POST', '/seo/check', { domain: input.value.trim() }); paint(r.report); msg.textContent = ''; }
    catch (e) { msg.textContent = `Prüfung fehlgeschlagen: ${(e as Error).message}`; }
    go.disabled = false;
  });
  paint(st.report);

  body.append(h('section', { class: 'panel' }, h('h2', null, 'Technischer SEO-Check'),
    h('p', { class: 'muted' }, 'Prüft die öffentliche Startseite der Domain direkt über das Netz – ohne Search Console. Pro Prüfpunkt: Status, gefundener Wert und konkrete Behebung.'),
    h('div', { class: 'seo-form' }, h('label', { class: 'f grow', for: 'seo-domain' }, h('span', null, 'Öffentliche Adresse'), input), go), msg, out));

  // ---- Search Console
  const gbox = h('section', { class: 'panel' }, h('h2', null, 'Google Search Console (optional)'));
  body.append(gbox);
  async function paintGsc(force = false): Promise<void> {
    clear(gbox); gbox.append(h('h2', null, 'Google Search Console (optional)'));
    let g: GscState;
    try { g = await api<GscState>('GET', `/gsc${force ? '?force=1' : ''}`); } catch (e) { gbox.append(h('div', { class: 'notice err', role: 'alert' }, (e as Error).message)); return; }
    if (location.hash.includes('gsc=ok')) gbox.append(h('div', { class: 'notice ok', role: 'status' }, 'Verbunden. Bitte unten die bestätigte Property wählen.'));
    if (location.hash.includes('gsc=fehler')) gbox.append(h('div', { class: 'notice err', role: 'alert' }, 'Die Verbindung mit Google ist fehlgeschlagen. Bitte erneut versuchen.'));
    if (!g.available) {
      gbox.append(h('p', { class: 'muted' }, 'Nicht eingerichtet. Der technische Check oben funktioniert ohne diese Verbindung. Für Suchanfragen, Klicks und Position werden die Umgebungsvariablen GSC_CLIENT_ID, GSC_CLIENT_SECRET und APP_SECRET gebraucht (nur Lesezugriff „webmasters.readonly“). Als Weiterleitungs-URI im Google-Cloud-Projekt eintragen:'), h('code', { class: 'block' }, g.redirectUri));
      return;
    }
    if (!g.connected) {
      gbox.append(h('p', { class: 'muted' }, 'Lesender Zugriff auf Impressionen, Klicks, CTR und Position – nur für bestätigte Properties.'),
        h('button', { type: 'button', class: 'btn primary', onclick: async () => { const r = await api<{ url: string }>('POST', '/gsc/connect'); location.href = r.url; } }, 'Mit Google verbinden'));
      return;
    }
    if (g.error) gbox.append(h('div', { class: 'notice err', role: 'alert' }, g.error));
    const pick = h('select', { id: 'gsc-site', 'aria-label': 'Property wählen' }, h('option', { value: '' }, g.site ? g.site : '– Property wählen –'), ...(g.sites ?? []).map((x) => h('option', { value: x.siteUrl, selected: x.siteUrl === g.site }, x.siteUrl)));
    pick.addEventListener('change', async () => { if (pick.value) { await api('POST', '/gsc/site', { site: pick.value }); void paintGsc(); } });
    gbox.append(h('div', { class: 'seo-form' }, h('label', { class: 'f grow' }, h('span', null, 'Bestätigte Property'), pick),
      h('button', { type: 'button', class: 'btn', onclick: () => void paintGsc(true) }, 'Aktualisieren'),
      h('button', { type: 'button', class: 'btn', onclick: async () => { await api('POST', '/gsc/disconnect'); void paintGsc(); } }, 'Trennen')));
    const d = g.data;
    if (!d) { gbox.append(h('p', { class: 'muted' }, g.sites && g.sites.length === 0 ? 'Keine bestätigte Property gefunden.' : 'Property wählen, um Daten zu laden.')); return; }
    gbox.append(h('p', { class: 'muted' }, `Zeitraum ${d.from} bis ${d.to} (Search Console liefert mit 2–3 Tagen Verzögerung) · zuletzt abgerufen ${dt(d.fetchedAt, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr`),
      h('section', { class: 'kpis small' },
        ...([['Impressionen', n0(d.totals.impressions)], ['Klicks', n0(d.totals.clicks)], ['CTR', pct(d.totals.ctr)], ['Ø Position', n1(d.totals.position)]] as const).map(([t, v]) => h('article', { class: 'kpi' }, h('h3', null, t), h('p', { class: 'kpi-v' }, v)))),
      h('h3', null, 'Top-Suchanfragen'),
      d.queries.length === 0 ? h('p', { class: 'muted' }, 'Keine Suchanfragen im Zeitraum.') :
        h('div', { class: 'tbl-scroll' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, ...['Suchanfrage', 'Impressionen', 'Klicks', 'CTR', 'Ø Position'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', null, ...d.queries.map((q) => h('tr', null, h('th', { scope: 'row' }, q.query), h('td', null, n0(q.impressions)), h('td', null, n0(q.clicks)), h('td', null, pct(q.ctr)), h('td', null, n1(q.position))))))));
  }
  await paintGsc();
}
