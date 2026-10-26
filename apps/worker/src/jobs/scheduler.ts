import type { Env } from '../env'
import { coordinate } from './coordinate'
export async function processQueue(
  batch: MessageBatch<{ userId: string; reason: string }>,
  env: Env,
) {
  for (const message of batch.messages) {
    try {
      if (typeof message.body.userId !== 'string' || message.body.userId.length > 128) {
        message.ack()
        continue
      }
      await coordinate(env, message.body.userId, 'sync')
      message.ack()
    } catch {
      message.retry({ delaySeconds: 60 })
    }
  }
}
export async function scheduleUsers(env: Env) {
  let after = ''
  do {
    const page = (
      await env.DB.prepare(
        'SELECT u.id FROM user u JOIN customers c ON c.user_id=u.id WHERE u.id>? ORDER BY u.id LIMIT 100',
      )
        .bind(after)
        .all<{ id: string }>()
    ).results
    if (!page.length) break
    await env.SYNC_QUEUE.sendBatch(
      page.map((u) => ({ body: { userId: u.id, reason: 'periodic' } })),
    )
    after = page[page.length - 1]!.id
  } while (after)
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_attempts WHERE expires_at<?').bind(now),
    env.DB.prepare('DELETE FROM previews WHERE expires_at<?').bind(now),
    env.DB.prepare('DELETE FROM webhook_receipts WHERE created_at<?').bind(now - 30 * 86400000),
    env.DB.prepare('DELETE FROM activity WHERE created_at<?').bind(now - 90 * 86400000),
    env.DB.prepare('DELETE FROM trial_claims WHERE first_claimed_at<?').bind(now - 365 * 86400000),
    env.DB.prepare("DELETE FROM billing_events WHERE status='done' AND created_at<?").bind(
      now - 30 * 86400000,
    ),
  ])
}
