import { google, type calendar_v3 } from 'googleapis'

import type { Db } from '../db/index.js'
import { logger } from '../logger.js'
import { getAuthedClient } from './oauth.js'

export type GoogleEvent = calendar_v3.Schema$Event

/** Marks events this app owns. Constant, so it is queryable for recovery —
 *  `privateExtendedProperty` only supports exact `key=value` matches, so a
 *  `todoistId=*` wildcard is not possible. */
export const MANAGED_BY_KEY = 'managedBy'
export const MANAGED_BY_VALUE = 't2gc'
export const TODOIST_ID_KEY = 'todoistId'

/**
 * These must be byte-identical between the initial list and every incremental
 * one, or the sync token's behaviour is undefined.
 *
 * `singleEvents: false` is mandatory: `timeMin`/`timeMax` are forbidden
 * alongside `syncToken`, so expanding recurring series would mean expanding
 * unbounded ones with no window to bound them.
 */
const LIST_PARAMS = {
  singleEvents: false,
  showDeleted: true,
  maxResults: 250,
} as const

export class SyncTokenExpiredError extends Error {
  constructor(readonly calendarId: string) {
    super(`Google sync token for ${calendarId} expired (410 GONE)`)
    this.name = 'SyncTokenExpiredError'
  }
}

function isGone(error: unknown): boolean {
  const status = (error as { status?: number; code?: number } | null)?.status
  const code = (error as { code?: number } | null)?.code
  return status === 410 || code === 410
}

export function todoistIdOf(event: GoogleEvent): string | undefined {
  return event.extendedProperties?.private?.[TODOIST_ID_KEY] ?? undefined
}

export interface GoogleClientOptions {
  /** When true, mutating calls are logged and skipped. */
  dryRun?: boolean
}

export class GoogleCalendarClient {
  private readonly calendar: calendar_v3.Calendar
  private readonly timeZones = new Map<string, string>()

  constructor(
    db: Db,
    private readonly options: GoogleClientOptions = {},
  ) {
    this.calendar = google.calendar({
      version: 'v3',
      auth: getAuthedClient(db),
      // Transient 429/5xx are retried in the transport, so the sync engine only
      // ever sees errors that are actually worth reporting.
      retryConfig: { retry: 3, retryDelay: 500 },
    })
  }

  /**
   * A calendar's own timezone, used to place Todoist floating times.
   * Cached for process lifetime — calendars are not re-homed in practice.
   */
  async getTimeZone(calendarId: string): Promise<string> {
    const cached = this.timeZones.get(calendarId)
    if (cached !== undefined) return cached

    const response = await this.calendar.calendars.get({ calendarId })
    const timeZone = response.data.timeZone ?? 'UTC'
    this.timeZones.set(calendarId, timeZone)
    return timeZone
  }

  /** Escape hatch for watch-channel calls, which are not event operations. */
  get api(): calendar_v3.Calendar {
    return this.calendar
  }

  /**
   * Incremental list. Pass `undefined` for the initial full list.
   *
   * Throws {@link SyncTokenExpiredError} on 410 so the caller can clear the
   * cursor and re-baseline.
   */
  async listChanges(
    calendarId: string,
    syncToken: string | undefined,
  ): Promise<{ events: GoogleEvent[]; nextSyncToken: string }> {
    const events: GoogleEvent[] = []
    let pageToken: string | undefined
    let nextSyncToken: string | undefined

    do {
      let response
      try {
        response = await this.calendar.events.list({
          calendarId,
          ...LIST_PARAMS,
          ...(syncToken === undefined ? {} : { syncToken }),
          ...(pageToken === undefined ? {} : { pageToken }),
        })
      } catch (error) {
        if (isGone(error)) throw new SyncTokenExpiredError(calendarId)
        throw error
      }

      events.push(...(response.data.items ?? []))
      pageToken = response.data.nextPageToken ?? undefined
      // Only present on the final page.
      nextSyncToken = response.data.nextSyncToken ?? undefined
    } while (pageToken !== undefined)

    if (nextSyncToken === undefined) {
      throw new Error(`Google returned no nextSyncToken for ${calendarId}`)
    }

    return { events, nextSyncToken }
  }

