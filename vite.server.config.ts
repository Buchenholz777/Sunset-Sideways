import { defineConfig } from 'vite';

// Baut Server und Wartungsbefehle zu lauffähigen Node-Modulen (dist-server/index.mjs, cli.mjs). node:sqlite und node:crypto bleiben extern.
export default defineConfig({
  build: {
    ssr: true,
    target: 'node24',
    outDir: 'dist-server',
    emptyOutDir: true,
    minify: false,
    rollupOptions: { input: { index: 'server/index.ts', cli: 'server/cli.ts' }, output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' } },
  },
  ssr: { noExternal: true },
});
