import { describe, expect, it } from 'vitest'

import type { GoogleEvent } from '../google/client.js'
import type { TodoistItem } from '../todoist/types.js'
import {
  isCancelled,
  isDeclinedByOrganizer,
  isRecurring,
  isSyntheticEventType,
  toGoogleEvent,
  toTodoistFields,
  type MappingOptions,
} from './mapping.js'

const options: MappingOptions = {
  defaultDurationMinutes: 60,
  fallbackTimeZone: 'Europe/Paris',
}

function item(overrides: Partial<TodoistItem> = {}): TodoistItem {
  return {
    id: 'item-1',
    project_id: 'proj-1',
    content: 'Write the sync engine',
    description: '',
    due: null,
    duration: null,
    checked: false,
    is_deleted: false,
    ...overrides,
  }
}

describe('toGoogleEvent', () => {
  it('returns null for an undated task', () => {
    expect(toGoogleEvent(item(), options)).toBeNull()
  })

  it('maps a date-only due to an all-day event with an exclusive end', () => {
    const event = toGoogleEvent(
      item({ due: { date: '2026-08-09', is_recurring: false } }),
      options,
    )

    expect(event?.start).toEqual({ date: '2026-08-09' })
    expect(event?.end).toEqual({ date: '2026-08-10' })
  })

  it('spans a multi-day duration across the right number of days', () => {
    const event = toGoogleEvent(
      item({
        due: { date: '2026-08-09', is_recurring: false },
        duration: { amount: 3, unit: 'day' },
      }),
      options,
    )

    expect(event?.start).toEqual({ date: '2026-08-09' })
    expect(event?.end).toEqual({ date: '2026-08-12' })
  })

  it('crosses a month boundary correctly', () => {
    const event = toGoogleEvent(
      item({ due: { date: '2026-08-31', is_recurring: false } }),
      options,
    )

    expect(event?.end).toEqual({ date: '2026-09-01' })
  })

  it('applies the default duration to a timed task with none of its own', () => {
    const event = toGoogleEvent(
      item({
        due: { date: '2026-08-09T13:00:00.000000Z', timezone: 'Europe/Paris', is_recurring: false },
      }),
      options,
    )

    expect(event?.start).toEqual({
      dateTime: '2026-08-09T13:00:00.000Z',
      timeZone: 'Europe/Paris',
    })
    expect(event?.end).toEqual({
      dateTime: '2026-08-09T14:00:00.000Z',
      timeZone: 'Europe/Paris',
    })
  })

  it('honours an explicit minute duration', () => {
    const event = toGoogleEvent(
      item({
        due: { date: '2026-08-09T13:00:00.000000Z', timezone: 'UTC', is_recurring: false },
        duration: { amount: 25, unit: 'minute' },
      }),
      options,
    )

    expect(event?.end).toEqual({
      dateTime: '2026-08-09T13:25:00.000Z',
      timeZone: 'UTC',
    })
  })

  // A floating time means a wall-clock time, so arithmetic must move the clock
  // and the result must not be pinned to an instant.
  it('keeps a floating time floating and attaches the fallback timezone', () => {
    const event = toGoogleEvent(
      item({ due: { date: '2026-08-09T13:00:00', is_recurring: false } }),
      options,
    )

    expect(event?.start).toEqual({
      dateTime: '2026-08-09T13:00:00',
      timeZone: 'Europe/Paris',
    })
    expect(event?.end).toEqual({
      dateTime: '2026-08-09T14:00:00',
      timeZone: 'Europe/Paris',
    })
  })

  it('rolls a floating time over midnight without shifting the date twice', () => {
    const event = toGoogleEvent(
      item({
        due: { date: '2026-08-09T23:30:00', is_recurring: false },
        duration: { amount: 60, unit: 'minute' },
      }),
      options,
    )

    expect(event?.end).toEqual({
      dateTime: '2026-08-10T00:30:00',
      timeZone: 'Europe/Paris',
    })
  })

  it('tags the event so it can be recognised and recovered later', () => {
    const event = toGoogleEvent(
      item({ due: { date: '2026-08-09', is_recurring: false } }),
      options,
    )

    expect(event?.extendedProperties.private).toEqual({
      todoistId: 'item-1',
      managedBy: 't2gc',
    })
    expect(event?.source.url).toBe('https://app.todoist.com/app/task/item-1')
  })

  it('substitutes a placeholder for blank content', () => {
    const event = toGoogleEvent(
      item({ content: '   ', due: { date: '2026-08-09', is_recurring: false } }),
      options,
    )

    expect(event?.summary).toBe('(untitled)')
  })

  // Recurring tasks mirror only their current occurrence, so the event must
  // stay a plain single event with no RRULE.
  it('emits no recurrence for a recurring task', () => {
    const event = toGoogleEvent(
      item({ due: { date: '2026-08-09', is_recurring: true, string: 'every day' } }),
      options,
    )

    expect(event).not.toHaveProperty('recurrence')
  })
})

