/**
 * Force a full resync from the command line.
 *
 * Equivalent to `POST /admin/resync`, for when you have shell access to the
 * machine holding the database. On a hosted deploy the volume lives with the
 * server, so the endpoint is usually the one you want.
 *
 * `--dry-run` reports what a full resync would write without writing it.
 */
import { closeDb, getDb } from '../db/index.js'
import { logger } from '../logger.js'
import { createEngine, isAuthorized } from '../runtime.js'

const dryRun = process.argv.includes('--dry-run')
const db = getDb()

if (!isAuthorized(db)) {
  logger.error(
    'Not authorized. Start the server and complete the flow at /setup first.',
  )
  process.exit(1)
}

logger.info({ dryRun }, 'starting full resync')

try {
  await createEngine(db, { dryRun }).resyncAll()
} catch (error) {
  logger.error({ err: error }, 'full resync failed')
  process.exitCode = 1
} finally {
  closeDb()
}
