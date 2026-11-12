// Build für Cloudflare Pages: Spiel (dist/) + private Admin-Oberfläche (dist/_admin/, wird nur von der Function nach Anmeldung ausgeliefert).
// Aufruf: node scripts/build_pages.mjs https://www.sunsetsideways.com
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const origin = (process.argv[2] ?? process.env.SITE_ORIGIN ?? 'https://www.sunsetsideways.com').replace(/\/+$/, '');
const run = (args, env = {}) => { const r = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', ...args], { stdio: 'inherit', env: { ...process.env, ...env } }); if (r.status) process.exit(r.status); };
run(['build'], { SITE_ORIGIN: origin });                       // Spiel → dist/
run(['build', '-c', 'vite.admin.config.ts']);                 // Admin → dist/_admin/
writeFileSync('dist/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
writeFileSync('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`);
writeFileSync('dist/_headers', `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/index.html\n  Cache-Control: no-cache\n`);
console.log(`Pages-Build fertig: dist/ (Domain ${origin})`);
