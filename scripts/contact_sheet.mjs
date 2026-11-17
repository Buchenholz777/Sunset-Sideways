// Kontaktbogen aus Bildern (für Vorher/Nachher-Vergleiche). node scripts/contact_sheet.mjs <ziel.png> <spalten> <breite je Bild> <bild1> [bild2 …]
// Ein Bildpfad "|" beginnt eine neue Zeile mit Beschriftung: "|Vorher".
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [out, cols, w, ...files] = process.argv.slice(2);
const cells = files.map((f) => f.startsWith('|') ? `<div class="lab" style="grid-column:1/-1">${f.slice(1)}</div>` : `<figure><img src="${pathToFileURL(resolve(f)).href}"><figcaption>${f.split(/[\\/]/).pop()}</figcaption></figure>`).join('');
const html = `<html><body style="margin:0;background:#111;color:#ddd;font:12px system-ui"><div style="display:grid;grid-template-columns:repeat(${cols},${w}px);gap:6px;padding:6px">${cells}</div>
<style>figure{margin:0}img{width:${w}px;display:block}figcaption{padding:2px 0}.lab{font:700 16px system-ui;padding:6px 0 0}</style></body></html>`;
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: Number(cols) * (Number(w) + 6) + 6, height: 400 } });
const tmp = resolve(out + '.html');
writeFileSync(tmp, html);
await p.goto(pathToFileURL(tmp).href); await p.waitForLoadState('load'); await p.waitForTimeout(200);
unlinkSync(tmp);
await p.screenshot({ path: out, fullPage: true });
await b.close();
