import { getCredentials } from './config.js'
import type { Db } from './db/index.js'
import { getToken } from './db/state.js'
import { GoogleCalendarClient } from './google/client.js'
import { logger } from './logger.js'
import { SyncEngine } from './sync/engine.js'
import { Routing } from './sync/routing.js'
import { TodoistClient } from './todoist/client.js'
import { createTodoistTokenProvider } from './todoist/oauth.js'

export interface RuntimeOptions {
  dryRun?: boolean
}

/**
 * Todoist can fall back to a personal token for reads, but Google has no
 * equivalent — without its OAuth token there is nothing to sync to.
 */
export function isAuthorized(db: Db): boolean {
  const hasGoogle = getToken(db, 'google') !== undefined
  const hasTodoist =
    getToken(db, 'todoist') !== undefined ||
    getCredentials().TODOIST_API_TOKEN !== undefined

  return hasGoogle && hasTodoist
}

export function createEngine(db: Db, options: RuntimeOptions = {}): SyncEngine {
  const google = new GoogleCalendarClient(db, { dryRun: options.dryRun })
  const todoist = new TodoistClient({
    getAccessToken: createTodoistTokenProvider(db),
    dryRun: options.dryRun,
  })

  return new SyncEngine({
    db,
    todoist,
    google,
    routing: Routing.fromConfig(),
    dryRun: options.dryRun,
  })
}

/** `undefined` until both providers are authorized, so the server can boot
 *  into the setup flow rather than crash-looping. */
export function tryCreateEngine(
  db: Db,
  options: RuntimeOptions = {},
): SyncEngine | undefined {
  if (!isAuthorized(db)) return undefined

  try {
    return createEngine(db, options)
  } catch (error) {
    logger.error({ err: error }, 'could not build sync engine')
    return undefined
  }
}

export function createGoogleClient(db: Db, options: RuntimeOptions = {}) {
  return new GoogleCalendarClient(db, { dryRun: options.dryRun })
}
