import { getConfig } from '../config.js'
import { getItem, getNotes } from '../db/items.js'
import * as links from '../db/links.js'
import { todoistIdOf, type GoogleEvent } from '../google/client.js'
import { logger } from '../logger.js'
import {
  itemAdd,
  itemComplete,
  itemMove,
  itemUpdate,
} from '../todoist/client.js'
import type { TodoistCommand, TodoistItem } from '../todoist/types.js'
import type { SyncContext } from './context.js'
import { googleFingerprint, todoistFingerprint } from './fingerprint.js'
import {
  isCancelled,
  isDeclinedByOrganizer,
  isRecurring,
  isSyntheticEventType,
  toTodoistFields,
  type TodoistFields,
} from './mapping.js'

/**
 * The fingerprint the task will have once Todoist has applied our write.
 *
 * Todoist's command API returns no item body, so the post-write state is
 * reconstructed rather than read back. If Todoist normalises something
 * differently the next reconcile corrects it in one extra pass — it cannot
 * loop, because that pass stores the value Todoist actually reported.
 *
 * Projected onto the cached item so fields the calendar has no say over —
 * priority, labels — survive. Rebuilding from scratch would predict
 * `priority: 1` for a p1 task, the prediction would miss, and every calendar
 * edit would trigger a pointless re-push.
 */
function expectedTodoistFingerprint(
  ctx: SyncContext,
  itemId: string,
  projectId: string,
  fields: TodoistFields,
): string {
  const current = getItem(ctx.db, itemId)
  const notes = getNotes(ctx.db, itemId)

  const projected: TodoistItem = {
    ...(current ?? { priority: 1, labels: [] }),
    id: itemId,
    project_id: projectId,
    // Mirror exactly what the update sends: when the title was untouched we
    // omit content, so the task keeps the one it already has.
    content:
      fields.contentUnchanged && current !== undefined
        ? current.content
        : fields.content,
    description: fields.description,
    due:
      fields.due === null
        ? null
        : {
            date: fields.due.date,
            timezone: fields.due.timezone ?? null,
            is_recurring: current?.due?.is_recurring ?? false,
          },
    duration: fields.duration,
    checked: false,
    is_deleted: false,
  }
  return todoistFingerprint(projected, notes)
}

/** Is this event id present on any other mapped calendar? */
async function findOnOtherCalendar(
  ctx: SyncContext,
  eventId: string,
  excluding: string,
): Promise<string | undefined> {
  for (const calendarId of ctx.routing.calendarIds) {
    if (calendarId === excluding) continue
    const found = await ctx.google.get(calendarId, eventId)
    if (found !== undefined) return calendarId
  }
  return undefined
}

/** Should this untracked event become a Todoist task? */
function foreignEventSkipReason(event: GoogleEvent): string | undefined {
  const config = getConfig()

  if (!config.SYNC_FOREIGN_EVENTS) return 'foreign event sync disabled'
  if (isSyntheticEventType(event)) return `event type ${event.eventType}`
  if (isDeclinedByOrganizer(event)) return 'invitation declined'
  if (isRecurring(event) && !config.SYNC_RECURRING_FOREIGN_EVENTS) {
    // Incremental sync forbids timeMin/timeMax, so a recurring series cannot
    // be expanded into instances. Half-syncing it would be worse than not.
    return 'recurring series cannot be expanded under incremental sync'
  }
  return undefined
}

/** Push an event's content onto its already-paired task. */
async function updateLinkedTask(
  ctx: SyncContext,
  calendarId: string,
  event: GoogleEvent,
  link: links.Link,
): Promise<void> {
  const fingerprint = googleFingerprint(event, calendarId)
  const movedCalendar = link.googleCalendarId !== calendarId

  if (!movedCalendar && fingerprint === link.googleFingerprint) {
    logger.debug({ eventId: event.id }, 'echo of our own write; skipping')
    return
  }

  const targetProject = ctx.routing.projectForCalendar(calendarId)
  if (targetProject === undefined) return

  const fields = toTodoistFields(event, ctx.decorationOptions())

  // Omit content unless the title was genuinely edited. Sending our own
  // rendered title back would flatten a markdown link in the task's name into
  // plain text and lose the URL for good.
  const commands: TodoistCommand[] = [
    itemUpdate(link.todoistItemId, {
      ...(fields.contentUnchanged ? {} : { content: fields.content }),
      description: fields.description,
      due: fields.due,
      duration: fields.duration,
    }),
  ]

  // Dragging an event to another calendar moves the task to that project.
  if (targetProject !== link.todoistProjectId) {
    commands.push(itemMove(link.todoistItemId, targetProject))
    logger.info(
      { itemId: link.todoistItemId, from: link.todoistProjectId, to: targetProject },
      'moved task between projects',
    )
  }

  await ctx.todoist.executeCommands(commands)

  ctx.persistLink({
    todoistItemId: link.todoistItemId,
    googleEventId: link.googleEventId,
    googleCalendarId: calendarId,
    todoistProjectId: targetProject,
    todoistFingerprint: expectedTodoistFingerprint(
      ctx,
      link.todoistItemId,
      targetProject,
      fields,
    ),
    googleFingerprint: fingerprint,
  })
  logger.info({ itemId: link.todoistItemId, eventId: event.id }, 'updated task')
}

