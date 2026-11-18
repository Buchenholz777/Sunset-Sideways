// Nimmt die Menümusik ein Mal komplett auf (16 Takte bei 86 BPM ≈ 44,7 s) und speichert sie als WebM.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const [URL, OUT, SEC] = [process.argv[2], process.argv[3], Number(process.argv[4] ?? 46)];
const b = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  localStorage.setItem('ssw-consent', JSON.stringify({ v: 1, d: 'denied', ts: 1 }));
  const orig = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...r) {
    if (dest instanceof AudioDestinationNode) {
      const c = this.context;
      if (!c.__rec) {
        const md = c.createMediaStreamDestination();
        const mr = new MediaRecorder(md.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
        const parts = []; mr.ondataavailable = (e) => parts.push(e.data); mr.start();
        c.__rec = { md, mr, parts }; window.__rec = c.__rec;
      }
      orig.call(this, c.__rec.md);
    }
    return orig.call(this, dest, ...r);
  };
});
const page = await ctx.newPage();
await page.goto(URL); await page.waitForSelector('#btn-start');
await page.mouse.click(5, 5);
await page.waitForFunction(() => !!window.__rec, null, { timeout: 10000 });
await page.waitForTimeout(SEC * 1000);
const b64 = await page.evaluate(() => new Promise((res) => {
  const R = window.__rec; R.mr.onstop = async () => { const buf = await new Blob(R.parts).arrayBuffer(); let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); res(btoa(s)); }; R.mr.stop();
}));
writeFileSync(OUT, Buffer.from(b64, 'base64'));
await b.close();
console.log('gespeichert', OUT, Buffer.from(b64, 'base64').length, 'Bytes');
