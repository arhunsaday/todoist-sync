/**
 * In-memory stand-ins for the two APIs, used by the engine tests.
 *
 * They model the one behaviour that matters for correctness: a write is
 * reported back on the next incremental read, exactly as the real services do.
 * Without that, an echo-suppression test proves nothing.
 */
import type { GoogleCalendarClient, GoogleEvent } from '../google/client.js'
import type { TodoistClient } from '../todoist/client.js'
import type {
  CommandResponse,
  SyncResponse,
  TodoistCommand,
  TodoistItem,
  TodoistNote,
} from '../todoist/types.js'

export class FakeTodoist {
  readonly items = new Map<string, TodoistItem>()
  readonly notes = new Map<string, TodoistNote>()
  /** Every mutating call, for asserting that a quiet reconcile stays quiet. */
  readonly writes: TodoistCommand[] = []

  private pending = new Set<string>()
  private pendingNotes = new Set<string>()
  private seq = 0

  seed(item: TodoistItem): void {
    this.items.set(item.id, item)
    this.pending.add(item.id)
  }

  /** Simulate a user edit made in the Todoist UI. */
  edit(id: string, changes: Partial<TodoistItem>): void {
    const existing = this.items.get(id)
    if (existing === undefined) throw new Error(`no such item ${id}`)
    this.items.set(id, { ...existing, ...changes })
    this.pending.add(id)
  }

  /**
   * Post a comment. Crucially this does NOT mark the task as changed — that is
   * exactly how Todoist behaves, and the reason the engine has to map notes
   * back to their task itself.
   */
  addComment(itemId: string, content: string, postedAt = '2026-08-09T10:00:00Z'): string {
    const id = `note-${++this.seq}`
    this.notes.set(id, {
      id,
      item_id: itemId,
      content,
      posted_at: postedAt,
      is_deleted: false,
    })
    this.pendingNotes.add(id)
    return id
  }

  deleteComment(id: string): void {
    const existing = this.notes.get(id)
    if (existing === undefined) return
    this.notes.set(id, { ...existing, is_deleted: true })
    this.pendingNotes.add(id)
  }

  async sync(syncToken: string): Promise<SyncResponse> {
    const full = syncToken === '*'
    const ids = full ? [...this.items.keys()] : [...this.pending]
    const noteIds = full ? [...this.notes.keys()] : [...this.pendingNotes]
    this.pending = new Set()
    this.pendingNotes = new Set()

    return {
      sync_token: `todoist-${++this.seq}`,
      full_sync: full,
      items: ids
        .map((id) => this.items.get(id))
        .filter((item): item is TodoistItem => item !== undefined),
      projects: [],
      notes: noteIds
        .map((id) => this.notes.get(id))
        .filter((note): note is TodoistNote => note !== undefined),
    }
  }

  async executeCommands(commands: TodoistCommand[]): Promise<CommandResponse> {
    const tempIdMapping: Record<string, string> = {}

    for (const command of commands) {
      this.writes.push(command)
      const args = command.args as Record<string, never>

      switch (command.type) {
        case 'item_add': {
          const id = `item-${++this.seq}`
          this.items.set(id, {
            id,
            project_id: String(args['project_id']),
            content: String(args['content'] ?? ''),
            description: (args['description'] as string | undefined) ?? '',
            due: (args['due'] as TodoistItem['due']) ?? null,
            duration: (args['duration'] as TodoistItem['duration']) ?? null,
            priority: 1,
            labels: [],
            checked: false,
            is_deleted: false,
          })
          this.pending.add(id)
          if (command.temp_id !== undefined) tempIdMapping[command.temp_id] = id
          break
        }
        case 'item_update': {
          const id = String(args['id'])
          const existing = this.items.get(id)
          if (existing === undefined) break
          const { id: _ignored, ...rest } = args
          this.items.set(id, { ...existing, ...rest })
          this.pending.add(id)
          break
        }
        case 'item_move': {
          const id = String(args['id'])
          const existing = this.items.get(id)
          if (existing === undefined) break
          this.items.set(id, { ...existing, project_id: String(args['project_id']) })
          this.pending.add(id)
          break
        }
        case 'item_complete': {
          const id = String(args['id'])
          const existing = this.items.get(id)
          if (existing === undefined) break
          this.items.set(id, { ...existing, checked: true })
          this.pending.add(id)
          break
        }
        default:
          throw new Error(`unhandled command ${command.type}`)
      }
    }

    return { temp_id_mapping: tempIdMapping, sync_status: {} }
  }

