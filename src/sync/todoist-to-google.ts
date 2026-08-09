import { getNotes } from '../db/items.js'
import * as links from '../db/links.js'
import type { GoogleEvent } from '../google/client.js'
import { logger } from '../logger.js'
import type { TodoistItem } from '../todoist/types.js'
import { isNotFound, type SyncContext } from './context.js'
import { googleFingerprint, todoistFingerprint } from './fingerprint.js'
import { toGoogleEvent } from './mapping.js'

/** Delete the mirrored event, if any, and forget the pairing. */
async function removeMirroredEvent(
  ctx: SyncContext,
  itemId: string,
  link: links.Link | undefined,
  reason: string,
): Promise<void> {
  if (link === undefined) return

  await ctx.google.delete(link.googleCalendarId, link.googleEventId)
  ctx.dropLink(itemId)
  logger.info({ itemId, reason }, 'deleted event')
}

/**
 * Apply one changed Todoist task to Google Calendar.
 *
 * Ordering matters: completion and unmapped-project checks come before the
 * echo check, because both must take effect even when the task's own fields
 * are byte-identical to what we last wrote.
 */
export async function applyTodoistItem(
  ctx: SyncContext,
  item: TodoistItem,
): Promise<void> {
  const link = links.findByTodoistItemId(ctx.db, item.id)

  // Completed or deleted: the calendar shows only what is still outstanding.
  if (item.is_deleted || item.checked) {
    await removeMirroredEvent(ctx, item.id, link, 'task completed or deleted')
    return
  }

  const targetCalendar = ctx.routing.calendarForProject(item.project_id)
  if (targetCalendar === undefined) {
    await removeMirroredEvent(ctx, item.id, link, 'project is not mapped')
    return
  }

  const notes = getNotes(ctx.db, item.id)
  const fingerprint = todoistFingerprint(item, notes)
  if (link !== undefined && link.todoistFingerprint === fingerprint) {
    logger.debug({ itemId: item.id }, 'echo of our own write; skipping')
    return
  }

  const options = await ctx.mappingOptions(targetCalendar)
  const fields = toGoogleEvent(item, options, notes)

  // An undated task has no place on a calendar.
  if (fields === null) {
    await removeMirroredEvent(ctx, item.id, link, 'task has no due date')
    return
  }

  if (link === undefined) {
    const created = await ctx.google.insert(targetCalendar, fields)
    if (created.id == null) throw new Error('Google insert returned no event id')

    ctx.persistLink({
      todoistItemId: item.id,
      googleEventId: created.id,
      googleCalendarId: targetCalendar,
      todoistProjectId: item.project_id,
      todoistFingerprint: fingerprint,
      googleFingerprint: googleFingerprint(created, targetCalendar),
    })
    logger.info(
      { itemId: item.id, calendarId: targetCalendar, content: item.content },
      'created event',
    )
    return
  }

  // A project change moves the event. Google preserves the event id, so the
  // link row is updated rather than replaced.
  let calendarId = link.googleCalendarId
  if (calendarId !== targetCalendar) {
    await ctx.google.move(calendarId, link.googleEventId, targetCalendar)
    logger.info(
      { itemId: item.id, from: calendarId, to: targetCalendar },
      'moved event between calendars',
    )
    calendarId = targetCalendar
  }

  let saved: GoogleEvent
  try {
    saved = await ctx.google.patch(calendarId, link.googleEventId, fields)
  } catch (error) {
    if (!isNotFound(error)) throw error

    // Deleted out from under us — recreate rather than stall forever.
    logger.warn(
      { itemId: item.id, eventId: link.googleEventId },
      'mirrored event is gone; recreating',
    )
    saved = await ctx.google.insert(calendarId, fields)
    if (saved.id == null) throw new Error('Google insert returned no event id')
  }

  ctx.persistLink({
    todoistItemId: item.id,
    googleEventId: saved.id ?? link.googleEventId,
    googleCalendarId: calendarId,
    todoistProjectId: item.project_id,
    todoistFingerprint: fingerprint,
    // Store what Google actually saved, not what we sent: the next push
    // notification carries Google's normalised form, and that is what the
    // echo check will compare against.
    googleFingerprint: googleFingerprint(saved, calendarId),
  })
  logger.info({ itemId: item.id, calendarId }, 'updated event')
}
