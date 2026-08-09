/**
 * Run a single reconcile pass and exit.
 *
 * With `--dry-run`, every intended write is logged and none is performed, and
 * no link state is persisted. Run that against the real accounts before the
 * first live sync — it is the cheapest way to catch a bad mapping before it
 * creates a few hundred events.
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

logger.info({ dryRun }, 'starting one-off reconcile')

try {
  await createEngine(db, { dryRun }).reconcile()
  logger.info({ dryRun }, 'reconcile finished')
} catch (error) {
  logger.error({ err: error }, 'reconcile failed')
  process.exitCode = 1
} finally {
  closeDb()
}
