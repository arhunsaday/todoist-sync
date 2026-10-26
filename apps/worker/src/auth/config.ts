import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../storage/schema'
import type { Env } from '../env'
export function authFor(env: Env) {
  return betterAuth({
    baseURL: env.PUBLIC_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.DB, { schema }), { provider: 'sqlite', schema }),
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {},
    advanced: { useSecureCookies: env.PUBLIC_URL.startsWith('https://') },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: 'database',
      storeAccountCookie: false,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (u) => {
            const bytes = await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(env.BETTER_AUTH_SECRET + ':' + u.email.toLowerCase()),
            )
            const hash = Array.from(new Uint8Array(bytes), (x) =>
              x.toString(16).padStart(2, '0'),
            ).join('')
            const now = Date.now()
            const claim = await env.DB.prepare(
              'INSERT OR IGNORE INTO trial_claims(identity_hash,first_claimed_at) VALUES(?,?)',
            )
              .bind(hash, now)
              .run()
            await env.DB.prepare(
              'INSERT OR IGNORE INTO customers(user_id,trial_ends_at) VALUES(?,?)',
            )
              .bind(u.id, claim.meta.changes ? now + 14 * 86400000 : now)
              .run()
          },
        },
      },
    },
  })
}
