import { serve } from '@hono/node-server'

import { getConfig } from './config.js'
import { closeDb, getDb } from './db/index.js'
import { GoogleCalendarClient } from './google/client.js'
import { ensureWatchChannels } from './google/watch.js'
import { logger } from './logger.js'
import { isAuthorized, tryCreateEngine } from './runtime.js'
import type { SyncEngine } from './sync/engine.js'
import { createApp } from './web/server.js'

/** Re-register push channels well inside Google's TTL. */
const WATCH_CHECK_INTERVAL_MS = 12 * 3_600_000

const config = getConfig()
const db = getDb()

let engine: SyncEngine | undefined
const timers: NodeJS.Timeout[] = []

/**
 * Build the engine and bring push notifications up.
 *
 * Called at boot and again after each OAuth callback, so the process can start
 * unauthorized, serve the setup pages, and begin syncing without a restart.
 */
async function activate(): Promise<void> {
  if (engine !== undefined) return

  const setupUrl = new URL('/setup', config.PUBLIC_URL).toString()

  if (!isAuthorized(db)) {
    logger.warn({ setup: setupUrl }, 'not authorized yet; visit the setup page')
    return
  }

  // Authorized but unmapped: the sync would run and touch nothing, which looks
  // identical to being broken. Say so instead.
  if (config.SYNC_MAPPINGS.length === 0) {
    logger.warn(
      { ids: new URL('/setup/ids', config.PUBLIC_URL).toString() },
      'SYNC_MAPPINGS is empty; nothing will sync. Build it from the ids page, ' +
        'set the variable, and redeploy.',
    )
    return
  }

  engine = tryCreateEngine(db)
  if (engine === undefined) return

  await refreshWatchChannels()
  logger.info(
    { calendars: config.SYNC_MAPPINGS.length },
    'sync active; running initial resync',
  )
  // resyncAll rather than a plain reconcile: it re-links managed events from
  // their tags first, so booting against a lost volume adopts the existing
  // events instead of creating a duplicate for every task.
  engine.triggerResyncAll('startup')
}

async function refreshWatchChannels(): Promise<void> {
  if (!isAuthorized(db)) return

  try {
    await ensureWatchChannels(db, new GoogleCalendarClient(db))
  } catch (error) {
    // Push is a latency optimisation; the periodic reconcile keeps the sync
    // correct on its own, so this must never take the process down.
    logger.error({ err: error }, 'watch channel refresh failed')
  }
}

const app = createApp({
  db,
  adminToken: config.ADMIN_TOKEN,
  getEngine: () => engine,
  onAuthorized: activate,
})

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port, publicUrl: config.PUBLIC_URL }, 'listening')
})

await activate()

// Safety net for anything the webhooks missed, plus channel renewal.
timers.push(
  setInterval(
    () => engine?.trigger('periodic'),
    config.RECONCILE_INTERVAL_MINUTES * 60_000,
  ),
  setInterval(() => void refreshWatchChannels(), WATCH_CHECK_INTERVAL_MS),
)

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down')
  for (const timer of timers) clearInterval(timer)

  server.close(() => {
    closeDb()
    process.exit(0)
  })

  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