  /** Every event this app owns on a calendar. Used by `pnpm rebuild-links`. */
  async listManagedEvents(calendarId: string): Promise<GoogleEvent[]> {
    const events: GoogleEvent[] = []
    let pageToken: string | undefined

    do {
      const response = await this.calendar.events.list({
        calendarId,
        privateExtendedProperty: [`${MANAGED_BY_KEY}=${MANAGED_BY_VALUE}`],
        singleEvents: false,
        showDeleted: false,
        maxResults: 250,
        ...(pageToken === undefined ? {} : { pageToken }),
      })

      events.push(...(response.data.items ?? []))
      pageToken = response.data.nextPageToken ?? undefined
    } while (pageToken !== undefined)

    return events
  }

  /**
   * Fetch one event, or `undefined` if it is not on that calendar.
   *
   * Used to tell a genuine deletion from a cross-calendar move: Google reports
   * both as a cancellation on the source calendar, and only the presence of
   * the same event id elsewhere distinguishes them.
   */
  async get(
    calendarId: string,
    eventId: string,
  ): Promise<GoogleEvent | undefined> {
    try {
      const response = await this.calendar.events.get({ calendarId, eventId })
      return response.data.status === 'cancelled' ? undefined : response.data
    } catch (error) {
      const status = (error as { status?: number; code?: number }).status
      const code = (error as { code?: number }).code
      if (status === 404 || code === 404 || isGone(error)) return undefined
      throw error
    }
  }

  async insert(calendarId: string, event: GoogleEvent): Promise<GoogleEvent> {
    if (this.options.dryRun === true) {
      logger.info({ calendarId, event }, '[dry-run] would insert event')
      return { ...event, id: `dry-run-${randomSuffix()}` }
    }

    const response = await this.calendar.events.insert({
      calendarId,
      requestBody: event,
    })
    return response.data
  }

  async patch(
    calendarId: string,
    eventId: string,
    event: GoogleEvent,
  ): Promise<GoogleEvent> {
    if (this.options.dryRun === true) {
      logger.info({ calendarId, eventId, event }, '[dry-run] would patch event')
      return { ...event, id: eventId }
    }

    const response = await this.calendar.events.patch({
      calendarId,
      eventId,
      requestBody: event,
    })
    return response.data
  }

  /**
   * Move an event between calendars. Google preserves the event id, so the
   * link row is updated in place rather than recreated.
   */
  async move(
    fromCalendarId: string,
    eventId: string,
    toCalendarId: string,
  ): Promise<GoogleEvent> {
    if (this.options.dryRun === true) {
      logger.info(
        { fromCalendarId, toCalendarId, eventId },
        '[dry-run] would move event',
      )
      return { id: eventId }
    }

    const response = await this.calendar.events.move({
      calendarId: fromCalendarId,
      eventId,
      destination: toCalendarId,
    })
    return response.data
  }

  /** Tolerates 404/410: an event already gone is the state we wanted. */
  async delete(calendarId: string, eventId: string): Promise<void> {
    if (this.options.dryRun === true) {
      logger.info({ calendarId, eventId }, '[dry-run] would delete event')
      return
    }

    try {
      await this.calendar.events.delete({ calendarId, eventId })
    } catch (error) {
      const status = (error as { status?: number; code?: number }).status
      const code = (error as { code?: number }).code
      if (status === 404 || code === 404 || isGone(error)) {
        logger.debug({ calendarId, eventId }, 'event already deleted')
        return
      }
      throw error
    }
  }

  async listCalendars(): Promise<calendar_v3.Schema$CalendarListEntry[]> {
    const response = await this.calendar.calendarList.list({ maxResults: 250 })
    return response.data.items ?? []
  }
}

function randomSuffix(): string {
  return Math.trunc(performance.now() * 1000).toString(36)
}
