import {
  AppError,
  planPair,
  canSync,
  matchesRule,
  type Rule,
  type Entity,
  type Link,
  type Decision,
  type ProviderAdapter,
  type Operation,
} from '@accord/domain'
import type { Env } from '../env'
import { adapterFor } from '../connections/adapters'
import { getLink, billing, listRules, logActivity } from '../storage/db'
import { digest } from '../connections/crypto'
export interface Adapters {
  source: ProviderAdapter
  destination: ProviderAdapter
}
export interface PlannedPair {
  source: Entity
  destination: Entity | null
  link: Link | null
  decisions: Decision[]
  originSide: 'source' | 'destination'
}
export interface RulePlan {
  pairs: PlannedPair[]
  sourceCursor: string | null
  destinationCursor: string | null
  hash: string
  mutations: number
}
export async function adaptersFor(env: Env, userId: string, rule: Rule): Promise<Adapters> {
  return {
    source: await adapterFor(env, userId, rule.source, rule),
    destination: await adapterFor(env, userId, rule.destination, rule),
  }
}
async function cursor(env: Env, userId: string, ruleId: string, side: string) {
  return (
    (
      await env.DB.prepare(
        'SELECT cursor FROM sync_cursors WHERE user_id=? AND rule_id=? AND side=?',
      )
        .bind(userId, ruleId, side)
        .first<{ cursor: string | null }>()
    )?.cursor ?? null
  )
}
async function groupFor(env: Env, userId: string, entity: Entity): Promise<string> {
  const found = await env.DB.prepare(
    "SELECT l.group_id FROM entity_links l JOIN rules r ON r.id=l.rule_id WHERE l.user_id=? AND ((l.source_id=? AND json_extract(r.payload,'$.source.connectionId')=?) OR (l.destination_id=? AND json_extract(r.payload,'$.destination.connectionId')=?)) LIMIT 1",
  )
    .bind(userId, entity.id, entity.ref.connectionId, entity.id, entity.ref.connectionId)
    .first<{ group_id: string }>()
  return found?.group_id ?? (await digest(`${userId}:${entity.ref.connectionId}:${entity.id}`))
}
export async function planRule(
  env: Env,
  userId: string,
  rule: Rule,
  full = false,
  adapters?: Adapters,
): Promise<RulePlan> {
  const a = adapters ?? (await adaptersFor(env, userId, rule))
  const source = await a.source.changes(
    rule.source,
    full ? null : await cursor(env, userId, rule.id, 'source'),
  )
  const destination =
    rule.direction === 'two-way' || full
      ? await a.destination.changes(
          rule.destination,
          full ? null : await cursor(env, userId, rule.id, 'destination'),
        )
      : { entities: [], nextCursor: null, hasMore: false }
  const pairs: PlannedPair[] = [],
    seen = new Set<string>()
  const sourceKeys = new Set(
    await Promise.all(source.entities.map((e) => groupFor(env, userId, e))),
  )
  const rules = await listRules(env.DB, userId)
  async function isMoved(entity: Entity) {
    if (!entity.deleted || entity.ref.provider !== 'google') return false
    const refs = rules
      .flatMap((r) => [r.source, r.destination])
      .filter(
        (ref) =>
          ref.provider === 'google' &&
          ref.connectionId === entity.ref.connectionId &&
          ref.resourceId !== entity.ref.resourceId,
      )
    for (const ref of refs) {
      const found = await a.destination.read(ref, entity.id)
      if (found && !found.deleted) return true
    }
    return false
  }
  const links = (
    await env.DB.prepare('SELECT payload FROM entity_links WHERE user_id=? AND rule_id=?')
      .bind(userId, rule.id)
      .all<{ payload: string }>()
  ).results.map((x) => JSON.parse(x.payload) as Link)
  for (const entity of source.entities) {
    let link = links.find((l) => l.sourceId === entity.id) ?? null
    if (entity.ref.resourceId !== rule.source.resourceId && !link) continue
    let other = link
      ? (destination.entities.find((e) => e.id === link?.destinationId) ??
        (await a.destination.read(rule.destination, link.destinationId)))
      : null
    if (
      !link &&
      rule.options.adoptLegacy &&
      rule.source.provider === 'todoist' &&
      rule.destination.provider === 'google'
    ) {
      other = await a.destination.findMirror(
        rule.destination,
        await digest(`${userId}:${entity.ref.connectionId}:${entity.id}`),
        entity.id,
      )
      if (other)
        link = {
          groupId: await digest(`${userId}:${entity.ref.connectionId}:${entity.id}`),
          ruleId: rule.id,
          sourceId: entity.id,
          destinationId: other.id,
          baseline: other.fields,
          sourceRevision: entity.revision,
          destinationRevision: other.revision,
        }
    }
    if (
      other?.metadata.accordTitleHash &&
      other.metadata.accordTitleHash === (await digest(other.metadata.rawTitle ?? ''))
    )
      other.fields.title = link?.baseline.title ?? other.fields.title
    const moved = other?.deleted ? await isMoved(other) : false
    const decisions = moved
      ? [
          {
            kind: 'unlink' as const,
            entityId: entity.id,
            target: rule.destination,
            patch: {},
            reason: 'L’événement a été déplacé vers un autre calendrier.',
          },
        ]
      : link?.detached
        ? [
            {
              kind: 'skip' as const,
              entityId: entity.id,
              target: rule.destination,
              patch: {},
              reason: 'Cette paire a été dissociée.',
            },
          ]
        : planPair(
            rule,
            entity,
            other ??
              (link
                ? { ...entity, id: link.destinationId, ref: rule.destination, deleted: true }
                : null),
            link,
          )
    pairs.push({ source: entity, destination: other, link, decisions, originSide: 'source' })
    seen.add(entity.id)
  }
  for (const entity of destination.entities) {
    const link = links.find((l) => l.destinationId === entity.id)
    if (link) {
      if (seen.has(link.sourceId) || link.detached) continue
      const other = await a.source.read(rule.source, link.sourceId)
      if (!other) continue
      pairs.push({
        source: other,
        destination: entity,
        link,
        decisions: (await isMoved(entity))
          ? [
              {
                kind: 'unlink',
                entityId: other.id,
                target: rule.destination,
                patch: {},
                reason: 'L’événement a été déplacé vers un autre calendrier.',
              },
            ]
          : planPair(rule, other, entity, link),
        originSide: 'source',
      })
      seen.add(link.sourceId)
    } else if (
      !sourceKeys.has(entity.metadata.accordKey ?? '') &&
      !(rule.options.adoptLegacy && entity.metadata.managedBy === 't2gc') &&
      entity.metadata.accordRuleId !== rule.id &&
      rule.direction === 'two-way' &&
      !entity.deleted &&
      entity.metadata.skip !== 'true' &&
      !entity.recurring
    ) {
      if (rule.filters.datedOnly && !entity.fields.schedule) continue
      const previous = await env.DB.prepare(
        "SELECT l.payload,r.payload AS rule_payload FROM entity_links l JOIN rules r ON r.id=l.rule_id WHERE l.user_id=? AND l.destination_id=? AND json_extract(r.payload,'$.destination.connectionId')=? LIMIT 1",
      )
        .bind(userId, entity.id, entity.ref.connectionId)
        .first<{ payload: string; rule_payload: string }>()
      if (previous) {
        const oldRule = JSON.parse(previous.rule_payload) as Rule
        const oldLink = JSON.parse(previous.payload) as Link
        if (
          oldRule.destination.resourceId !== entity.ref.resourceId &&
          oldRule.source.provider === rule.source.provider
        ) {
          if (
            rule.source.provider !== 'todoist' ||
            oldRule.source.connectionId !== rule.source.connectionId
          )
            continue
          const original = await a.source.read(rule.source, oldLink.sourceId)
          if (original) {
            pairs.push({
              source: original,
              destination: entity,
              link: { ...oldLink, ruleId: rule.id },
              originSide: 'source',
              decisions: [
                {
                  kind: 'write',
                  entityId: original.id,
                  target: rule.source,
                  targetId: original.id,
                  patch: {},
                  reason: 'Déplacer la tâche vers le projet associé.',
                  moveSource: true,
                },
              ],
            })
            continue
          }
        }
      }
      pairs.push({
        source: entity,
        destination: null,
        link: null,
        originSide: 'destination',
        decisions: [
          {
            kind: 'write',
            entityId: entity.id,
            target: rule.source,
            targetId: null,
            patch: entity.fields,
            reason: 'Créer une tâche depuis la destination.',
          },
        ],
      })
    }
  }
  const changes = pairs.filter((p) => p.decisions.some((d) => d.kind !== 'skip'))
  const mutations = changes.reduce(
    (n, p) => n + p.decisions.filter((d) => d.kind === 'write').length,
    0,
  )
  const hash = await digest(
    JSON.stringify(
      changes
        .map((p) => ({
          id: p.source.id,
          source: p.source.fields,
          sourceMetadata: {
            labels: p.source.metadata.labels,
            comments: p.source.metadata.comments,
          },
          destination: p.destination?.fields,
          decisions: p.decisions,
          side: p.originSide,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ),
  )
  return {
    pairs: changes,
    sourceCursor: source.nextCursor,
    destinationCursor: destination.nextCursor,
    hash,
    mutations,
  }
}
export async function persistPlan(env: Env, userId: string, rule: Rule, plan: RulePlan) {
  const writes: D1PreparedStatement[] = []
  for (const pair of plan.pairs) {
    const head = pair.decisions.find((d) => d.kind !== 'skip')
    if (!head) continue
    if (head.kind === 'conflict') {
      const duplicate = await env.DB.prepare(
        "SELECT id FROM activity WHERE user_id=? AND rule_id=? AND source_id=? AND status='conflict'",
      )
        .bind(userId, rule.id, pair.source.id)
        .first()
      if (!duplicate)
        await logActivity(
          env.DB,
          userId,
          rule.id,
          'conflict',
          pair.source.fields.title,
          head.reason,
          pair.source.id,
        )
      continue
    }
    const outstanding = await env.DB.prepare(
      "SELECT id FROM operations WHERE user_id=? AND rule_id=? AND status IN ('pending','running','failed') AND json_extract(payload,'$.decision.originId')=? LIMIT 1",
    )
      .bind(userId, rule.id, pair.source.id)
      .first()
    if (outstanding) continue
    const groupId = pair.link?.groupId ?? (await groupFor(env, userId, pair.source))
    const id = await digest(
      `${userId}:${rule.id}:${rule.revision}:${pair.originSide}:${pair.source.id}:${pair.source.revision}:${pair.destination?.revision ?? ''}:${plan.sourceCursor ?? ''}:${plan.destinationCursor ?? ''}:${pair.source.metadata.comments ?? ''}:${pair.source.metadata.labels ?? ''}:${JSON.stringify(pair.source.fields)}:${JSON.stringify(pair.destination?.fields)}:${head.kind}`,
    )
    const operation: Operation = {
      id,
      userId,
      ruleId: rule.id,
      ruleRevision: rule.revision,
      groupId,
      idempotencyKey: groupId,
      decision: {
        ...head,
        originSide: pair.originSide,
        sourceId: pair.originSide === 'source' ? pair.source.id : undefined,
        originId: pair.source.id,
      },
      attempts: 0,
      status: 'pending',
      nextAttemptAt: Date.now(),
    }
    writes.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO operations(id,user_id,rule_id,status,next_attempt_at,attempts,payload) VALUES(?,?,?,?,?,?,?)',
      ).bind(id, userId, rule.id, 'pending', operation.nextAttemptAt, 0, JSON.stringify(operation)),
    )
  }
  // Each page's operations are durable before its cursor moves; re-reading after a crash deduplicates ids.
  for (let i = 0; i < writes.length; i += 50) await env.DB.batch(writes.slice(i, i + 50))
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO sync_cursors(user_id,rule_id,side,cursor) VALUES(?,?,?,?) ON CONFLICT(user_id,rule_id,side) DO UPDATE SET cursor=excluded.cursor',
    ).bind(userId, rule.id, 'source', plan.sourceCursor),
    env.DB.prepare(
      'INSERT INTO sync_cursors(user_id,rule_id,side,cursor) VALUES(?,?,?,?) ON CONFLICT(user_id,rule_id,side) DO UPDATE SET cursor=excluded.cursor',
    ).bind(userId, rule.id, 'destination', plan.destinationCursor),
  ])
}
export async function reconcileUser(env: Env, userId: string) {
  if (!canSync(await billing(env.DB, userId, env.OWNER_EMAILS), Date.now())) return
  for (const rule of await listRules(env.DB, userId)) {
    if (rule.status !== 'active') continue
    try {
      const plan = await planRule(env, userId, rule)
      if (plan.mutations > rule.options.maxMutations) {
        await env.DB.prepare("UPDATE rules SET status='blocked' WHERE id=? AND user_id=?")
          .bind(rule.id, userId)
          .run()
        await logActivity(
          env.DB,
          userId,
          rule.id,
          'failed',
          rule.name,
          'Le seuil de protection est dépassé. Prévisualisez et confirmez le lot.',
        )
        continue
      }
      await persistPlan(env, userId, rule, plan)
    } catch (e) {
      await logActivity(
        env.DB,
        userId,
        rule.id,
        'failed',
        rule.name,
        e instanceof AppError ? e.message : 'Réconciliation indisponible. Réessayez.',
      )
    }
  }
}
