import { h, s, clear } from './dom';

/** Gerundete Obergrenze und Teilung für eine Achse. */
export function niceMax(v: number): { max: number; step: number } {
  if (v <= 0) return { max: 4, step: 1 };
  const raw = v / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const step = Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag);
  return { max: Math.ceil(v / step) * step, step };
}

export interface Series { name: string; values: number[]; cls: string; dashed?: boolean }
export interface Marker { at: number; label: string; kind: 'publish' }
export interface Band { from: number; to: number; label: string }

export interface LineOpts {
  title: string; yLabel: string; xLabel: string;
  xs: number[]; xFmt: (t: number) => string; yFmt?: (v: number) => string;
  series: Series[]; markers?: Marker[]; bands?: Band[];
  /** Beschreibung für Screenreader. */
  summary: string;
}

const W = 640, H = 260, L = 52, R = 34, T = 14, B = 44;

/** Liniendiagramm mit beschrifteten Achsen, Tastatur-/Zeigerauswahl, Textanzeige und Tabellenansicht. */
export function lineChart(o: LineOpts): HTMLElement {
  const n = o.xs.length;
  const yFmt = o.yFmt ?? ((v: number) => String(v));
  const all = o.series.flatMap((x) => x.values);
  const { max, step } = niceMax(Math.max(0, ...all));
  const px = (i: number): number => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
  const py = (v: number): number => T + (1 - v / max) * (H - T - B);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${o.title}. ${o.summary}`, class: 'chart-svg' });
  for (let v = 0; v <= max + 1e-9; v += step) {
    svg.append(s('line', { x1: L, x2: W - R, y1: py(v), y2: py(v), class: 'grid' }));
    const t = s('text', { x: L - 8, y: py(v) + 4, class: 'tick', 'text-anchor': 'end' }); t.textContent = yFmt(v); svg.append(t);
  }
  const every = Math.max(1, Math.ceil(n / 7));
  o.xs.forEach((x, i) => {
    if (i % every !== 0) return;
    const t = s('text', { x: px(i), y: H - B + 18, class: 'tick', 'text-anchor': 'middle' }); t.textContent = o.xFmt(x); svg.append(t);
  });
  const xl = s('text', { x: (L + W - R) / 2, y: H - 6, class: 'axis-title', 'text-anchor': 'middle' }); xl.textContent = o.xLabel; svg.append(xl);
  const yl = s('text', { x: 12, y: (T + H - B) / 2, class: 'axis-title', 'text-anchor': 'middle', transform: `rotate(-90 12 ${(T + H - B) / 2})` }); yl.textContent = o.yLabel; svg.append(yl);
  const xi = (t: number): number => (n <= 1 ? L : L + Math.min(1, Math.max(0, (t - o.xs[0]) / (o.xs[n - 1] - o.xs[0]))) * (W - L - R));
  for (const b of o.bands ?? []) {
    const x1 = xi(b.from), x2 = xi(b.to);
    const r = s('rect', { x: x1, y: T, width: Math.max(2, x2 - x1), height: H - T - B, class: 'band' });
    const tt = s('title'); tt.textContent = b.label; r.append(tt); svg.append(r);
  }
  for (const m of o.markers ?? []) {
    const x = xi(m.at);
    const l = s('line', { x1: x, x2: x, y1: T, y2: H - B, class: 'marker' });
    const tt = s('title'); tt.textContent = m.label; l.append(tt); svg.append(l);
  }
  for (const se of o.series) {
    const d = se.values.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ');
    svg.append(s('path', { d, class: `line ${se.cls}${se.dashed ? ' dashed' : ''}`, fill: 'none' }));
    if (n <= 31) se.values.forEach((v, i) => svg.append(s('circle', { cx: px(i), cy: py(v), r: 2.6, class: `dot ${se.cls}` })));
  }
  const cursor = s('line', { x1: 0, x2: 0, y1: T, y2: H - B, class: 'cursor', visibility: 'hidden' });
  svg.append(cursor);

  const readout = h('p', { class: 'readout', 'aria-live': 'polite' }, 'Mit Pfeiltasten oder Zeiger einen Zeitpunkt wählen.');
  let idx = -1;
  const show = (i: number): void => {
    idx = Math.max(0, Math.min(n - 1, i));
    cursor.setAttribute('x1', String(px(idx))); cursor.setAttribute('x2', String(px(idx))); cursor.setAttribute('visibility', 'visible');
    readout.textContent = `${o.xFmt(o.xs[idx])}: ` + o.series.map((x) => `${x.name} ${yFmt(x.values[idx])}`).join(' · ');
  };
  const wrap = h('div', { class: 'chart-wrap', tabindex: '0', role: 'group', 'aria-label': `${o.title} – interaktive Werteanzeige` }, svg);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { show(idx < 0 ? 0 : idx + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { show(idx < 0 ? n - 1 : idx - 1); e.preventDefault(); }
    else if (e.key === 'Home') { show(0); e.preventDefault(); } else if (e.key === 'End') { show(n - 1); e.preventDefault(); }
  });
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    show(Math.round(((x - L) / (W - L - R)) * (n - 1)));
  });
  const legend = h('ul', { class: 'legend' }, ...o.series.map((x) => h('li', null, h('i', { class: `sw ${x.cls}${x.dashed ? ' dashed' : ''}` }), x.name)),
    ...(o.markers?.length ? [h('li', null, h('i', { class: 'sw marker-sw' }), 'Veröffentlichung')] : []), ...(o.bands?.length ? [h('li', null, h('i', { class: 'sw band-sw' }), 'Ereignis (Flugwoche)')] : []));
  return h('div', { class: 'chart' }, legend, wrap, readout, tableToggle(o.xs.map((x) => o.xFmt(x)), o.series, yFmt, o.xLabel));
}

/** Tabellenansicht (gleiche Daten wie das Diagramm), per Schalter einblendbar. */
export function tableToggle(rows: string[], series: Series[], f: (v: number) => string, firstHead: string): HTMLElement {
  const tbl = h('table', { class: 'data', hidden: true },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, firstHead), ...series.map((x) => h('th', { scope: 'col' }, x.name)))),
    h('tbody', null, ...rows.map((r, i) => h('tr', null, h('th', { scope: 'row' }, r), ...series.map((x) => h('td', null, f(x.values[i])))))));
  const btn = h('button', { type: 'button', class: 'link', 'aria-expanded': 'false' }, 'Tabelle anzeigen');
  btn.addEventListener('click', () => { const open = tbl.hidden; tbl.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.textContent = open ? 'Tabelle ausblenden' : 'Tabelle anzeigen'; });
  return h('div', { class: 'tbl-box' }, btn, h('div', { class: 'tbl-scroll' }, tbl));
}

export interface Bar { label: string; value: number; text: string; sub?: string }

/** Balkendiagramm (senkrecht) mit Tastaturauswahl; für Verteilungen. */
export function columnChart(o: { title: string; xLabel: string; yLabel: string; bars: Bar[]; summary: string; xTickEvery?: number }): HTMLElement {
  const n = o.bars.length;
  const { max, step } = niceMax(Math.max(0, ...o.bars.map((b) => b.value)));
  const bw = (W - L - R) / n;
  const py = (v: number): number => T + (1 - v / max) * (H - T - B);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${o.title}. ${o.summary}`, class: 'chart-svg' });
  for (let v = 0; v <= max + 1e-9; v += step) {
    svg.append(s('line', { x1: L, x2: W - R, y1: py(v), y2: py(v), class: 'grid' }));
    const t = s('text', { x: L - 8, y: py(v) + 4, class: 'tick', 'text-anchor': 'end' }); t.textContent = String(v); svg.append(t);
  }
  const every = o.xTickEvery ?? Math.max(1, Math.ceil(n / 8));
  const rects: SVGElement[] = [];
  o.bars.forEach((b, i) => {
    const x = L + i * bw + 1, y = py(b.value);
    const r = s('rect', { x, y, width: Math.max(1, bw - 2), height: Math.max(0, H - B - y), class: 'bar', rx: 2 });
    rects.push(r); svg.append(r);
    if (i % every === 0) { const t = s('text', { x: x + bw / 2, y: H - B + 18, class: 'tick', 'text-anchor': 'middle' }); t.textContent = b.label; svg.append(t); }
  });
  const xl = s('text', { x: (L + W - R) / 2, y: H - 6, class: 'axis-title', 'text-anchor': 'middle' }); xl.textContent = o.xLabel; svg.append(xl);
  const yl = s('text', { x: 12, y: (T + H - B) / 2, class: 'axis-title', 'text-anchor': 'middle', transform: `rotate(-90 12 ${(T + H - B) / 2})` }); yl.textContent = o.yLabel; svg.append(yl);
  const readout = h('p', { class: 'readout', 'aria-live': 'polite' }, 'Mit Pfeiltasten oder Zeiger einen Balken wählen.');
  let idx = -1;
  const show = (i: number): void => {
    idx = Math.max(0, Math.min(n - 1, i));
    rects.forEach((r, k) => r.classList.toggle('sel', k === idx));
    readout.textContent = `${o.bars[idx].label}: ${o.bars[idx].text}`;
  };
  const wrap = h('div', { class: 'chart-wrap', tabindex: '0', role: 'group', 'aria-label': `${o.title} – interaktive Werteanzeige` }, svg);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { show(idx < 0 ? 0 : idx + 1); e.preventDefault(); } else if (e.key === 'ArrowLeft') { show(idx < 0 ? n - 1 : idx - 1); e.preventDefault(); }
  });
  svg.addEventListener('pointermove', (e) => { const r = svg.getBoundingClientRect(); show(Math.floor((((e.clientX - r.left) / r.width) * W - L) / bw)); });
  return h('div', { class: 'chart' }, wrap, readout, tableToggle(o.bars.map((b) => b.label), [{ name: o.yLabel, values: o.bars.map((b) => b.value), cls: 'a' }], (v) => String(v), o.xLabel));
}

/** Waagerechte Balken mit direkter Beschriftung (Anteile, Sammelquoten). */
export function hbars(rows: Array<{ label: string; frac: number | null; text: string; sub?: string; frac2?: number | null }>, cls = 'a'): HTMLElement {
  return h('ul', { class: 'hbars' }, ...rows.map((r) => h('li', null,
    h('div', { class: 'hb-head' }, h('span', { class: 'hb-label' }, r.label), h('span', { class: 'hb-text' }, r.text)),
    h('div', { class: 'hb-track', role: 'presentation' },
      r.frac2 != null ? h('div', { class: 'hb-fill b', style: `width:${Math.max(0, Math.min(1, r.frac2)) * 100}%` }) : null,
      r.frac != null ? h('div', { class: `hb-fill ${cls}`, style: `width:${Math.max(0, Math.min(1, r.frac)) * 100}%` }) : null),
    r.sub ? h('div', { class: 'hb-sub' }, r.sub) : null)));
}

export { clear };
