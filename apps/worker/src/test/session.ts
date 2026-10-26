import { makeSignature } from 'better-auth/crypto'
import { authFor } from '../auth/config'
import type { Env } from '../env'
export async function createTestSession(env: Env, id: string) {
  const now = Date.now(),
    token = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT OR IGNORE INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)',
  )
    .bind(id, id, id + '@test.local', 1, now, now)
    .run()
  await env.DB.prepare('INSERT OR IGNORE INTO customers(user_id,trial_ends_at) VALUES(?,?)')
    .bind(id, now + 86400000)
    .run()
  await env.DB.prepare(
    'INSERT INTO session(id,expires_at,token,created_at,updated_at,user_id) VALUES(?,?,?,?,?,?)',
  )
    .bind(crypto.randomUUID(), now + 86400000, token, now, now, id)
    .run()
  const ctx = await authFor(env).$context
  return `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(token + '.' + (await makeSignature(token, env.BETTER_AUTH_SECRET!)))}`
}
