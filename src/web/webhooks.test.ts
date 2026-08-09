import { createHmac } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import { createTestDb, type Db } from '../db/index.js'
import { upsertWatchChannel } from '../db/state.js'
import { classifyNotification } from './google-webhook.js'
import { consumeState, issueState } from './setup.js'
import { isValidSignature } from './todoist-webhook.js'

// Matches TODOIST_CLIENT_SECRET in vitest.config.ts.
const SECRET = 'test-todoist-secret'

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64')
}

describe('Todoist webhook signature', () => {
  const body = '{"event_name":"item:added","event_data":{"id":"123"}}'

  it('accepts a correctly signed body', () => {
    expect(isValidSignature(body, sign(body))).toBe(true)
  })

  it('rejects a tampered body', () => {
    const signature = sign(body)
    expect(isValidSignature(body.replace('123', '456'), signature)).toBe(false)
  })

  it('rejects a signature made with the wrong secret', () => {
    expect(isValidSignature(body, sign(body, 'not-the-secret'))).toBe(false)
  })

  it('rejects a missing or empty signature', () => {
    expect(isValidSignature(body, undefined)).toBe(false)
    expect(isValidSignature(body, '')).toBe(false)
  })

  // timingSafeEqual throws on length mismatch, so these must be caught first.
  it('rejects malformed signatures without throwing', () => {
    expect(isValidSignature(body, 'not-base64!!')).toBe(false)
    expect(isValidSignature(body, 'c2hvcnQ=')).toBe(false)
    expect(isValidSignature(body, sign(body) + 'AAAA')).toBe(false)
  })

  // The digest covers raw bytes; re-serialised JSON differs in whitespace.
  it('rejects a re-serialised body', () => {
    const signature = sign(body)
    const reserialised = JSON.stringify(JSON.parse(body), null, 2)
    expect(isValidSignature(reserialised, signature)).toBe(false)
  })
})

describe('Google push notification', () => {
  let db: Db

  const channel = {
    calendarId: 'work@group.calendar.google.com',
    channelId: 'chan-1',
    resourceId: 'res-1',
    token: 'shared-secret',
    expiration: Date.now() + 86_400_000,
  }

  beforeEach(() => {
    db = createTestDb()
    upsertWatchChannel(db, channel)
  })

  function classify(overrides: Record<string, string | undefined> = {}) {
    return classifyNotification(db, {
      channelId: 'chan-1',
      channelToken: 'shared-secret',
      resourceState: 'exists',
      ...overrides,
    })
  }

  it('resolves a change to the calendar the channel watches', () => {
    expect(classify()).toEqual({
      kind: 'change',
      calendarId: 'work@group.calendar.google.com',
    })
  })

  it('recognises the initial handshake, which carries no change', () => {
    expect(classify({ resourceState: 'sync' })).toEqual({
      kind: 'handshake',
      calendarId: 'work@group.calendar.google.com',
    })
  })

  it('treats a deletion as a change to be pulled', () => {
    expect(classify({ resourceState: 'not_exists' }).kind).toBe('change')
  })

  it('rejects a missing channel id', () => {
    expect(classify({ channelId: undefined }).kind).toBe('invalid')
  })

  // Usually a channel we superseded and Google has not stopped delivering for.
  it('rejects an unknown channel', () => {
    expect(classify({ channelId: 'chan-unknown' }).kind).toBe('invalid')
  })

  it('rejects a wrong, missing, or truncated channel token', () => {
    expect(classify({ channelToken: 'wrong-secret' }).kind).toBe('invalid')
    expect(classify({ channelToken: undefined }).kind).toBe('invalid')
    expect(classify({ channelToken: 'shared' }).kind).toBe('invalid')
  })
})

describe('OAuth state', () => {
  it('accepts a state it issued', () => {
    expect(consumeState('todoist', issueState('todoist'))).toBe(true)
  })

  it('is single use', () => {
    const state = issueState('google')
    expect(consumeState('google', state)).toBe(true)
    expect(consumeState('google', state)).toBe(false)
  })

  it('rejects a state issued for the other provider', () => {
    expect(consumeState('google', issueState('todoist'))).toBe(false)
  })

  it('rejects an unknown or missing state', () => {
    expect(consumeState('todoist', 'never-issued')).toBe(false)
    expect(consumeState('todoist', undefined)).toBe(false)
  })
})
