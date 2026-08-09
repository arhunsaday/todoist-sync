/**
 * Rebuild the link table from what is actually on the two services.
 *
 * The SQLite file is a cache, not the source of truth: every managed event
 * carries `extendedProperties.private.todoistId`, so a wiped volume (a Railway
 * redeploy without a mount, a lost disk) is recoverable. Without this, the
 * next sync would treat every task as new and duplicate the lot.
 *
 * Pass `--prune` to also delete events whose task no longer exists.
 */
import { closeDb, getDb } from '../db/index.js'
import * as links from '../db/links.js'
import { todoistIdOf } from '../google/client.js'
import { logger } from '../logger.js'
import { createGoogleClient, isAuthorized } from '../runtime.js'
import { googleFingerprint } from '../sync/fingerprint.js'
import { Routing } from '../sync/routing.js'
import { TodoistClient } from '../todoist/client.js'
import { createTodoistTokenProvider } from '../todoist/oauth.js'
import type { TodoistItem } from '../todoist/types.js'

const prune = process.argv.includes('--prune')
const db = getDb()

if (!isAuthorized(db)) {
  logger.error(
    'Not authorized. Start the server and complete the flow at /setup first.',
  )
  process.exit(1)
}

const routing = Routing.fromConfig()
const google = createGoogleClient(db)
const todoist = new TodoistClient({
  getAccessToken: createTodoistTokenProvider(db),
})

logger.info('reading all Todoist tasks')
const snapshot = await todoist.sync('*')
const items = new Map<string, TodoistItem>(
  snapshot.items.map((item) => [item.id, item]),
)

let rebuilt = 0
let orphaned = 0
let pruned = 0

for (const calendarId of routing.calendarIds) {
  const events = await google.listManagedEvents(calendarId)
  logger.info({ calendarId, count: events.length }, 'found managed events')

  for (const event of events) {
    const todoistId = todoistIdOf(event)
    if (todoistId === undefined || event.id == null) continue

    const item = items.get(todoistId)

    // The task was completed or deleted while we were down, so nothing owns
    // this event any more.
    if (item === undefined || item.checked || item.is_deleted) {
      orphaned++
      if (prune) {
        await google.delete(calendarId, event.id)
        pruned++
        logger.info(
          { calendarId, eventId: event.id, todoistId },
          'pruned orphaned event',
        )
      } else {
        logger.warn(
          { calendarId, eventId: event.id, todoistId, summary: event.summary },
          'orphaned event (re-run with --prune to delete)',
        )
      }
      continue
    }

    links.upsert(db, {
      todoistItemId: todoistId,
      googleEventId: event.id,
      googleCalendarId: calendarId,
      todoistProjectId: item.project_id,
      // Deliberately blank: an empty fingerprint can never match, so the next
      // reconcile re-pushes every task from Todoist. That costs one write per
      // task but guarantees convergence, whereas recording the current state
      // would silently accept any drift that happened while we were down.
      todoistFingerprint: '',
      googleFingerprint: googleFingerprint(event, calendarId),
    })
    rebuilt++
  }
}

logger.info(
  { rebuilt, orphaned, pruned },
  'rebuild complete; the next reconcile will re-push every task from Todoist',
)
closeDb()
