import { AppError, type Provider } from '@accord/domain'
import type { Env } from '../env'
import { verifyHmac, digest, sealToken, openToken } from '../connections/crypto'
export async function receiveProviderWebhook(env: Env, provider: Provider, request: Request) {
  const raw = await request.text()
  let users: string[] = [],
    receipt = await digest(raw)
  if (provider === 'google') {
    const id = request.headers.get('x-goog-channel-id'),
      token = request.headers.get('x-goog-channel-token'),
      resource = request.headers.get('x-goog-resource-id')
    const channel = id
      ? await env.DB.prepare(
          'SELECT user_id,token,resource_id,expiration FROM watch_channels WHERE channel_id=?',
        )
          .bind(id)
          .first<{ user_id: string; token: string; resource_id: string; expiration: number }>()
      : null
    if (
      !channel ||
      channel.expiration < Date.now() ||
      token !== channel.token ||
      resource !== channel.resource_id
    )
      throw new AppError('WEBHOOK_SIGNATURE', 'Canal Google inconnu ou non autorisé.', 401)
    users = [channel.user_id]
    receipt = id + ':' + (request.headers.get('x-goog-message-number') ?? receipt)
  } else if (provider === 'todoist') {
    if (!env.TODOIST_CLIENT_SECRET)
      throw new AppError('CONFIGURATION', 'Le webhook Todoist n’est pas configuré.', 503)
    if (
      !(await verifyHmac(
        raw,
        request.headers.get('x-todoist-hmac-sha256') ?? '',
        env.TODOIST_CLIENT_SECRET,
        'base64',
      ))
    )
      throw new AppError('WEBHOOK_SIGNATURE', 'Signature Todoist invalide.', 401)
    const payload = JSON.parse(raw) as {
      user_id?: string | number
      event_data?: { user_id?: string | number }
    }
    const externalId = payload.user_id ?? payload.event_data?.user_id
    if (externalId === undefined)
      throw new AppError('WEBHOOK_PAYLOAD', 'Utilisateur Todoist absent.', 400)
    users = (
      await env.DB.prepare(
        "SELECT user_id FROM connections WHERE provider='todoist' AND external_user_id=? AND status='connected'",
      )
        .bind(String(externalId))
        .all<{ user_id: string }>()
    ).results.map((x) => x.user_id)
  } else {
    const payload = JSON.parse(raw) as {
      verification_token?: string
      workspace_id?: string
      id?: string
    }
    if (payload.verification_token) {
      if (
        !env.NOTION_HANDSHAKE_KEY ||
        new URL(request.url).searchParams.get('setup') !== env.NOTION_HANDSHAKE_KEY ||
        !env.TOKEN_ENCRYPTION_KEY
      )
        throw new AppError(
          'WEBHOOK_SETUP',
          'Configurez la clé temporaire de vérification Notion.',
          503,
        )
      const encrypted = await sealToken(
        payload.verification_token,
        env.TOKEN_ENCRYPTION_KEY,
        'v1',
        'notion-webhook',
      )
      const inserted = await env.DB.prepare(
        "INSERT OR IGNORE INTO provider_secrets(key,encrypted_value,created_at) VALUES('notion-webhook',?,?)",
      )
        .bind(encrypted, Date.now())
        .run()
      if (!inserted.meta.changes)
        throw new AppError('WEBHOOK_SETUP', 'La vérification Notion a déjà été initialisée.', 409)
      return { ok: true }
    }
    let secret = env.NOTION_WEBHOOK_SECRET
    if (!secret && env.TOKEN_ENCRYPTION_KEY) {
      const stored = await env.DB.prepare(
        "SELECT encrypted_value FROM provider_secrets WHERE key='notion-webhook'",
      ).first<{ encrypted_value: string }>()
      if (stored)
        secret = await openToken<string>(
          stored.encrypted_value,
          env.TOKEN_ENCRYPTION_KEY,
          'v1',
          'notion-webhook',
        )
    }
    if (!secret)
      throw new AppError('CONFIGURATION', 'La vérification Notion n’est pas configurée.', 503)
    if (
      !(await verifyHmac(
        raw,
        (request.headers.get('x-notion-signature') ?? '').replace(/^sha256=/, ''),
        secret,
      ))
    )
      throw new AppError('WEBHOOK_SIGNATURE', 'Signature Notion invalide.', 401)
    receipt = payload.id ?? receipt
    if (!payload.workspace_id) throw new AppError('WEBHOOK_PAYLOAD', 'Espace Notion absent.', 400)
    users = (
      await env.DB.prepare(
        "SELECT user_id FROM connections WHERE provider='notion' AND external_user_id=? AND status='connected'",
      )
        .bind(payload.workspace_id)
        .all<{ user_id: string }>()
    ).results.map((x) => x.user_id)
  }
  const recorded = await env.DB.prepare(
    'INSERT OR IGNORE INTO webhook_receipts(provider,receipt_id,created_at) VALUES(?,?,?)',
  )
    .bind(provider, receipt, Date.now())
    .run()
  if (!recorded.meta.changes) return { ok: true }
  try {
    for (const userId of new Set(users))
      await env.SYNC_QUEUE.send({ userId, reason: provider + '-webhook' })
  } catch (e) {
    await env.DB.prepare('DELETE FROM webhook_receipts WHERE provider=? AND receipt_id=?')
      .bind(provider, receipt)
      .run()
    throw e
  }
  return { ok: true }
}