describe('toTodoistFields', () => {
  it('maps a one-day all-day event to a bare due date', () => {
    const fields = toTodoistFields({
      summary: 'Standup notes',
      start: { date: '2026-08-09' },
      end: { date: '2026-08-10' },
    })

    expect(fields).toEqual({
      content: 'Standup notes',
      description: '',
      due: { date: '2026-08-09' },
      duration: null,
    })
  })

  it('maps a multi-day all-day event to a day duration', () => {
    const fields = toTodoistFields({
      summary: 'Conference',
      start: { date: '2026-08-09' },
      end: { date: '2026-08-12' },
    })

    expect(fields.due).toEqual({ date: '2026-08-09' })
    expect(fields.duration).toEqual({ amount: 3, unit: 'day' })
  })

  it('maps a timed event to an instant plus a minute duration', () => {
    const fields = toTodoistFields({
      summary: '1:1',
      start: { dateTime: '2026-08-09T13:00:00+02:00', timeZone: 'Europe/Paris' },
      end: { dateTime: '2026-08-09T13:30:00+02:00', timeZone: 'Europe/Paris' },
    })

    expect(fields.due).toEqual({
      date: '2026-08-09T11:00:00.000Z',
      timezone: 'Europe/Paris',
    })
    expect(fields.duration).toEqual({ amount: 30, unit: 'minute' })
  })

  it('drops a zero-length duration rather than sending an invalid one', () => {
    const fields = toTodoistFields({
      summary: 'Instant',
      start: { dateTime: '2026-08-09T13:00:00Z' },
      end: { dateTime: '2026-08-09T13:00:00Z' },
    })

    expect(fields.duration).toBeNull()
  })

  it('substitutes a placeholder for an event with no title', () => {
    const fields = toTodoistFields({ start: { date: '2026-08-09' }, end: { date: '2026-08-10' } })

    expect(fields.content).toBe('(untitled)')
  })

  it('throws on an event with no start at all', () => {
    expect(() => toTodoistFields({ id: 'evt-1', summary: 'Broken' })).toThrow(
      /has no start/,
    )
  })
})

describe('round trip', () => {
  // A task mirrored out and read back must describe the same thing, or every
  // reconcile would rewrite it.
  it('preserves an all-day task through Todoist → Google → Todoist', () => {
    const source = item({
      content: 'Ship it',
      due: { date: '2026-08-09', is_recurring: false },
    })
    const event = toGoogleEvent(source, options)
    const back = toTodoistFields(event as GoogleEvent)

    expect(back.content).toBe('Ship it')
    expect(back.due).toEqual({ date: '2026-08-09' })
    expect(back.duration).toBeNull()
  })

  it('preserves a fixed-time task through Todoist → Google → Todoist', () => {
    const source = item({
      content: 'Review PR',
      due: {
        date: '2026-08-09T13:00:00.000000Z',
        timezone: 'Europe/Paris',
        is_recurring: false,
      },
      duration: { amount: 45, unit: 'minute' },
    })
    const event = toGoogleEvent(source, options)
    const back = toTodoistFields(event as GoogleEvent)

    expect(back.due?.date).toBe('2026-08-09T13:00:00.000Z')
    expect(back.due?.timezone).toBe('Europe/Paris')
    expect(back.duration).toEqual({ amount: 45, unit: 'minute' })
  })
})

describe('classification', () => {
  const base: GoogleEvent = { id: 'evt-1', summary: 'x' }

  it('detects cancellation', () => {
    expect(isCancelled({ ...base, status: 'cancelled' })).toBe(true)
    expect(isCancelled({ ...base, status: 'confirmed' })).toBe(false)
    expect(isCancelled(base)).toBe(false)
  })

  it('detects both recurring masters and their exceptions', () => {
    expect(isRecurring({ ...base, recurrence: ['RRULE:FREQ=WEEKLY'] })).toBe(true)
    expect(isRecurring({ ...base, recurringEventId: 'master-1' })).toBe(true)
    expect(isRecurring({ ...base, recurrence: [] })).toBe(false)
    expect(isRecurring(base)).toBe(false)
  })

  it('detects Google-generated event types that are not tasks', () => {
    expect(isSyntheticEventType({ ...base, eventType: 'birthday' })).toBe(true)
    expect(isSyntheticEventType({ ...base, eventType: 'workingLocation' })).toBe(true)
    expect(isSyntheticEventType({ ...base, eventType: 'default' })).toBe(false)
    expect(isSyntheticEventType(base)).toBe(false)
  })

  it('detects a declined invitation for this user only', () => {
    expect(
      isDeclinedByOrganizer({
        ...base,
        attendees: [{ self: true, responseStatus: 'declined' }],
      }),
    ).toBe(true)

    // Someone else declining is not a reason to skip the event.
    expect(
      isDeclinedByOrganizer({
        ...base,
        attendees: [{ self: false, responseStatus: 'declined' }],
      }),
    ).toBe(false)

    expect(isDeclinedByOrganizer(base)).toBe(false)
  })
})
