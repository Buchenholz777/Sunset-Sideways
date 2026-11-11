import { defineConfig } from 'vite';

// Admin-Oberfläche: eigenes Bundle, wird nur nach serverseitiger Sitzungsprüfung ausgeliefert (dist-admin).
export default defineConfig({
  root: 'admin',
  base: '/admin/',
  build: { target: 'es2022', outDir: '../dist-admin', emptyOutDir: true, assetsInlineLimit: 0 },
});
