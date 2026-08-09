import {
  getItem,
  putItem,
  putNote,
  removeItem,
  removeNote,
  removeNotesForItem,
} from '../db/items.js'
import * as links from '../db/links.js'
import * as state from '../db/state.js'
import {
  SyncTokenExpiredError,
  todoistIdOf,
  type GoogleEvent,
} from '../google/client.js'
import { logger } from '../logger.js'
import type { TodoistItem, TodoistNote } from '../todoist/types.js'
import { createSyncContext, type SyncContext, type SyncContextDeps } from './context.js'
import { googleFingerprint } from './fingerprint.js'
import {
  applyGoogleEvent,
  isGenuineDeletion,
  wouldCompleteTask,
} from './google-to-todoist.js'
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
  /** Calendars whose pass the circuit breaker is currently refusing. */
  private readonly blocked = new Set<string>()

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

  /** Calendars stalled by the circuit breaker; surfaced on /health. */
  get blockedCalendars(): string[] {
    return [...this.blocked]
  }

  /** Fire-and-forget entry point for webhook handlers and timers. */
  trigger(reason: string): void {
    logger.debug({ reason }, 'reconcile triggered')
    void this.reconcile().catch((error: unknown) => {
      logger.error({ reason, err: error }, 'reconcile failed')
    })
  }

  /**
   * Discard both cursors and reconcile from scratch.
   *
   * Incremental sync only ever reports what changed, so a task that was
   * skipped — a failed write, or a change that arrived while the mapping was
   * wrong — is never revisited. This is the way back: dropping the cursors
   * makes the next pass a full sync without having to wipe the database.
   *
   * Cheap and safe to repeat. Links are left alone, so tasks already mirrored
   * match their stored fingerprints and are echo-skipped; only genuinely
   * missing or drifted events produce writes.
   */
  async resyncAll(): Promise<void> {
    const { db } = this.ctx

    // Re-link before syncing. Without this, a resync run against a wiped link
    // table sees every task as new and creates a second event for each one —
    // the existing events are already there, tagged, but nothing points at
    // them. Adopting them first makes a resync safe to run unconditionally.
    await this.adoptOrphanedEvents()

    logger.info('clearing sync cursors for a full resync')
    state.clearTodoistSyncToken(db)
    for (const calendarId of this.ctx.routing.calendarIds) {
      state.clearGoogleSyncToken(db, calendarId)
    }

    await this.reconcile()
    logger.info('full resync finished')
  }

  /**
   * Rebuild link rows for managed events that have lost theirs.
   *
   * Every event this app creates carries its `todoistId`, so the pairing is
   * recoverable from Google alone — the database is a cache. Only missing links
   * are created; existing ones are left alone, which is what keeps repeated
   * resyncs write-free.
   */
  private async adoptOrphanedEvents(): Promise<void> {
    const { db, google, routing } = this.ctx
    let adopted = 0

    for (const calendarId of routing.calendarIds) {
      const projectId = routing.projectForCalendar(calendarId)
      if (projectId === undefined) continue

      for (const event of await google.listManagedEvents(calendarId)) {
        const todoistId = todoistIdOf(event)
        if (todoistId === undefined || event.id == null) continue
        if (links.findByTodoistItemId(db, todoistId) !== undefined) continue

        this.ctx.persistLink({
          todoistItemId: todoistId,
          googleEventId: event.id,
          googleCalendarId: calendarId,
          todoistProjectId: projectId,
          // Blank so the task is re-pushed once, bringing the event back in
          // line with whatever changed while the link was missing. The real
          // fingerprint is stored on that push, so later resyncs are quiet.
          todoistFingerprint: '',
          googleFingerprint: googleFingerprint(event, calendarId),
        })
        adopted++
      }
    }

    if (adopted > 0) {
      logger.info({ adopted }, 'adopted managed events with no link row')
    }
  }

  /** Fire-and-forget variant, for the admin endpoint. */
  triggerResyncAll(reason: string): void {
    logger.info({ reason }, 'full resync triggered')
    void this.resyncAll().catch((error: unknown) => {
      logger.error({ reason, err: error }, 'full resync failed')
    })
  }

  /**
   * Fold the response into the local cache and return every task that needs
   * re-rendering.
   *
   * Comments are the reason this is not just `response.items`: a comment is a
   * separate resource, so editing one reports the note alone and leaves its
   * task untouched. Its `item_id` is the only link back to the event that has
   * to change.
   */
  private absorb(response: {
    items: TodoistItem[]
    notes: TodoistNote[]
  }): TodoistItem[] {
    const { db } = this.ctx
    const affected = new Map<string, TodoistItem>()

    for (const item of response.items) {
      if (item.is_deleted) {
        removeItem(db, item.id)
        removeNotesForItem(db, item.id)
      } else {
        putItem(db, item)
      }
      affected.set(item.id, item)
    }

    for (const note of response.notes) {
      if (note.is_deleted) removeNote(db, note.id)
      else putNote(db, note)

      const itemId = note.item_id
      if (itemId == null || affected.has(itemId)) continue

      // The task itself did not change, so pull it from the cache to re-render.
      const cached = getItem(db, itemId)
      if (cached !== undefined) affected.set(itemId, cached)
    }

    return [...affected.values()]
  }

  private async pullTodoist(): Promise<void> {
    const { db, todoist } = this.ctx
    const response = await todoist.sync(state.getTodoistSyncToken(db))

    // Cache first: applying a change reads the notes back out of the database.
    const changed = this.ctx.dryRun ? response.items : this.absorb(response)

    if (changed.length > 0) {
      logger.debug(
        {
          items: response.items.length,
          notes: response.notes.length,
          affected: changed.length,
          fullSync: response.full_sync,
        },
        'todoist changes received',
      )
    }

    let failures = 0
    for (const item of changed) {
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

  /**
   * Refuse a pass that would complete an implausible number of tasks.
   *
   * Deleting an event is read as "task done", so clearing a calendar in the
   * Google UI would complete every corresponding task. That is the only way
   * this app can do widespread damage — it cannot delete a Todoist task at all
   * — so it is worth a guard.
   *
   * Counted before anything is applied, and the sync token is left untouched:
   * the changes are neither applied nor lost. Once you raise the limit or fix
   * the calendar, the same pass runs again and goes through. Failing closed and
   * stalling one calendar beats silently completing two hundred tasks.
   */
  private async tripsCircuitBreaker(
    calendarId: string,
    events: GoogleEvent[],
  ): Promise<boolean> {
    const limit = this.ctx.maxCompletionsPerSync
    if (limit === 0) return false

    const clear = (): boolean => {
      if (this.blocked.delete(calendarId)) {
        logger.info({ calendarId }, 'calendar no longer blocked')
      }
      return false
    }

    // Cheap pass first, so an ordinary reconcile costs no extra API calls.
    const candidates = events.filter((event) =>
      wouldCompleteTask(this.ctx, calendarId, event),
    )
    if (candidates.length <= limit) return clear()

    // Suspicion raised. Now pay for the probes: a bulk cross-calendar move
    // looks identical to a bulk deletion until each event is looked for
    // elsewhere, and refusing a legitimate reorganisation would be its own bug.
    let completions = 0
    for (const event of candidates) {
      if (await isGenuineDeletion(this.ctx, calendarId, event)) completions++
    }

    if (completions <= limit) return clear()

    this.blocked.add(calendarId)
    logger.error(
      { calendarId, completions, limit },
      'refusing to apply this pass: it would complete far more tasks than ' +
        'expected, which usually means events were deleted en masse. Nothing ' +
        'has been changed and no cursor advanced. Check the calendar, then ' +
        'either restore it or raise MAX_COMPLETIONS_PER_SYNC to let it through.',
    )
    return true
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

    if (await this.tripsCircuitBreaker(calendarId, result.events)) return

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
