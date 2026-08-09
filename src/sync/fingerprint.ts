import { createHash } from 'node:crypto'

import type { GoogleEvent } from '../google/client.js'
import type { TodoistItem } from '../todoist/types.js'
import { durationToMinutes, isDateOnly, parseTodoistTimestamp } from './time.js'

/**
 * Fingerprints exist for one job: telling our own writes apart from real user
 * edits.
 *
 * After every write we store the resulting fingerprint on both sides. When the
 * webhook that write triggered comes back around, the recomputed fingerprint
 * matches what we stored and the change is dropped. Without this, a two-way
 * sync feeds itself forever.
 *
 * The two fingerprints are deliberately NOT comparable with each other — each
 * only has to be stable within its own side, across the different shapes that
 * side reports the same state in. That is a much weaker property than a shared
 * canonical form, and correspondingly harder to get wrong.
 *
 * Only fields that participate in the sync are included. Anything Google or
 * Todoist may rewrite on its own (`etag`, `updated`, `sequence`) is excluded,
 * or every reconcile would see phantom changes.
 */

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** `date:2026-08-09` or `time:2026-08-09T13:00:00.000Z`. */
type CanonicalTime = string

function canonicalTodoistDue(date: string): CanonicalTime {
  return isDateOnly(date)
    ? `date:${date}`
    : `time:${parseTodoistTimestamp(date).toISOString()}`
}

function canonicalEventTime(
  slot: GoogleEvent['start'] | GoogleEvent['end'],
): CanonicalTime | null {
  if (slot == null) return null
  if (slot.date != null) return `date:${slot.date}`
  if (slot.dateTime != null) {
    // Normalise to an instant: Google may report the same moment as
    // `...+02:00` on one read and `...Z` on another.
    return `time:${new Date(slot.dateTime).toISOString()}`
  }
  return null
}

export function todoistFingerprint(item: TodoistItem): string {
  return hash({
    content: item.content.trim(),
    description: (item.description ?? '').trim(),
    projectId: item.project_id,
    checked: item.checked,
    due: item.due == null ? null : canonicalTodoistDue(item.due.date),
    timezone: item.due?.timezone ?? null,
    durationMinutes:
      item.duration == null
        ? null
        : durationToMinutes(item.duration.amount, item.duration.unit),
  })
}

/**
 * `calendarId` is part of the fingerprint, not incidental: moving an event
 * between calendars is how a task changes project, and it is the only signal
 * that the move happened.
 */
export function googleFingerprint(
  event: GoogleEvent,
  calendarId: string,
): string {
  return hash({
    calendarId,
    summary: (event.summary ?? '').trim(),
    description: (event.description ?? '').trim(),
    status: event.status ?? 'confirmed',
    start: canonicalEventTime(event.start),
    end: canonicalEventTime(event.end),
    startTimeZone: event.start?.timeZone ?? null,
  })
}
