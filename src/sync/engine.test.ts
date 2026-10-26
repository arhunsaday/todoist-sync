import { beforeEach, describe, expect, it } from 'vitest'

import { createTestDb, type Db } from '../db/index.js'
import * as links from '../db/links.js'
import { todoistIdOf } from '../google/client.js'
import type { TodoistItem } from '../todoist/types.js'
import { SyncEngine } from './engine.js'
import { FakeGoogle, FakeTodoist } from './fakes.js'
import { Routing } from './routing.js'

const WORK = 'work@group.calendar.google.com'
const HOME = 'home@group.calendar.google.com'

const routing = new Routing([
  { todoistProjectId: 'proj-1', googleCalendarId: WORK },
  { todoistProjectId: 'proj-2', googleCalendarId: HOME },
])

let db: Db
let todoist: FakeTodoist
let google: FakeGoogle
let engine: SyncEngine

beforeEach(() => {
  db = createTestDb()
  todoist = new FakeTodoist()
  google = new FakeGoogle([WORK, HOME])
  engine = new SyncEngine({
    db,
    todoist: todoist.asClient(),
    google: google.asClient(),
    routing,
  })
})

function task(overrides: Partial<TodoistItem> = {}): TodoistItem {
  return {
    id: 'item-1',
    project_id: 'proj-1',
    content: 'Write the sync engine',
    description: '',
    due: { date: '2026-08-09', is_recurring: false },
    duration: null,
    priority: 1,
    labels: [],
    checked: false,
    is_deleted: false,
    ...overrides,
  }
}

function writeCount(): number {
  return todoist.writes.length + google.writes.length
}

describe('Todoist → Google', () => {
  it('creates an event on the calendar mapped to the task project', async () => {
    todoist.seed(task())
    await engine.reconcile()

    const events = google.eventsOn(WORK)
    expect(events).toHaveLength(1)
    expect(events[0]?.summary).toBe('Write the sync engine')
    expect(todoistIdOf(events[0]!)).toBe('item-1')
    expect(google.eventsOn(HOME)).toHaveLength(0)
  })

  it('records the pairing', async () => {
    todoist.seed(task())
    await engine.reconcile()

    const link = links.findByTodoistItemId(db, 'item-1')
    expect(link?.googleCalendarId).toBe(WORK)
  })

  it('ignores tasks in unmapped projects', async () => {
    todoist.seed(task({ project_id: 'proj-unmapped' }))
    await engine.reconcile()

    expect(google.eventsOn(WORK)).toHaveLength(0)
    expect(links.listAll(db)).toHaveLength(0)
  })

  it('creates no event for an undated task', async () => {
    todoist.seed(task({ due: null }))
    await engine.reconcile()

    expect(google.eventsOn(WORK)).toHaveLength(0)
  })

  it('propagates a content edit', async () => {
    todoist.seed(task())
    await engine.reconcile()

    todoist.edit('item-1', { content: 'Renamed' })
    await engine.reconcile()

    expect(google.eventsOn(WORK)[0]?.summary).toBe('Renamed')
    expect(google.eventsOn(WORK)).toHaveLength(1)
  })

  it('deletes the event when the task is completed', async () => {
    todoist.seed(task())
    await engine.reconcile()

    todoist.edit('item-1', { checked: true })
    await engine.reconcile()

    expect(google.eventsOn(WORK)).toHaveLength(0)
    expect(links.findByTodoistItemId(db, 'item-1')).toBeUndefined()
  })

  it('deletes the event when the due date is cleared', async () => {
    todoist.seed(task())
    await engine.reconcile()

    todoist.edit('item-1', { due: null })
    await engine.reconcile()

    expect(google.eventsOn(WORK)).toHaveLength(0)
  })

  it('moves the event when the task changes project', async () => {
    todoist.seed(task())
    await engine.reconcile()

    todoist.edit('item-1', { project_id: 'proj-2' })
    await engine.reconcile()

    expect(google.eventsOn(WORK)).toHaveLength(0)
    expect(google.eventsOn(HOME)).toHaveLength(1)
    expect(links.findByTodoistItemId(db, 'item-1')?.googleCalendarId).toBe(HOME)
  })

  it('deletes the event when the task moves out of every mapped project', async () => {
    todoist.seed(task())
    await engine.reconcile()

    todoist.edit('item-1', { project_id: 'proj-unmapped' })
    await engine.reconcile()

    expect(google.eventsOn(WORK)).toHaveLength(0)
    expect(links.findByTodoistItemId(db, 'item-1')).toBeUndefined()
  })

  it('recreates an event that disappeared behind our back', async () => {
    todoist.seed(task())
    await engine.reconcile()
    const originalId = google.eventsOn(WORK)[0]?.id

    google.userDelete(WORK, originalId!)
    todoist.edit('item-1', { content: 'Still needed' })
    await engine.reconcile()

    const events = google.eventsOn(WORK)
    expect(events).toHaveLength(1)
    expect(events[0]?.summary).toBe('Still needed')
  })
})

