import * as state from '../db/state.js'
import { SyncTokenExpiredError } from '../google/client.js'
import { logger } from '../logger.js'
import { createSyncContext, type SyncContext, type SyncContextDeps } from './context.js'
import { applyGoogleEvent } from './google-to-todoist.js'
import { applyTodoistItem } from './todoist-to-google.js'

/**
 * Drives reconciliation. Both webhook handlers and the periodic timer land
 * here; neither reads data out of its payload.
 *
 * Webhooks are wake-up signals; the sync tokens are the source of truth. That
 * split makes out-of-order, duplicated, and dropped deliveries all harmless —
 * a lost webhook costs latency, not correctness.
 *
 * Conflict policy: `pullTodoist` runs before `pullGoogle`, so when the same
 * task is edited on both sides inside one window, Todoist wins. This is a
 * deliberate simplification over timestamp comparison — it needs no extra
 * fetch per change and no clock-skew handling, at the cost of losing a
 * simultaneous calendar-side edit.
 */
export class SyncEngine {
  private readonly ctx: SyncContext
  private running = false
  private dirty = false

  constructor(deps: SyncContextDeps) {
    this.ctx = createSyncContext(deps)
  }

  /**
   * Run a full reconcile, coalescing concurrent requests.
   *
   * A trigger arriving mid-run sets `dirty` and is picked up by a further loop
   * iteration rather than starting a second overlapping pass: two passes
   * interleaving writes would each read the other's as user edits.
   */
  async reconcile(): Promise<void> {
    if (this.running) {
      this.dirty = true
      logger.debug('reconcile already running; coalescing')
      return
    }

    this.running = true
    try {
      do {
        this.dirty = false
        await this.pullTodoist()
        for (const calendarId of this.ctx.routing.calendarIds) {
          await this.pullGoogle(calendarId)
        }
      } while (this.dirty)
    } finally {
      this.running = false
    }
  }

  /** Fire-and-forget entry point for webhook handlers and timers. */
  trigger(reason: string): void {
    logger.debug({ reason }, 'reconcile triggered')
    void this.reconcile().catch((error: unknown) => {
      logger.error({ reason, err: error }, 'reconcile failed')
    })
  }

  private async pullTodoist(): Promise<void> {
    const { db, todoist } = this.ctx
    const response = await todoist.sync(state.getTodoistSyncToken(db))

    if (response.items.length > 0) {
      logger.debug(
        { count: response.items.length, fullSync: response.full_sync },
        'todoist changes received',
      )
    }

    let failures = 0
    for (const item of response.items) {
      try {
        await applyTodoistItem(this.ctx, item)
      } catch (error) {
        failures++
        logger.error(
          { itemId: item.id, content: item.content, err: error },
          'could not apply Todoist change',
        )
      }
    }

    // The cursor advances even when individual items failed. Holding it back
    // would stall every other change behind one permanently broken task; the
    // errors above are the signal that something needs attention.
    if (!this.ctx.dryRun) state.setTodoistSyncToken(db, response.sync_token)
    if (failures > 0) {
      logger.warn({ failures }, 'some Todoist changes were not applied')
    }
  }

  private async pullGoogle(calendarId: string): Promise<void> {
    const { db, google } = this.ctx
    const syncToken = state.getGoogleSyncToken(db, calendarId)

    let result
    try {
      result = await google.listChanges(calendarId, syncToken)
    } catch (error) {
      if (!(error instanceof SyncTokenExpiredError)) throw error

      // Re-baseline from a full list. Links survive, and every managed event
      // carries its todoistId, so this re-checks pairs rather than duplicating.
      logger.warn({ calendarId }, 'google sync token expired; re-baselining')
      state.clearGoogleSyncToken(db, calendarId)
      result = await google.listChanges(calendarId, undefined)
    }

    if (result.events.length > 0) {
      logger.debug(
        { calendarId, count: result.events.length },
        'google changes received',
      )
    }

    let failures = 0
    for (const event of result.events) {
      try {
        await applyGoogleEvent(this.ctx, calendarId, event)
      } catch (error) {
        failures++
        logger.error(
          { calendarId, eventId: event.id, err: error },
          'could not apply Google change',
        )
      }
    }

    if (!this.ctx.dryRun) {
      state.setGoogleSyncToken(db, calendarId, result.nextSyncToken)
    }
    if (failures > 0) {
      logger.warn({ calendarId, failures }, 'some Google changes were not applied')
    }
  }
}
