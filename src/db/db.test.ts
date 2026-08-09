import { beforeEach, describe, expect, it } from 'vitest'

import { createTestDb, type Db } from './index.js'
import * as links from './links.js'
import * as state from './state.js'

let db: Db

beforeEach(() => {
  db = createTestDb()
})

const link = {
  todoistItemId: 'item-1',
  googleEventId: 'event-1',
  googleCalendarId: 'work@group.calendar.google.com',
  todoistProjectId: 'proj-1',
  todoistFingerprint: 'tf-1',
  googleFingerprint: 'gf-1',
}

describe('links', () => {
  it('round-trips a link by either side of the pair', () => {
    links.upsert(db, link)

    expect(links.findByTodoistItemId(db, 'item-1')).toMatchObject(link)
    expect(
      links.findByGoogleEventId(db, 'work@group.calendar.google.com', 'event-1'),
    ).toMatchObject(link)
  })

  it('returns undefined for unknown ids', () => {
    expect(links.findByTodoistItemId(db, 'nope')).toBeUndefined()
    expect(links.findByGoogleEventId(db, 'cal', 'nope')).toBeUndefined()
  })

  // events.move preserves the event id, so changing project must update the
  // existing row rather than leaving a stale one behind on the old calendar.
  it('updates calendar in place when a task moves project', () => {
    links.upsert(db, link)
    links.upsert(db, {
      ...link,
      googleCalendarId: 'personal@group.calendar.google.com',
      todoistProjectId: 'proj-2',
    })

    expect(links.listAll(db)).toHaveLength(1)
    expect(
      links.findByGoogleEventId(db, 'work@group.calendar.google.com', 'event-1'),
    ).toBeUndefined()
    expect(
      links.findByGoogleEventId(
        db,
        'personal@group.calendar.google.com',
        'event-1',
      ),
    ).toMatchObject({ todoistProjectId: 'proj-2' })
  })

  it('rejects two tasks pointing at the same event', () => {
    links.upsert(db, link)

    expect(() => links.upsert(db, { ...link, todoistItemId: 'item-2' })).toThrow(
      /UNIQUE/,
    )
  })

  it('removes links individually and in bulk', () => {
    links.upsert(db, link)
    links.upsert(db, {
      ...link,
      todoistItemId: 'item-2',
      googleEventId: 'event-2',
    })

    links.remove(db, 'item-1')
    expect(links.listAll(db)).toHaveLength(1)

    links.removeAll(db)
    expect(links.listAll(db)).toHaveLength(0)
  })
})

describe('sync cursors', () => {
  it('starts Todoist at * so a cold start is a full sync', () => {
    expect(state.getTodoistSyncToken(db)).toBe('*')

    state.setTodoistSyncToken(db, 'abc')
    expect(state.getTodoistSyncToken(db)).toBe('abc')
  })

  it('keeps Google tokens separate per calendar', () => {
    state.setGoogleSyncToken(db, 'cal-a', 'token-a')
    state.setGoogleSyncToken(db, 'cal-b', 'token-b')

    expect(state.getGoogleSyncToken(db, 'cal-a')).toBe('token-a')
    expect(state.getGoogleSyncToken(db, 'cal-b')).toBe('token-b')
  })

  // A 410 GONE clears one calendar's cursor; the others must keep theirs.
  it('clears a single calendar cursor on 410 recovery', () => {
    state.setGoogleSyncToken(db, 'cal-a', 'token-a')
    state.setGoogleSyncToken(db, 'cal-b', 'token-b')

    state.clearGoogleSyncToken(db, 'cal-a')

    expect(state.getGoogleSyncToken(db, 'cal-a')).toBeUndefined()
    expect(state.getGoogleSyncToken(db, 'cal-b')).toBe('token-b')
  })
})

describe('watch channels', () => {
  const channel = {
    calendarId: 'work@group.calendar.google.com',
    channelId: 'chan-1',
    resourceId: 'res-1',
    token: 'secret-1',
    expiration: 1_000,
  }

  it('looks up by calendar and by inbound channel id', () => {
    state.upsertWatchChannel(db, channel)

    expect(state.getWatchChannel(db, channel.calendarId)).toEqual(channel)
    expect(state.getWatchChannelByChannelId(db, 'chan-1')).toEqual(channel)
  })

  it('replaces the channel on renewal rather than accumulating rows', () => {
    state.upsertWatchChannel(db, channel)
    state.upsertWatchChannel(db, {
      ...channel,
      channelId: 'chan-2',
      resourceId: 'res-2',
      expiration: 2_000,
    })

    expect(state.listWatchChannels(db)).toHaveLength(1)
    expect(state.getWatchChannelByChannelId(db, 'chan-1')).toBeUndefined()
    expect(state.getWatchChannelByChannelId(db, 'chan-2')?.expiration).toBe(2_000)
  })

  it('removes a channel', () => {
    state.upsertWatchChannel(db, channel)
    state.removeWatchChannel(db, channel.calendarId)

    expect(state.listWatchChannels(db)).toHaveLength(0)
  })
})

describe('oauth tokens', () => {
  it('round-trips a Google token pair', () => {
    state.saveToken(db, 'google', {
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt: 5_000,
    })

    expect(state.getToken(db, 'google')).toEqual({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt: 5_000,
    })
  })

  it('stores a Todoist token that has neither refresh nor expiry', () => {
    state.saveToken(db, 'todoist', { accessToken: 'at-1' })

    expect(state.getToken(db, 'todoist')).toEqual({
      accessToken: 'at-1',
      refreshToken: undefined,
      expiresAt: undefined,
    })
  })

  // Google omits refresh_token on refresh responses. Overwriting it with null
  // would silently force a full re-consent the next time the access token dies.
  it('preserves an existing refresh token when the refresh response omits it', () => {
    state.saveToken(db, 'google', {
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt: 5_000,
    })
    state.saveToken(db, 'google', { accessToken: 'at-2', expiresAt: 9_000 })

    expect(state.getToken(db, 'google')).toEqual({
      accessToken: 'at-2',
      refreshToken: 'rt-1',
      expiresAt: 9_000,
    })
  })

  it('keeps providers isolated', () => {
    state.saveToken(db, 'google', { accessToken: 'g' })
    state.saveToken(db, 'todoist', { accessToken: 't' })

    expect(state.getToken(db, 'google')?.accessToken).toBe('g')
    expect(state.getToken(db, 'todoist')?.accessToken).toBe('t')
  })
})

describe('migrations', () => {
  it('is idempotent', () => {
    const before = db
      .prepare<[], { count: number }>(
        'SELECT COUNT(*) AS count FROM schema_migrations',
      )
      .get()

    expect(before?.count).toBe(1)
  })
})
