import type { Db } from './index.js'

/** A Todoist task and the Google event mirroring it. */
export interface Link {
  todoistItemId: string
  googleEventId: string
  googleCalendarId: string
  todoistProjectId: string
  /** Fingerprint of the Todoist state as of our last successful sync. */
  todoistFingerprint: string
  /** Fingerprint of the Google state as of our last successful sync. */
  googleFingerprint: string
  updatedAt: number
}

interface LinkRow {
  todoist_item_id: string
  google_event_id: string
  google_calendar_id: string
  todoist_project_id: string
  todoist_fingerprint: string
  google_fingerprint: string
  updated_at: number
}

function toLink(row: LinkRow): Link {
  return {
    todoistItemId: row.todoist_item_id,
    googleEventId: row.google_event_id,
    googleCalendarId: row.google_calendar_id,
    todoistProjectId: row.todoist_project_id,
    todoistFingerprint: row.todoist_fingerprint,
    googleFingerprint: row.google_fingerprint,
    updatedAt: row.updated_at,
  }
}

const COLUMNS = `
  todoist_item_id, google_event_id, google_calendar_id, todoist_project_id,
  todoist_fingerprint, google_fingerprint, updated_at
`

export function findByTodoistItemId(db: Db, itemId: string): Link | undefined {
  const row = db
    .prepare<[string], LinkRow>(
      `SELECT ${COLUMNS} FROM links WHERE todoist_item_id = ?`,
    )
    .get(itemId)
  return row === undefined ? undefined : toLink(row)
}

export function findByGoogleEventId(
  db: Db,
  calendarId: string,
  eventId: string,
): Link | undefined {
  const row = db
    .prepare<[string, string], LinkRow>(
      `SELECT ${COLUMNS} FROM links
       WHERE google_calendar_id = ? AND google_event_id = ?`,
    )
    .get(calendarId, eventId)
  return row === undefined ? undefined : toLink(row)
}

export function listAll(db: Db): Link[] {
  return db
    .prepare<[], LinkRow>(`SELECT ${COLUMNS} FROM links`)
    .all()
    .map(toLink)
}

/**
 * Insert or replace, keyed on the Todoist item id.
 *
 * `events.move` preserves the event id across calendars, so a project change
 * updates `google_calendar_id` in place rather than creating a second row.
 */
export function upsert(db: Db, link: Omit<Link, 'updatedAt'>): void {
  db.prepare(
    `INSERT INTO links (${COLUMNS})
     VALUES (@todoistItemId, @googleEventId, @googleCalendarId, @todoistProjectId,
             @todoistFingerprint, @googleFingerprint, @updatedAt)
     ON CONFLICT (todoist_item_id) DO UPDATE SET
       google_event_id     = excluded.google_event_id,
       google_calendar_id  = excluded.google_calendar_id,
       todoist_project_id  = excluded.todoist_project_id,
       todoist_fingerprint = excluded.todoist_fingerprint,
       google_fingerprint  = excluded.google_fingerprint,
       updated_at          = excluded.updated_at`,
  ).run({ ...link, updatedAt: Date.now() })
}

export function remove(db: Db, itemId: string): void {
  db.prepare('DELETE FROM links WHERE todoist_item_id = ?').run(itemId)
}

/** Used by `pnpm rebuild-links` before repopulating from Google. */
export function removeAll(db: Db): void {
  db.prepare('DELETE FROM links').run()
}
