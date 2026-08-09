import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDb, type Db } from '../db/index.js'
import { saveToken } from '../db/state.js'
import { createApp, type AppDeps } from './server.js'

const discover = vi.hoisted(() => vi.fn())
vi.mock('../discovery.js', () => ({ discover }))

let db: Db

function app() {
  return createApp({
    db,
    getEngine: () => undefined,
    onAuthorized: async () => {},
  })
}

beforeEach(() => {
  db = createTestDb()
  discover.mockReset()
  discover.mockResolvedValue({
    projects: [
      { id: '6Jf837qfR3px2795', name: 'Work' },
      { id: '6Jf837qfR3px2796', name: 'Personal' },
    ],
    calendars: [
      { id: 'c_abc123@group.calendar.google.com', name: 'Work Cal' },
      { id: 'me@example.com', name: 'Personal Cal' },
    ],
    errors: [],
  })
})

describe('/setup/ids', () => {
  it('lists both sets of ids', async () => {
    const html = await (await app().request('/setup/ids')).text()

    expect(html).toContain('6Jf837qfR3px2795')
    expect(html).toContain('c_abc123@group.calendar.google.com')
    expect(html).toContain('Todoist projects')
    expect(html).toContain('Google calendars')
  })

  it('renders one picker per project so the mapping can be assembled', async () => {
    const html = await (await app().request('/setup/ids')).text()

    expect(html).toContain('Build SYNC_MAPPINGS')
    expect(html.match(/data-project=/g)).toHaveLength(2)
  })

  // Project and calendar names are user-controlled strings echoed into HTML.
  it('escapes names rather than injecting them as markup', async () => {
    discover.mockResolvedValue({
      projects: [{ id: 'p1', name: '<script>alert(1)</script>' }],
      calendars: [{ id: 'c1', name: 'Cal "quoted" & <b>bold</b>' }],
      errors: [],
    })

    const html = await (await app().request('/setup/ids')).text()

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<b>bold</b>')
  })

  it('surfaces a provider failure without hiding the other provider', async () => {
    discover.mockResolvedValue({
      projects: [{ id: 'p1', name: 'Work' }],
      calendars: [],
      errors: ['Google: No Google token. Visit /setup/google to authorize.'],
    })

    const html = await (await app().request('/setup/ids')).text()

    expect(html).toContain('No Google token')
    expect(html).toContain('Work')
  })

  it('omits the builder when one side has nothing to pair with', async () => {
    discover.mockResolvedValue({ projects: [], calendars: [], errors: [] })

    const html = await (await app().request('/setup/ids')).text()

    expect(html).not.toContain('Build SYNC_MAPPINGS')
    expect(html).toContain('(none found)')
  })
})

describe('/health', () => {
  // Must stay 200 before setup is complete, or the platform restart-loops the
  // container and /setup can never be reached to fix it.
  it('returns 200 and awaiting-setup before authorization', async () => {
    const response = await app().request('/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'awaiting-setup',
      authorized: { todoist: false, google: false },
    })
  })

  it('reports which providers are authorized', async () => {
    saveToken(db, 'google', { accessToken: 'a', refreshToken: 'r' })
    const body = (await (await app().request('/health')).json()) as {
      authorized: { google: boolean; todoist: boolean }
    }

    expect(body.authorized.google).toBe(true)
    expect(body.authorized.todoist).toBe(false)
  })
})

describe('/setup', () => {
  it('shows the three steps with their status', async () => {
    const html = await (await app().request('/setup')).text()

    expect(html).toContain('Authorize Todoist')
    expect(html).toContain('Authorize Google Calendar')
    expect(html).toContain('SYNC_MAPPINGS')
  })
})

// ADMIN_TOKEN is unset in the test environment, which is the unprotected
// configuration — /admin must refuse to work at all in that state rather than
// exposing an unauthenticated trigger for calendar writes.
describe('/admin without ADMIN_TOKEN', () => {
  it('refuses the confirmation page', async () => {
    const response = await app().request('/admin/resync')

    expect(response.status).toBe(503)
    expect(await response.text()).toContain('ADMIN_TOKEN')
  })

  it('refuses to run a resync', async () => {
    const response = await app().request('/admin/resync', { method: 'POST' })

    expect(response.status).toBe(503)
  })
})

describe('/admin/resync', () => {
  // A GET that mutated would be fired by link scanners and browser prefetch.
  it('only confirms on GET, never acts', async () => {
    const resync = vi.fn()
    const app = createApp({
      db,
      getEngine: () =>
        ({ triggerResyncAll: resync }) as unknown as ReturnType<
          AppDeps['getEngine']
        >,
      onAuthorized: async () => {},
    })

    await app.request('/admin/resync')

    expect(resync).not.toHaveBeenCalled()
  })
})
