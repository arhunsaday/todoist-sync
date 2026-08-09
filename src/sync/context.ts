import { getConfig } from '../config.js'
import type { Db } from '../db/index.js'
import * as links from '../db/links.js'
import type { GoogleCalendarClient } from '../google/client.js'
import type { TodoistClient } from '../todoist/client.js'
import type { DecorationOptions } from './decorate.js'
import type { MappingOptions } from './mapping.js'
import type { Routing } from './routing.js'

export interface SyncContextDeps {
  db: Db
  todoist: TodoistClient
  google: GoogleCalendarClient
  routing: Routing
  /** Log intended writes without performing them, and skip link persistence. */
  dryRun?: boolean
}

/**
 * Everything the two direction modules need, plus the few write helpers that
 * must respect dry-run. Passing this around keeps `engine.ts` responsible for
 * orchestration alone.
 */
export interface SyncContext extends SyncContextDeps {
  dryRun: boolean
  /** Title decoration rules, needed on the reverse path to undo them. */
  decorationOptions(): DecorationOptions
  mappingOptions(calendarId: string): Promise<MappingOptions>
  persistLink(link: Omit<links.Link, 'updatedAt'>): void
  dropLink(itemId: string): void
}

export function createSyncContext(deps: SyncContextDeps): SyncContext {
  const dryRun = deps.dryRun === true

  return {
    ...deps,
    dryRun,

    decorationOptions(): DecorationOptions {
      const config = getConfig()
      return {
        priorityPrefixes: config.PRIORITY_PREFIXES,
        labelPrefixes: config.LABEL_PREFIXES,
      }
    },

    async mappingOptions(calendarId: string): Promise<MappingOptions> {
      const config = getConfig()
      return {
        ...this.decorationOptions(),
        defaultDurationMinutes: config.DEFAULT_EVENT_DURATION_MINUTES,
        syncComments: config.SYNC_COMMENTS,
        // Todoist floating times carry no zone; Google needs one, and the
        // calendar's own zone is the least surprising choice.
        fallbackTimeZone: await deps.google.getTimeZone(calendarId),
      }
    },

    persistLink(link) {
      if (dryRun) return
      links.upsert(deps.db, link)
    },

    dropLink(itemId) {
      if (dryRun) return
      links.remove(deps.db, itemId)
    },
  }
}

export function isNotFound(error: unknown): boolean {
  const status = (error as { status?: number; code?: number } | null)?.status
  const code = (error as { code?: number } | null)?.code
  return status === 404 || code === 404
}
