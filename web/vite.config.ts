import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The UI is static and served by the sync server itself (src/web/server.ts),
// so the build lands next to the compiled server in dist/public.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL('../dist/public', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    // `pnpm dev` serves the API on :3000; the browser only talks to Vite.
    proxy: {
      '/api': 'http://localhost:3000',
      '/setup': 'http://localhost:3000',
    },
  },
})
