import { AppError } from '@accord/domain'
import type { Env } from '../env'
import { billing, connections } from '../storage/db'
import { stripeFor } from '../billing/stripe'
import { openToken } from '../connections/crypto'
import type { Tokens } from '../connections/oauth'
export async function deleteAccount(env: Env, userId: string) {
  const b = await billing(env.DB, userId)
  await env.DB.batch([
    env.DB.prepare('UPDATE customers SET deleting=1 WHERE user_id=?').bind(userId),
    env.DB.prepare('DELETE FROM session WHERE user_id=?').bind(userId),
    env.DB.prepare("UPDATE rules SET status='paused' WHERE user_id=?").bind(userId),
    env.DB.prepare(
      "UPDATE operations SET status='canceled' WHERE user_id=? AND status IN ('pending','running')",
    ).bind(userId),
  ])
  if (b.subscription?.id) {
    if (!env.STRIPE_SECRET_KEY)
      throw new AppError(
        'CONFIGURATION',
        'La facturation doit être reconnectée pour terminer l’annulation. Votre compte est suspendu.',
        503,
      )
    const sub = await stripeFor(env).subscriptions.retrieve(b.subscription.id)
    if (sub.status !== 'canceled') await stripeFor(env).subscriptions.cancel(sub.id)
  }
  for (const c of await connections(env.DB, userId)) {
    if (c.provider === 'google' && c.encrypted_tokens && env.TOKEN_ENCRYPTION_KEY) {
      try {
        const tokens = await openToken<Tokens>(
          c.encrypted_tokens,
          env.TOKEN_ENCRYPTION_KEY,
          'v1',
          `${userId}:${c.id}:${c.provider}`,
        )
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokens.refresh_token ?? tokens.access_token }),
        })
      } catch {
        /* local tokens will be erased; provider access can also be removed in Google's account settings */
      }
    }
  }
  await env.DB.prepare('DELETE FROM user WHERE id=?').bind(userId).run()
  return { ok: true }
}
