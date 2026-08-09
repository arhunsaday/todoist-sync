import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

import { LOG_LEVELS } from './logger.js'

loadDotenv({ quiet: true })

/**
 * One Todoist project mirrored to one Google calendar.
 *
 * The mapping is the universe of the sync in both directions: tasks outside a
 * mapped project are never mirrored, and events outside a mapped calendar are
 * never read.
 */
export const mappingSchema = z.object({
  todoistProjectId: z.string().min(1),
  googleCalendarId: z.string().min(1),
})

export type Mapping = z.infer<typeof mappingSchema>

/**
 * `SYNC_MAPPINGS` is a comma-separated list of `todoistProjectId:googleCalendarId`.
 * Calendar ids contain `@` and dots but never `:` or `,`, so this stays unambiguous.
 */
export const mappingsSchema = z
  .string()
  .min(1)
  .transform((raw, ctx) => {
    const mappings: Mapping[] = []

    for (const pair of raw.split(',')) {
      const trimmed = pair.trim()
      if (trimmed === '') continue

      const separator = trimmed.indexOf(':')
      if (separator === -1) {
        ctx.addIssue({
          code: 'custom',
          message: `expected "todoistProjectId:googleCalendarId", got "${trimmed}"`,
        })
        continue
      }

      mappings.push({
        todoistProjectId: trimmed.slice(0, separator).trim(),
        googleCalendarId: trimmed.slice(separator + 1).trim(),
      })
    }

    return mappings
  })
  .pipe(
    z
      .array(mappingSchema)
      .min(1)
      .superRefine((mappings, ctx) => {
        // A project mapped twice, or a calendar targeted twice, makes the
        // direction of a change ambiguous. Reject it at boot rather than
        // discovering it as duplicated events later.
        const seenProjects = new Set<string>()
        const seenCalendars = new Set<string>()

        for (const { todoistProjectId, googleCalendarId } of mappings) {
          if (seenProjects.has(todoistProjectId)) {
            ctx.addIssue({
              code: 'custom',
              message: `Todoist project ${todoistProjectId} is mapped more than once`,
            })
          }
          if (seenCalendars.has(googleCalendarId)) {
            ctx.addIssue({
              code: 'custom',
              message: `Google calendar ${googleCalendarId} is mapped more than once`,
            })
          }
          seenProjects.add(todoistProjectId)
          seenCalendars.add(googleCalendarId)
        }
      }),
  )

const booleanSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')

/**
 * Everything needed to talk to the two APIs — but *not* the mapping.
 *
 * `pnpm list-ids` exists to discover the ids that go into `SYNC_MAPPINGS`, so
 * it cannot require `SYNC_MAPPINGS` to already be valid.
 */
const credentialsSchema = z.object({
  DATABASE_PATH: z.string().min(1).default('./data/sync.db'),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.url(),

  /** Webhooks only fire for OAuth apps — a personal token is not enough. */
  TODOIST_CLIENT_ID: z.string().min(1),
  TODOIST_CLIENT_SECRET: z.string().min(1),
  TODOIST_REDIRECT_URI: z.url(),
  /** Optional. Lets `pnpm list-ids` run before the OAuth flow is set up. */
  TODOIST_API_TOKEN: z.string().min(1).optional(),
})

const envSchema = credentialsSchema.extend({
  PORT: z.coerce.number().int().positive().default(3000),
  /** Public HTTPS origin. Google refuses to deliver push to anything else. */
  PUBLIC_URL: z.url(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  SYNC_MAPPINGS: mappingsSchema,

  DEFAULT_EVENT_DURATION_MINUTES: z.coerce.number().int().positive().default(60),
  /** Create Todoist tasks for events added straight to a mapped calendar. */
  SYNC_FOREIGN_EVENTS: booleanSchema.default(true),
  /**
   * Recurring foreign events cannot be expanded into instances under
   * incremental sync, so they are skipped and logged. Enabling this without an
   * RRULE translation layer does nothing.
   */
  SYNC_RECURRING_FOREIGN_EVENTS: booleanSchema.default(false),
  RECONCILE_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  /** Renew Google watch channels expiring within this window. */
  WATCH_RENEW_WITHIN_HOURS: z.coerce.number().int().positive().default(48),
})

export type Credentials = z.infer<typeof credentialsSchema>
export type Config = z.infer<typeof envSchema>

function parseOrThrow<T>(schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(process.env)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid configuration:\n${issues}`)
  }

  return parsed.data
}

let cachedCredentials: Credentials | undefined
let cachedConfig: Config | undefined

/** Credentials only — safe to call before `SYNC_MAPPINGS` is filled in. */
export function getCredentials(): Credentials {
  cachedCredentials ??= parseOrThrow(credentialsSchema)
  return cachedCredentials
}

/**
 * Full configuration, including the mapping. Validated once on first use
 * rather than at import time, so pure modules stay importable in tests
 * without a populated `.env`.
 */
export function getConfig(): Config {
  cachedConfig ??= parseOrThrow(envSchema)
  return cachedConfig
}
