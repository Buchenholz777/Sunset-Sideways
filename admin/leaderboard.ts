import { api } from './api';
import { clear, dt, h, km, n0 } from './dom';

interface Top { run: string; pid: string; name: string; score: number; dist: number; ts: number }
interface Rej { run: string; pid: string; mode: string; score: number; dist: number; dur: number; reason: string; ts: number }
interface Overview { rules: number; published: number; players: number; active: number; banned: number; rejected24h: number; top: { endless: Top[]; sprint: Top[] }; rejected: Rej[] }

/** Weltrangliste im Admin: Kennzahlen, Top-Scores, abgewiesene Einreichungen; nachweislich manipulierte Läufe entfernen und Gäste sperren (serverseitig autorisiert, mit CSRF-Schutz). */
export async function renderLeaderboard(root: HTMLElement): Promise<void> {
  clear(root);
  const body = h('div', { class: 'view-body' });
  root.append(body);
  const msg = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });

  async function load(): Promise<void> {
    let o: Overview;
    try { o = await api<Overview>('GET', '/lb'); } catch (e) { clear(body); body.append(h('div', { class: 'notice err', role: 'alert' }, `Rangliste nicht ladbar: ${(e as Error).message}`)); return; }
    clear(body);
    const kpi = (label: string, v: string | number) => h('article', { class: 'kpi' }, h('h3', null, label), h('p', { class: 'kpi-v' }, String(v)));
    const act = async (path: string, payload: unknown, ok: string): Promise<void> => {
      try { await api('POST', path, payload); msg.textContent = ok; await load(); } catch (e) { msg.textContent = `Aktion fehlgeschlagen: ${(e as Error).message}`; }
    };
    const table = (rows: Top[], mode: string) => h('div', { class: 'tbl-scroll' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, ...['#', 'Name', 'Punkte', 'Distanz', 'Zeit', 'Gast', 'Aktion'].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', null, ...(rows.length ? rows.map((r, i) => h('tr', null,
        h('td', null, String(i + 1)), h('td', null, r.name), h('td', null, n0(r.score)), h('td', null, km(r.dist)), h('td', null, dt(r.ts)), h('td', null, h('code', null, r.pid)),
        h('td', null,
          h('button', { type: 'button', class: 'btn small', onclick: () => { if (confirm(`Lauf „${r.name}“ (${mode}) aus der Rangliste entfernen?`)) void act('/lb/remove', { run: r.run }, 'Lauf entfernt.'); } }, 'Entfernen'), ' ',
          h('button', { type: 'button', class: 'btn small', onclick: () => { if (confirm(`Gast ${r.pid} sperren? Alle Läufe dieses Gasts verschwinden aus der Rangliste.`)) void act('/lb/ban', { pid: r.pid, banned: true }, 'Gast gesperrt.'); } }, 'Gast sperren')))) : [h('tr', null, h('td', { colspan: '7', class: 'muted' }, 'Noch keine Einträge.'))]))));
    body.append(
      h('div', { class: 'kpis' }, kpi('Punkteregeln (Version)', o.rules), kpi('Veröffentlichte Highscores', n0(o.published)), kpi('Spieler gesamt', n0(o.players)), kpi('Aktiv (7 Tage)', n0(o.active)), kpi('Gesperrte Gäste', n0(o.banned)), kpi('Abgewiesen (24 Std)', n0(o.rejected24h))),
      h('p', { class: 'muted' }, 'Rangliste nach Stilpunkten, bei Gleichstand Distanz, danach früherer Rekord. Je Gast und Modus zählt nur der beste gültige Lauf der aktiven Punkteregeln. Gäste sind pseudonym (zufällige ID, frei wählbarer Name).'),
      msg,
      h('h2', null, 'Top 10 · Endless (gesamt)'), table(o.top.endless, 'Endless'),
      h('h2', null, 'Top 10 · Sunset Sprint (gesamt)'), table(o.top.sprint, 'Sprint'),
      h('h2', null, 'Zuletzt abgewiesen (Plausibilitätsprüfung)'),
      h('div', { class: 'tbl-scroll' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, ...['Zeit', 'Modus', 'Punkte', 'Distanz', 'Dauer', 'Grund', 'Gast'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, ...(o.rejected.length ? o.rejected.map((r) => h('tr', null, h('td', null, dt(r.ts)), h('td', null, r.mode), h('td', null, n0(r.score)), h('td', null, km(r.dist)), h('td', null, `${Math.round(r.dur)} s`), h('td', null, r.reason), h('td', null, h('code', null, r.pid)))) : [h('tr', null, h('td', { colspan: '7', class: 'muted' }, 'Keine abgewiesenen Einträge.'))])))),
    );
  }
  await load();
}
