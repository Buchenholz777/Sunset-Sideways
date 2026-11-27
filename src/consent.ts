/**
 * Einwilligung für den Google Tag Manager (GTM-WRM84FRX). Vor einer Zustimmung wird KEIN Google-Skript geladen und kein Cookie gesetzt.
 * Die Entscheidung liegt im localStorage dieses Browsers (technisch notwendig, um sie zu merken) und lässt sich jederzeit widerrufen.
 */
import { tr, onLang } from './i18n';
export const GTM_ID ='GTM-WRM84FRX';
export const CONSENT_KEY = 'ssw-consent';

export type Decision = 'granted' | 'denied';
export interface StoreLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function readConsent(store: StoreLike | null): Decision | null {
  try {
    const raw = store?.getItem(CONSENT_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { v?: number; d?: string };
    return j.v === 1 && (j.d === 'granted' || j.d === 'denied') ? j.d : null;
  } catch { return null; }
}
export function writeConsent(store: StoreLike | null, d: Decision, now = Date.now()): void {
  try { store?.setItem(CONSENT_KEY, JSON.stringify({ v: 1, d, ts: now })); } catch { /* ohne Speicher: gilt nur für diese Sitzung */ }
}

const w = (): Window & { dataLayer?: unknown[] } => window as never;

/** Lädt den Tag Manager (einmal). */
export function loadGtm(): void {
  if (document.getElementById('gtm-script')) return;
  const win = w();
  win.dataLayer = win.dataLayer || [];
  win.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  const s = document.createElement('script');
  s.id = 'gtm-script'; s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  document.head.appendChild(s);
}

/** Entfernt von Google gesetzte Cookies (soweit vom eigenen Host aus löschbar). */
function clearGoogleCookies(): void {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (/^(_ga|_gid|_gat|_gcl)/.test(name)) {
      document.cookie = `${name}=; Max-Age=0; Path=/`;
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${location.hostname.replace(/^www\./, '.')}`;
    }
  }
}

let banner: HTMLElement | null = null;
let ro: ResizeObserver | null = null;
/** Höhe der Statistikabfrage als CSS-Variable: Der Fußbereich (Hilfe, Rechtslinks) sitzt auf dem Smartphone darüber statt darunter. */
function setBannerHeight(px: number): void { document.documentElement.style.setProperty('--consent-h', px > 0 ? Math.ceil(px) + 12 + 'px' : '0px'); }
function dropBanner(): void { banner?.remove(); banner = null; ro?.disconnect(); ro = null; setBannerHeight(0); }
const store = (): Storage | null => { try { return localStorage; } catch { return null; } };

function decide(d: Decision): void {
  const prev = readConsent(store());
  writeConsent(store(), d);
  dropBanner();
  if (d === 'granted') loadGtm();
  else if (prev === 'granted') { clearGoogleCookies(); location.reload(); }   // bereits geladene Skripte lassen sich nicht entladen
}

function show(): HTMLElement | null {
  if (banner) return banner;
  const el = document.createElement('section');
  el.id = 'consent';
  el.setAttribute('role', 'region');
  const paint = (): void => {
    el.setAttribute('aria-label', tr('Datenschutz-Einwilligung'));
    el.innerHTML = `<p><strong>${tr('Statistik mit Google?')}</strong>${tr(' Wir möchten mit dem Google Tag Manager anonyme Nutzungsstatistik erfassen. ')}<span class="c-long">${tr('Dabei werden Daten an Google übertragen und eventuell Cookies gesetzt. ')}</span>${tr('Ohne deine Zustimmung wird nichts geladen – das Spiel läuft in jedem Fall. ')}<a href="/datenschutz">${tr('Datenschutz')}</a></p>
    <div class="consent-btns"><button type="button" data-d="denied">${tr('Ablehnen')}</button><button type="button" data-d="granted">${tr('Akzeptieren')}</button></div>`;
    el.querySelectorAll<HTMLButtonElement>('button[data-d]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.d as Decision)));
  };
  paint();
  onLang(() => { if (banner === el) paint(); });
  document.body.appendChild(el);
  banner = el;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => setBannerHeight(el.getBoundingClientRect().height)); ro.observe(el); }
  setBannerHeight(el.getBoundingClientRect().height);
  return el;
}

/** Beim Start aufrufen. Nicht in QA-Läufen und privaten Testfahrten. */
export function initConsent(): void {
  // QA-Läufe haben kein Banner, außer `consent=1` verlangt es ausdrücklich (Abnahme der Banner-Anordnung)
  if (/[?&]testdrive=/.test(location.search) || (/[?&]qa=/.test(location.search) && !/[?&]consent=1/.test(location.search))) return;
  const d = readConsent(store());
  if (d === 'granted') loadGtm();
  else if (d === null) show();
  document.getElementById('consent-settings')?.addEventListener('click', () => { dropBanner(); show()?.querySelector<HTMLElement>('button')?.focus(); });
}
