import { AppError, ruleSchema, validateGraph, canSync, type Rule } from '@accord/domain'
import { validateNotionMapping } from '@accord/providers'
import type { Env } from '../env'
import { getRule, listRules, connection, billing } from '../storage/db'
import { adapterFor } from '../connections/adapters'
export async function requireRule(env: Env, userId: string, id: string) {
  const r = await getRule(env.DB, userId, id)
  if (!r) throw new AppError('NOT_FOUND', 'Règle introuvable.', 404)
  return r
}
export async function assertCanWrite(env: Env, userId: string, rule: Rule) {
  const b = await billing(env.DB, userId, env.OWNER_EMAILS)
  if (b.deleting)
    throw new AppError('ACCOUNT_DELETING', 'Ce compte est en cours de suppression.', 403)
  if (!canSync(b, Date.now()))
    throw new AppError(
      'BILLING_REQUIRED',
      'Votre essai ou abonnement est terminé. Activez votre abonnement pour reprendre.',
      402,
    )
  if (rule.status !== 'active') throw new AppError('RULE_PAUSED', 'Cette règle est en pause.', 409)
  await connection(env.DB, userId, rule.source.connectionId)
  await connection(env.DB, userId, rule.destination.connectionId)
}
export async function saveRule(env: Env, userId: string, input: unknown, id?: string) {
  const parsed = ruleSchema.safeParse(input)
  if (!parsed.success)
    throw new AppError('VALIDATION', parsed.error.issues.map((i) => i.message).join(' '), 400)
  const rule = { ...parsed.data, userId, id: id ?? parsed.data.id, status: 'draft' as const }
  const old = id ? await requireRule(env, userId, id) : null
  if (old && old.revision !== rule.revision)
    throw new AppError(
      'REVISION_CONFLICT',
      'Cette règle a changé dans une autre fenêtre. Rechargez-la.',
      409,
    )
  for (const ref of [rule.source, rule.destination]) {
    await connection(env.DB, userId, ref.connectionId)
    const adapter = await adapterFor(env, userId, ref, rule),
      resource = (await adapter.discover()).find(
        (x) => x.ref.resourceId === ref.resourceId && x.ref.provider === ref.provider,
      )
    if (!resource || !resource.writable)
      throw new AppError('VALIDATION', 'Cette ressource n’est pas accessible en écriture.', 400)
    if (ref.provider === 'notion') {
      const issues = validateNotionMapping(resource.properties ?? [], rule.notionMapping)
      if (issues.length)
        throw new AppError('VALIDATION', issues.map((i) => i.message).join(' '), 400)
      if (rule.fields.includes('description') && !rule.notionMapping?.description)
        throw new AppError(
          'VALIDATION',
          'Associez une propriété de description Notion ou désactivez ce champ.',
          400,
        )
      if (rule.fields.includes('priority') && !rule.notionMapping?.priority)
        throw new AppError(
          'VALIDATION',
          'Associez une propriété de priorité Notion ou désactivez ce champ.',
          400,
        )
    }
  }
  const rules = (await listRules(env.DB, userId)).filter((r) => r.id !== rule.id)
  const issues = validateGraph([...rules, rule])
  if (issues.length) throw new AppError('VALIDATION', issues.map((i) => i.message).join(' '), 400)
  rule.revision = old ? old.revision + 1 : 1
  const payload = JSON.stringify(rule)
  if (old) {
    const update = await env.DB.prepare(
      "UPDATE rules SET revision=?,status='draft',payload=? WHERE id=? AND user_id=? AND revision=?",
    )
      .bind(rule.revision, payload, id!, userId, old.revision)
      .run()
    if (!update.meta.changes)
      throw new AppError('REVISION_CONFLICT', 'Cette règle a été modifiée. Rechargez-la.', 409)
  } else {
    const dup = await env.DB.prepare('SELECT id FROM rules WHERE id=?').bind(rule.id).first()
    if (dup) throw new AppError('VALIDATION', 'Identifiant de règle déjà utilisé.', 409)
    await env.DB.prepare('INSERT INTO rules(id,user_id,revision,status,payload) VALUES(?,?,?,?,?)')
      .bind(rule.id, userId, rule.revision, 'draft', payload)
      .run()
  }
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO rule_versions(rule_id,user_id,revision,payload) VALUES(?,?,?,?)',
    ).bind(rule.id, userId, rule.revision, payload),
    env.DB.prepare('DELETE FROM previews WHERE user_id=? AND rule_id=?').bind(userId, rule.id),
    env.DB.prepare(
      "UPDATE operations SET status='canceled' WHERE user_id=? AND rule_id=? AND status IN ('pending','running')",
    ).bind(userId, rule.id),
  ])
  return rule
}
export async function pauseRule(env: Env, userId: string, id: string) {
  await requireRule(env, userId, id)
  await env.DB.batch([
    env.DB.prepare("UPDATE rules SET status='paused' WHERE user_id=? AND id=?").bind(userId, id),
    env.DB.prepare(
      "UPDATE operations SET status='canceled' WHERE user_id=? AND rule_id=? AND status IN ('pending','running')",
    ).bind(userId, id),
  ])
  return { ok: true }
}
export async function deleteRule(env: Env, userId: string, id: string) {
  await pauseRule(env, userId, id)
  await env.DB.prepare('DELETE FROM rules WHERE user_id=? AND id=?').bind(userId, id).run()
  return { ok: true }
}
