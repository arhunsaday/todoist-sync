import { expect, it } from 'vitest'
import {
  createGoogleAdapter,
  createTodoistAdapter,
  normalizePriority,
  validateNotionMapping,
  createNotionAdapter,
} from './index'
import type { Rule, ResourceRef } from '@accord/domain'
import { makeRule } from '@accord/domain'
const ref: ResourceRef = { provider: 'google', connectionId: 'g', resourceId: 'cal' }
it('Google resets expired cursor and paginates without dropping events', async () => {
  let n = 0
  const f: typeof fetch = async () => {
    n++
    if (n === 1) return new Response('', { status: 410 })
    return Response.json(
      n === 2
        ? {
            items: [
              {
                id: '1',
                summary: 'First',
                start: { date: '2026-10-06' },
                end: { date: '2026-10-07' },
              },
            ],
            nextPageToken: 'page2',
          }
        : {
            items: [
              {
                id: '2',
                summary: 'Second',
                start: { date: '2026-10-07' },
                end: { date: '2026-10-08' },
              },
            ],
            nextSyncToken: 'new',
          },
    )
  }
  const a = createGoogleAdapter('g', async () => 'token', makeRule('u'), f)
  const changes = await a.changes(ref, 'expired')
  expect(changes.entities.map((e) => e.id)).toEqual(['1', '2'])
  expect(changes.nextCursor).toBe('new')
})
it('Todoist rejects per-command failure under HTTP 200', async () => {
  const f: typeof fetch = async (_url, init) => {
    const body = new URLSearchParams(String(init?.body))
    const cmds = JSON.parse(body.get('commands') ?? '[]')
    return Response.json({ sync_status: { [cmds[0].uuid]: { error: 'Invalid project' } } })
  }
  const a = createTodoistAdapter('t', async () => 'token', makeRule('u'), f)
  await expect(
    a.write(
      { provider: 'todoist', connectionId: 't', resourceId: 'p' },
      null,
      { title: 'Task' },
      'stable',
    ),
  ).rejects.toThrow()
})
it('Todoist priority reflects UI order', () => {
  expect(normalizePriority(4)).toBe(1)
  expect(normalizePriority(1)).toBe(4)
})
it('Notion property names may change while ids stay stable', () => {
  const m = {
    title: 't',
    date: 'd',
    status: 's',
    doneValues: ['Done'],
    openValue: 'Open',
    doneValue: 'Done',
  }
  expect(
    validateNotionMapping(
      [
        { id: 't', name: 'Name', type: 'title' },
        { id: 'd', name: 'Renamed', type: 'date' },
        { id: 's', name: 'Status', type: 'status', options: ['Open', 'Done'] },
      ],
      m,
    ),
  ).toEqual([])
})
it('Notion inaccessible page is not a deletion', async () => {
  const a = createNotionAdapter(
    'n',
    async () => 'token',
    makeRule('u'),
    async () => new Response('', { status: 404 }),
  )
  await expect(
    a.read({ provider: 'notion', connectionId: 'n', resourceId: 'ds' }, 'page'),
  ).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' })
})
it('blocks queued Notion reads if a mapped date property was removed', async () => {
  const rule = makeRule('u')
  rule.notionMapping = {
    title: 't',
    date: 'd',
    status: 's',
    doneValues: ['Done'],
    openValue: 'Open',
    doneValue: 'Done',
  }
  const fetcher: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('/data_sources/'))
      return Response.json({
        id: 'ds',
        title: [],
        properties: {
          Name: { id: 't', type: 'title' },
          Status: {
            id: 's',
            type: 'status',
            status: { options: [{ name: 'Open' }, { name: 'Done' }] },
          },
        },
      })
    return Response.json({
      id: 'p',
      last_edited_time: 'v1',
      properties: {
        Name: { id: 't', type: 'title', title: [{ plain_text: 'Task' }] },
        Status: { id: 's', type: 'status', status: { name: 'Open' } },
      },
    })
  }
  await expect(
    createNotionAdapter('n', async () => 'token', rule, fetcher).read(
      { provider: 'notion', connectionId: 'n', resourceId: 'ds' },
      'p',
    ),
  ).rejects.toMatchObject({ code: 'NOTION_MAPPING' })
})
it('preserves Todoist recurrence when rescheduling one occurrence', async () => {
  let writtenDue: unknown = null
  const task = {
    id: 'task',
    project_id: 'p',
    content: 'Recurring',
    checked: false,
    labels: [],
    priority: 1,
    due: { date: '2026-10-06', string: 'every day', lang: 'en', is_recurring: true },
  }
  const f: typeof fetch = async (_url, init) => {
    if (init?.method === 'POST') {
      const commands = JSON.parse(
        new URLSearchParams(String(init.body)).get('commands') ?? '[]',
      ) as { uuid: string; args: { due?: unknown } }[]
      writtenDue = commands[0]?.args.due
      return Response.json({ sync_status: Object.fromEntries(commands.map((c) => [c.uuid, 'ok'])) })
    }
    return Response.json(task)
  }
  await createTodoistAdapter('t', async () => 'token', makeRule('u'), f).write(
    { provider: 'todoist', connectionId: 't', resourceId: 'p' },
    'task',
    { schedule: { kind: 'date', date: '2026-10-07', days: 1 } },
    'update-key',
  )
  expect(writtenDue).toMatchObject({
    date: '2026-10-07',
    string: 'every day',
    is_recurring: true,
    lang: 'en',
  })
})
it('recreates an app-removed Google mirror with a fresh stable event id', async () => {
  let created = 0
  const rule = makeRule('u')
  const ref = { provider: 'google' as const, connectionId: 'g', resourceId: 'cal' }
  const fake: typeof fetch = async (_url, init) => {
    if (init?.method === 'POST') {
      created++
      return Response.json({
        ...JSON.parse(String(init.body)),
        status: 'confirmed',
        updated: 'new',
      })
    }
    return new Response('', { status: 410 })
  }
  const result = await createGoogleAdapter('g', async () => 'token', rule, fake).write(
    ref,
    'removed-event',
    {
      title: 'Restored',
      schedule: { kind: 'date', date: '2026-10-06', days: 1 },
      completed: false,
    },
    'new-operation',
    { allowRecreate: true, groupId: 'original-group' },
  )
  expect(created).toBe(1)
  expect(result.deleted).toBe(false)
  expect(result.metadata.accordKey).toBe('original-group')
  expect(result.id).not.toBe('removed-event')
})

it('blocks Notion mirror recovery when a mapped date property was removed', async () => {
  const rule = makeRule('u')
  rule.notionMapping = {
    title: 't',
    date: 'd',
    status: 's',
    mirrorKey: 'k',
    doneValues: ['Done'],
    openValue: 'Open',
    doneValue: 'Done',
  }
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith('/query'))
      return Response.json({
        results: [
          {
            id: 'p',
            last_edited_time: 'v1',
            properties: {
              Name: { id: 't', type: 'title', title: [{ plain_text: 'Task' }] },
              Status: { id: 's', type: 'status', status: { name: 'Open' } },
            },
          },
        ],
      })
    return Response.json({
      id: 'ds',
      title: [],
      properties: {
        Name: { id: 't', type: 'title' },
        Status: {
          id: 's',
          type: 'status',
          status: { options: [{ name: 'Open' }, { name: 'Done' }] },
        },
        Key: { id: 'k', type: 'rich_text' },
      },
    })
  }
  await expect(
    createNotionAdapter('n', async () => 'token', rule, fetcher).findMirror(
      { provider: 'notion', connectionId: 'n', resourceId: 'ds' },
      'key',
    ),
  ).rejects.toMatchObject({ code: 'NOTION_MAPPING' })
})