describe('Google → Todoist', () => {
  it('creates a task for an event added straight to a mapped calendar', async () => {
    google.seed(WORK, {
      summary: 'Dentist',
      start: { dateTime: '2026-08-09T09:00:00Z' },
      end: { dateTime: '2026-08-09T10:00:00Z' },
    })
    await engine.reconcile()

    const created = [...todoist.items.values()]
    expect(created).toHaveLength(1)
    expect(created[0]?.content).toBe('Dentist')
    expect(created[0]?.project_id).toBe('proj-1')
  })

  it('tags the foreign event so it is recognised afterwards', async () => {
    const eventId = google.seed(WORK, {
      summary: 'Dentist',
      start: { date: '2026-08-09' },
      end: { date: '2026-08-10' },
    })
    await engine.reconcile()

    const event = google.eventsOn(WORK).find((e) => e.id === eventId)
    expect(todoistIdOf(event!)).toBeDefined()
    expect(links.findByGoogleEventId(db, WORK, eventId)).toBeDefined()
  })

  it('skips recurring foreign events', async () => {
    google.seed(WORK, {
      summary: 'Daily standup',
      recurrence: ['RRULE:FREQ=DAILY'],
      start: { dateTime: '2026-08-09T09:00:00Z' },
      end: { dateTime: '2026-08-09T09:15:00Z' },
    })
    await engine.reconcile()

    expect(todoist.items.size).toBe(0)
  })

  it('skips birthdays and other generated events', async () => {
    google.seed(WORK, {
      summary: "Someone's birthday",
      eventType: 'birthday',
      start: { date: '2026-08-09' },
      end: { date: '2026-08-10' },
    })
    await engine.reconcile()

    expect(todoist.items.size).toBe(0)
  })

  it('skips invitations this user declined', async () => {
    google.seed(WORK, {
      summary: 'Optional sync',
      attendees: [{ self: true, responseStatus: 'declined' }],
      start: { dateTime: '2026-08-09T09:00:00Z' },
      end: { dateTime: '2026-08-09T10:00:00Z' },
    })
    await engine.reconcile()

    expect(todoist.items.size).toBe(0)
  })

  it('reschedules the task when the event is dragged to a new time', async () => {
    todoist.seed(
      task({ due: { date: '2026-08-09T09:00:00.000000Z', is_recurring: false } }),
    )
    await engine.reconcile()
    const eventId = google.eventsOn(WORK)[0]?.id

    google.userEdit(WORK, eventId!, {
      start: { dateTime: '2026-08-09T14:00:00Z' },
      end: { dateTime: '2026-08-09T15:00:00Z' },
    })
    await engine.reconcile()

    expect(todoist.items.get('item-1')?.due?.date).toBe('2026-08-09T14:00:00.000Z')
  })

  it('renames the task when the event is renamed', async () => {
    todoist.seed(task())
    await engine.reconcile()
    const eventId = google.eventsOn(WORK)[0]?.id

    google.userEdit(WORK, eventId!, { summary: 'Renamed in Google' })
    await engine.reconcile()

    expect(todoist.items.get('item-1')?.content).toBe('Renamed in Google')
  })

  it('completes the task when the event is deleted', async () => {
    todoist.seed(task())
    await engine.reconcile()
    const eventId = google.eventsOn(WORK)[0]?.id

    google.userDelete(WORK, eventId!)
    await engine.reconcile()

    expect(todoist.items.get('item-1')?.checked).toBe(true)
    expect(links.findByTodoistItemId(db, 'item-1')).toBeUndefined()
  })

  // Google reports a cross-calendar move as a cancellation on the source
  // calendar. Reading that as a deletion would complete a task the user only
  // dragged to another calendar.
  it('moves the task, and does NOT complete it, when the event is dragged to another calendar', async () => {
    todoist.seed(task())
    await engine.reconcile()
    const eventId = google.eventsOn(WORK)[0]?.id

    google.userMove(WORK, eventId!, HOME)
    await engine.reconcile()

    expect(todoist.items.get('item-1')?.checked).toBe(false)
    expect(todoist.items.get('item-1')?.project_id).toBe('proj-2')
    expect(links.findByTodoistItemId(db, 'item-1')?.googleCalendarId).toBe(HOME)
    expect(google.eventsOn(HOME)).toHaveLength(1)
  })
})