/** Create a task for an event that was added straight to the calendar. */
async function createTaskForForeignEvent(
  ctx: SyncContext,
  calendarId: string,
  event: GoogleEvent,
  eventId: string,
): Promise<void> {
  const skip = foreignEventSkipReason(event)
  if (skip !== undefined) {
    logger.info({ eventId, summary: event.summary, reason: skip }, 'skipped event')
    return
  }

  const projectId = ctx.routing.projectForCalendar(calendarId)
  if (projectId === undefined) return

  const fields = toTodoistFields(event, ctx.decorationOptions())
  // A brand new task always needs its content, whatever the hash comparison said.
  const command = itemAdd(projectId, {
    content: fields.content,
    description: fields.description,
    due: fields.due,
    duration: fields.duration,
  })
  const response = await ctx.todoist.executeCommands([command])
  const itemId = response.temp_id_mapping[command.temp_id]

  if (itemId === undefined) {
    if (ctx.dryRun) return
    throw new Error(`Todoist item_add returned no id for event ${eventId}`)
  }

  // Tag the event so it is recognised as managed from now on — including
  // after a state loss, since the tag is what `rebuild-links` reads.
  // extendedProperties are excluded from the fingerprint, so this write does
  // not come back as a spurious change.
  const tagged = await ctx.google.patch(calendarId, eventId, {
    extendedProperties: {
      private: { todoistId: itemId, managedBy: 't2gc' },
    },
  })

  ctx.persistLink({
    todoistItemId: itemId,
    googleEventId: eventId,
    googleCalendarId: calendarId,
    todoistProjectId: projectId,
    todoistFingerprint: expectedTodoistFingerprint(ctx, itemId, projectId, fields),
    googleFingerprint: googleFingerprint(tagged, calendarId),
  })
  logger.info(
    { itemId, eventId, summary: event.summary },
    'created task for calendar event',
  )
}

/**
 * Apply one changed Google event to Todoist.
 *
 * The awkward case is cancellation. Google reports a cross-calendar move as a
 * cancellation on the source calendar, identical in shape to a real deletion,
 * so a naive reading completes a task the user merely dragged elsewhere. Two
 * rules disambiguate it, and between them the two halves of a move can arrive
 * in either order:
 *
 *   - a cancellation on a calendar the link no longer points at is the tail of
 *     a move already processed, and is ignored;
 *   - otherwise the event id is probed on the other mapped calendars, and only
 *     its genuine absence counts as a deletion.
 */
export async function applyGoogleEvent(
  ctx: SyncContext,
  calendarId: string,
  event: GoogleEvent,
): Promise<void> {
  const eventId = event.id
  if (eventId == null) return

  // Prefer the id in the event's own tag: it survives a lost link table, and
  // it still resolves when the event has moved between calendars.
  const taggedId = todoistIdOf(event)
  const link =
    links.findByGoogleEventId(ctx.db, calendarId, eventId) ??
    (taggedId === undefined
      ? undefined
      : links.findByTodoistItemId(ctx.db, taggedId))

  if (isCancelled(event)) {
    if (link === undefined) return

    // The link has moved on, so this cancellation describes a calendar or an
    // event id we no longer track — the tail of a change already applied
    // (a move, or a recreate after the event was deleted behind our back).
    // Acting on it would complete a task that is still very much live.
    if (
      link.googleCalendarId !== calendarId ||
      link.googleEventId !== eventId
    ) {
      logger.debug(
        { eventId, calendarId, trackedEventId: link.googleEventId },
        'cancellation refers to an event we no longer track; ignoring',
      )
      return
    }

    const movedTo = await findOnOtherCalendar(ctx, eventId, calendarId)
    if (movedTo !== undefined) {
      logger.debug({ eventId, movedTo }, 'cancellation is a move; deferring')
      return
    }

    await ctx.todoist.executeCommands([itemComplete(link.todoistItemId)])
    ctx.dropLink(link.todoistItemId)
    logger.info(
      { itemId: link.todoistItemId, eventId },
      'completed task after event deletion',
    )
    return
  }

  if (link !== undefined) {
    await updateLinkedTask(ctx, calendarId, event, link)
    return
  }

  await createTaskForForeignEvent(ctx, calendarId, event, eventId)
}
