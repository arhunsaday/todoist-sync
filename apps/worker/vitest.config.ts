import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          BETTER_AUTH_SECRET: 'test-secret-32-characters-0123456789',
          TOKEN_ENCRYPTION_KEY: btoa('01234567890123456789012345678901'),
        },
      },
    }),
  ],
  test: { include: ['src/**/*.test.ts'], exclude: ['src/**/*.unit.test.ts'] },
})