describe('loop prevention', () => {
  it('performs no writes on a reconcile with nothing to do', async () => {
    await engine.reconcile()
    expect(writeCount()).toBe(0)
  })

  it('settles after mirroring a new task', async () => {
    todoist.seed(task())
    await engine.reconcile()

    const afterFirst = writeCount()
    expect(afterFirst).toBeGreaterThan(0)

    await engine.reconcile()
    await engine.reconcile()

    expect(writeCount()).toBe(afterFirst)
  })

  it('settles after adopting a foreign calendar event', async () => {
    google.seed(WORK, {
      summary: 'Dentist',
      start: { dateTime: '2026-08-09T09:00:00Z' },
      end: { dateTime: '2026-08-09T10:00:00Z' },
    })
    await engine.reconcile()

    const afterFirst = writeCount()
    await engine.reconcile()
    await engine.reconcile()

    expect(writeCount()).toBe(afterFirst)
    expect(todoist.items.size).toBe(1)
    expect(google.eventsOn(WORK)).toHaveLength(1)
  })

  it('settles after a Google-side edit propagates back', async () => {
    todoist.seed(task())
    await engine.reconcile()
    const eventId = google.eventsOn(WORK)[0]?.id

    google.userEdit(WORK, eventId!, { summary: 'Renamed in Google' })
    await engine.reconcile()
    await engine.reconcile()

    const settled = writeCount()
    await engine.reconcile()
    expect(writeCount()).toBe(settled)
  })

  it('settles after a cross-calendar drag', async () => {
    todoist.seed(task())
    await engine.reconcile()
    const eventId = google.eventsOn(WORK)[0]?.id

    google.userMove(WORK, eventId!, HOME)
    await engine.reconcile()
    await engine.reconcile()

    const settled = writeCount()
    await engine.reconcile()
    expect(writeCount()).toBe(settled)
  })
})

