import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// base './' → Build funktioniert unter jedem Hosting-Unterpfad.
export default defineConfig({
  base: './',
  plugins: [{ name: 'site-origin', transformIndexHtml: (html: string) => (process.env.SITE_ORIGIN ? html.replace(/__ORIGIN__/g, process.env.SITE_ORIGIN.replace(/[/]+$/, '')) : html) }],
  define: { __GAME_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
