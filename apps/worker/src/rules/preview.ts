import { AppError, canSync, planPair, validateGraph } from '@accord/domain'
import { planRule, persistPlan } from '../sync/reconcile'
import { requireRule, assertCanWrite } from './service'
import { billing, getLink, listRules } from '../storage/db'
import type { Env } from '../env'
import { digest } from '../connections/crypto'
import { adapterFor } from '../connections/adapters'
export async function previewRule(env: Env, userId: string, id: string) {
  const rule = await requireRule(env, userId, id)
  const plan = await planRule(env, userId, rule, true)
  const token = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO previews(token,user_id,rule_id,revision,expires_at,payload) VALUES(?,?,?,?,?,?)',
  )
    .bind(
      token,
      userId,
      id,
      rule.revision,
      Date.now() + 600000,
      JSON.stringify({ hash: plan.hash }),
    )
    .run()
  return {
    token,
    revision: rule.revision,
    total: plan.pairs.length,
    requiresConfirmation: plan.mutations > rule.options.maxMutations,
    decisions: plan.pairs
      .flatMap((p) =>
        p.decisions.map((d) => ({ kind: d.kind, title: p.source.fields.title, reason: d.reason })),
      )
      .slice(0, 200),
    totalChanges: plan.mutations,
  }
}
export async function activateRule(
  env: Env,
  userId: string,
  id: string,
  input: { token: string; revision: number; confirmMass?: boolean },
) {
  const rule = await requireRule(env, userId, id)
  if (!canSync(await billing(env.DB, userId, env.OWNER_EMAILS), Date.now()))
    throw new AppError(
      'BILLING_REQUIRED',
      'Activez votre abonnement pour démarrer cette synchronisation.',
      402,
    )
  const graphIssues = validateGraph([
    ...(await listRules(env.DB, userId)).filter((r) => r.id !== id),
    { ...rule, status: 'active' },
  ])
  if (graphIssues.length)
    throw new AppError('VALIDATION', graphIssues.map((i) => i.message).join(' '), 400)
  const preview = await env.DB.prepare(
    'SELECT revision,payload FROM previews WHERE token=? AND user_id=? AND rule_id=? AND expires_at>?',
  )
    .bind(input.token, userId, id, Date.now())
    .first<{ revision: number; payload: string }>()
  if (!preview || preview.revision !== rule.revision || input.revision !== rule.revision)
    throw new AppError('PREVIEW_EXPIRED', 'Cet aperçu a expiré. Prévisualisez à nouveau.', 409)
  const plan = await planRule(env, userId, rule, true)
  if (plan.hash !== JSON.parse(preview.payload).hash)
    throw new AppError(
      'PREVIEW_STALE',
      'Vos données ont changé depuis l’aperçu. Vérifiez les nouveaux changements.',
      409,
    )
  if (plan.mutations > rule.options.maxMutations && !input.confirmMass)
    throw new AppError('MASS_CONFIRMATION', 'Confirmez explicitement ce lot de modifications.', 409)
  await env.DB.prepare("UPDATE rules SET status='active' WHERE user_id=? AND id=? AND revision=?")
    .bind(userId, id, rule.revision)
    .run()
  try {
    await persistPlan(env, userId, { ...rule, status: 'active' }, plan)
  } catch (e) {
    await env.DB.prepare("UPDATE rules SET status='draft' WHERE user_id=? AND id=?")
      .bind(userId, id)
      .run()
    throw e
  }
  await env.DB.prepare('DELETE FROM previews WHERE token=? AND user_id=?')
    .bind(input.token, userId)
    .run()
  await env.SYNC_QUEUE.send({ userId, reason: 'activation' })
  return { ok: true }
}
export async function resolveConflict(
  env: Env,
  userId: string,
  id: string,
  input: { sourceId: string; choice: 'source' | 'destination'; hash: string },
) {
  const rule = await requireRule(env, userId, id)
  await assertCanWrite(env, userId, rule)
  if (!['source', 'destination'].includes(input.choice))
    throw new AppError('VALIDATION', 'Choisissez une version à conserver.', 400)
  const link = await getLink(env.DB, userId, id, input.sourceId)
  if (!link) throw new AppError('NOT_FOUND', 'Cette paire n’existe plus.', 404)
  const a = await adapterFor(env, userId, rule.source, rule),
    b = await adapterFor(env, userId, rule.destination, rule)
  const source = await a.read(rule.source, link.sourceId),
    destination = await b.read(rule.destination, link.destinationId)
  if (!source || !destination)
    throw new AppError('STALE_ENTITY', 'Un élément est inaccessible. Prévisualisez à nouveau.', 409)
  if (input.hash !== (await digest(JSON.stringify([source.fields, destination.fields]))))
    throw new AppError(
      'CONFLICT_STALE',
      'Ces éléments ont changé. Consultez les nouvelles versions avant de choisir.',
      409,
    )
  const effective = { ...rule, options: { ...rule.options, conflict: input.choice } }
  const decisions = planPair(effective, source, destination, link).map((d) => ({
    ...d,
    resolution: input.choice,
  }))
  await env.DB.prepare(
    "UPDATE operations SET status='canceled' WHERE user_id=? AND rule_id=? AND json_extract(payload,'$.decision.originId')=? AND status IN ('pending','failed','running')",
  )
    .bind(userId, id, input.sourceId)
    .run()
  await persistPlan(env, userId, rule, {
    pairs: [{ source, destination, link, decisions, originSide: 'source' }],
    sourceCursor: null,
    destinationCursor: null,
    hash: 'manual',
    mutations: decisions.length,
  })
  await env.DB.prepare(
    "UPDATE activity SET status='resolved' WHERE user_id=? AND rule_id=? AND source_id=? AND status='conflict'",
  )
    .bind(userId, id, input.sourceId)
    .run()
  await env.SYNC_QUEUE.send({ userId, reason: 'conflict' })
  return { ok: true }
}

export async function conflictDetail(env: Env, userId: string, id: string, sourceId: string) {
  const rule = await requireRule(env, userId, id)
  const link = await getLink(env.DB, userId, id, sourceId)
  if (!link) throw new AppError('NOT_FOUND', 'Paire introuvable.', 404)
  const a = await adapterFor(env, userId, rule.source, rule),
    b = await adapterFor(env, userId, rule.destination, rule)
  const source = await a.read(rule.source, link.sourceId),
    destination = await b.read(rule.destination, link.destinationId)
  if (!source || !destination)
    throw new AppError('STALE_ENTITY', 'Un élément est inaccessible.', 409)
  return {
    source: source.fields,
    destination: destination.fields,
    hash: await digest(JSON.stringify([source.fields, destination.fields])),
    sourceProvider: rule.source.provider,
    destinationProvider: rule.destination.provider,
    fields: rule.fields,
  }
}