describe('title decoration', () => {
  it('prepends the priority and label prefixes', async () => {
    todoist.seed(task({ priority: 4, labels: ['⚡5min'] }))
    await engine.reconcile()

    expect(google.eventsOn(WORK)[0]?.summary).toBe(
      '!p1 @5min Write the sync engine',
    )
  })

  it('leaves the Todoist content itself untouched', async () => {
    todoist.seed(task({ priority: 4, labels: ['⚡5min'] }))
    await engine.reconcile()

    expect(todoist.items.get('item-1')?.content).toBe('Write the sync engine')
  })

  it('re-decorates when the priority changes', async () => {
    todoist.seed(task({ priority: 4 }))
    await engine.reconcile()

    todoist.edit('item-1', { priority: 3 })
    await engine.reconcile()

    expect(google.eventsOn(WORK)[0]?.summary).toBe('!p2 Write the sync engine')
  })

  it('re-decorates when a label is added', async () => {
    todoist.seed(task())
    await engine.reconcile()

    todoist.edit('item-1', { labels: ['🔥urgent'] })
    await engine.reconcile()

    expect(google.eventsOn(WORK)[0]?.summary).toBe('@urg Write the sync engine')
  })

  // The whole point of the strip step. A calendar-side edit maps the decorated
  // summary back to the task, and without stripping the prefixes accumulate on
  // every subsequent edit.
  it('does NOT write prefixes back into the task when the event is edited', async () => {
    todoist.seed(task({ priority: 4, labels: ['⚡5min'] }))
    await engine.reconcile()
    const eventId = google.eventsOn(WORK)[0]?.id

    google.userEdit(WORK, eventId!, {
      start: { dateTime: '2026-08-09T14:00:00Z' },
      end: { dateTime: '2026-08-09T15:00:00Z' },
    })
    await engine.reconcile()

    expect(todoist.items.get('item-1')?.content).toBe('Write the sync engine')
  })

  it('never accumulates prefixes across many calendar-side edits', async () => {
    todoist.seed(task({ priority: 4, labels: ['⚡5min'] }))
    await engine.reconcile()
    const eventId = google.eventsOn(WORK)[0]?.id

    for (let hour = 10; hour < 16; hour++) {
      google.userEdit(WORK, eventId!, {
        start: { dateTime: `2026-08-09T${hour}:00:00Z` },
        end: { dateTime: `2026-08-09T${hour + 1}:00:00Z` },
      })
      await engine.reconcile()
    }

    expect(todoist.items.get('item-1')?.content).toBe('Write the sync engine')
    expect(google.eventsOn(WORK)[0]?.summary).toBe(
      '!p1 @5min Write the sync engine',
    )
  })

  it('takes a genuine rename, minus the prefixes the user left in place', async () => {
    todoist.seed(task({ priority: 4 }))
    await engine.reconcile()
    const eventId = google.eventsOn(WORK)[0]?.id

    google.userEdit(WORK, eventId!, { summary: '!p1 Renamed in Google' })
    await engine.reconcile()

    expect(todoist.items.get('item-1')?.content).toBe('Renamed in Google')
  })
})

describe('links in task titles', () => {
  const LINKED =
    'Prendre [rendez-vous chez le dentiste](https://www.doctolib.fr/search?around_me=true&keyword=dentiste)'

  it('shows the link text, not the URL', async () => {
    todoist.seed(task({ content: LINKED, priority: 4, labels: ['🔥urgent'] }))
    await engine.reconcile()

    expect(google.eventsOn(WORK)[0]?.summary).toBe(
      '!p1 @urg Prendre rendez-vous chez le dentiste',
    )
  })

  // The URL cannot be recovered from the rendered title, so writing it back
  // would silently delete the link from the task's name. This is the test that
  // matters most about rendering.
  it('does NOT strip the URL from the task when the event is edited', async () => {
    todoist.seed(task({ content: LINKED, priority: 4 }))
    await engine.reconcile()
    const eventId = google.eventsOn(WORK)[0]?.id

    google.userEdit(WORK, eventId!, {
      start: { dateTime: '2026-08-09T14:00:00Z' },
      end: { dateTime: '2026-08-09T15:00:00Z' },
    })
    await engine.reconcile()

    expect(todoist.items.get('item-1')?.content).toBe(LINKED)
    // The reschedule still landed.
    expect(todoist.items.get('item-1')?.due?.date).toBe('2026-08-09T14:00:00.000Z')
  })

  it('keeps the URL safe across many calendar-side edits', async () => {
    todoist.seed(task({ content: LINKED }))
    await engine.reconcile()
    const eventId = google.eventsOn(WORK)[0]?.id

    for (let hour = 10; hour < 15; hour++) {
      google.userEdit(WORK, eventId!, {
        start: { dateTime: `2026-08-09T${hour}:00:00Z` },
        end: { dateTime: `2026-08-09T${hour + 1}:00:00Z` },
      })
      await engine.reconcile()
    }

    expect(todoist.items.get('item-1')?.content).toBe(LINKED)
  })

  // Renaming is the user overwriting the title themselves, so the link is
  // theirs to lose — but the rename must still be applied.
  it('accepts a genuine rename, which does discard the link', async () => {
    todoist.seed(task({ content: LINKED }))
    await engine.reconcile()
    const eventId = google.eventsOn(WORK)[0]?.id

    google.userEdit(WORK, eventId!, { summary: 'Dentiste jeudi' })
    await engine.reconcile()

    expect(todoist.items.get('item-1')?.content).toBe('Dentiste jeudi')
  })
})

