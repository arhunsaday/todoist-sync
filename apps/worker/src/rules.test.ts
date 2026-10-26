import { env, SELF } from 'cloudflare:test'
import { beforeAll, expect, it, vi } from 'vitest'
import sqlAuth from '../migrations/0001_auth.sql?raw'
import sqlDomain from '../migrations/0002_domain.sql?raw'
import sqlJobs from '../migrations/0003_jobs.sql?raw'
import { sealToken } from './connections/crypto'
import { createTestSession } from './test/session'
import { coordinate } from './jobs/coordinate'
import { makeRule } from '@accord/domain'
let cookie = ''
beforeAll(async () => {
  env.BETTER_AUTH_SECRET = 'test-secret-32-characters-0123456789'
  await env.DB.exec(sqlAuth)
  await env.DB.exec(sqlDomain)
  await env.DB.exec(sqlJobs)
  cookie = await createTestSession(env, 'alice')
})
it('reads a real product session from D1', async () => {
  const r = await SELF.fetch('https://local.test/api/me', { headers: { cookie } })
  expect(r.status).toBe(200)
  expect(await r.json()).toMatchObject({ id: 'alice' })
})
it('refuses resources owned by another customer', async () => {
  const r = makeRule('alice')
  r.source = { provider: 'todoist', connectionId: 'bob-conn', resourceId: 'project' }
  r.destination = { provider: 'google', connectionId: 'bob-google', resourceId: 'calendar' }
  const response = await SELF.fetch('https://local.test/api/rules', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(r),
  })
  expect(response.status).toBe(404)
})
it('does not expose another customer rules', async () => {
  await createTestSession(env, 'bob')
  const rule = makeRule('bob')
  await env.DB.prepare('INSERT INTO rules(id,user_id,revision,status,payload) VALUES(?,?,?,?,?)')
    .bind(rule.id, 'bob', 1, 'draft', JSON.stringify(rule))
    .run()
  const response = await SELF.fetch('https://local.test/api/rules/' + rule.id, {
    headers: { cookie },
  })
  expect(response.status).toBe(404)
})

it('creates a real owned rule and refuses a stale configuration update', async () => {
  let createdEvents = 0
  let event: Record<string, unknown> | null = null
  const task = {
    id: 'task-a',
    project_id: 'project-a',
    content: 'A task',
    priority: 1,
    labels: [],
    checked: false,
    due: { date: '2026-10-06' },
  }
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith('https://api.todoist.com/api/v1/sync'))
      return Response.json({
        projects: [{ id: 'project-a', name: 'Work' }],
        items: [task],
        sync_token: 'todoist-new',
        notes: [],
      })
    if (url.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList'))
      return Response.json({ items: [{ id: 'calendar-a', summary: 'Work', accessRole: 'owner' }] })
    if (url.includes('/api/v1/tasks/task-a')) return Response.json(task)
    if (url.includes('/calendar/v3/calendars/calendar-a/events')) {
      if (init?.method === 'POST' || init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        if (init.method === 'POST') createdEvents++
        event = { ...event, ...body, updated: 'v' + createdEvents }
        return Response.json(event)
      }
      if (url.includes('/events/'))
        return event ? Response.json(event) : new Response('', { status: 404 })
      return Response.json({ items: event ? [event] : [], nextSyncToken: 'google-new' })
    }
    throw new Error('Unmocked outbound request')
  })
  for (const [id, provider] of [
    ['alice-t', 'todoist'],
    ['alice-g', 'google'],
  ]) {
    const tokens = await sealToken(
      { access_token: 'test' },
      env.TOKEN_ENCRYPTION_KEY!,
      'v1',
      `alice:${id}:${provider}`,
    )
    await env.DB.prepare(
      'INSERT INTO connections(id,user_id,provider,name,external_user_id,status,encrypted_tokens,created_at) VALUES(?,?,?,?,?,?,?,?)',
    )
      .bind(id!, 'alice', provider!, provider!, 'ext-' + id, 'connected', tokens, Date.now())
      .run()
  }
  const rule = makeRule('alice')
  rule.source = { provider: 'todoist', connectionId: 'alice-t', resourceId: 'project-a' }
  rule.destination = { provider: 'google', connectionId: 'alice-g', resourceId: 'calendar-a' }
  const request = (method: string, body: unknown, path = '/api/rules') =>
    SELF.fetch('https://local.test' + path, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const created = await request('POST', rule)
  expect(created.status).toBe(200)
  const changed = await request('PATCH', { ...rule, name: 'Updated' }, '/api/rules/' + rule.id)
  expect(changed.status).toBe(200)
  const stale = await request('PATCH', { ...rule, name: 'Overwrite' }, '/api/rules/' + rule.id)
  expect(stale.status).toBe(409)
  const loaded = await SELF.fetch('https://local.test/api/rules/' + rule.id, {
    headers: { cookie },
  })
  expect(await loaded.json()).toMatchObject({ name: 'Updated', revision: 2 })
  const preview = await request('POST', {}, '/api/rules/' + rule.id + '/preview')
  expect(preview.status).toBe(200)
  const p = (await preview.json()) as { token: string; revision: number }
  expect(createdEvents).toBe(0)
  expect(
    (
      await request(
        'POST',
        { token: p.token, revision: p.revision },
        '/api/rules/' + rule.id + '/activate',
      )
    ).status,
  ).toBe(200)
  await coordinate(env, 'alice', 'sync')
  expect(createdEvents).toBe(1)
  expect(event).toMatchObject({ summary: 'A task' })
  task.content = 'A renamed task'
  await coordinate(env, 'alice', 'sync')
  expect(createdEvents).toBe(1)
  expect(event).toMatchObject({ summary: 'A renamed task' })
  network.mockRestore()
})
