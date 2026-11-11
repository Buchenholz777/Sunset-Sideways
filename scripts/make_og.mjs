// Erzeugt public/og.png (1200×630, Social-Vorschau) aus einer kleinen HTML-Szene im Stil des Spiels.
import { chromium } from 'playwright-core';
const html = `<!doctype html><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;background:linear-gradient(#1a0b45 0%,#5b1b86 34%,#e8457f 58%,#ffb26b 70%,#1a0b45 70.2%);position:relative}
.sun{position:absolute;left:380px;top:215px;width:440px;height:220px;border-radius:220px 220px 0 0;background:linear-gradient(#ffe27a,#ff7aa8);box-shadow:0 0 90px #ff7aa8}
.sun i{position:absolute;left:0;right:0;height:9px;background:#5b1b86}
.road{position:absolute;left:0;right:0;top:441px;bottom:0;background:#14082f;overflow:hidden}
.road b{position:absolute;left:600px;top:0;width:3px;height:200px;background:#5fe0ff;transform-origin:top;box-shadow:0 0 12px #5fe0ff}
.h{position:absolute;left:0;right:0;height:2px;background:#ff5fa8;box-shadow:0 0 10px #ff5fa8}
.car{position:absolute;left:520px;top:506px;width:160px;height:70px;border-radius:30px 30px 10px 10px;background:linear-gradient(#ff3f7f,#8f1d5f);box-shadow:0 0 40px #ff3f7f}
.car:before{content:'';position:absolute;left:28px;top:-22px;width:104px;height:34px;border-radius:24px 24px 0 0;background:#2a1050}
.car:after{content:'';position:absolute;left:10px;right:10px;bottom:14px;height:8px;background:#ffe27a;border-radius:4px;box-shadow:0 0 18px #ffe27a}
h1{position:absolute;left:0;right:0;top:46px;text-align:center;font-size:104px;line-height:1;font-style:italic;font-weight:900;letter-spacing:.02em;color:#fff;text-shadow:0 0 30px #ff5fa8,0 0 70px #5fe0ff}
h1 span{display:block}h1 .b{color:#5fe0ff;font-size:96px}
p{position:absolute;left:0;right:0;bottom:22px;text-align:center;color:#ffe9f3;font-size:30px;letter-spacing:.06em}
</style><div class="sun">${[0.45, 0.58, 0.7, 0.8, 0.9].map((t) => `<i style="top:${t * 100}%"></i>`).join('')}</div>
<div class="road">${[0, 1, 2, 3, 4, 5].map((i) => `<div class="h" style="top:${Math.pow(i / 5, 2) * 188}px"></div>`).join('')}${[-5, -3, -1, 1, 3, 5].map((k) => `<b style="transform:rotate(${k * 9}deg)"></b>`).join('')}</div>
<div class="car"></div><h1><span>Sunset</span><span class="b">Sideways</span></h1><p>Arcade-Racer im Browser · vom Sonnenuntergang in die Neonnacht</p>`;
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: 'public/og.png' });
await browser.close();
console.log('public/og.png geschrieben');