describe('comments', () => {
  it('appends comments to the event description', async () => {
    todoist.seed(task())
    await engine.reconcile()

    todoist.addComment('item-1', 'first thought')
    await engine.reconcile()

    expect(google.eventsOn(WORK)[0]?.description).toContain('first thought')
  })

  // A comment does not change its task, so this only works if the engine maps
  // the note back to its item id itself.
  it('updates the event even though the task itself did not change', async () => {
    todoist.seed(task())
    await engine.reconcile()
    const before = google.writes.length

    todoist.addComment('item-1', 'first thought')
    await engine.reconcile()

    expect(google.writes.length).toBeGreaterThan(before)
  })

  it('reflects a deleted comment', async () => {
    todoist.seed(task())
    const noteId = todoist.addComment('item-1', 'first thought')
    await engine.reconcile()

    todoist.deleteComment(noteId)
    await engine.reconcile()

    expect(google.eventsOn(WORK)[0]?.description).not.toContain('first thought')
  })

  it('does NOT write the comments block back into the task description', async () => {
    todoist.seed(task({ description: 'my own notes' }))
    todoist.addComment('item-1', 'a comment')
    await engine.reconcile()
    const eventId = google.eventsOn(WORK)[0]?.id

    google.userEdit(WORK, eventId!, {
      start: { dateTime: '2026-08-09T14:00:00Z' },
      end: { dateTime: '2026-08-09T15:00:00Z' },
    })
    await engine.reconcile()

    expect(todoist.items.get('item-1')?.description).toBe('my own notes')
  })

  it('settles after a comment propagates', async () => {
    todoist.seed(task())
    todoist.addComment('item-1', 'a comment')
    await engine.reconcile()
    await engine.reconcile()

    const settled = writeCount()
    await engine.reconcile()
    expect(writeCount()).toBe(settled)
  })
})

// The failure seen in production: Google deep-merges nested objects on patch,
// so a stale all-day `date` survived alongside the new `dateTime` and the
// request came back 400 "Invalid start time."
describe('switching between all-day and timed', () => {
  it('converts an all-day event to a timed one', async () => {
    todoist.seed(task({ due: { date: '2026-08-10', is_recurring: false } }))
    await engine.reconcile()
    expect(google.eventsOn(WORK)[0]?.start?.date).toBe('2026-08-10')

    todoist.edit('item-1', {
      due: { date: '2026-08-10T15:00:00', is_recurring: false },
    })
    await engine.reconcile()

    const event = google.eventsOn(WORK)[0]
    expect(event?.start?.dateTime).toBe('2026-08-10T15:00:00')
    expect(event?.start?.date).toBeUndefined()
  })

  it('converts a timed event back to all-day', async () => {
    todoist.seed(
      task({ due: { date: '2026-08-10T15:00:00', is_recurring: false } }),
    )
    await engine.reconcile()

    todoist.edit('item-1', { due: { date: '2026-08-10', is_recurring: false } })
    await engine.reconcile()

    const event = google.eventsOn(WORK)[0]
    expect(event?.start?.date).toBe('2026-08-10')
    expect(event?.start?.dateTime).toBeUndefined()
  })
})

