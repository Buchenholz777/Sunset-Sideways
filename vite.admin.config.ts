import { defineConfig } from 'vite';

// Admin-Oberfläche: eigenes Bundle unter /_admin/ im Pages-Ausgabeordner. Wird nur von der Pages Function nach Anmeldung ausgeliefert.
export default defineConfig({
  root: 'admin',
  base: '/_admin/',
  build: { target: 'es2022', outDir: '../dist/_admin', emptyOutDir: true, assetsInlineLimit: 0 },
});
