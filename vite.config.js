// The page: built from ui/ into web/dist, which the office serves on its own port. `npm run ui:dev`
// runs Vite with /api proxied to a running office.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'ui',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../web/dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1500 },
  server: { port: 4601, proxy: { '/api': { target: 'http://127.0.0.1:4600', changeOrigin: true } } },
});
