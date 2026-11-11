type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

/** Kleiner DOM-Baukasten. Attribute mit Präfix „on“ werden zu Ereignissen, „class“, „text“ und boolesche Werte sind unterstützt. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export const svgNs = 'http://www.w3.org/2000/svg';
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: Array<Node | string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(svgNs, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) el.append(c);
  return el;
}

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
export const n0 = (v: number): string => nf0.format(v);
export const n1 = (v: number): string => nf1.format(v);
export const n2 = (v: number): string => nf2.format(v);
export const pct = (v: number | null, d = 1): string => (v === null ? '–' : `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: d }).format(v * 100)} %`);
export const km = (m: number | null): string => (m === null ? '–' : m >= 1000 ? `${n2(m / 1000)} km` : `${n0(m)} m`);
export const dt = (t: number, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }): string => new Intl.DateTimeFormat('de-DE', opts).format(t);
export const dur = (ms: number): string => {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? `${d} Tg ${hh} Std` : hh > 0 ? `${hh} Std ${mm} Min` : `${mm} Min`;
};

export function clear(el: Element): void { while (el.firstChild) el.removeChild(el.firstChild); }
