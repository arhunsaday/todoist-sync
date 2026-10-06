import { digest } from '../connections/crypto'
import {
  AppError,
  planPair,
  equal,
  type Rule,
  type Link,
  type Entity,
  type Operation,
} from '@accord/domain'
import type { Env } from '../env'
import { assertCanWrite, requireRule } from '../rules/service'
import { getLink, loadOperation, saveLink, logActivity } from '../storage/db'
import { adaptersFor, type Adapters } from './reconcile'
export async function executeOperation(env: Env, userId: string, id: string, adapters?: Adapters) {
  const op = await loadOperation(env.DB, userId, id)
  if (!op || op.status === 'done' || op.status === 'canceled') return
  const rule = await requireRule(env, userId, op.ruleId)
  if (rule.revision !== op.ruleRevision) {
    await env.DB.prepare("UPDATE operations SET status='canceled' WHERE id=? AND user_id=?")
      .bind(id, userId)
      .run()
    return
  }
  await assertCanWrite(env, userId, rule)
  const a = adapters ?? (await adaptersFor(env, userId, rule))
  await env.DB.prepare(
    "UPDATE operations SET status='running',attempts=attempts+1 WHERE id=? AND user_id=?",
  )
    .bind(id, userId)
    .run()
  try {
    const originSide = op.decision.originSide ?? 'source'
    let source: Entity | null, destination: Entity | null
    let link: Link | null = null
    if (originSide === 'source') {
      source = await a.source.read(rule.source, op.decision.originId ?? op.decision.entityId)
      if (!source) {
        link = await getLink(env.DB, userId, rule.id, op.decision.originId ?? op.decision.entityId)
        if (link && op.decision.patch.completed === true && rule.source.provider === 'todoist')
          source = {
            id: link.sourceId,
            ref: rule.source,
            fields: { ...link.baseline, ...op.decision.patch },
            revision: 'completed',
            deleted: false,
            recurring: false,
            metadata: {},
          }
        else {
          if (link) await saveLink(env.DB, userId, { ...link, detached: true })
          await finish(env, op)
          return
        }
      }
      link = await getLink(env.DB, userId, rule.id, source.id)
      destination = link
        ? await a.destination.read(rule.destination, link.destinationId)
        : await a.destination.findMirror(rule.destination, op.idempotencyKey, source.id)
      if (!link && destination && !destination.deleted) {
        link = {
          groupId: op.groupId,
          ruleId: rule.id,
          sourceId: source.id,
          destinationId: destination.id,
          baseline:
            destination.metadata.managedBy === 't2gc'
              ? destination.fields
              : { ...source.fields, ...op.decision.patch },
          sourceRevision: source.revision,
          destinationRevision: destination.revision,
        }
        await saveLink(env.DB, userId, link)
      }
    } else {
      destination = await a.destination.read(
        rule.destination,
        op.decision.originId ?? op.decision.entityId,
      )
      if (!destination || destination.deleted) {
        await finish(env, op)
        return
      }
      source = await a.source.findMirror(rule.source, op.idempotencyKey)
      if (!source) {
        if (op.uncertainCreation && rule.source.provider === 'notion')
          throw new AppError(
            'AMBIGUOUS_WRITE',
            'Vérifiez la page Notion créée avant de reprendre cette opération.',
            409,
          )
        await assertCanWrite(env, userId, await requireRule(env, userId, rule.id))
        source = await a.source.write(rule.source, null, destination.fields, op.idempotencyKey)
      }
      link = {
        groupId: op.groupId,
        ruleId: rule.id,
        sourceId: source.id,
        destinationId: destination.id,
        baseline: source.fields,
        sourceRevision: source.revision,
        destinationRevision: destination.revision,
      }
      await saveLink(env.DB, userId, link)
    }
    if (source && link && !destination)
      destination = {
        ...source,
        id: link.destinationId,
        ref: rule.destination,
        deleted: true,
        metadata: {},
      }
    if (
      destination?.metadata.accordTitleHash &&
      link &&
      destination.metadata.accordTitleHash === (await digest(destination.metadata.rawTitle ?? ''))
    )
      destination.fields.title = link.baseline.title
    if (op.decision.moveSource && source) {
      await assertCanWrite(env, userId, rule)
      source = await a.source.write(rule.source, source.id, {}, op.id + ':move')
      link = {
        groupId: op.groupId,
        ruleId: rule.id,
        sourceId: source.id,
        destinationId: destination!.id,
        baseline: source.fields,
        sourceRevision: source.revision,
        destinationRevision: destination!.revision,
      }
      await saveLink(env.DB, userId, link)
    }
    if (link?.detached) {
      await finish(env, op)
      return
    }
    const effectiveRule = op.decision.resolution
      ? { ...rule, options: { ...rule.options, conflict: op.decision.resolution } }
      : rule
    let decisions = planPair(
      effectiveRule,
      source!,
      destination ??
        (link
          ? { ...source!, id: link.destinationId, ref: rule.destination, deleted: true }
          : null),
      link,
    )
    if (op.decision.kind === 'unlink') decisions = [op.decision]
    if (decisions.some((d) => d.kind === 'conflict')) {
      await logActivity(
        env.DB,
        userId,
        rule.id,
        'conflict',
        source!.fields.title,
        decisions.find((d) => d.kind === 'conflict')!.reason,
        source!.id,
      )
      await finish(env, op)
      return
    }
    for (const decision of decisions) {
      if (decision.kind === 'unlink') {
        if (
          link &&
          source.ref.resourceId !== rule.source.resourceId &&
          rule.destination.provider === 'google' &&
          destination &&
          !destination.deleted
        )
          await a.destination.removeMirror(rule.destination, destination.id)
        if (link) await saveLink(env.DB, userId, { ...link, detached: true })
        await logActivity(
          env.DB,
          userId,
          rule.id,
          'done',
          source!.fields.title,
          'Éléments dissociés.',
          source!.id,
        )
        await finish(env, op)
        return
      }
      if (decision.kind !== 'write') continue
      await assertCanWrite(env, userId, await requireRule(env, userId, rule.id))
      const towardSource = decision.target.connectionId === rule.source.connectionId
      const provider = towardSource ? a.source : a.destination
      const current = towardSource ? source : destination
      if (!current && decision.target.provider === 'notion' && op.uncertainCreation)
        throw new AppError(
          'AMBIGUOUS_WRITE',
          'Vérifiez la page Notion créée avant de reprendre cette opération.',
          409,
        )
      const patch = { ...decision.patch }
      if (!towardSource && source?.metadata.comments)
        patch.description =
          (patch.description ?? source.fields.description) +
          '\n─────── Todoist comments ───────\n' +
          source.metadata.comments
      const result = await provider.write(
        decision.target,
        current?.id ?? null,
        patch,
        current ? op.id + ':' + (towardSource ? 'source' : 'destination') : op.idempotencyKey,
        {
          labels: JSON.parse(source?.metadata.labels ?? '[]'),
          groupId: op.groupId,
          allowRecreate: current?.deleted === true,
        },
      )
      if (towardSource) source = result
      else destination = result
    }
    if (source && destination) {
      if (
        source.recurring &&
        source.ref.provider === 'todoist' &&
        source.fields.schedule &&
        !equal(source.fields.schedule, destination.fields.schedule)
      ) {
        await assertCanWrite(env, userId, await requireRule(env, userId, rule.id))
        destination = await a.destination.write(
          rule.destination,
          destination.id,
          { schedule: source.fields.schedule, completed: source.fields.completed },
          op.id + ':recurrence',
        )
      }
      await saveLink(env.DB, userId, {
        groupId: op.groupId,
        ruleId: rule.id,
        sourceId: source.id,
        destinationId: destination.id,
        baseline: source.fields,
        sourceRevision: source.revision,
        destinationRevision: destination.revision,
      })
    }
    await finish(env, op)
    await logActivity(
      env.DB,
      userId,
      rule.id,
      'done',
      source!.fields.title,
      'Synchronisation appliquée.',
      source!.id,
    )
  } catch (e) {
    const attempts = op.attempts + 1
    const uncertainCreation =
      op.uncertainCreation ||
      (op.decision.target.provider === 'notion' &&
        !op.decision.targetId &&
        (!(e instanceof AppError) || ['PROVIDER_UNAVAILABLE', 'AMBIGUOUS_WRITE'].includes(e.code)))
    const permanent =
      e instanceof AppError &&
      [
        'NOTION_MAPPING',
        'RECONNECT_REQUIRED',
        'STALE_ENTITY',
        'DUPLICATE_MIRROR',
        'RULE_PAUSED',
        'BILLING_REQUIRED',
        'AMBIGUOUS_WRITE',
      ].includes(e.code)
    const status = permanent || uncertainCreation || attempts >= 6 ? 'failed' : 'pending'
    const delay =
      e instanceof AppError && e.retryAfter
        ? e.retryAfter * 1000
        : Math.min(3600000, 30000 * 2 ** attempts)
    await env.DB.prepare(
      'UPDATE operations SET status=?,next_attempt_at=?,payload=? WHERE id=? AND user_id=?',
    )
      .bind(status, Date.now() + delay, JSON.stringify({ ...op, uncertainCreation }), id, userId)
      .run()
    if (status === 'failed')
      await logActivity(
        env.DB,
        userId,
        rule.id,
        'failed',
        rule.name,
        e instanceof AppError ? e.message : 'Une écriture demande une nouvelle tentative.',
        op.decision.entityId,
      )
    throw e
  }
}
async function finish(env: Env, op: Operation) {
  await env.DB.prepare("UPDATE operations SET status='done' WHERE id=? AND user_id=?")
    .bind(op.id, op.userId)
    .run()
}
export async function executeDue(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    "SELECT id FROM operations WHERE user_id=? AND status IN ('pending','running') AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 50",
  )
    .bind(userId, Date.now())
    .all<{ id: string }>()
  for (const row of rows.results) {
    try {
      await executeOperation(env, userId, row.id)
    } catch {
      /* durable retry is scheduled and visible; independent pairs continue */
    }
  }
}
