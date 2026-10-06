import type { Env } from '../env'
import { connections, listRules, logActivity } from '../storage/db'
import { accessToken } from '../connections/tokens'
import { requestJson, bearer } from '@accord/providers'
export async function renewGoogleWatches(env: Env, userId: string) {
  if (!env.PUBLIC_URL.startsWith('https://')) return
  const rules = (await listRules(env.DB, userId)).filter((r) => r.status === 'active')
  for (const c of await connections(env.DB, userId)) {
    if (c.provider !== 'google' || c.status !== 'connected') continue
    const calendars = new Set(
      rules
        .flatMap((r) => [r.source, r.destination])
        .filter((r) => r.connectionId === c.id)
        .map((r) => r.resourceId),
    )
    for (const calendarId of calendars) {
      const old = await env.DB.prepare(
        'SELECT channel_id,resource_id,expiration FROM watch_channels WHERE user_id=? AND connection_id=? AND calendar_id=? ORDER BY expiration DESC LIMIT 1',
      )
        .bind(userId, c.id, calendarId)
        .first<{ channel_id: string; resource_id: string; expiration: number }>()
      if (old && old.expiration > Date.now() + 48 * 3600000) continue
      try {
        const token = crypto.randomUUID() + crypto.randomUUID(),
          id = crypto.randomUUID()
        const result = await requestJson<{ id: string; resourceId: string; expiration: string }>(
          'https://www.googleapis.com/calendar/v3/calendars/' +
            encodeURIComponent(calendarId) +
            '/events/watch',
          {
            method: 'POST',
            headers: bearer(await accessToken(env, userId, c.id)),
            body: JSON.stringify({
              id,
              type: 'web_hook',
              address: env.PUBLIC_URL + '/api/webhooks/google',
              token,
              params: { ttl: '604800' },
            }),
          },
        )
        await env.DB.prepare(
          'INSERT INTO watch_channels(channel_id,user_id,connection_id,resource_id,calendar_id,token,expiration) VALUES(?,?,?,?,?,?,?)',
        )
          .bind(
            result.id,
            userId,
            c.id,
            result.resourceId,
            calendarId,
            token,
            Number(result.expiration),
          )
          .run()
        if (old) {
          await requestJson('https://www.googleapis.com/calendar/v3/channels/stop', {
            method: 'POST',
            headers: bearer(await accessToken(env, userId, c.id)),
            body: JSON.stringify({ id: old.channel_id, resourceId: old.resource_id }),
          })
          await env.DB.prepare('DELETE FROM watch_channels WHERE channel_id=? AND user_id=?')
            .bind(old.channel_id, userId)
            .run()
        }
      } catch {
        await logActivity(
          env.DB,
          userId,
          null,
          'failed',
          'Notifications Google',
          'Le renouvellement du canal a échoué. La réconciliation périodique reste active.',
        )
      }
    }
  }
}
