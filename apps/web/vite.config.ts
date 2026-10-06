import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    cloudflare({
      configPath: '../worker/wrangler.jsonc',
      persistState: { path: '../../.wrangler/state' },
    }),
  ],
  server: { port: 5173 },
  build: { outDir: 'dist/client' },
})
