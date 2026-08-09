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
} from '../todoist/types.js'

export class FakeTodoist {
  readonly items = new Map<string, TodoistItem>()
  /** Every mutating call, for asserting that a quiet reconcile stays quiet. */
  readonly writes: TodoistCommand[] = []

  private pending = new Set<string>()
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

  async sync(syncToken: string): Promise<SyncResponse> {
    const ids = syncToken === '*' ? [...this.items.keys()] : [...this.pending]
    this.pending = new Set()

    return {
      sync_token: `todoist-${++this.seq}`,
      full_sync: syncToken === '*',
      items: ids
        .map((id) => this.items.get(id))
        .filter((item): item is TodoistItem => item !== undefined),
      projects: [],
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

export class FakeGoogle {
  readonly writes: WriteRecord[] = []

  private readonly calendars = new Map<string, Map<string, GoogleEvent>>()
  private readonly pending = new Map<string, GoogleEvent[]>()
  private seq = 0

  constructor(calendarIds: string[]) {
    for (const id of calendarIds) {
      this.calendars.set(id, new Map())
      this.pending.set(id, [])
    }
  }

  private store(calendarId: string): Map<string, GoogleEvent> {
    const store = this.calendars.get(calendarId)
    if (store === undefined) throw new Error(`no such calendar ${calendarId}`)
    return store
  }

  private touch(calendarId: string, event: GoogleEvent): void {
    this.pending.get(calendarId)?.push(event)
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

  async listChanges(
    calendarId: string,
    syncToken: string | undefined,
  ): Promise<{ events: GoogleEvent[]; nextSyncToken: string }> {
    const events =
      syncToken === undefined
        ? [...this.store(calendarId).values()]
        : (this.pending.get(calendarId) ?? [])
    this.pending.set(calendarId, [])

    return { events, nextSyncToken: `google-${++this.seq}` }
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
      extendedProperties: {
        private: {
          ...existing.extendedProperties?.private,
          ...event.extendedProperties?.private,
        },
      },
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
