import { env } from 'cloudflare:test'
import { beforeAll, it, expect } from 'vitest'
import authSql from '../migrations/0001_auth.sql?raw'
import domainSql from '../migrations/0002_domain.sql?raw'
import jobsSql from '../migrations/0003_jobs.sql?raw'
import { canSync } from '@accord/domain'
import { billing } from './storage/db'
import { createTestSession } from './test/session'
beforeAll(async () => {
  await env.DB.exec(authSql)
  await env.DB.exec(domainSql)
  await env.DB.exec(jobsSql)
  await createTestSession(env, 'owner')
  await createTestSession(env, 'guest')
  await env.DB.prepare('UPDATE customers SET trial_ends_at=0').run()
})
it('keeps syncing for an owner after the trial has ended', async () => {
  const b = await billing(env.DB, 'owner', 'OWNER@test.local')
  expect(b.owner).toBe(true)
  expect(canSync(b, Date.now())).toBe(true)
})
it('still suspends other accounts once their trial has ended', async () => {
  const b = await billing(env.DB, 'guest', 'owner@test.local')
  expect(b.owner).toBe(false)
  expect(canSync(b, Date.now())).toBe(false)
  expect(canSync(await billing(env.DB, 'owner'), Date.now())).toBe(false)
})
