import { z } from 'zod'
export const providerSchema = z.enum(['todoist', 'google', 'notion'])
export const fieldSchema = z.enum(['title', 'description', 'schedule', 'completed', 'priority'])
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    try {
      return new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s
    } catch {
      return false
    }
  }, 'Date invalide')
const zone = z.string().refine((s) => {
  try {
    new Intl.DateTimeFormat('fr', { timeZone: s })
    return true
  } catch {
    return false
  }
}, 'Fuseau horaire invalide')
export const scheduleSchema = z
  .union([
    z.object({ kind: z.literal('date'), date: dateString, days: z.number().int().min(1).max(365) }),
    z.object({
      kind: z.literal('timed'),
      start: z.string().datetime({ offset: true }),
      timeZone: zone,
      durationMinutes: z.number().int().min(1).max(525600),
    }),
  ])
  .nullable()
export const refSchema = z.object({
  connectionId: z.string().min(1),
  provider: providerSchema,
  resourceId: z.string().min(1),
})
export const taskFieldsSchema = z.object({
  title: z.string(),
  description: z.string(),
  schedule: scheduleSchema,
  completed: z.boolean(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
})
export const ruleSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(100),
    source: refSchema,
    destination: refSchema,
    direction: z.enum(['one-way', 'two-way']),
    fields: z
      .array(fieldSchema)
      .min(1)
      .refine((x) => new Set(x).size === x.length),
    filters: z.object({
      sectionIds: z.array(z.string()),
      labels: z.array(z.string()),
      priorities: z.array(z.number().int().min(1).max(4)),
      datedOnly: z.boolean(),
    }),
    options: z.object({
      timeZone: zone,
      durationMinutes: z.number().int().min(1).max(1440),
      syncAllDay: z.boolean(),
      priorityPrefix: z.boolean(),
      labelPrefixes: z.record(z.string(), z.string()),
      syncComments: z.boolean(),
      conflict: z.enum(['manual', 'source', 'destination']),
      eventDeletion: z.enum(['unlink', 'complete']),
      completion: z.enum(['mark', 'remove']),
      adoptLegacy: z.boolean().default(false),
      maxMutations: z.number().int().min(1).max(10000),
    }),
    notionMapping: z
      .object({
        title: z.string().min(1),
        date: z.string().min(1),
        status: z.string().min(1),
        doneValues: z.array(z.string()).min(1),
        openValue: z.string().min(1),
        doneValue: z.string().min(1),
        priority: z.string().optional(),
        mirrorKey: z.string().optional(),
        description: z.string().optional(),
      })
      .nullable(),
    status: z.enum(['draft', 'active', 'paused', 'blocked']),
  })
  .refine((x) => x.source.provider !== x.destination.provider, 'Choisissez deux outils différents')
  .refine(
    (x) =>
      (x.source.provider !== 'notion' && x.destination.provider !== 'notion') ||
      x.notionMapping !== null,
    'Associez les propriétés Notion',
  )
