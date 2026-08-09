import type { Db } from './index.js'

/* -------------------------------------------------------------------------- */
/* Sync cursors                                                               */
/* -------------------------------------------------------------------------- */

const TODOIST_SYNC_TOKEN = 'todoist_sync_token'

const googleSyncTokenKey = (calendarId: string) => `gcal_sync_token:${calendarId}`

function getValue(db: Db, key: string): string | undefined {
  return db
    .prepare<[string], { value: string }>(
      'SELECT value FROM sync_state WHERE key = ?',
    )
    .get(key)?.value
}

function setValue(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(key, value)
}

function clearValue(db: Db, key: string): void {
  db.prepare('DELETE FROM sync_state WHERE key = ?').run(key)
}

/** `*` requests a full sync — the correct value on a cold start. */
export function getTodoistSyncToken(db: Db): string {
  return getValue(db, TODOIST_SYNC_TOKEN) ?? '*'
}

export function setTodoistSyncToken(db: Db, token: string): void {
  setValue(db, TODOIST_SYNC_TOKEN, token)
}

/** Next read falls back to `*`, forcing a full sync. */
export function clearTodoistSyncToken(db: Db): void {
  clearValue(db, TODOIST_SYNC_TOKEN)
}

/** `undefined` means "no cursor yet" — the caller performs a full list. */
export function getGoogleSyncToken(
  db: Db,
  calendarId: string,
): string | undefined {
  return getValue(db, googleSyncTokenKey(calendarId))
}

export function setGoogleSyncToken(
  db: Db,
  calendarId: string,
  token: string,
): void {
  setValue(db, googleSyncTokenKey(calendarId), token)
}

/** Called on HTTP 410 GONE, which means the token expired and must be reissued. */
export function clearGoogleSyncToken(db: Db, calendarId: string): void {
  clearValue(db, googleSyncTokenKey(calendarId))
}

/* -------------------------------------------------------------------------- */
/* Google push channels                                                       */
/* -------------------------------------------------------------------------- */

export interface WatchChannel {
  calendarId: string
  channelId: string
  resourceId: string
  /** Shared secret echoed back in `X-Goog-Channel-Token`. */
  token: string
  /** Unix ms. Google never auto-renews; we renew ahead of this. */
  expiration: number
}

interface WatchChannelRow {
  calendar_id: string
  channel_id: string
  resource_id: string
  token: string
  expiration: number
}

function toWatchChannel(row: WatchChannelRow): WatchChannel {
  return {
    calendarId: row.calendar_id,
    channelId: row.channel_id,
    resourceId: row.resource_id,
    token: row.token,
    expiration: row.expiration,
  }
}

const CHANNEL_COLUMNS = 'calendar_id, channel_id, resource_id, token, expiration'

export function getWatchChannel(
  db: Db,
  calendarId: string,
): WatchChannel | undefined {
  const row = db
    .prepare<[string], WatchChannelRow>(
      `SELECT ${CHANNEL_COLUMNS} FROM watch_channels WHERE calendar_id = ?`,
    )
    .get(calendarId)
  return row === undefined ? undefined : toWatchChannel(row)
}

/** Resolves an inbound push notification back to the calendar it belongs to. */
export function getWatchChannelByChannelId(
  db: Db,
  channelId: string,
): WatchChannel | undefined {
  const row = db
    .prepare<[string], WatchChannelRow>(
      `SELECT ${CHANNEL_COLUMNS} FROM watch_channels WHERE channel_id = ?`,
    )
    .get(channelId)
  return row === undefined ? undefined : toWatchChannel(row)
}

export function listWatchChannels(db: Db): WatchChannel[] {
  return db
    .prepare<[], WatchChannelRow>(`SELECT ${CHANNEL_COLUMNS} FROM watch_channels`)
    .all()
    .map(toWatchChannel)
}

export function upsertWatchChannel(db: Db, channel: WatchChannel): void {
  db.prepare(
    `INSERT INTO watch_channels (${CHANNEL_COLUMNS})
     VALUES (@calendarId, @channelId, @resourceId, @token, @expiration)
     ON CONFLICT (calendar_id) DO UPDATE SET
       channel_id  = excluded.channel_id,
       resource_id = excluded.resource_id,
       token       = excluded.token,
       expiration  = excluded.expiration`,
  ).run(channel)
}

export function removeWatchChannel(db: Db, calendarId: string): void {
  db.prepare('DELETE FROM watch_channels WHERE calendar_id = ?').run(calendarId)
}

/* -------------------------------------------------------------------------- */
/* OAuth tokens                                                               */
/* -------------------------------------------------------------------------- */

export type Provider = 'todoist' | 'google'

export interface StoredToken {
  accessToken: string
  /** Todoist tokens do not expire and carry no refresh token. */
  refreshToken?: string
  /** Unix ms. */
  expiresAt?: number
}

interface TokenRow {
  access_token: string
  refresh_token: string | null
  expires_at: number | null
}

export function getToken(db: Db, provider: Provider): StoredToken | undefined {
  const row = db
    .prepare<[string], TokenRow>(
      'SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE provider = ?',
    )
    .get(provider)

  if (row === undefined) return undefined

  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token ?? undefined,
    expiresAt: row.expires_at ?? undefined,
  }
}

/**
 * Google omits `refresh_token` on refresh responses, so a null must never
 * overwrite the one we already hold — losing it means re-running consent.
 */
export function saveToken(
  db: Db,
  provider: Provider,
  token: StoredToken,
): void {
  db.prepare(
    `INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at)
     VALUES (@provider, @accessToken, @refreshToken, @expiresAt)
     ON CONFLICT (provider) DO UPDATE SET
       access_token  = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, oauth_tokens.refresh_token),
       expires_at    = excluded.expires_at`,
  ).run({
    provider,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? null,
    expiresAt: token.expiresAt ?? null,
  })
}