  asClient(): TodoistClient {
    return this as unknown as TodoistClient
  }
}

interface WriteRecord {
  op: 'insert' | 'patch' | 'move' | 'delete'
  calendarId: string
  eventId?: string
}

/**
 * Merge a start/end slot the way Google's patch does: nested objects are
 * deep-merged, and an explicit `null` is what clears a field. Omitting a key
 * leaves the previous value in place.
 */
function mergeSlot(
  existing: GoogleEvent['start'],
  incoming: GoogleEvent['start'],
): GoogleEvent['start'] {
  if (incoming === undefined) return existing

  const merged = { ...existing, ...incoming } as Record<string, unknown>
  for (const [key, value] of Object.entries(merged)) {
    if (value === null) delete merged[key]
  }
  return merged as GoogleEvent['start']
}

export class FakeGoogle {
  readonly writes: WriteRecord[] = []

  private readonly calendars = new Map<string, Map<string, GoogleEvent>>()
  /**
   * Append-only change log per calendar, plus where each issued token points
   * into it.
   *
   * Modelled this way because a sync token is a server-side cursor: if the
   * client never persists the token it was given, the next request with the old
   * one returns the same changes again. A fake that simply drained a pending
   * list would lose them instead — hiding exactly the behaviour that makes
   * refusing a pass safe.
   */
  private readonly log = new Map<string, GoogleEvent[]>()
  private readonly tokenPosition = new Map<string, number>()
  private seq = 0

  constructor(calendarIds: string[]) {
    for (const id of calendarIds) {
      this.calendars.set(id, new Map())
      this.log.set(id, [])
    }
  }

  private store(calendarId: string): Map<string, GoogleEvent> {
    const store = this.calendars.get(calendarId)
    if (store === undefined) throw new Error(`no such calendar ${calendarId}`)
    return store
  }

  private touch(calendarId: string, event: GoogleEvent): void {
    this.log.get(calendarId)?.push(event)
  }

  /** Simulate an event created or edited directly in Google Calendar. */
  seed(calendarId: string, event: Omit<GoogleEvent, 'id'> & { id?: string }): string {
    const id = event.id ?? `evt-${++this.seq}`
    const saved: GoogleEvent = { status: 'confirmed', ...event, id }
    this.store(calendarId).set(id, saved)
    this.touch(calendarId, saved)
    return id
  }

  eventsOn(calendarId: string): GoogleEvent[] {
    return [...this.store(calendarId).values()].filter(
      (event) => event.status !== 'cancelled',
    )
  }

  async getTimeZone(): Promise<string> {
    return 'Europe/Paris'
  }

  /** Events this app owns, found by the constant `managedBy` marker. */
  async listManagedEvents(calendarId: string): Promise<GoogleEvent[]> {
    return this.eventsOn(calendarId).filter(
      (event) => event.extendedProperties?.private?.['managedBy'] === 't2gc',
    )
  }

  async listChanges(
    calendarId: string,
    syncToken: string | undefined,
  ): Promise<{ events: GoogleEvent[]; nextSyncToken: string }> {
    const log = this.log.get(calendarId) ?? []

    // No token means a full list: current state, not the change log.
    const events =
      syncToken === undefined
        ? [...this.store(calendarId).values()]
        : log.slice(this.tokenPosition.get(syncToken) ?? 0)

    const nextSyncToken = `google-${++this.seq}`
    this.tokenPosition.set(nextSyncToken, log.length)

    return { events, nextSyncToken }
  }

  async get(calendarId: string, eventId: string): Promise<GoogleEvent | undefined> {
    const found = this.store(calendarId).get(eventId)
    return found === undefined || found.status === 'cancelled' ? undefined : found
  }

  async insert(calendarId: string, event: GoogleEvent): Promise<GoogleEvent> {
    const id = `evt-${++this.seq}`
    const saved: GoogleEvent = { status: 'confirmed', ...event, id }
    this.store(calendarId).set(id, saved)
    this.touch(calendarId, saved)
    this.writes.push({ op: 'insert', calendarId, eventId: id })
    return saved
  }

