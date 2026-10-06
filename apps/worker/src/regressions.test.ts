import { env } from 'cloudflare:test'
import { beforeAll, it, expect } from 'vitest'
import authSql from '../migrations/0001_auth.sql?raw'
import domainSql from '../migrations/0002_domain.sql?raw'
import jobsSql from '../migrations/0003_jobs.sql?raw'
import { makeRule, type Entity, type Rule } from '@accord/domain'
import { createTestSession } from './test/session'
import { persistPlan } from './sync/reconcile'
import { activateRule } from './rules/preview'
beforeAll(async () => {
  await env.DB.exec(authSql)
  await env.DB.exec(domainSql)
  await env.DB.exec(jobsSql)
  await createTestSession(env, 'regression')
})
async function insert(rule: Rule) {
  await env.DB.prepare('INSERT INTO rules(id,user_id,revision,status,payload) VALUES(?,?,?,?,?)')
    .bind(rule.id, rule.userId, rule.revision, rule.status, JSON.stringify(rule))
    .run()
}
it('records distinct operations for repeated A-B-A-B edit cycles', async () => {
  const r = makeRule('regression')
  r.source = { provider: 'todoist', connectionId: 't', resourceId: 'p' }
  r.destination = { provider: 'google', connectionId: 'g', resourceId: 'c' }
  await insert(r)
  for (let i = 1; i <= 3; i++) {
    const fields = {
      title: i % 2 ? 'B' : 'A',
      description: '',
      schedule: null,
      completed: false,
      priority: 4 as const,
    }
    const source: Entity = {
      id: 'task',
      ref: r.source,
      fields,
      revision: String(i),
      deleted: false,
      recurring: false,
      metadata: {},
    }
    const destination = {
      ...source,
      id: 'event',
      ref: r.destination,
      fields: { ...fields, title: i % 2 ? 'A' : 'B' },
      revision: String(i),
    }
    await persistPlan(env, 'regression', r, {
      pairs: [
        {
          source,
          destination,
          link: null,
          originSide: 'source',
          decisions: [
            {
              kind: 'write',
              entityId: 'task',
              target: r.destination,
              patch: { title: fields.title },
              reason: 'Update',
              targetId: 'event',
            },
          ],
        },
      ],
      sourceCursor: String(i),
      destinationCursor: String(i),
      hash: 'h' + i,
      mutations: 1,
    })
    await env.DB.prepare("UPDATE operations SET status='done' WHERE rule_id=?").bind(r.id).run()
  }
  expect(
    (
      await env.DB.prepare('SELECT COUNT(*) AS count FROM operations WHERE rule_id=?')
        .bind(r.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(3)
})
it('rejects reactivation when paused rules would form a triangle', async () => {
  const a = { provider: 'todoist' as const, connectionId: 't', resourceId: 'x' },
    b = { provider: 'google' as const, connectionId: 'g', resourceId: 'y' },
    c = { provider: 'notion' as const, connectionId: 'n', resourceId: 'z' }
  const one = { ...makeRule('regression'), source: a, destination: b, status: 'paused' as const }
  await insert(one)
  await insert({ ...makeRule('regression'), source: b, destination: c, status: 'active' })
  await insert({ ...makeRule('regression'), source: a, destination: c, status: 'active' })
  await expect(
    activateRule(env, 'regression', one.id, { token: 'missing-preview', revision: 1 }),
  ).rejects.toMatchObject({ code: 'VALIDATION' })
})
