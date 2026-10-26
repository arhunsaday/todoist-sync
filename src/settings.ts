import { z } from 'zod'

import { getConfig, type SettingValues } from './config.js'

/**
 * The editable settings as the UI sees them: structured, rather than the
 * comma-separated strings the environment variables use.
 */
export const settingsSchema = z.object({
  mappings: z.array(
    z.object({
      todoistProjectId: z.string().min(1),
      googleCalendarId: z.string().min(1),
    }),
  ),
  defaultEventDurationMinutes: z.number().int().positive(),
  syncForeignEvents: z.boolean(),
  priorityPrefixes: z.boolean(),
  labelPrefixes: z.array(
    z.object({ match: z.string().trim().min(1), prefix: z.string().trim().min(1) }),
  ),
  syncComments: z.boolean(),
  maxCompletionsPerSync: z.number().int().min(0),
})

export type Settings = z.infer<typeof settingsSchema>

export function currentSettings(): Settings {
  const config = getConfig()
  return {
    mappings: config.SYNC_MAPPINGS,
    defaultEventDurationMinutes: config.DEFAULT_EVENT_DURATION_MINUTES,
    syncForeignEvents: config.SYNC_FOREIGN_EVENTS,
    priorityPrefixes: config.PRIORITY_PREFIXES,
    labelPrefixes: config.LABEL_PREFIXES,
    syncComments: config.SYNC_COMMENTS,
    maxCompletionsPerSync: config.MAX_COMPLETIONS_PER_SYNC,
  }
}

/**
 * Back to the environment-variable format, so saved values go through the
 * same schema as the environment. `:` and `,` separate entries there, so a
 * value containing either is refused rather than silently split.
 */
export function toSettingValues(settings: Settings): SettingValues | string[] {
  const unsafe = [
    ...settings.mappings.flatMap((m) => [m.todoistProjectId, m.googleCalendarId]),
    ...settings.labelPrefixes.flatMap((l) => [l.match, l.prefix]),
  ].filter((value) => /[:,]/.test(value))

  if (unsafe.length > 0) {
    return unsafe.map((value) => `"${value}" cannot contain ":" or ","`)
  }

  return {
    SYNC_MAPPINGS: settings.mappings
      .map((m) => `${m.todoistProjectId}:${m.googleCalendarId}`)
      .join(','),
    DEFAULT_EVENT_DURATION_MINUTES: String(settings.defaultEventDurationMinutes),
    SYNC_FOREIGN_EVENTS: String(settings.syncForeignEvents),
    PRIORITY_PREFIXES: String(settings.priorityPrefixes),
    LABEL_PREFIXES: settings.labelPrefixes.map((l) => `${l.match}:${l.prefix}`).join(','),
    SYNC_COMMENTS: String(settings.syncComments),
    MAX_COMPLETIONS_PER_SYNC: String(settings.maxCompletionsPerSync),
  }
}
