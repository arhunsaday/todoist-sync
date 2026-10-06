import { AppError, type Rule } from '@accord/domain'
import type { Env } from '../env'
import { connections, billing, listRules, logActivity } from '../storage/db'
import { discoverAll } from '../connections/adapters'
import { saveRule, pauseRule, deleteRule, requireRule, assertCanWrite } from '../rules/service'
import { previewRule, activateRule, resolveConflict, conflictDetail } from '../rules/preview'
import { reconcileUser } from '../sync/reconcile'
import { executeDue } from '../sync/execute'
import { consumeBillingEvents, checkout, portal } from '../billing/stripe'
import { deleteAccount } from '../account/delete'
import { disconnect, finishOAuth } from '../connections/oauth'
import { renewGoogleWatches } from '../webhooks/watch'
import { providerSchema } from '@accord/domain'
export async function userAction(
  env: Env,
  userId: string,
  action: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  switch (action) {
    case 'bootstrap': {
      const discovered = await discoverAll(env, userId)
      const user = await env.DB.prepare('SELECT id,name,email FROM user WHERE id=?')
        .bind(userId)
        .first()
      const activity = (
        await env.DB.prepare(
          'SELECT id,title,detail,status,created_at AS createdAt,rule_id AS ruleId,source_id AS sourceId FROM activity WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
        )
          .bind(userId)
          .all()
      ).results
      const stats = await env.DB.prepare(
        "SELECT SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS synced,SUM(CASE WHEN status IN ('failed','conflict') THEN 1 ELSE 0 END) AS errors FROM activity WHERE user_id=?",
      )
        .bind(userId)
        .first<{ synced: number | null; errors: number | null }>()
      const b = await billing(env.DB, userId)
      return {
        user,
        rules: await listRules(env.DB, userId),
        connections: (await connections(env.DB, userId)).map(({ id, provider, name, status }) => ({
          id,
          provider,
          name,
          status,
        })),
        resources: discovered.resources,
        warnings: discovered.warnings,
        activity,
        billing: {
          trialEndsAt: b.trialEndsAt,
          subscription: b.subscription,
          configured: !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID),
        },
        stats: { synced: stats?.synced ?? 0, errors: stats?.errors ?? 0 },
      }
    }
    case 'save-rule':
      return saveRule(env, userId, body.rule, body.id as string | undefined)
    case 'pause-rule':
      return pauseRule(env, userId, String(body.id))
    case 'delete-rule':
      return deleteRule(env, userId, String(body.id))
    case 'preview-rule':
      return previewRule(env, userId, String(body.id))
    case 'activate-rule':
      return activateRule(
        env,
        userId,
        String(body.id),
        body as unknown as Parameters<typeof activateRule>[3],
      )
    case 'conflict-detail':
      return conflictDetail(env, userId, String(body.id), String(body.sourceId))
    case 'resolve-conflict':
      return resolveConflict(
        env,
        userId,
        String(body.id),
        body as unknown as Parameters<typeof resolveConflict>[3],
      )
    case 'retry-rule': {
      const r = await requireRule(env, userId, String(body.id))
      await assertCanWrite(env, userId, r)
      await env.DB.prepare(
        "UPDATE operations SET status='pending',attempts=0,next_attempt_at=? WHERE user_id=? AND rule_id=? AND status='failed'",
      )
        .bind(Date.now(), userId, r.id)
        .run()
      await env.SYNC_QUEUE.send({ userId, reason: 'manual-retry' })
      return { ok: true }
    }
    case 'disconnect':
      await disconnect(env, userId, String(body.id))
      return { ok: true }
    case 'finish-oauth':
      await finishOAuth(
        env,
        userId,
        providerSchema.parse(body.provider),
        String(body.code),
        String(body.state),
      )
      return { ok: true }
    case 'checkout':
      return checkout(env, userId)
    case 'portal':
      return portal(env, userId)
    case 'delete-account':
      return deleteAccount(env, userId)
    case 'sync': {
      await consumeBillingEvents(env, userId)
      if ((await billing(env.DB, userId)).deleting) return deleteAccount(env, userId)
      await executeDue(env, userId)
      await reconcileUser(env, userId)
      await executeDue(env, userId)
      await renewGoogleWatches(env, userId)
      return { ok: true }
    }
    default:
      throw new AppError('NOT_FOUND', 'Action inconnue.', 404)
  }
}
