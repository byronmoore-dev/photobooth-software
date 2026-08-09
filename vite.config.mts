import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'src/shared'),
      '@renderer': path.resolve(import.meta.dirname, 'src/renderer'),
    },
  },
  build: {
    outDir: 'dist-renderer',
    rolldownOptions: { checks: { pluginTimings: false } },
  },
  server: { port: 5173, strictPort: true },
});
