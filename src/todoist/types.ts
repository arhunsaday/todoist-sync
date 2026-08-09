import { z } from 'zod'

/** Todoist v1 returns string ids, but tolerate numeric ones defensively. */
const idSchema = z.union([z.string(), z.number()]).transform(String)

/**
 * `date` is one of three shapes:
 *   "2026-08-09"                   date only, no time
 *   "2026-08-09T13:00:00"          floating time, no timezone
 *   "2026-08-09T13:00:00.000000Z"  fixed time, UTC, with `timezone` set
 */
export const dueSchema = z.object({
  date: z.string(),
  timezone: z.string().nullish(),
  string: z.string().nullish(),
  lang: z.string().nullish(),
  is_recurring: z.boolean().default(false),
})

export const durationSchema = z.object({
  amount: z.number().int().positive(),
  unit: z.enum(['minute', 'day']),
})

export const itemSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  content: z.string(),
  description: z.string().nullish(),
  due: dueSchema.nullish(),
  duration: durationSchema.nullish(),
  /** Inverted relative to the UI: 4 is p1 (urgent), 1 is p4 (no priority). */
  priority: z.number().int().min(1).max(4).default(1),
  labels: z.array(z.string()).default([]),
  checked: z.boolean().default(false),
  is_deleted: z.boolean().default(false),
  added_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  completed_at: z.string().nullish(),
})

/** A task comment. Todoist calls these notes. */
export const noteSchema = z.object({
  id: idSchema,
  item_id: idSchema.nullish(),
  content: z.string().default(''),
  posted_at: z.string().nullish(),
  is_deleted: z.boolean().default(false),
})

export const projectSchema = z.object({
  id: idSchema,
  name: z.string(),
  is_deleted: z.boolean().default(false),
  is_archived: z.boolean().default(false),
})

export const syncResponseSchema = z.object({
  sync_token: z.string(),
  full_sync: z.boolean().default(false),
  items: z.array(itemSchema).default([]),
  projects: z.array(projectSchema).default([]),
  notes: z.array(noteSchema).default([]),
})

const commandErrorSchema = z.object({
  error: z.string(),
  error_code: z.number().optional(),
  error_tag: z.string().optional(),
})

export const commandResponseSchema = z.object({
  sync_token: z.string().optional(),
  /** Maps the `temp_id` we sent on an `item_add` to the real id assigned. */
  temp_id_mapping: z.record(z.string(), idSchema).default({}),
  /** Per-command outcome, keyed by the command uuid: `"ok"` or an error. */
  sync_status: z
    .record(z.string(), z.union([z.literal('ok'), commandErrorSchema]))
    .default({}),
})

export const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
})

export type TodoistDue = z.infer<typeof dueSchema>
export type TodoistDuration = z.infer<typeof durationSchema>
export type TodoistItem = z.infer<typeof itemSchema>
export type TodoistProject = z.infer<typeof projectSchema>
export type TodoistNote = z.infer<typeof noteSchema>
export type SyncResponse = z.infer<typeof syncResponseSchema>
export type CommandResponse = z.infer<typeof commandResponseSchema>
export type TokenResponse = z.infer<typeof tokenResponseSchema>

export interface TodoistCommand {
  type: string
  uuid: string
  temp_id?: string
  args: Record<string, unknown>
}
