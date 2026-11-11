// Statischer Build nur fürs Spiel (ohne Admin/Server) für Netlify, Cloudflare Pages, GitHub Pages u. ä.
// Aufruf: node scripts/build_static.mjs https://sunsetsideways.com
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const origin = (process.argv[2] ?? 'https://sunsetsideways.com').replace(/\/+$/, '');
const r = spawnSync('npx', ['vite', 'build'], { stdio: 'inherit', shell: true, env: { ...process.env, SITE_ORIGIN: origin, VITE_STATIC: '1' } });
if (r.status) process.exit(r.status);
writeFileSync('dist/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
writeFileSync('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc></url>\n</urlset>\n`);
// Kopfzeilen für Netlify/Cloudflare Pages: Hash-Assets lange cachen, Seite immer prüfen, Basis-Sicherheit
writeFileSync('dist/_headers', `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/index.html\n  Cache-Control: no-cache\n`);
console.log(`Statischer Build fertig: dist/ (Domain ${origin})`);
