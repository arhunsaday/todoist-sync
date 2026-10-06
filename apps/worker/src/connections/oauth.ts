import { AppError, type Provider } from '@accord/domain'
import type { Env } from '../env'
import { sealToken, digest } from './crypto'
import { requestJson } from '@accord/providers'
export interface Tokens {
  access_token: string
  refresh_token?: string
  expires_at?: number
  scope?: string
}
function credentials(env: Env, provider: Provider) {
  const pair =
    provider === 'google'
      ? [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET]
      : provider === 'todoist'
        ? [env.TODOIST_CLIENT_ID, env.TODOIST_CLIENT_SECRET]
        : [env.NOTION_CLIENT_ID, env.NOTION_CLIENT_SECRET]
  if (!pair[0] || !pair[1] || !env.TOKEN_ENCRYPTION_KEY)
    throw new AppError(
      'CONFIGURATION',
      'Cette intégration n’est pas encore configurée sur cette instance.',
      503,
    )
  return { id: pair[0], secret: pair[1] }
}
function callback(env: Env, p: Provider) {
  return env.PUBLIC_URL + '/api/connections/' + p + '/callback'
}
export async function startOAuth(env: Env, userId: string, provider: Provider) {
  const creds = credentials(env, provider),
    state = crypto.randomUUID() + crypto.randomUUID()
  const verifier = provider === 'google' ? crypto.randomUUID() + crypto.randomUUID() : null
  await env.DB.prepare(
    'INSERT INTO oauth_attempts(state,user_id,provider,verifier,expires_at) VALUES(?,?,?,?,?)',
  )
    .bind(state, userId, provider, verifier, Date.now() + 600000)
    .run()
  const url = new URL(
    provider === 'google'
      ? 'https://accounts.google.com/o/oauth2/v2/auth'
      : provider === 'todoist'
        ? 'https://app.todoist.com/oauth/authorize'
        : 'https://api.notion.com/v1/oauth/authorize',
  )
  url.searchParams.set('client_id', creds.id)
  url.searchParams.set('redirect_uri', callback(env, provider))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  if (provider === 'google') {
    url.searchParams.set(
      'scope',
      'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    )
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    const bytes = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier!)),
    )
    url.searchParams.set(
      'code_challenge',
      btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, ''),
    )
    url.searchParams.set('code_challenge_method', 'S256')
  } else if (provider === 'todoist') url.searchParams.set('scope', 'data:read_write')
  else url.searchParams.set('owner', 'user')
  return { url: url.toString() }
}
export async function finishOAuth(
  env: Env,
  userId: string,
  provider: Provider,
  code: string,
  state: string,
) {
  const creds = credentials(env, provider)
  const attempt = await env.DB.prepare(
    'DELETE FROM oauth_attempts WHERE state=? AND user_id=? AND provider=? AND expires_at>? RETURNING verifier',
  )
    .bind(state, userId, provider, Date.now())
    .first<{ verifier: string | null }>()
  if (!attempt)
    throw new AppError(
      'OAUTH_STATE',
      'Cette autorisation a expiré ou a déjà été utilisée. Recommencez.',
      400,
    )
  let token: Tokens & {
    expires_in?: number
    bot_id?: string
    workspace_id?: string
    workspace_name?: string
    owner?: { user?: { id: string } }
  }
  if (provider === 'google') {
    token = await requestJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.id,
        client_secret: creds.secret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: callback(env, provider),
        code_verifier: attempt.verifier!,
      }),
    })
    const scopes = token.scope?.split(' ') ?? []
    if (
      !scopes.includes('https://www.googleapis.com/auth/calendar.events') ||
      !scopes.includes('https://www.googleapis.com/auth/calendar.calendarlist.readonly')
    )
      throw new AppError(
        'OAUTH_SCOPE',
        'Autorisez les événements et la liste des calendriers pour connecter Google Agenda.',
        400,
      )
  } else if (provider === 'todoist') {
    token = await requestJson('https://api.todoist.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.id,
        client_secret: creds.secret,
        code,
        redirect_uri: callback(env, provider),
      }),
    })
  } else
    token = await requestJson('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(creds.id + ':' + creds.secret),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callback(env, provider),
      }),
    })
  if (!token.access_token)
    throw new AppError('OAUTH_TOKEN', 'L’autorisation ne contient pas de jeton valide.', 502)
  if (token.expires_in) token.expires_at = Date.now() + token.expires_in * 1000
  let externalId: string, name: string
  if (provider === 'todoist') {
    const u = await requestJson<{ id: string; full_name: string }>(
      'https://api.todoist.com/api/v1/user',
      { headers: { Authorization: 'Bearer ' + token.access_token } },
    )
    externalId = String(u.id)
    name = u.full_name || 'Todoist'
  } else if (provider === 'google') {
    // The Calendar id is sufficient for display and push routing; no identity scope added.
    const list = await requestJson<{ items: { id: string; summary: string; primary?: boolean }[] }>(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: 'Bearer ' + token.access_token } },
    )
    const primary = list.items.find((x) => x.primary) ?? list.items[0]
    if (!primary) throw new AppError('NO_CALENDAR', 'Aucun calendrier accessible.', 400)
    externalId = primary.id
    name = primary.summary
  } else {
    externalId = token.workspace_id ?? token.bot_id ?? ''
    name = token.workspace_name ?? 'Notion'
    if (!externalId) throw new AppError('OAUTH_TOKEN', 'Espace Notion introuvable.', 502)
  }
  const existing = await env.DB.prepare('SELECT id FROM connections WHERE user_id=? AND provider=?')
    .bind(userId, provider)
    .first<{ id: string }>()
  const id = existing?.id ?? crypto.randomUUID()
  const encrypted = await sealToken(
    token,
    env.TOKEN_ENCRYPTION_KEY!,
    'v1',
    `${userId}:${id}:${provider}`,
  )
  await env.DB.prepare(
    'INSERT INTO connections(id,user_id,provider,name,external_user_id,status,encrypted_tokens,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET name=excluded.name,external_user_id=excluded.external_user_id,status=excluded.status,encrypted_tokens=excluded.encrypted_tokens',
  )
    .bind(id, userId, provider, name, externalId, 'connected', encrypted, Date.now())
    .run()
  return id
}
export async function disconnect(env: Env, userId: string, id: string) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE connections SET status='disconnected',encrypted_tokens='' WHERE id=? AND user_id=?",
    ).bind(id, userId),
    env.DB.prepare(
      "UPDATE rules SET status='paused' WHERE user_id=? AND (json_extract(payload,'$.source.connectionId')=? OR json_extract(payload,'$.destination.connectionId')=?)",
    ).bind(userId, id, id),
    env.DB.prepare(
      "UPDATE operations SET status='canceled' WHERE user_id=? AND rule_id IN (SELECT id FROM rules WHERE user_id=? AND (json_extract(payload,'$.source.connectionId')=? OR json_extract(payload,'$.destination.connectionId')=?)) AND status IN ('pending','running')",
    ).bind(userId, userId, id, id),
    env.DB.prepare('DELETE FROM watch_channels WHERE user_id=? AND connection_id=?').bind(
      userId,
      id,
    ),
  ])
}
