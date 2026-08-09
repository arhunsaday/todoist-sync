import { randomBytes, randomUUID } from 'node:crypto'

import { getConfig } from '../config.js'
import type { Db } from '../db/index.js'
import {
  getWatchChannel,
  removeWatchChannel,
  upsertWatchChannel,
  type WatchChannel,
} from '../db/state.js'
import { logger } from '../logger.js'
import type { GoogleCalendarClient } from './client.js'

export const GOOGLE_WEBHOOK_PATH = '/webhooks/google'

function webhookAddress(): string {
  return new URL(GOOGLE_WEBHOOK_PATH, getConfig().PUBLIC_URL).toString()
}

/** Stopping the superseded channel is best-effort — it expires on its own. */
async function stopChannel(
  client: GoogleCalendarClient,
  channel: WatchChannel,
): Promise<void> {
  try {
    await client.api.channels.stop({
      requestBody: { id: channel.channelId, resourceId: channel.resourceId },
    })
    logger.debug({ channelId: channel.channelId }, 'stopped watch channel')
  } catch (error) {
    logger.warn(
      { channelId: channel.channelId, err: error },
      'could not stop superseded watch channel',
    )
  }
}

async function createChannel(
  db: Db,
  client: GoogleCalendarClient,
  calendarId: string,
): Promise<WatchChannel> {
  const channelId = randomUUID()
  // Echoed back as X-Goog-Channel-Token; proves the POST came from Google.
  const token = randomBytes(24).toString('hex')

  const response = await client.api.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: webhookAddress(),
      token,
    },
  })

  const resourceId = response.data.resourceId
  if (resourceId == null) {
    throw new Error(`events.watch for ${calendarId} returned no resourceId`)
  }

  return {
    calendarId,
    channelId,
    resourceId,
    token,
    // Google decides the real TTL; never assume the requested one.
    expiration: Number(response.data.expiration ?? 0),
  }
}

/**
 * Register a push channel per mapped calendar, renewing any that expire soon.
 *
 * Google never auto-renews and gives no warning when a channel lapses, so this
 * runs on boot and on a daily timer.
 *
 * Failures are logged, not thrown: push is a latency optimisation, and the
 * periodic reconcile keeps the sync correct without it.
 */
export async function ensureWatchChannels(
  db: Db,
  client: GoogleCalendarClient,
): Promise<void> {
  const config = getConfig()
  const renewBefore = Date.now() + config.WATCH_RENEW_WITHIN_HOURS * 3_600_000

  for (const { googleCalendarId } of config.SYNC_MAPPINGS) {
    const existing = getWatchChannel(db, googleCalendarId)

    if (existing !== undefined && existing.expiration > renewBefore) continue

    try {
      const channel = await createChannel(db, client, googleCalendarId)
      // Record the new channel before stopping the old one: overlapping
      // channels only cause a duplicate wake-up, whereas a gap loses events.
      upsertWatchChannel(db, channel)

      if (existing !== undefined) await stopChannel(client, existing)

      logger.info(
        {
          calendarId: googleCalendarId,
          expiresAt: new Date(channel.expiration).toISOString(),
          renewed: existing !== undefined,
        },
        'watch channel active',
      )
    } catch (error) {
      const reason = (error as { errors?: Array<{ reason?: string }> }).errors?.[0]
        ?.reason

      if (reason === 'pushNotificationsNotAllowed') {
        logger.error(
          { calendarId: googleCalendarId, address: webhookAddress() },
          'Google rejected the webhook URL. The receiving domain must be HTTPS ' +
            'with a valid certificate and verified in Search Console, then added ' +
            'to the Cloud project as an authorized domain. Falling back to polling.',
        )
      } else {
        logger.error(
          { calendarId: googleCalendarId, err: error },
          'could not register watch channel; falling back to polling',
        )
      }
    }
  }
}

export async function stopAllChannels(
  db: Db,
  client: GoogleCalendarClient,
): Promise<void> {
  for (const { googleCalendarId } of getConfig().SYNC_MAPPINGS) {
    const channel = getWatchChannel(db, googleCalendarId)
    if (channel === undefined) continue
    await stopChannel(client, channel)
    removeWatchChannel(db, googleCalendarId)
  }
}
