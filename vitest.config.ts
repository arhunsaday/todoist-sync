import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Set before any test imports config.ts. dotenv will not override a key
    // listed here — but any key NOT listed still leaks in from a developer's
    // real .env, so anything that changes behaviour must be pinned.
    env: {
      LOG_LEVEL: 'silent',
      ADMIN_TOKEN: 'test-admin-token-0123456789',
      DATABASE_PATH: ':memory:',
      PUBLIC_URL: 'https://sync.test',
      GOOGLE_CLIENT_ID: 'test-google-client',
      GOOGLE_CLIENT_SECRET: 'test-google-secret',
      GOOGLE_REDIRECT_URI: 'https://sync.test/setup/google/callback',
      TODOIST_CLIENT_ID: 'test-todoist-client',
      TODOIST_CLIENT_SECRET: 'test-todoist-secret',
      TODOIST_REDIRECT_URI: 'https://sync.test/setup/todoist/callback',
      SYNC_MAPPINGS: 'proj-1:work@group.calendar.google.com,proj-2:home@group.calendar.google.com',
      DEFAULT_EVENT_DURATION_MINUTES: '60',
      SYNC_FOREIGN_EVENTS: 'true',
      SYNC_RECURRING_FOREIGN_EVENTS: 'false',
      // Low on purpose, so the circuit-breaker tests stay readable.
      MAX_COMPLETIONS_PER_SYNC: '3',
    },
  },
})