describe('full resync', () => {
  // The reason this exists: incremental sync never revisits a task once the
  // cursor has moved past it, so a change that failed to apply is lost.
  it('picks up a task the incremental cursor has already moved past', async () => {
    // Establish a real cursor first, so the next pass is incremental rather
    // than the full sync a cold start performs.
    await engine.reconcile()

    // The task appears, but its change is consumed without being applied —
    // standing in for an apply that failed while the cursor advanced anyway.
    todoist.seed(task())
    await todoist.sync('incremental')

    await engine.reconcile()
    expect(google.eventsOn(WORK)).toHaveLength(0)

    await engine.resyncAll()

    expect(google.eventsOn(WORK)).toHaveLength(1)
  })

  it('creates nothing extra for tasks already mirrored', async () => {
    todoist.seed(task())
    await engine.reconcile()
    const after = writeCount()

    await engine.resyncAll()

    expect(google.eventsOn(WORK)).toHaveLength(1)
    expect(writeCount()).toBe(after)
  })

  it('is safe to repeat', async () => {
    todoist.seed(task())
    await engine.resyncAll()
    const after = writeCount()

    await engine.resyncAll()
    await engine.resyncAll()

    expect(writeCount()).toBe(after)
    expect(google.eventsOn(WORK)).toHaveLength(1)
  })

  // A wiped volume leaves the events in place but nothing pointing at them.
  // Without re-linking first, a resync would create a second event per task.
  it('adopts existing events instead of duplicating them after a wipe', async () => {
    todoist.seed(task())
    await engine.resyncAll()
    expect(google.eventsOn(WORK)).toHaveLength(1)

    links.removeAll(db)
    await engine.resyncAll()

    expect(google.eventsOn(WORK)).toHaveLength(1)
    expect(links.findByTodoistItemId(db, 'item-1')).toBeDefined()
  })

  it('resyncs every mapped calendar, not just the first', async () => {
    await engine.reconcile()

    todoist.seed(task())
    todoist.seed(task({ id: 'item-2', project_id: 'proj-2' }))
    await todoist.sync('incremental')

    await engine.resyncAll()

    expect(google.eventsOn(WORK)).toHaveLength(1)
    expect(google.eventsOn(HOME)).toHaveLength(1)
  })
})

// MAX_COMPLETIONS_PER_SYNC is 3 in the test environment.
describe('changing the mapping without a restart', () => {
  it('imports a newly mapped project on the next resync', async () => {
    todoist.seed(task({ id: 'item-3', project_id: 'proj-3' }))
    await engine.reconcile()
    expect(google.eventsOn(HOME)).toHaveLength(0)

    engine.setRouting(
      new Routing([
        { todoistProjectId: 'proj-1', googleCalendarId: WORK },
        { todoistProjectId: 'proj-3', googleCalendarId: HOME },
      ]),
    )
    await engine.resyncAll()

    expect(google.eventsOn(HOME)).toHaveLength(1)
  })

  // A pass that read Todoist under one mapping and Google under another would
  // read the difference as user edits.
  it('waits for the running pass to finish before switching', async () => {
    const running = engine.reconcile()

    engine.setRouting(
      new Routing([{ todoistProjectId: 'proj-3', googleCalendarId: HOME }]),
    )
    expect(engine.status.running).toBe(true)
    await running
    expect(engine.status.lastRunAt).toBeTypeOf('number')

    // In force from the next pass on. Tasks the old mapping already skipped
    // are left to the resync that a mapping change also starts.
    todoist.seed(task({ id: 'item-3', project_id: 'proj-3' }))
    todoist.seed(task({ id: 'item-1', project_id: 'proj-1' }))
    await engine.reconcile()

    expect(google.eventsOn(HOME)).toHaveLength(1)
    expect(google.eventsOn(WORK)).toHaveLength(0)
  })
})

