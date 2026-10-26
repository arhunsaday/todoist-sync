import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type MiddlewareHandler } from 'hono'
import { basicAuth } from 'hono/basic-auth'

import { getConfig, reloadConfig, validateSettings } from '../config.js'
import type { Db } from '../db/index.js'
import { saveSettings } from '../db/settings.js'
import { getToken } from '../db/state.js'
import { discover } from '../discovery.js'
import * as googleOAuth from '../google/oauth.js'
import { GOOGLE_WEBHOOK_PATH } from '../google/watch.js'
import { logger } from '../logger.js'
import { currentSettings, settingsSchema, toSettingValues } from '../settings.js'
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
  /**
   * Guards `/setup` and `/admin` with basic auth. Passed in rather than read
   * from config so tests can exercise both states — and so a value in a
   * developer's `.env` cannot silently change how the app under test behaves.
   */
  adminToken?: string | undefined
  /** `undefined` until both providers have been authorized. */
  getEngine: () => SyncEngine | undefined
  /** Called after a successful OAuth callback so the engine can be built. */
  onAuthorized: () => Promise<void>
  /**
   * Called after settings are saved from the UI. The mapping needs more than
   * a config reload: routing, watch channels and an import of new projects.
   */
  onSettingsChanged?: (change: { mappings: boolean }) => Promise<void>
  /** Absolute path to the built UI. Omitted in tests and under `pnpm dev`. */
  staticRoot?: string | undefined
}

/** Reachable without the admin password: the platform and the two providers. */
function isPublicPath(path: string): boolean {
  return path === '/health' || path.startsWith('/webhooks/')
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  const adminToken = deps.adminToken

  // Basic auth rather than a token in the query string: the browser prompts
  // once and the value never lands in history, logs, or a Referer header.
  //
  // Deliberately not applied to /webhooks (Todoist and Google authenticate
  // themselves, by HMAC and channel token) or /health (the platform's
  // healthcheck must reach it unauthenticated).
  if (adminToken !== undefined) {
    const guard = basicAuth({ username: 'admin', password: adminToken })
    const guardPrivate: MiddlewareHandler = (c, next) =>
      isPublicPath(c.req.path) ? next() : guard(c, next)
    app.use('*', guardPrivate)
  } else {
    logger.warn(
      'ADMIN_TOKEN is not set: the UI and /setup are publicly reachable, and ' +
        'anyone who completes the OAuth flow there replaces the stored token. ' +
        'Saving settings and resyncing are disabled until you set it.',
    )
  }

  app.get('/health', (c) => {
    const todoist = getToken(deps.db, 'todoist') !== undefined
    const google = getToken(deps.db, 'google') !== undefined
    const mappings = getConfig().SYNC_MAPPINGS.length

    // Always 200, including before setup is finished: a failing healthcheck
    // would have the platform restart the container in a loop, and you could
    // never reach /setup to authorize it.
    const blocked = deps.getEngine()?.blockedCalendars ?? []

    return c.json({
      status:
        deps.getEngine() === undefined
          ? 'awaiting-setup'
          : blocked.length > 0
            ? 'blocked'
            : 'ok',
      authorized: { todoist, google },
      mappings,
      // Calendars the circuit breaker is refusing. Non-empty means a pass would
      // have completed an implausible number of tasks and was rejected.
      blockedCalendars: blocked,
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
  /* UI API                                                            */
  /* ---------------------------------------------------------------- */

  const state = () => {
    const engine = deps.getEngine()
    const linkCounts = Object.fromEntries(
      deps.db
        .prepare<[], { calendarId: string; count: number }>(
          `SELECT google_calendar_id AS calendarId, COUNT(*) AS count
           FROM links GROUP BY google_calendar_id`,
        )
        .all()
        .map(({ calendarId, count }) => [calendarId, count]),
    )
    const publicUrl = getConfig().PUBLIC_URL

    return {
      authorized: {
        todoist: getToken(deps.db, 'todoist') !== undefined,
        google: getToken(deps.db, 'google') !== undefined,
      },
      // Writes need the admin password; the UI says why its buttons are off.
      canEdit: adminToken !== undefined,
      syncing: engine !== undefined,
      engine: engine?.status ?? null,
      blockedCalendars: engine?.blockedCalendars ?? [],
      linkCounts,
      settings: currentSettings(),
      webhooks: {
        todoist: new URL(TODOIST_WEBHOOK_PATH, publicUrl).toString(),
        google: new URL(GOOGLE_WEBHOOK_PATH, publicUrl).toString(),
      },
    }
  }

  app.get('/api/state', (c) => c.json(state()))

  app.get('/api/discovery', async (c) => c.json(await discover(deps.db)))

  app.put('/api/settings', async (c) => {
    if (adminToken === undefined) {
      return c.json({ errors: ['ADMIN_TOKEN is not set'] }, 503)
    }

    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ errors: parsed.error.issues.map((i) => i.message) }, 400)
    }

    const values = toSettingValues(parsed.data)
    if (Array.isArray(values)) return c.json({ errors: values }, 400)

    // The env schema also catches what the structured one cannot, such as a
    // calendar mapped to two projects.
    const errors = validateSettings(values)
    if (errors.length > 0) return c.json({ errors }, 400)

    const before = getConfig().SYNC_MAPPINGS
    saveSettings(deps.db, values)
    reloadConfig()

    const mappings = JSON.stringify(before) !== JSON.stringify(getConfig().SYNC_MAPPINGS)
    logger.info({ mappings }, 'settings saved from the UI')
    await deps.onSettingsChanged?.({ mappings })

    return c.json(state())
  })

  /**
   * Force a full resync: picks up tasks that predate the app, or that an
   * earlier error skipped. A POST, so prefetchers and link scanners that
   * follow GETs cannot fire it on their own.
   */
  app.post('/api/resync', (c) => {
    if (adminToken === undefined) {
      return c.json({ errors: ['ADMIN_TOKEN is not set'] }, 503)
    }

    const engine = deps.getEngine()
    if (engine === undefined) {
      return c.json({ errors: ['Connect both accounts and map a project first.'] }, 409)
    }

    // A full sync can take a while, so do not hold the request open for it.
    engine.triggerResyncAll('ui')
    return c.json(state())
  })

  /* ---------------------------------------------------------------- */
  /* OAuth                                                             */
  /* ---------------------------------------------------------------- */

  // The old setup and admin pages now live in the UI.
  app.get('/setup', (c) => c.redirect('/'))
  app.get('/setup/ids', (c) => c.redirect('/'))
  app.get('/admin/resync', (c) => c.redirect('/'))

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
    return c.redirect('/?connected=todoist')
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
    return c.redirect('/?connected=google')
  })

  /* ---------------------------------------------------------------- */
  /* UI                                                                */
  /* ---------------------------------------------------------------- */

  if (deps.staticRoot !== undefined) {
    app.get('*', serveStatic({ root: deps.staticRoot }))
    // Single-page app: any other GET renders the shell.
    app.get('*', serveStatic({ root: deps.staticRoot, path: 'index.html' }))
  }

  return app
}
