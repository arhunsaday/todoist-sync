import { z } from 'zod'
import { Temporal } from '@js-temporal/polyfill'
import {
  AppError,
  type ProviderAdapter,
  type Entity,
  type Rule,
  type ResourceRef,
  type TaskFields,
} from '@accord/domain'
import { requestJson, bearer } from '../http'
const itemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  project_id: z.union([z.string(), z.number()]).transform(String),
  section_id: z.union([z.string(), z.number()]).nullable().optional(),
  content: z.string(),
  description: z.string().nullish(),
  priority: z.number().int().min(1).max(4).default(1),
  labels: z.array(z.string()).default([]),
  checked: z.boolean().optional(),
  is_completed: z.boolean().optional(),
  is_deleted: z.boolean().optional(),
  updated_at: z.string().nullish(),
  due: z
    .object({
      date: z.string(),
      timezone: z.string().nullish(),
      is_recurring: z.boolean().optional(),
      string: z.string().nullish(),
      lang: z.string().nullish(),
    })
    .nullish(),
  duration: z.object({ amount: z.number(), unit: z.enum(['minute', 'day']) }).nullish(),
})
export function normalizePriority(value: number): 1 | 2 | 3 | 4 {
  return (5 - value) as 1 | 2 | 3 | 4
}
export const commandTypes = [
  'item_add',
  'item_update',
  'item_move',
  'item_complete',
  'item_uncomplete',
] as const
function normalize(raw: unknown, ref: ResourceRef, rule: Rule): Entity {
  const i = itemSchema.parse(raw)
  let schedule: TaskFields['schedule'] = null
  if (i.due) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(i.due.date))
      schedule = {
        kind: 'date',
        date: i.due.date,
        days: i.duration?.unit === 'day' ? i.duration.amount : 1,
      }
    else {
      const zone = i.due.timezone ?? rule.options.timeZone
      const start = /(Z|[+-]\d\d:\d\d)$/.test(i.due.date)
        ? new Date(i.due.date).toISOString()
        : Temporal.PlainDateTime.from(i.due.date)
            .toZonedDateTime(zone, { disambiguation: 'reject' })
            .toInstant()
            .toString({ fractionalSecondDigits: 3 })
      schedule = {
        kind: 'timed',
        start,
        timeZone: zone,
        durationMinutes: i.duration
          ? i.duration.unit === 'day'
            ? i.duration.amount * 1440
            : i.duration.amount
          : rule.options.durationMinutes,
      }
    }
  }
  return {
    id: i.id,
    ref: { ...ref, resourceId: i.project_id },
    fields: {
      title: i.content,
      description: i.description ?? '',
      completed: i.checked ?? i.is_completed ?? false,
      priority: normalizePriority(i.priority),
      schedule,
    },
    revision: i.updated_at ?? '',
    deleted: i.is_deleted ?? false,
    recurring: i.due?.is_recurring ?? false,
    metadata: {
      labels: JSON.stringify(i.labels),
      sectionId: String(i.section_id ?? ''),
      recurrence: i.due?.string ?? '',
      recurrenceLang: i.due?.lang ?? '',
    },
  }
}
async function uuid(key: string) {
  const hex = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))),
    (x) => x.toString(16).padStart(2, '0'),
  )
    .join('')
    .slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export function createTodoistAdapter(
  connectionId: string,
  tokenProvider: () => Promise<string>,
  rule: Rule,
  fetcher: typeof fetch = fetch,
): ProviderAdapter {
  const base = 'https://api.todoist.com/api/v1'
  async function call<T>(path: string, init: RequestInit = {}) {
    return requestJson<T>(
      base + path,
      { ...init, headers: { ...bearer(await tokenProvider()), ...init.headers } },
      fetcher,
    )
  }
  async function sync<T>(values: Record<string, string>) {
    return call<T>('/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values),
    })
  }
  const a: ProviderAdapter = {
    async discover() {
      const result = await sync<{
        projects: { id: string; name: string; is_archived?: boolean; is_deleted?: boolean }[]
        sections?: { id: string; name: string; project_id: string }[]
        labels?: { name: string }[]
      }>({ sync_token: '*', resource_types: '["projects","sections","labels"]' })
      return result.projects
        .filter((p) => !p.is_archived && !p.is_deleted)
        .map((p) => ({
          name: p.name,
          ref: { connectionId, provider: 'todoist', resourceId: String(p.id) },
          writable: true,
          sections: (result.sections ?? [])
            .filter((s) => String(s.project_id) === String(p.id))
            .map((s) => ({ id: String(s.id), name: s.name })),
          labels: (result.labels ?? []).map((l) => l.name),
        }))
    },
    async changes(ref, cursor) {
      const result = await sync<{
        items: unknown[]
        sync_token: string
        notes?: { item_id: string; content: string; posted_at?: string; is_deleted?: boolean }[]
      }>({ sync_token: cursor ?? '*', resource_types: '["items","notes"]' })
      const items = new Map<string, Entity>()
      for (const raw of result.items) {
        const i = normalize(raw, ref, rule)
        items.set(i.id, i)
      }
      if (rule.options.syncComments) {
        const notes = result.notes ?? []
        for (const note of notes) {
          if (!items.has(note.item_id)) {
            const i = await a.read(ref, note.item_id)
            if (i && i.ref.resourceId === ref.resourceId) items.set(i.id, i)
          }
        }
        for (const entity of items.values()) {
          if (!entity.deleted) {
            const comments = await call<{ results?: { content: string; posted_at?: string }[] }>(
              '/comments?task_id=' + encodeURIComponent(entity.id),
            )
            entity.metadata.comments = (comments.results ?? [])
              .map((x) => (x.posted_at ? x.posted_at.slice(0, 10) + ' · ' : '') + x.content)
              .join('\n')
          }
        }
      }
      return { entities: [...items.values()], nextCursor: result.sync_token, hasMore: false }
    },
    async read(ref, id) {
      try {
        const entity = normalize(await call('/tasks/' + encodeURIComponent(id)), ref, rule)
        if (rule.options.syncComments) {
          const comments: { content: string; posted_at?: string }[] = []
          let cursor: string | undefined
          do {
            const page = await call<{
              results: { content: string; posted_at?: string }[]
              next_cursor?: string | null
            }>(
              '/comments?task_id=' +
                encodeURIComponent(id) +
                (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
            )
            comments.push(...page.results)
            cursor = page.next_cursor ?? undefined
          } while (cursor)
          entity.metadata.comments = comments
            .map((c) => (c.posted_at ? c.posted_at.slice(0, 10) + ' · ' : '') + c.content)
            .join('\n')
        }
        return entity
      } catch (e) {
        if (e instanceof AppError && e.code === 'RESOURCE_UNAVAILABLE') return null
        throw e
      }
    },
    async findMirror() {
      // Todoist deduplicates command UUIDs; mapping is returned again on command replay.
      return null
    },
    async write(ref, id, patch, key) {
      const original = id ? await a.read(ref, id) : null
      const args: Record<string, unknown> = {}
      if (patch.title !== undefined) args.content = patch.title
      if (patch.description !== undefined) args.description = patch.description
      if (patch.priority !== undefined) args.priority = 5 - patch.priority
      if (patch.schedule !== undefined) {
        const s = patch.schedule
        if (original?.recurring && s && !original.metadata.recurrence)
          throw new AppError(
            'RECURRENCE_UNSUPPORTED',
            'La règle de récurrence est indisponible. Modifiez cette occurrence dans Todoist.',
            409,
          )
        args.due = s
          ? {
              date: s.kind === 'date' ? s.date : s.start,
              timezone: s.kind === 'timed' ? s.timeZone : undefined,
              ...(original?.recurring
                ? {
                    string: original.metadata.recurrence,
                    is_recurring: true,
                    lang: original.metadata.recurrenceLang || undefined,
                  }
                : {}),
            }
          : null
        args.duration = s
          ? s.kind === 'date' && s.days > 1
            ? { amount: s.days, unit: 'day' }
            : s.kind === 'timed'
              ? { amount: s.durationMinutes, unit: 'minute' }
              : null
          : null
      }
      const commands: {
        type: string
        uuid: string
        temp_id?: string
        args: Record<string, unknown>
      }[] = []
      const temp = await uuid(key + ':temp')
      if (!id)
        commands.push({
          type: 'item_add',
          uuid: await uuid(key + ':add'),
          temp_id: temp,
          args: { ...args, project_id: ref.resourceId, content: patch.title ?? 'Sans titre' },
        })
      else if (Object.keys(args).length)
        commands.push({
          type: 'item_update',
          uuid: await uuid(key + ':update'),
          args: { id, ...args },
        })
      if (id && original && original.ref.resourceId !== ref.resourceId)
        commands.push({
          type: 'item_move',
          uuid: await uuid(key + ':move'),
          args: { id, project_id: ref.resourceId },
        })
      if (patch.completed !== undefined)
        commands.push({
          type: patch.completed ? 'item_complete' : 'item_uncomplete',
          uuid: await uuid(key + ':complete'),
          args: { id: id ?? temp },
        })
      if (!commands.length) {
        const entity = id ? await a.read(ref, id) : null
        if (!entity) throw new AppError('STALE_ENTITY', 'Tâche introuvable.', 409)
        return entity
      }
      const result = await sync<{
        sync_status: Record<string, 'ok' | { error: string }>
        temp_id_mapping?: Record<string, string>
      }>({ commands: JSON.stringify(commands) })
      for (const cmd of commands) {
        if (result.sync_status?.[cmd.uuid] !== 'ok')
          throw new AppError(
            'COMMAND_FAILED',
            'Todoist a refusé une modification. Vérifiez le projet et les champs.',
            502,
          )
      }
      const newId = id ?? result.temp_id_mapping?.[temp]
      if (!newId)
        throw new AppError(
          'AMBIGUOUS_WRITE',
          'La création demande une vérification avant de réessayer.',
          502,
        )
      const existing = await a.read(ref, newId)
      if (existing) return existing
      return {
        id: newId,
        ref,
        fields: {
          title: 'Sans titre',
          description: '',
          schedule: null,
          completed: false,
          priority: 4,
          ...original?.fields,
          ...patch,
        },
        revision: '',
        deleted: false,
        recurring: false,
        metadata: {},
      }
    },
    async removeMirror() {
      throw new AppError(
        'UNSUPPORTED',
        'Les tâches Todoist ne sont jamais supprimées définitivement.',
        400,
      )
    },
  }
  return a
}
