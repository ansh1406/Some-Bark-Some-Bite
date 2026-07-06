import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@sbsb/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url))
    }
  },
  plugins: [react()],
  server: {
    port: 5173
  }
});
