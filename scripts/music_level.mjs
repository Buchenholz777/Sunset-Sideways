// Pegel einer Musikaufnahme je 4 Takte (86 BPM): zeigt, ob Intro, Strophe und Refrains hörbar sind. node scripts/music_level.mjs <datei>
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const b64 = readFileSync(process.argv[2]).toString('base64');
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage();
const out = await page.evaluate(async (s) => {
  const u = Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
  const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(u.buffer);
  const d = buf.getChannelData(0), sec = (60 / 86) * 16, r = [];
  for (let a = 0; a < buf.duration; a += sec) {
    let q = 0, pk = 0; const i0 = Math.floor(a * buf.sampleRate), i1 = Math.min(d.length, Math.floor((a + sec) * buf.sampleRate));
    for (let i = i0; i < i1; i++) { q += d[i] * d[i]; pk = Math.max(pk, Math.abs(d[i])); }
    r.push(`${a.toFixed(1)}s: RMS ${(20 * Math.log10(Math.sqrt(q / Math.max(1, i1 - i0)) + 1e-9)).toFixed(1)} dB, Spitze ${pk.toFixed(2)}`);
  }
  return [`Dauer ${buf.duration.toFixed(1)} s`, ...r].join('\n');
}, b64);
console.log(out);
await b.close();