  async patch(
    calendarId: string,
    eventId: string,
    event: GoogleEvent,
  ): Promise<GoogleEvent> {
    const existing = this.store(calendarId).get(eventId)
    // Google 404s on a patch to a deleted event rather than resurrecting it.
    if (existing === undefined || existing.status === 'cancelled') {
      const error = new Error('Not Found') as Error & { code: number }
      error.code = 404
      throw error
    }

    // Google's patch is a merge, and extendedProperties.private merges too.
    const saved: GoogleEvent = {
      ...existing,
      ...event,
      start: mergeSlot(existing.start, event.start),
      end: mergeSlot(existing.end, event.end),
      extendedProperties: {
        private: {
          ...existing.extendedProperties?.private,
          ...event.extendedProperties?.private,
        },
      },
    }

    // Google rejects a slot carrying both a date and a dateTime with
    // "Invalid start time." Reproducing that here is the point: without it a
    // stale all-day `date` surviving a patch to a timed event looks fine
    // locally and 400s in production.
    for (const slot of [saved.start, saved.end]) {
      if (slot?.date != null && slot.dateTime != null) {
        const error = new Error('Invalid start time.') as Error & { code: number }
        error.code = 400
        throw error
      }
    }
    this.store(calendarId).set(eventId, saved)
    this.touch(calendarId, saved)
    this.writes.push({ op: 'patch', calendarId, eventId })
    return saved
  }

  /**
   * Google keeps the event id and reports a cancellation on the source
   * calendar — the behaviour that makes a move indistinguishable from a
   * deletion without probing.
   */
  async move(
    fromCalendarId: string,
    eventId: string,
    toCalendarId: string,
  ): Promise<GoogleEvent> {
    const existing = this.store(fromCalendarId).get(eventId)
    if (existing === undefined) throw new Error(`no such event ${eventId}`)

    this.store(fromCalendarId).set(eventId, { ...existing, status: 'cancelled' })
    this.touch(fromCalendarId, { ...existing, status: 'cancelled' })

    this.store(toCalendarId).set(eventId, existing)
    this.touch(toCalendarId, existing)

    this.writes.push({ op: 'move', calendarId: toCalendarId, eventId })
    return existing
  }

  async delete(calendarId: string, eventId: string): Promise<void> {
    const existing = this.store(calendarId).get(eventId)
    if (existing === undefined) return

    const cancelled: GoogleEvent = { ...existing, status: 'cancelled' }
    this.store(calendarId).set(eventId, cancelled)
    this.touch(calendarId, cancelled)
    this.writes.push({ op: 'delete', calendarId, eventId })
  }

  /** Drag an event to another calendar in the Google Calendar UI. */
  userMove(fromCalendarId: string, eventId: string, toCalendarId: string): void {
    const existing = this.store(fromCalendarId).get(eventId)
    if (existing === undefined) throw new Error(`no such event ${eventId}`)

    this.store(fromCalendarId).set(eventId, { ...existing, status: 'cancelled' })
    this.touch(fromCalendarId, { ...existing, status: 'cancelled' })
    this.store(toCalendarId).set(eventId, existing)
    this.touch(toCalendarId, existing)
  }

  /** Delete an event in the Google Calendar UI. */
  userDelete(calendarId: string, eventId: string): void {
    const existing = this.store(calendarId).get(eventId)
    if (existing === undefined) return
    const cancelled: GoogleEvent = { ...existing, status: 'cancelled' }
    this.store(calendarId).set(eventId, cancelled)
    this.touch(calendarId, cancelled)
  }

  /** Edit an event in the Google Calendar UI. */
  userEdit(calendarId: string, eventId: string, changes: GoogleEvent): void {
    const existing = this.store(calendarId).get(eventId)
    if (existing === undefined) throw new Error(`no such event ${eventId}`)
    const saved = { ...existing, ...changes }
    this.store(calendarId).set(eventId, saved)
    this.touch(calendarId, saved)
  }

  asClient(): GoogleCalendarClient {
    return this as unknown as GoogleCalendarClient
  }
}
