import { Hono } from 'hono'

import type { Db } from '../db/index.js'
import { getToken } from '../db/state.js'
import * as googleOAuth from '../google/oauth.js'
import { GOOGLE_WEBHOOK_PATH } from '../google/watch.js'
import { logger } from '../logger.js'
import type { SyncEngine } from '../sync/engine.js'
import * as todoistOAuth from '../todoist/oauth.js'
import {
  GOOGLE_CHANNEL_ID_HEADER,
  GOOGLE_CHANNEL_TOKEN_HEADER,
  GOOGLE_RESOURCE_STATE_HEADER,
  classifyNotification,
} from './google-webhook.js'
import { consumeState, issueState } from './setup.js'
import {
  TODOIST_SIGNATURE_HEADER,
  TODOIST_WEBHOOK_PATH,
  isValidSignature,
} from './todoist-webhook.js'

export interface AppDeps {
  db: Db
  /** `undefined` until both providers have been authorized. */
  getEngine: () => SyncEngine | undefined
  /** Called after a successful OAuth callback so the engine can be built. */
  onAuthorized: () => Promise<void>
}

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.6">
<h1>${title}</h1>${body}</body>`
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/health', (c) => {
    const todoist = getToken(deps.db, 'todoist') !== undefined
    const google = getToken(deps.db, 'google') !== undefined

    return c.json({
      status: deps.getEngine() === undefined ? 'awaiting-authorization' : 'ok',
      authorized: { todoist, google },
    })
  })

  /* ---------------------------------------------------------------- */
  /* Webhooks — validate, wake the reconciler, return immediately.     */
  /* Neither handler reads task data out of its payload.               */
  /* ---------------------------------------------------------------- */

  app.post(TODOIST_WEBHOOK_PATH, async (c) => {
    // Must be the raw bytes: re-serialising parsed JSON breaks the HMAC.
    const rawBody = await c.req.text()

    if (!isValidSignature(rawBody, c.req.header(TODOIST_SIGNATURE_HEADER))) {
      logger.warn('rejected Todoist webhook with a bad signature')
      return c.text('invalid signature', 401)
    }

    deps.getEngine()?.trigger('todoist-webhook')
    // 200 straight away; Todoist retries on anything slow or non-2xx.
    return c.text('ok')
  })

  app.post(GOOGLE_WEBHOOK_PATH, (c) => {
    const notification = classifyNotification(deps.db, {
      channelId: c.req.header(GOOGLE_CHANNEL_ID_HEADER),
      channelToken: c.req.header(GOOGLE_CHANNEL_TOKEN_HEADER),
      resourceState: c.req.header(GOOGLE_RESOURCE_STATE_HEADER),
    })

    switch (notification.kind) {
      case 'invalid':
        logger.warn({ reason: notification.reason }, 'ignored Google notification')
        // Still 200: a non-2xx makes Google retry, and none of these are
        // worth retrying. Stale channels stop on their own at expiry.
        return c.text('ignored')

      case 'handshake':
        logger.debug(
          { calendarId: notification.calendarId },
          'google channel handshake',
        )
        return c.text('ok')

      case 'change':
        deps.getEngine()?.trigger(`google-webhook:${notification.calendarId}`)
        return c.text('ok')
    }
  })

  /* ---------------------------------------------------------------- */
  /* One-time OAuth setup                                              */
  /* ---------------------------------------------------------------- */

  app.get('/setup', (c) => {
    const todoist = getToken(deps.db, 'todoist') !== undefined
    const google = getToken(deps.db, 'google') !== undefined
    const mark = (done: boolean) => (done ? '&#10003;' : '&#9679;')

    return c.html(
      page(
        'Setup',
        `<ul>
           <li>${mark(todoist)} <a href="/setup/todoist">Authorize Todoist</a></li>
           <li>${mark(google)} <a href="/setup/google">Authorize Google Calendar</a></li>
         </ul>
         <p>Both are required before syncing starts.</p>`,
      ),
    )
  })

  app.get('/setup/todoist', (c) =>
    c.redirect(todoistOAuth.buildAuthorizeUrl(issueState('todoist'))),
  )

  app.get('/setup/todoist/callback', async (c) => {
    if (!consumeState('todoist', c.req.query('state'))) {
      return c.text('invalid or expired state', 400)
    }

    const code = c.req.query('code')
    if (code === undefined) return c.text('no code returned', 400)

    await todoistOAuth.exchangeCode(deps.db, code)
    await deps.onAuthorized()
    return c.html(page('Todoist authorized', '<p><a href="/setup">Back</a></p>'))
  })

  app.get('/setup/google', (c) =>
    c.redirect(googleOAuth.buildAuthorizeUrl(issueState('google'))),
  )

  app.get('/setup/google/callback', async (c) => {
    if (!consumeState('google', c.req.query('state'))) {
      return c.text('invalid or expired state', 400)
    }

    const code = c.req.query('code')
    if (code === undefined) return c.text('no code returned', 400)

    await googleOAuth.exchangeCode(deps.db, code)
    await deps.onAuthorized()
    return c.html(page('Google authorized', '<p><a href="/setup">Back</a></p>'))
  })

  return app
}
