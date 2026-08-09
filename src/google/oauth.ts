import { google } from 'googleapis'

import { getCredentials } from '../config.js'
import type { Db } from '../db/index.js'
import { getToken, saveToken } from '../db/state.js'
import { logger } from '../logger.js'

export type GoogleAuthClient = InstanceType<typeof google.auth.OAuth2>

/** Full calendar scope: we create, move, and delete events across calendars. */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar']

function createOAuthClient(): GoogleAuthClient {
  const config = getCredentials()
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI,
  )
}

export function buildAuthorizeUrl(state: string): string {
  return createOAuthClient().generateAuthUrl({
    // Without offline access there is no refresh token and the sync dies in an
    // hour. `prompt: consent` forces a fresh refresh token even on re-auth,
    // where Google would otherwise omit it.
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  })
}

export async function exchangeCode(db: Db, code: string): Promise<void> {
  const { tokens } = await createOAuthClient().getToken(code)

  if (tokens.access_token == null) {
    throw new Error('Google token exchange returned no access token')
  }
  if (tokens.refresh_token == null) {
    throw new Error(
      'Google token exchange returned no refresh token. Revoke the app at ' +
        'https://myaccount.google.com/permissions and authorize again.',
    )
  }

  saveToken(db, 'google', {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expiry_date ?? undefined,
  })
  logger.info('stored Google OAuth token')
}

/**
 * An OAuth client that refreshes itself and persists the result.
 *
 * google-auth-library refreshes on demand and emits `tokens`; without
 * persisting that we would mint a new access token on every process start.
 */
export function getAuthedClient(db: Db): GoogleAuthClient {
  const stored = getToken(db, 'google')

  if (stored === undefined) {
    throw new Error('No Google token. Visit /setup/google to authorize.')
  }

  const client = createOAuthClient()
  client.setCredentials({
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken,
    expiry_date: stored.expiresAt,
  })

  client.on('tokens', (tokens) => {
    if (tokens.access_token == null) return
    saveToken(db, 'google', {
      accessToken: tokens.access_token,
      // Omitted on refresh responses; saveToken keeps the stored one.
      refreshToken: tokens.refresh_token ?? undefined,
      expiresAt: tokens.expiry_date ?? undefined,
    })
    logger.debug('refreshed Google access token')
  })

  return client
}
