import './style.css';
import { ApiError, api, boot } from './api';
import { clear, h } from './dom';
import { renderOverview } from './overview';
import { renderSettings } from './settings';
import { renderSeo } from './seo';

const VIEWS = [
  { id: 'overview', label: 'Übersicht', render: renderOverview },
  { id: 'settings', label: 'Spieleinstellungen', render: renderSettings },
  { id: 'seo', label: 'SEO', render: renderSeo },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

const root = document.getElementById('root') as HTMLElement;

function current(): ViewId {
  const hsh = location.hash.replace('#', '').split('?')[0];
  return (VIEWS.find((v) => v.id === hsh)?.id ?? 'overview') as ViewId;
}

async function start(): Promise<void> {
  try { await boot(); } catch { return; }
  clear(root);
  const main = h('main', { id: 'main', tabindex: '-1' });
  const nav = h('nav', { class: 'tabs', 'aria-label': 'Bereiche' });
  const account = h('dialog', { class: 'dlg', 'aria-labelledby': 'acc-t' });

  const paintNav = (): void => {
    clear(nav);
    for (const v of VIEWS) nav.append(h('a', { href: `#${v.id}`, class: current() === v.id ? 'on' : '', 'aria-current': current() === v.id ? 'page' : null }, v.label));
  };

  async function show(): Promise<void> {
    paintNav();
    const v = VIEWS.find((x) => x.id === current())!;
    clear(main);
    const holder = h('div', { class: 'view' });
    main.append(h('h1', { class: 'view-title' }, v.label), holder);
    try { await v.render(holder); } catch (e) { if (!(e instanceof ApiError && e.status === 401)) { clear(holder); holder.append(h('div', { class: 'notice err', role: 'alert' }, `Ansicht konnte nicht geladen werden: ${(e as Error).message}`)); } }
    document.title = `${v.label} · Admin · Sunset Sideways`;
  }

  function openAccount(): void {
    clear(account);
    const cur = h('input', { type: 'password', id: 'pw-cur', autocomplete: 'current-password', required: true });
    const nw = h('input', { type: 'password', id: 'pw-new', autocomplete: 'new-password', minlength: '12', required: true });
    const msg = h('div', { class: 'issue show', role: 'alert' });
    const form = h('form', { onsubmit: async (e: Event) => {
      e.preventDefault(); msg.textContent = '';
      try { await api('POST', '/password', { current: cur.value, next: nw.value }); location.reload(); }
      catch (err) { msg.textContent = (err as Error).message; }
    } },
      h('label', { class: 'f', for: 'pw-cur' }, h('span', null, 'Aktuelles Passwort'), cur),
      h('label', { class: 'f', for: 'pw-new' }, h('span', null, 'Neues Passwort (mindestens 12 Zeichen)'), nw),
      h('p', { class: 'muted' }, 'Nach der Änderung werden alle Sitzungen (auch auf anderen Geräten) beendet.'), msg,
      h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => account.close() }, 'Abbrechen'), h('button', { type: 'submit', class: 'btn primary' }, 'Passwort ändern')));
    account.append(h('h2', { id: 'acc-t' }, 'Passwort ändern'), form);
    account.showModal();
  }

  const header = h('header', { class: 'top' },
    h('a', { class: 'skip', href: '#main', onclick: (e: Event) => { e.preventDefault(); main.focus(); } }, 'Zum Inhalt'),
    h('div', { class: 'brand' }, h('span', { class: 'logo-a' }, 'Sunset'), ' ', h('span', { class: 'logo-b' }, 'Sideways'), h('span', { class: 'sub' }, 'Admin')),
    h('div', { class: 'top-actions' },
      h('a', { class: 'btn small', href: '/', target: '_blank', rel: 'noopener' }, 'Spiel öffnen'),
      h('button', { type: 'button', class: 'btn small', onclick: openAccount }, 'Passwort'),
      h('button', { type: 'button', class: 'btn small', onclick: async () => { try { await api('POST', '/logout'); } catch { /* ignorieren */ } location.reload(); } }, 'Abmelden')));

  root.append(header, nav, main, account);
  window.addEventListener('hashchange', () => void show());
  await show();
}

void start();
