import { timingSafeEqual } from 'node:crypto'

import type { Db } from '../db/index.js'
import { getWatchChannelByChannelId } from '../db/state.js'

export const GOOGLE_CHANNEL_ID_HEADER = 'x-goog-channel-id'
export const GOOGLE_CHANNEL_TOKEN_HEADER = 'x-goog-channel-token'
export const GOOGLE_RESOURCE_STATE_HEADER = 'x-goog-resource-state'

export type GoogleNotification =
  | { kind: 'invalid'; reason: string }
  /** Sent once when a channel is created; carries no change. */
  | { kind: 'handshake'; calendarId: string }
  | { kind: 'change'; calendarId: string }

/**
 * Classify an inbound Google push notification.
 *
 * The body is always empty — Google deliberately sends no payload, so the
 * headers are all there is, and the actual change must be fetched with the
 * calendar's sync token afterwards.
 */
export function classifyNotification(
  db: Db,
  headers: {
    channelId: string | undefined
    channelToken: string | undefined
    resourceState: string | undefined
  },
): GoogleNotification {
  const { channelId, channelToken, resourceState } = headers

  if (channelId === undefined) return { kind: 'invalid', reason: 'no channel id' }

  const channel = getWatchChannelByChannelId(db, channelId)
  // An unknown channel is usually one we superseded and Google has not yet
  // stopped delivering for; it is not an attack, but it is not actionable.
  if (channel === undefined) {
    return { kind: 'invalid', reason: 'unknown channel' }
  }

  const expected = Buffer.from(channel.token, 'utf8')
  const received = Buffer.from(channelToken ?? '', 'utf8')
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    return { kind: 'invalid', reason: 'channel token mismatch' }
  }

  if (resourceState === 'sync') {
    return { kind: 'handshake', calendarId: channel.calendarId }
  }

  return { kind: 'change', calendarId: channel.calendarId }
}