describe('completion circuit breaker', () => {
  /** Same fakes and database, but with the guard effectively off. */
  function permissiveEngine(): SyncEngine {
    return new SyncEngine({
      db,
      todoist: todoist.asClient(),
      google: google.asClient(),
      routing,
      maxCompletionsPerSync: 0,
    })
  }

  async function seedMirroredTasks(count: number): Promise<string[]> {
    for (let i = 1; i <= count; i++) {
      todoist.seed(task({ id: `item-${i}`, content: `Task ${i}` }))
    }
    await engine.reconcile()
    return google.eventsOn(WORK).map((event) => event.id as string)
  }

  it('lets a normal number of deletions through', async () => {
    const ids = await seedMirroredTasks(3)
    for (const id of ids) google.userDelete(WORK, id)

    await engine.reconcile()

    expect([...todoist.items.values()].every((item) => item.checked)).toBe(true)
    expect(engine.blockedCalendars).toEqual([])
  })

  it('refuses a pass that would complete too many tasks', async () => {
    const ids = await seedMirroredTasks(5)
    for (const id of ids) google.userDelete(WORK, id)

    await engine.reconcile()

    // Nothing applied at all — not even a partial sweep.
    expect([...todoist.items.values()].some((item) => item.checked)).toBe(false)
    expect(engine.blockedCalendars).toEqual([WORK])
  })

  // Failing closed only works if the changes survive. The cursor must not have
  // advanced, so the same pass is offered again rather than lost.
  it('neither applies nor loses the changes', async () => {
    const ids = await seedMirroredTasks(5)
    for (const id of ids) google.userDelete(WORK, id)
    await engine.reconcile()
    await engine.reconcile()

    expect([...todoist.items.values()].some((item) => item.checked)).toBe(false)

    // Raising the limit lets the very same deletions through, which is only
    // possible because the cursor was never advanced.
    await permissiveEngine().reconcile()

    expect([...todoist.items.values()].every((item) => item.checked)).toBe(true)
  })

  it('reports nothing blocked once the pass is let through', async () => {
    const ids = await seedMirroredTasks(5)
    for (const id of ids) google.userDelete(WORK, id)
    await engine.reconcile()
    expect(engine.blockedCalendars).toEqual([WORK])

    const permissive = permissiveEngine()
    await permissive.reconcile()

    expect(permissive.blockedCalendars).toEqual([])
  })

  it('does not stall the other calendars', async () => {
    const ids = await seedMirroredTasks(5)
    for (const id of ids) google.userDelete(WORK, id)
    todoist.seed(task({ id: 'home-1', project_id: 'proj-2' }))

    await engine.reconcile()

    expect(engine.blockedCalendars).toEqual([WORK])
    expect(google.eventsOn(HOME)).toHaveLength(1)
  })

  // Cross-calendar moves arrive as cancellations too, but complete nothing —
  // counting them would trip the breaker on a legitimate bulk reorganisation.
  it('does not count cross-calendar moves', async () => {
    const ids = await seedMirroredTasks(5)
    for (const id of ids) google.userMove(WORK, id, HOME)

    await engine.reconcile()

    expect(engine.blockedCalendars).toEqual([])
    expect([...todoist.items.values()].some((item) => item.checked)).toBe(false)
  })
})

describe('concurrency', () => {
  it('coalesces overlapping reconciles instead of interleaving them', async () => {
    todoist.seed(task())

    await Promise.all([
      engine.reconcile(),
      engine.reconcile(),
      engine.reconcile(),
    ])

    // Three triggers, one event — not three.
    expect(google.eventsOn(WORK)).toHaveLength(1)
  })
})

describe('dry run', () => {
  it('performs no writes and persists no links', async () => {
    const dryEngine = new SyncEngine({
      db,
      todoist: todoist.asClient(),
      google: google.asClient(),
      routing,
      dryRun: true,
    })

    todoist.seed(task())
    await dryEngine.reconcile()

    expect(links.listAll(db)).toHaveLength(0)
  })
})
