import { env } from 'cloudflare:test'
import { beforeAll, it, expect } from 'vitest'
import sqlAuth from '../migrations/0001_auth.sql?raw'
import sqlDomain from '../migrations/0002_domain.sql?raw'
import { makeRule, type Entity, type ProviderAdapter, AppError } from '@accord/domain'
import { createTestSession } from './test/session'
import { planRule, persistPlan } from './sync/reconcile'
import { executeOperation } from './sync/execute'
import { getLink } from './storage/db'
beforeAll(async () => {
  await env.DB.exec(sqlAuth)
  await env.DB.exec(sqlDomain)
  await createTestSession(env, 'u')
  for (const [id, p] of [
    ['t', 'todoist'],
    ['g', 'google'],
  ])
    await env.DB.prepare(
      'INSERT INTO connections(id,user_id,provider,name,external_user_id,status,encrypted_tokens,created_at) VALUES(?,?,?,?,?,?,?,?)',
    )
      .bind(id!, 'u', p!, p!, 'external-' + id, 'connected', 'test-token', Date.now())
      .run()
})
it('retains failed writes after the cursor advances and recovers a mirror without duplication', async () => {
  const rule = makeRule('u')
  rule.status = 'active'
  rule.source = { provider: 'todoist', connectionId: 't', resourceId: 'p' }
  rule.destination = { provider: 'google', connectionId: 'g', resourceId: 'c' }
  await env.DB.prepare('INSERT INTO rules(id,user_id,revision,status,payload) VALUES(?,?,?,?,?)')
    .bind(rule.id, 'u', 1, 'active', JSON.stringify(rule))
    .run()
  let source: Entity = {
    id: 'task',
    ref: rule.source,
    fields: {
      title: 'First',
      description: '',
      priority: 4,
      completed: false,
      schedule: { kind: 'date', date: '2026-10-06', days: 1 },
    },
    revision: '1',
    deleted: false,
    recurring: false,
    metadata: {},
  }
  let mirror: Entity | null = null,
    created = 0,
    loseResponse = true
  const a: ProviderAdapter = {
    async discover() {
      return []
    },
    async changes() {
      return { entities: [source], nextCursor: 'advanced', hasMore: false }
    },
    async read() {
      return source
    },
    async findMirror() {
      return null
    },
    async write(_ref, _id, patch) {
      source = { ...source, fields: { ...source.fields, ...patch } }
      return source
    },
    async removeMirror() {},
  }
  const b: ProviderAdapter = {
    async discover() {
      return []
    },
    async changes() {
      return { entities: mirror ? [mirror] : [], nextCursor: 'google-token', hasMore: false }
    },
    async read() {
      return mirror
    },
    async findMirror() {
      return mirror
    },
    async write(ref, id, patch) {
      if (!id) created++
      mirror = {
        ...source,
        id: 'event',
        ref,
        fields: { ...source.fields, ...mirror?.fields, ...patch },
      }
      if (loseResponse) {
        loseResponse = false
        throw new AppError('PROVIDER_UNAVAILABLE', 'Lost response', 502)
      }
      return mirror
    },
    async removeMirror() {},
  }
  const adapters = { source: a, destination: b }
  const plan = await planRule(env, 'u', rule, false, adapters)
  await persistPlan(env, 'u', rule, plan)
  const row = await env.DB.prepare('SELECT id FROM operations WHERE rule_id=?')
    .bind(rule.id)
    .first<{ id: string }>()
  expect(row).not.toBeNull()
  await expect(executeOperation(env, 'u', row!.id, adapters)).rejects.toThrow()
  expect(
    (
      await env.DB.prepare('SELECT cursor FROM sync_cursors WHERE rule_id=? AND side=?')
        .bind(rule.id, 'source')
        .first<{ cursor: string }>()
    )?.cursor,
  ).toBe('advanced')
  source = { ...source, fields: { ...source.fields, title: 'Changed during outage' } }
  await executeOperation(env, 'u', row!.id, adapters)
  expect(created).toBe(1)
  expect(mirror!.fields.title).toBe('Changed during outage')
  expect(
    (
      await env.DB.prepare('SELECT status FROM operations WHERE id=?')
        .bind(row!.id)
        .first<{ status: string }>()
    )?.status,
  ).toBe('done')
  rule.options.completion = 'remove'
  await env.DB.prepare('UPDATE rules SET payload=? WHERE id=?')
    .bind(JSON.stringify(rule), rule.id)
    .run()
  source = { ...source, revision: '2', fields: { ...source.fields, completed: true } }
  const completePlan = await planRule(env, 'u', rule, false, adapters)
  await persistPlan(env, 'u', rule, completePlan)
  const completeOp = await env.DB.prepare(
    "SELECT id FROM operations WHERE rule_id=? AND status='pending'",
  )
    .bind(rule.id)
    .first<{ id: string }>()
  expect(completeOp).not.toBeNull()
  await executeOperation(env, 'u', completeOp!.id, adapters)
  expect((await getLink(env.DB, 'u', rule.id, source.id))?.removedByRule).toBe('completion')
  mirror = { ...mirror!, deleted: true }
  source = { ...source, revision: '3', fields: { ...source.fields, completed: false } }
  const reopenPlan = await planRule(env, 'u', rule, false, adapters)
  await persistPlan(env, 'u', rule, reopenPlan)
  const reopenOp = await env.DB.prepare(
    "SELECT id FROM operations WHERE rule_id=? AND status='pending'",
  )
    .bind(rule.id)
    .first<{ id: string }>()
  expect(reopenOp).not.toBeNull()
  await executeOperation(env, 'u', reopenOp!.id, adapters)
  expect((await getLink(env.DB, 'u', rule.id, source.id))?.removedByRule).toBeUndefined()
  expect(mirror!.deleted).toBe(false)
})
it('refuses a queued operation after trial expiry', async () => {
  await env.DB.prepare('UPDATE customers SET trial_ends_at=0 WHERE user_id=?').bind('u').run()
  const row = await env.DB.prepare('SELECT payload FROM operations LIMIT 1').first<{
    payload: string
  }>()
  const op = JSON.parse(row!.payload)
  op.id = 'expired-op'
  await env.DB.prepare(
    'INSERT INTO operations(id,user_id,rule_id,status,next_attempt_at,attempts,payload) VALUES(?,?,?,?,?,?,?)',
  )
    .bind(op.id, 'u', op.ruleId, 'pending', Date.now(), 0, JSON.stringify(op))
    .run()
  await expect(executeOperation(env, 'u', op.id)).rejects.toMatchObject({
    code: 'BILLING_REQUIRED',
  })
})
it('refuses queued writes after a provider is disconnected', async () => {
  await env.DB.prepare('UPDATE customers SET trial_ends_at=? WHERE user_id=?')
    .bind(Date.now() + 86400000, 'u')
    .run()
  await env.DB.prepare("UPDATE connections SET status='disconnected' WHERE id='g'").run()
  await expect(executeOperation(env, 'u', 'expired-op')).rejects.toMatchObject({
    code: 'RECONNECT_REQUIRED',
  })
})
it('refuses queued writes after the rule is paused', async () => {
  await env.DB.prepare("UPDATE rules SET status='paused' WHERE user_id='u'").run()
  await expect(executeOperation(env, 'u', 'expired-op')).rejects.toMatchObject({
    code: 'RULE_PAUSED',
  })
})
