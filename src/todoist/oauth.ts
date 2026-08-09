import { getCredentials } from '../config.js'
import type { Db } from '../db/index.js'
import { getToken, saveToken } from '../db/state.js'
import { logger } from '../logger.js'
import { tokenResponseSchema, type TokenResponse } from './types.js'

const AUTHORIZE_URL = 'https://app.todoist.com/oauth/authorize'
const TOKEN_URL = 'https://api.todoist.com/oauth/access_token'

/** Read and write tasks. We complete tasks rather than delete them, so
 *  `data:delete` is deliberately not requested. */
export const TODOIST_SCOPE = 'data:read_write'

/** Refresh this far ahead of expiry to absorb clock skew and slow requests. */
const REFRESH_SKEW_MS = 60_000

export function buildAuthorizeUrl(state: string): string {
  const config = getCredentials()
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', config.TODOIST_CLIENT_ID)
  url.searchParams.set('scope', TODOIST_SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('redirect_uri', config.TODOIST_REDIRECT_URI)
  return url.toString()
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })

  if (!response.ok) {
    throw new Error(
      `Todoist token request failed (${response.status}): ${(
        await response.text()
      ).slice(0, 500)}`,
    )
  }

  return tokenResponseSchema.parse(await response.json())
}

function persist(db: Db, token: TokenResponse): void {
  saveToken(db, 'todoist', {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt:
      token.expires_in === undefined
        ? undefined
        : Date.now() + token.expires_in * 1000,
  })
}

export async function exchangeCode(db: Db, code: string): Promise<void> {
  const config = getCredentials()
  persist(
    db,
    await postToken({
      client_id: config.TODOIST_CLIENT_ID,
      client_secret: config.TODOIST_CLIENT_SECRET,
      code,
      redirect_uri: config.TODOIST_REDIRECT_URI,
    }),
  )
  logger.info('stored Todoist OAuth token')
}

/**
 * Returns a valid access token, refreshing first if it is close to expiry.
 *
 * Falls back to `TODOIST_API_TOKEN` when no OAuth token is stored, so that
 * `pnpm list-ids` works before the OAuth flow has been completed. That fallback
 * is read-only in practice: webhooks never fire for a personal token.
 */
export function createTodoistTokenProvider(db: Db): () => Promise<string> {
  return async () => {
    const stored = getToken(db, 'todoist')

    if (stored === undefined) {
      const fallback = getCredentials().TODOIST_API_TOKEN
      if (fallback !== undefined) {
        logger.warn(
          'using TODOIST_API_TOKEN — webhooks will not fire until OAuth is completed at /setup/todoist',
        )
        return fallback
      }
      throw new Error(
        'No Todoist token. Visit /setup/todoist to authorize, or set TODOIST_API_TOKEN.',
      )
    }

    const expiring =
      stored.expiresAt !== undefined &&
      stored.expiresAt - REFRESH_SKEW_MS <= Date.now()

    if (!expiring) return stored.accessToken

    if (stored.refreshToken === undefined) {
      throw new Error(
        'Todoist access token expired and no refresh token is stored. Re-authorize at /setup/todoist.',
      )
    }

    const config = getCredentials()
    const refreshed = await postToken({
      client_id: config.TODOIST_CLIENT_ID,
      client_secret: config.TODOIST_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
    })

    persist(db, refreshed)
    logger.info('refreshed Todoist access token')
    return refreshed.access_token
  }
}
