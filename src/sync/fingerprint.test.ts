import { describe, expect, it } from 'vitest'

import type { GoogleEvent } from '../google/client.js'
import type { TodoistItem } from '../todoist/types.js'
import { googleFingerprint, todoistFingerprint } from './fingerprint.js'

function item(overrides: Partial<TodoistItem> = {}): TodoistItem {
  return {
    id: 'item-1',
    project_id: 'proj-1',
    content: 'Write the sync engine',
    description: '',
    due: { date: '2026-08-09', is_recurring: false },
    duration: null,
    checked: false,
    is_deleted: false,
    ...overrides,
  }
}

describe('todoistFingerprint', () => {
  it('is stable across repeated calls', () => {
    expect(todoistFingerprint(item())).toBe(todoistFingerprint(item()))
  })

  // These fields are rewritten by Todoist on its own. Including any of them
  // would make every reconcile see a phantom change.
  it('ignores fields that change without a user edit', () => {
    const before = todoistFingerprint(item())
    const after = todoistFingerprint(
      item({
        updated_at: '2026-08-09T10:00:00Z',
        added_at: '2026-08-01T10:00:00Z',
        completed_at: '2026-08-09T11:00:00Z',
      }),
    )

    expect(after).toBe(before)
  })

  it('ignores whitespace-only differences in text', () => {
    expect(todoistFingerprint(item({ content: '  Write the sync engine  ' }))).toBe(
      todoistFingerprint(item()),
    )
  })

  it.each([
    ['content', { content: 'Something else' }],
    ['description', { description: 'now with notes' }],
    ['project', { project_id: 'proj-2' }],
    ['completion', { checked: true }],
    ['due date', { due: { date: '2026-08-10', is_recurring: false } }],
    ['duration', { duration: { amount: 30, unit: 'minute' as const } }],
  ])('changes when %s changes', (_label, overrides) => {
    expect(todoistFingerprint(item(overrides))).not.toBe(todoistFingerprint(item()))
  })

  it('distinguishes an undated task from a dated one', () => {
    expect(todoistFingerprint(item({ due: null }))).not.toBe(
      todoistFingerprint(item()),
    )
  })

  it('treats equivalent instants written differently as the same', () => {
    const utc = todoistFingerprint(
      item({ due: { date: '2026-08-09T13:00:00.000000Z', is_recurring: false } }),
    )
    const offset = todoistFingerprint(
      item({ due: { date: '2026-08-09T15:00:00+02:00', is_recurring: false } }),
    )

    expect(offset).toBe(utc)
  })

  it('distinguishes a date-only due from midnight on that date', () => {
    expect(
      todoistFingerprint(item({ due: { date: '2026-08-09', is_recurring: false } })),
    ).not.toBe(
      todoistFingerprint(
        item({ due: { date: '2026-08-09T00:00:00Z', is_recurring: false } }),
      ),
    )
  })

  it('notices a timezone change that leaves the instant alone', () => {
    const paris = todoistFingerprint(
      item({
        due: {
          date: '2026-08-09T13:00:00.000000Z',
          timezone: 'Europe/Paris',
          is_recurring: false,
        },
      }),
    )
    const tokyo = todoistFingerprint(
      item({
        due: {
          date: '2026-08-09T13:00:00.000000Z',
          timezone: 'Asia/Tokyo',
          is_recurring: false,
        },
      }),
    )

    expect(tokyo).not.toBe(paris)
  })

  it('treats a day duration and its minute equivalent as the same', () => {
    expect(
      todoistFingerprint(item({ duration: { amount: 1, unit: 'day' } })),
    ).toBe(todoistFingerprint(item({ duration: { amount: 1440, unit: 'minute' } })))
  })
})

describe('googleFingerprint', () => {
  const calendar = 'work@group.calendar.google.com'

  function event(overrides: Partial<GoogleEvent> = {}): GoogleEvent {
    return {
      id: 'evt-1',
      summary: 'Write the sync engine',
      description: '',
      status: 'confirmed',
      start: { date: '2026-08-09' },
      end: { date: '2026-08-10' },
      ...overrides,
    }
  }

  it('is stable across repeated calls', () => {
    expect(googleFingerprint(event(), calendar)).toBe(
      googleFingerprint(event(), calendar),
    )
  })

  // etag and updated change on every server-side touch, including our own.
  it('ignores etag, updated, and sequence', () => {
    const before = googleFingerprint(event(), calendar)
    const after = googleFingerprint(
      event({ etag: '"999"', updated: '2026-08-09T10:00:00Z', sequence: 4 }),
      calendar,
    )

    expect(after).toBe(before)
  })

  // Google reports the same instant with different offsets between reads;
  // if that churned the fingerprint the sync would write on every poll.
  it('treats the same instant expressed differently as unchanged', () => {
    const zulu = googleFingerprint(
      event({
        start: { dateTime: '2026-08-09T11:00:00Z' },
        end: { dateTime: '2026-08-09T12:00:00Z' },
      }),
      calendar,
    )
    const offset = googleFingerprint(
      event({
        start: { dateTime: '2026-08-09T13:00:00+02:00' },
        end: { dateTime: '2026-08-09T14:00:00+02:00' },
      }),
      calendar,
    )

    expect(offset).toBe(zulu)
  })

  it.each([
    ['summary', { summary: 'Something else' }],
    ['description', { description: 'now with notes' }],
    ['status', { status: 'cancelled' }],
    ['start', { start: { date: '2026-08-10' } }],
    ['end', { end: { date: '2026-08-11' } }],
  ])('changes when %s changes', (_label, overrides) => {
    expect(googleFingerprint(event(overrides), calendar)).not.toBe(
      googleFingerprint(event(), calendar),
    )
  })

  // Moving an event between calendars is how a task changes project, and the
  // event body is otherwise untouched — so the calendar must be in the hash.
  it('changes when the event moves to another calendar', () => {
    expect(
      googleFingerprint(event(), 'personal@group.calendar.google.com'),
    ).not.toBe(googleFingerprint(event(), calendar))
  })

  it('ignores whitespace-only differences in text', () => {
    expect(
      googleFingerprint(event({ summary: '  Write the sync engine  ' }), calendar),
    ).toBe(googleFingerprint(event(), calendar))
  })

  it('treats a missing status as confirmed', () => {
    expect(googleFingerprint(event({ status: undefined }), calendar)).toBe(
      googleFingerprint(event({ status: 'confirmed' }), calendar),
    )
  })
})
