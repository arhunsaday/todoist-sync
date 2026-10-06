import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['packages/**/*.test.ts', 'apps/worker/src/**/*.unit.test.ts'] },
})
