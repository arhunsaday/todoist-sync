import { AppError } from '@accord/domain'
import { requestJson } from '@accord/providers'
import { connection } from '../storage/db'
import type { Env } from '../env'
import { openToken, sealToken } from './crypto'
import type { Tokens } from './oauth'
export async function accessToken(env: Env, userId: string, connectionId: string): Promise<string> {
  const c = await connection(env.DB, userId, connectionId)
  if (!env.TOKEN_ENCRYPTION_KEY)
    throw new AppError('CONFIGURATION', 'La clé de chiffrement n’est pas configurée.', 503)
  const aad = `${userId}:${c.id}:${c.provider}`,
    t = await openToken<Tokens>(c.encrypted_tokens, env.TOKEN_ENCRYPTION_KEY, 'v1', aad)
  if (!t.expires_at || t.expires_at > Date.now() + 60000) return t.access_token
  if (!t.refresh_token) {
    await env.DB.prepare("UPDATE connections SET status='reconnect' WHERE id=? AND user_id=?")
      .bind(c.id, userId)
      .run()
    throw new AppError(
      'RECONNECT_REQUIRED',
      'Reconnectez cet outil pour renouveler son accès.',
      409,
    )
  }
  let token: Tokens & { expires_in?: number }
  try {
    if (c.provider === 'notion')
      token = await requestJson('https://api.notion.com/v1/oauth/token', {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + btoa(env.NOTION_CLIENT_ID + ':' + env.NOTION_CLIENT_SECRET),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: t.refresh_token }),
      })
    else
      token = await requestJson(
        c.provider === 'google'
          ? 'https://oauth2.googleapis.com/token'
          : 'https://api.todoist.com/oauth/access_token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: t.refresh_token,
            client_id:
              (c.provider === 'google' ? env.GOOGLE_CLIENT_ID : env.TODOIST_CLIENT_ID) ?? '',
            client_secret:
              (c.provider === 'google' ? env.GOOGLE_CLIENT_SECRET : env.TODOIST_CLIENT_SECRET) ??
              '',
          }),
        },
      )
  } catch (e) {
    if (e instanceof AppError && e.status < 500) {
      await env.DB.prepare("UPDATE connections SET status='reconnect' WHERE id=? AND user_id=?")
        .bind(c.id, userId)
        .run()
      throw new AppError(
        'RECONNECT_REQUIRED',
        'L’autorisation a expiré. Reconnectez cet outil.',
        409,
      )
    }
    throw e
  }
  if (!token.access_token)
    throw new AppError('PROVIDER_UNAVAILABLE', 'Le renouvellement n’a pas fourni de jeton.', 502)
  const fresh = {
    ...t,
    ...token,
    refresh_token: token.refresh_token ?? t.refresh_token,
    expires_at: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
  }
  const ciphertext = await sealToken(fresh, env.TOKEN_ENCRYPTION_KEY, 'v1', aad)
  const update = await env.DB.prepare(
    "UPDATE connections SET encrypted_tokens=? WHERE id=? AND user_id=? AND encrypted_tokens=? AND status='connected'",
  )
    .bind(ciphertext, c.id, userId, c.encrypted_tokens)
    .run()
  if (!update.meta.changes) return accessToken(env, userId, connectionId)
  return fresh.access_token
}
