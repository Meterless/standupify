import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { standupifyBridge } from './server/bridge';

// Tauri sets TAURI_ENV_PLATFORM when it spawns Vite; it needs a fixed port.
const isTauri = !!process.env.TAURI_ENV_PLATFORM;
const port = Number(process.env.PORT) || (isTauri ? 1420 : 3210);

export default defineConfig({
  // Relative asset URLs work from any folder, file host, or tauri://localhost.
  base: './',
  clearScreen: false,

  // Loopback only: the bridge injects the Nightshift token, so it must never
  // be reachable from another machine.
  server: {
    host: '127.0.0.1',
    port,
    strictPort: isTauri,
    watch: { ignored: ['**/src-tauri/**', '**/engines/**', '**/.backup/**'] }
  },
  preview: { host: '127.0.0.1', port },

  envPrefix: ['VITE_', 'TAURI_ENV_*'],

  plugins: [react(), tailwindcss(), standupifyBridge()],

  resolve: {
    alias: { '@': path.resolve(__dirname, '.') }
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: { manualChunks: { 'react-vendor': ['react', 'react-dom'] } }
    }
  }
});
