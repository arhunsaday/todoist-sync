import {
  AppError,
  toEventSchedule,
  type ProviderAdapter,
  type Entity,
  type Rule,
  type ResourceRef,
  type TaskFields,
} from '@accord/domain'
import { requestJson, bearer } from '../http'
interface GoogleEvent {
  id: string
  summary?: string
  description?: string
  status?: string
  updated?: string
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string }
  recurrence?: string[]
  recurringEventId?: string
  eventType?: string
  attendees?: { self?: boolean; responseStatus?: string }[]
  extendedProperties?: { private?: Record<string, string> }
}
function normalized(e: GoogleEvent, ref: ResourceRef, rule: Rule): Entity {
  const privateData = e.extendedProperties?.private ?? {}
  const summary = e.summary ?? ''
  const title =
    summary === privateData.accordRenderedTitle
      ? (privateData.accordOriginalTitle ?? summary)
      : summary.replace(privateData.accordPrefix ?? '\0', '')
  let schedule: TaskFields['schedule'] = null
  if (e.start?.date) {
    const days = Math.max(
      1,
      Math.round((Date.parse(e.end?.date ?? e.start.date) - Date.parse(e.start.date)) / 86400000),
    )
    schedule = { kind: 'date', date: e.start.date, days }
  } else if (e.start?.dateTime)
    schedule = {
      kind: 'timed',
      start: new Date(e.start.dateTime).toISOString(),
      timeZone: e.start.timeZone ?? rule.options.timeZone,
      durationMinutes: Math.max(
        1,
        Math.round(
          (Date.parse(e.end?.dateTime ?? e.start.dateTime) - Date.parse(e.start.dateTime)) / 60000,
        ),
      ),
    }
  return {
    id: e.id,
    ref,
    fields: {
      title,
      description: (e.description ?? '').split('\n─────── Todoist comments ───────')[0] ?? '',
      schedule,
      completed: privateData.accordCompleted === 'true',
      priority: Number(privateData.accordPriority ?? 4) as 1 | 2 | 3 | 4,
    },
    revision: e.updated ?? '',
    deleted: e.status === 'cancelled',
    recurring: !!(e.recurrence?.length || e.recurringEventId),
    metadata: {
      ...privateData,
      comments: (e.description ?? '').split('\n─────── Todoist comments ───────\n')[1] ?? '',
      rawTitle: summary,
      skip:
        (e.eventType && e.eventType !== 'default') ||
        e.attendees?.some((a) => a.self && a.responseStatus === 'declined')
          ? 'true'
          : 'false',
    },
  }
}
async function stableId(key: string) {
  return (
    'accord' +
    Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))),
      (x) => x.toString(16).padStart(2, '0'),
    ).join('')
  )
}
export function createGoogleAdapter(
  connectionId: string,
  tokenProvider: () => Promise<string>,
  rule: Rule,
  fetcher: typeof fetch = fetch,
): ProviderAdapter {
  const base = 'https://www.googleapis.com/calendar/v3'
  async function call<T>(path: string, init: RequestInit = {}) {
    return requestJson<T>(
      base + path,
      { ...init, headers: { ...bearer(await tokenProvider()), ...init.headers } },
      fetcher,
    )
  }
  const path = (r: ResourceRef) => '/calendars/' + encodeURIComponent(r.resourceId) + '/events'
  const normalize = (e: GoogleEvent, r: ResourceRef) => normalized(e, r, rule)
  const adapter: ProviderAdapter = {
    async discover() {
      const list: import('@accord/domain').ProviderResource[] = []
      let page = ''
      do {
        const result = await call<{
          items: { id: string; summary: string; accessRole: string }[]
          nextPageToken?: string
        }>(
          '/users/me/calendarList?maxResults=250' +
            (page ? '&pageToken=' + encodeURIComponent(page) : ''),
        )
        list.push(
          ...result.items.map((x) => ({
            name: x.summary,
            ref: { provider: 'google' as const, connectionId, resourceId: x.id },
            writable: ['owner', 'writer'].includes(x.accessRole),
          })),
        )
        page = result.nextPageToken ?? ''
      } while (page)
      return list
    },
    async changes(ref, cursor) {
      const entities: Entity[] = []
      let page = '',
        nextCursor: string | null = null,
        reset = false
      do {
        const query = new URLSearchParams({ maxResults: '250', showDeleted: 'true' })
        if (cursor) query.set('syncToken', cursor)
        if (page) query.set('pageToken', page)
        let result: { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }
        try {
          result = await call(path(ref) + '?' + query)
        } catch (e) {
          if (e instanceof AppError && e.code === 'CURSOR_EXPIRED' && !reset) {
            cursor = null
            page = ''
            reset = true
            entities.length = 0
            continue
          }
          throw e
        }
        entities.push(...(result.items ?? []).map((x) => normalize(x, ref)))
        page = result.nextPageToken ?? ''
        nextCursor = result.nextSyncToken ?? nextCursor
      } while (page || (reset && nextCursor === null))
      return {
        entities: entities.filter(
          (e) =>
            e.metadata.skip !== 'true' &&
            (!e.metadata.accordUserId || e.metadata.accordUserId === rule.userId),
        ),
        nextCursor,
        hasMore: false,
      }
    },
    async read(ref, id) {
      try {
        return normalize(await call<GoogleEvent>(path(ref) + '/' + encodeURIComponent(id)), ref)
      } catch (e) {
        if (e instanceof AppError && e.code === 'CURSOR_EXPIRED')
          return {
            id,
            ref,
            fields: { title: '', description: '', schedule: null, completed: false, priority: 4 },
            deleted: true,
            recurring: false,
            revision: '',
            metadata: {},
          }
        if (e instanceof AppError && e.code === 'RESOURCE_UNAVAILABLE') return null
        throw e
      }
    },
    async findMirror(ref, key, legacyTodoistId) {
      const id = await stableId(key)
      const existing = await adapter.read(ref, id)
      if (existing?.metadata.accordUserId && existing.metadata.accordUserId !== rule.userId)
        throw new AppError(
          'FOREIGN_MIRROR',
          'Cet événement appartient à un autre espace Accord.',
          409,
        )
      if (existing || !rule.options.adoptLegacy || !legacyTodoistId) return existing
      const query = new URLSearchParams()
      query.append('privateExtendedProperty', 'managedBy=t2gc')
      query.append('privateExtendedProperty', 'todoistId=' + legacyTodoistId)
      const found = await call<{ items?: GoogleEvent[] }>(path(ref) + '?' + query)
      if ((found.items?.length ?? 0) > 1)
        throw new AppError(
          'DUPLICATE_MIRROR',
          'Plusieurs événements anciens correspondent à cette tâche.',
          409,
        )
      return found.items?.[0] ? normalize(found.items[0], ref) : null
    },
    async write(ref, id, patch, key, context) {
      const old = id ? await adapter.read(ref, id) : null
      if (old?.deleted || (!old && context?.allowRecreate)) id = null
      if (old?.metadata.accordUserId && old.metadata.accordUserId !== rule.userId)
        throw new AppError(
          'FOREIGN_MIRROR',
          'Cet événement appartient à un autre espace Accord.',
          409,
        )
      if (id && !old)
        throw new AppError(
          'STALE_ENTITY',
          'L’événement n’existe plus. Prévisualisez la règle à nouveau.',
          409,
        )
      const fields: TaskFields = {
        title: 'Sans titre',
        description: '',
        schedule: null,
        completed: false,
        priority: 4,
        ...old?.fields,
        ...patch,
      }
      if (!fields.schedule) {
        if (id) await adapter.removeMirror(ref, id)
        return {
          id: id ?? (await stableId(key)),
          ref,
          fields,
          revision: '',
          deleted: false,
          recurring: false,
          metadata: {},
        }
      }
      const priorityPrefix =
        rule.options.priorityPrefix && fields.priority < 4 ? '!p' + fields.priority + ' ' : ''
      const completionPrefix = fields.completed ? '✓ ' : ''
      const labelPrefix = (context?.labels ?? [])
        .flatMap((l) => (rule.options.labelPrefixes[l] ? [rule.options.labelPrefixes[l]] : []))
        .join(' ')
      const rendered =
        completionPrefix +
        priorityPrefix +
        (labelPrefix ? labelPrefix + ' ' : '') +
        fields.title.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      const body: Record<string, unknown> = {
        summary: rendered,
        description: fields.description,
        ...toEventSchedule(fields.schedule),
        extendedProperties: {
          private: {
            ...Object.fromEntries(
              Object.entries(old?.metadata ?? {}).filter(
                ([k]) => k.startsWith('accord') || ['managedBy', 'todoistId'].includes(k),
              ),
            ),
            accordKey: context?.groupId ?? old?.metadata.accordKey ?? key,
            accordRuleId: rule.id,
            accordUserId: rule.userId,
            accordTitleHash: (await stableId(rendered)).slice(6),
            accordOriginalTitle: fields.title.slice(0, 1024),
            accordRenderedTitle: rendered.slice(0, 1024),
            accordPrefix:
              completionPrefix + priorityPrefix + (labelPrefix ? labelPrefix + ' ' : ''),
            accordCompleted: String(fields.completed),
            accordPriority: String(fields.priority),
            accordLabelPrefix: labelPrefix,
          },
        },
      }
      if (fields.completed && rule.options.completion === 'remove') {
        if (id) await adapter.removeMirror(ref, id)
        return {
          id: id ?? (await stableId(key)),
          ref,
          fields,
          revision: '',
          deleted: false,
          recurring: false,
          metadata: {},
        }
      }
      if (!id) body.id = await stableId(key)
      let result: GoogleEvent
      try {
        result = await call(path(ref) + (id ? '/' + encodeURIComponent(id) : ''), {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        })
      } catch (e) {
        if (!id) {
          const mirror = await adapter.findMirror(ref, key)
          if (mirror) return mirror
        }
        throw e
      }
      return normalize(result, ref)
    },
    async removeMirror(ref, id) {
      await call(path(ref) + '/' + encodeURIComponent(id), { method: 'DELETE' })
    },
  }
  return adapter
}
