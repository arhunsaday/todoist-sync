import {
  AppError,
  type ProviderAdapter,
  type Entity,
  type Rule,
  type ResourceRef,
  type TaskFields,
  type ProviderResource,
} from '@accord/domain'
import { requestJson, bearer } from '../http'
interface TextItem {
  plain_text?: string
  text?: { content: string }
}
interface Property {
  id: string
  name?: string
  type: string
  title?: TextItem[]
  rich_text?: TextItem[]
  date?: { start: string; end?: string | null; time_zone?: string | null } | null
  status?: { name?: string; options?: { name: string }[] } | null
  select?: { name?: string; options?: { name: string }[] } | null
  number?: number | null
}
interface Page {
  id: string
  last_edited_time: string
  archived?: boolean
  in_trash?: boolean
  properties: Record<string, Property>
}
interface DataSource {
  id: string
  title?: TextItem[]
  properties: Record<string, Property>
}
const text = (xs: TextItem[] | undefined) =>
  xs?.map((x) => x.plain_text ?? x.text?.content ?? '').join('') ?? ''
function properties(source: DataSource) {
  return Object.entries(source.properties).map(([name, p]) => ({
    id: p.id,
    name: p.name ?? name,
    type: p.type,
    options: p.status?.options?.map((x) => x.name) ?? p.select?.options?.map((x) => x.name),
  }))
}
export function validateNotionMapping(
  props: NonNullable<ProviderResource['properties']>,
  mapping: Rule['notionMapping'],
) {
  const issues: { path: string; message: string }[] = []
  if (!mapping) return [{ path: 'notionMapping', message: 'Associez les propriétés Notion.' }]
  for (const [name, types] of [
    ['title', ['title']],
    ['date', ['date']],
    ['status', ['status', 'select']],
    ['priority', ['number']],
    ['description', ['rich_text']],
    ['mirrorKey', ['rich_text']],
  ] as const) {
    const id = (mapping as unknown as Record<string, string | undefined>)[name]
    if ((name === 'priority' || name === 'description' || name === 'mirrorKey') && !id) continue
    const p = props.find((p) => p.id === id)
    if (!p || !types.some((t) => t === p.type))
      issues.push({ path: name, message: 'La propriété ' + name + ' est absente ou incompatible.' })
  }
  const status = props.find((p) => p.id === mapping.status)
  if (
    status?.options &&
    ![mapping.openValue, mapping.doneValue, ...mapping.doneValues].every((x) =>
      status.options!.includes(x),
    )
  )
    issues.push({ path: 'status', message: 'Choisissez des valeurs de statut existantes.' })
  if (mapping.description && mapping.description === mapping.mirrorKey)
    issues.push({
      path: 'description',
      message: 'La description et Accord ID doivent être deux propriétés distinctes.',
    })
  return issues
}
export function createNotionAdapter(
  connectionId: string,
  tokenProvider: () => Promise<string>,
  rule: Rule,
  fetcher: typeof fetch = fetch,
): ProviderAdapter {
  async function call<T>(path: string, init: RequestInit = {}) {
    try {
      return await requestJson<T>(
        'https://api.notion.com/v1' + path,
        {
          ...init,
          headers: {
            ...bearer(await tokenProvider()),
            'Notion-Version': '2025-09-03',
            ...init.headers,
          },
        },
        fetcher,
      )
    } catch (e) {
      if (e instanceof AppError && e.code === 'RESOURCE_UNAVAILABLE')
        throw new AppError(
          'RECONNECT_REQUIRED',
          'Cette page Notion est inaccessible. Vérifiez les accès de la connexion.',
          409,
        )
      throw e
    }
  }
  function mapping() {
    if (!rule.notionMapping)
      throw new AppError(
        'NOTION_MAPPING',
        'Associez les propriétés Notion avant de continuer.',
        409,
      )
    return rule.notionMapping
  }
  function normalize(p: Page, ref: ResourceRef): Entity {
    const m = mapping(),
      values = Object.values(p.properties),
      get = (id: string | undefined) => values.find((v) => v.id === id)
    const date = get(m.date)?.date
    let schedule: TaskFields['schedule'] = null
    if (date) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date.start)) {
        schedule = {
          kind: 'date',
          date: date.start,
          days: date.end
            ? Math.max(
                1,
                Math.round((Date.parse(date.end) - Date.parse(date.start)) / 86400000) + 1,
              )
            : 1,
        }
      } else {
        if (!/(Z|[+-]\d\d:\d\d)$/.test(date.start))
          throw new AppError('INVALID_DATE', 'Le fuseau horaire Notion doit être explicite.', 409)
        schedule = {
          kind: 'timed',
          start: new Date(date.start).toISOString(),
          timeZone: date.time_zone ?? rule.options.timeZone,
          durationMinutes: date.end
            ? Math.max(1, Math.round((Date.parse(date.end) - Date.parse(date.start)) / 60000))
            : rule.options.durationMinutes,
        }
      }
    }
    const status = get(m.status)?.status?.name ?? get(m.status)?.select?.name ?? ''
    const priority = get(m.priority)?.number ?? 4
    if (![1, 2, 3, 4].includes(priority))
      throw new AppError(
        'NOTION_MAPPING',
        'La priorité Notion doit être comprise entre 1 et 4.',
        409,
      )
    return {
      id: p.id,
      ref,
      fields: {
        title: text(get(m.title)?.title),
        description: text(get(m.description)?.rich_text),
        schedule,
        completed: m.doneValues.includes(status),
        priority: priority as 1 | 2 | 3 | 4,
      },
      revision: p.last_edited_time,
      deleted: p.archived === true || p.in_trash === true,
      recurring: false,
      metadata: { accordKey: text(get(m.mirrorKey)?.rich_text) },
    }
  }
  async function validate(ref: ResourceRef) {
    const ds = await call<DataSource>('/data_sources/' + encodeURIComponent(ref.resourceId))
    const issues = validateNotionMapping(properties(ds), mapping())
    if (issues.length)
      throw new AppError('NOTION_MAPPING', issues.map((x) => x.message).join(' '), 409)
    return ds
  }
  const a: ProviderAdapter = {
    async discover() {
      const result: ProviderResource[] = []
      let cursor: string | undefined
      do {
        const list = await call<{
          results: { id: string }[]
          next_cursor: string | null
          has_more: boolean
        }>('/search', {
          method: 'POST',
          body: JSON.stringify({
            filter: { property: 'object', value: 'data_source' },
            page_size: 100,
            start_cursor: cursor,
          }),
        })
        for (const item of list.results) {
          const ds = await call<DataSource>('/data_sources/' + encodeURIComponent(item.id))
          result.push({
            name: text(ds.title) || 'Sans titre',
            ref: { connectionId, provider: 'notion', resourceId: ds.id },
            writable: true,
            properties: properties(ds),
          })
        }
        cursor = list.has_more ? (list.next_cursor ?? undefined) : undefined
      } while (cursor)
      return result
    },
    async changes(ref) {
      await validate(ref)
      let cursor: string | undefined
      const entities: Entity[] = []
      do {
        const result = await call<{
          results: Page[]
          has_more: boolean
          next_cursor: string | null
        }>('/data_sources/' + encodeURIComponent(ref.resourceId) + '/query', {
          method: 'POST',
          body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
        })
        entities.push(...result.results.map((x) => normalize(x, ref)))
        cursor = result.has_more ? (result.next_cursor ?? undefined) : undefined
      } while (cursor)
      return { entities, nextCursor: null, hasMore: false }
    },
    async read(ref, id) {
      await validate(ref)
      const page = await call<Page>('/pages/' + encodeURIComponent(id))
      return normalize(page, ref)
    },
    async findMirror(ref, key) {
      const m = mapping()
      if (!m.mirrorKey)
        throw new AppError(
          'NOTION_MAPPING',
          'Choisissez une propriété texte Accord ID pour créer des pages sans doublon.',
          409,
        )
      const result = await call<{ results: Page[] }>(
        '/data_sources/' + encodeURIComponent(ref.resourceId) + '/query',
        {
          method: 'POST',
          body: JSON.stringify({
            filter: { property: m.mirrorKey, rich_text: { equals: key } },
            page_size: 2,
          }),
        },
      )
      if (result.results.length > 1)
        throw new AppError(
          'DUPLICATE_MIRROR',
          'Deux pages utilisent la même clé Accord. Vérifiez-les avant de reprendre.',
          409,
        )
      return result.results[0] ? normalize(result.results[0], ref) : null
    },
    async write(ref, id, patch, key) {
      const ds = await validate(ref),
        m = mapping()
      if (!id && !m.mirrorKey)
        throw new AppError(
          'NOTION_MAPPING',
          'Choisissez la propriété Accord ID pour autoriser les créations.',
          409,
        )
      const values: Record<string, unknown> = {}
      if (patch.title !== undefined)
        values[m.title] = { title: [{ text: { content: patch.title } }] }
      if (patch.description !== undefined && m.description)
        values[m.description] = { rich_text: [{ text: { content: patch.description } }] }
      if (patch.completed !== undefined) {
        const p = Object.values(ds.properties).find((x) => x.id === m.status)!
        values[m.status] = { [p.type]: { name: patch.completed ? m.doneValue : m.openValue } }
      }
      if (patch.priority !== undefined && m.priority)
        values[m.priority] = { number: patch.priority }
      if (patch.schedule !== undefined) {
        const s = patch.schedule
        if (!s) values[m.date] = { date: null }
        else if (s.kind === 'timed')
          values[m.date] = {
            date: {
              start: s.start,
              end: new Date(Date.parse(s.start) + s.durationMinutes * 60000).toISOString(),
            },
          }
        else {
          const end = new Date(s.date + 'T00:00:00Z')
          end.setUTCDate(end.getUTCDate() + s.days - 1)
          values[m.date] = {
            date: { start: s.date, end: s.days > 1 ? end.toISOString().slice(0, 10) : null },
          }
        }
      }
      if (m.mirrorKey && !id) values[m.mirrorKey] = { rich_text: [{ text: { content: key } }] }
      const page = await call<Page>('/pages' + (id ? '/' + encodeURIComponent(id) : ''), {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(
          id
            ? { properties: values }
            : {
                parent: { type: 'data_source_id', data_source_id: ref.resourceId },
                properties: values,
              },
        ),
      })
      return normalize(page, ref)
    },
    async removeMirror() {
      throw new AppError('UNSUPPORTED', 'Les pages Notion ne sont pas supprimées par Accord.', 400)
    },
  }
  return a
}
