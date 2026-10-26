import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getConfig, setSettingsSource } from '../config.js'
import { createTestDb, type Db } from '../db/index.js'
import { getSettings } from '../db/settings.js'
import type { Settings } from '../settings.js'
import { createApp, type AppDeps } from './server.js'

const discover = vi.hoisted(() => vi.fn())
vi.mock('../discovery.js', () => ({ discover }))

const TOKEN = 'test-admin-token-0123456789'
const credentials = `Basic ${Buffer.from(`admin:${TOKEN}`).toString('base64')}`

let db: Db

function app(overrides: Partial<AppDeps> = {}) {
  return createApp({
    db,
    adminToken: TOKEN,
    getEngine: () => undefined,
    onAuthorized: async () => {},
    ...overrides,
  })
}

function request(path: string, init: RequestInit = {}, deps?: Partial<AppDeps>) {
  return app(deps).request(path, {
    ...init,
    headers: { Authorization: credentials, ...init.headers },
  })
}

function put(settings: unknown, deps?: Partial<AppDeps>) {
  return request(
    '/api/settings',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    },
    deps,
  )
}

// Response bodies are asserted field by field; their shape is the subject.
const json = async (response: Response): Promise<any> => response.json()

const settings: Settings = {
  mappings: [
    { todoistProjectId: 'proj-1', googleCalendarId: 'work@group.calendar.google.com' },
    { todoistProjectId: 'proj-3', googleCalendarId: 'new@group.calendar.google.com' },
  ],
  defaultEventDurationMinutes: 30,
  syncForeignEvents: false,
  priorityPrefixes: true,
  labelPrefixes: [{ match: '5min', prefix: '@5min' }],
  syncComments: false,
  maxCompletionsPerSync: 10,
}

beforeEach(() => {
  db = createTestDb()
  setSettingsSource(() => getSettings(db))
  discover.mockReset()
})

afterEach(() => {
  setSettingsSource(() => ({}))
})

describe('/api/state', () => {
  it('reports connections and the settings in effect', async () => {
    const body = await json(await request('/api/state'))

    expect(body.authorized).toEqual({ todoist: false, google: false })
    expect(body.canEdit).toBe(true)
    expect(body.syncing).toBe(false)
    // Straight from the environment until something is saved.
    expect(body.settings.mappings).toHaveLength(2)
    expect(body.webhooks.todoist).toBe('https://sync.test/webhooks/todoist')
  })
})

describe('/api/discovery', () => {
  it('passes the provider lists and errors through', async () => {
    discover.mockResolvedValue({
      projects: [{ id: 'p1', name: 'Work' }],
      calendars: [],
      errors: ['Google: not authorized'],
    })

    const body = await json(await request('/api/discovery'))

    expect(body.projects).toEqual([{ id: 'p1', name: 'Work' }])
    expect(body.errors).toEqual(['Google: not authorized'])
  })
})

describe('PUT /api/settings', () => {
  it('saves, overrides the environment, and reports a mapping change', async () => {
    const onSettingsChanged = vi.fn(async () => {})

    const response = await put(settings, { onSettingsChanged })

    expect(response.status).toBe(200)
    const config = getConfig()
    expect(config.SYNC_MAPPINGS).toEqual(settings.mappings)
    expect(config.DEFAULT_EVENT_DURATION_MINUTES).toBe(30)
    expect(config.SYNC_FOREIGN_EVENTS).toBe(false)
    expect(config.LABEL_PREFIXES).toEqual([{ match: '5min', prefix: '@5min' }])
    expect(onSettingsChanged).toHaveBeenCalledWith({ mappings: true })
  })

  it('does not report a mapping change when only options move', async () => {
    const onSettingsChanged = vi.fn(async () => {})
    await put(settings)

    await put({ ...settings, syncComments: true }, { onSettingsChanged })

    expect(onSettingsChanged).toHaveBeenCalledWith({ mappings: false })
  })

  it('accepts an empty label list rather than restoring the defaults', async () => {
    await put({ ...settings, labelPrefixes: [] })

    expect(getConfig().LABEL_PREFIXES).toEqual([])
  })

  it('refuses a calendar paired with two projects', async () => {
    const response = await put({
      ...settings,
      mappings: [
        { todoistProjectId: 'a', googleCalendarId: 'same@x.com' },
        { todoistProjectId: 'b', googleCalendarId: 'same@x.com' },
      ],
    })

    expect(response.status).toBe(400)
    expect((await json(response)).errors.join()).toContain('mapped more than once')
    expect(getSettings(db)).toEqual({})
  })

  // ":" and "," separate entries in the stored format.
  it('refuses a separator inside a value instead of splitting it', async () => {
    const response = await put({
      ...settings,
      labelPrefixes: [{ match: 'a,b', prefix: '@x' }],
    })

    expect(response.status).toBe(400)
    expect(getSettings(db)).toEqual({})
  })

  it('refuses a malformed body', async () => {
    const response = await put({ mappings: 'nope' })

    expect(response.status).toBe(400)
  })

  it('refuses to save without ADMIN_TOKEN', async () => {
    const response = await put(settings, { adminToken: undefined })

    expect(response.status).toBe(503)
    expect(getSettings(db)).toEqual({})
  })
})

describe('POST /api/resync', () => {
  it('needs a running engine', async () => {
    const response = await request('/api/resync', { method: 'POST' })

    expect(response.status).toBe(409)
  })

  it('starts a full resync in the background', async () => {
    const triggerResyncAll = vi.fn()
    const engine = {
      triggerResyncAll,
      blockedCalendars: [],
      status: { running: true, lastRunAt: undefined, lastError: undefined },
    } as unknown as ReturnType<AppDeps['getEngine']>

    const response = await request('/api/resync', { method: 'POST' }, { getEngine: () => engine })

    expect(response.status).toBe(200)
    expect(triggerResyncAll).toHaveBeenCalledOnce()
  })

  it('refuses without ADMIN_TOKEN', async () => {
    const response = await request('/api/resync', { method: 'POST' }, { adminToken: undefined })

    expect(response.status).toBe(503)
  })
})

describe('old setup pages', () => {
  it.each(['/setup', '/setup/ids', '/admin/resync'])('%s redirects to the UI', async (path) => {
    const response = await request(path)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/')
  })
})

describe('basic auth', () => {
  it.each(['/', '/api/state', '/api/discovery', '/setup/google'])(
    'rejects %s without credentials',
    async (path) => {
      expect((await app().request(path)).status).toBe(401)
    },
  )

  it('rejects a wrong password', async () => {
    const response = await app().request('/api/state', {
      headers: { Authorization: `Basic ${Buffer.from('admin:wrong').toString('base64')}` },
    })

    expect(response.status).toBe(401)
  })

  // The platform healthcheck and the two providers must still get through.
  it('leaves /health open', async () => {
    expect((await app().request('/health')).status).toBe(200)
  })

  it('leaves the Todoist webhook to its own HMAC check', async () => {
    const response = await app().request('/webhooks/todoist', {
      method: 'POST',
      headers: { 'x-todoist-hmac-sha256': 'bogus' },
      body: '{}',
    })

    // 401 from the signature check, not from basic auth.
    expect(await response.text()).toBe('invalid signature')
  })
})
