import type { calendar_v3 } from 'googleapis'

import type { StoredNote } from '../db/items.js'
import {
  MANAGED_BY_KEY,
  MANAGED_BY_VALUE,
  TODOIST_ID_KEY,
  type GoogleEvent,
} from '../google/client.js'
import type { TodoistDuration, TodoistItem } from '../todoist/types.js'
import {
  decorateSummary,
  normaliseGoogleText,
  renderDescription,
  stripCommentsBlock,
  stripSummaryDecoration,
  type DecorationOptions,
} from './decorate.js'
import {
  addDaysToDate,
  addMinutes,
  daysBetweenDates,
  durationToMinutes,
  formatFloating,
  hasExplicitZone,
  isDateOnly,
  minutesBetween,
  parseTodoistTimestamp,
} from './time.js'

export interface MappingOptions extends DecorationOptions {
  /** Applied to a timed task that carries no explicit duration. */
  defaultDurationMinutes: number
  /**
   * Timezone for Todoist floating times. Google rejects a `dateTime` with
   * neither an offset nor a `timeZone`, so a floating task needs one supplied.
   */
  fallbackTimeZone: string
  /** Append task comments to the event description. */
  syncComments: boolean
}

export interface GoogleEventFields {
  summary: string
  description: string
  start: calendar_v3.Schema$EventDateTime
  end: calendar_v3.Schema$EventDateTime
  extendedProperties: { private: Record<string, string> }
  source: { title: string; url: string }
}

export interface TodoistFields {
  content: string
  description: string
  due: { date: string; timezone?: string | null } | null
  duration: TodoistDuration | null
}

const UNTITLED = '(untitled)'

export function todoistTaskUrl(itemId: string): string {
  return `https://app.todoist.com/app/task/${itemId}`
}

/* -------------------------------------------------------------------------- */
/* Todoist → Google                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Build the Google event mirroring a task.
 *
 * Returns `null` when the task carries no due date: an undated task has no
 * place on a calendar, and the caller deletes any event it previously had.
 */
export function toGoogleEvent(
  item: TodoistItem,
  options: MappingOptions,
  notes: readonly StoredNote[] = [],
): GoogleEventFields | null {
  if (item.due == null) return null

  const { date, timezone } = item.due
  const content = item.content.trim() === '' ? UNTITLED : item.content
  const description = item.description ?? ''

  const common = {
    summary: decorateSummary(content, item, options),
    description: options.syncComments
      ? renderDescription(description, notes)
      : description,
    extendedProperties: {
      private: {
        [TODOIST_ID_KEY]: item.id,
        [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
      },
    },
    source: { title: 'Todoist', url: todoistTaskUrl(item.id) },
  }

  if (isDateOnly(date)) {
    // Google's end.date is exclusive, so a one-day event ends the next day.
    const days =
      item.duration != null && item.duration.unit === 'day'
        ? Math.max(1, item.duration.amount)
        : 1

    return {
      ...common,
      // `date` and `dateTime` are mutually exclusive, and Google's patch
      // deep-merges nested objects: omitting the other one leaves a stale
      // value in place and the request fails with "Invalid start time." An
      // explicit null is the only way to clear it, and it is needed on both
      // branches — a task can gain or lose its time of day either way.
      start: { date, dateTime: null, timeZone: null },
      end: { date: addDaysToDate(date, days), dateTime: null, timeZone: null },
    }
  }

  const start = parseTodoistTimestamp(date)
  const minutes =
    item.duration == null
      ? options.defaultDurationMinutes
      : durationToMinutes(item.duration.amount, item.duration.unit)
  const end = addMinutes(start, Math.max(1, minutes))

  // A fixed-timezone task pins an instant; send it as UTC and let Google
  // render it. A floating task means a wall-clock time, so send the wall clock
  // with a timezone attached rather than an instant.
  const timeZone = timezone ?? options.fallbackTimeZone
  const format = hasExplicitZone(date)
    ? (value: Date) => value.toISOString()
    : formatFloating

  return {
    ...common,
    start: { date: null, dateTime: format(start), timeZone },
    end: { date: null, dateTime: format(end), timeZone },
  }
}

/* -------------------------------------------------------------------------- */
/* Google → Todoist                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Build the Todoist task fields mirroring an event.
 *
 * Throws if the event has neither a date nor a dateTime, which Google should
 * never produce for a non-cancelled event.
 */
export function toTodoistFields(
  event: GoogleEvent,
  options: DecorationOptions,
): TodoistFields {
  // Undo the derived text before it reaches Todoist. Both operations are
  // idempotent, so this is safe to apply to an undecorated event and to one
  // that somehow arrived doubly decorated.
  const rawSummary = event.summary?.trim() ?? ''
  const summary = stripSummaryDecoration(rawSummary, options).trim()

  const common = {
    content: summary === '' ? UNTITLED : summary,
    description: stripCommentsBlock(
      normaliseGoogleText(event.description ?? ''),
    ),
  }

  const startDate = event.start?.date
  if (startDate != null) {
    const endDate = event.end?.date
    const days = endDate == null ? 1 : daysBetweenDates(startDate, endDate)

    return {
      ...common,
      due: { date: startDate },
      // A single-day all-day task needs no duration; anything longer does.
      duration: days > 1 ? { amount: days, unit: 'day' } : null,
    }
  }

  const startDateTime = event.start?.dateTime
  if (startDateTime == null) {
    throw new Error(`Google event ${event.id ?? '(no id)'} has no start`)
  }

  const start = new Date(startDateTime)
  const endDateTime = event.end?.dateTime
  const minutes =
    endDateTime == null ? 0 : minutesBetween(start, new Date(endDateTime))

  return {
    ...common,
    due: {
      date: start.toISOString(),
      timezone: event.start?.timeZone ?? null,
    },
    duration: minutes > 0 ? { amount: minutes, unit: 'minute' } : null,
  }
}

/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

/** Google marks deletions by flipping status rather than omitting the event. */
export function isCancelled(event: GoogleEvent): boolean {
  return event.status === 'cancelled'
}

/**
 * A recurring master or one of its exceptions.
 *
 * These cannot be expanded into instances under incremental sync, so foreign
 * ones are skipped rather than half-synced.
 */
export function isRecurring(event: GoogleEvent): boolean {
  return (
    (event.recurrence != null && event.recurrence.length > 0) ||
    event.recurringEventId != null
  )
}

/**
 * Events Google generates on the user's behalf. They are not tasks and must
 * never become them.
 */
export function isSyntheticEventType(event: GoogleEvent): boolean {
  return (
    event.eventType === 'birthday' ||
    event.eventType === 'workingLocation' ||
    event.eventType === 'fromGmail'
  )
}

/** True when the invitee has explicitly declined — not something to act on. */
export function isDeclinedByOrganizer(event: GoogleEvent): boolean {
  return (
    event.attendees?.some(
      (attendee) => attendee.self === true && attendee.responseStatus === 'declined',
    ) ?? false
  )
}
