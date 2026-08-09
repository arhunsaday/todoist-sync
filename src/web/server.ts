import { Hono } from 'hono'

import { getConfig } from '../config.js'
import type { Db } from '../db/index.js'
import { getToken } from '../db/state.js'
import { discover, type NamedId } from '../discovery.js'
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;max-width:52rem;margin:4rem auto;line-height:1.6;padding:0 1rem">
<h1>${title}</h1>${body}</body>`
}

/**
 * A pairing form that emits the `SYNC_MAPPINGS` line.
 *
 * Hand-assembling the value means copying opaque ids like
 * `c_1a2b…@group.calendar.google.com` by eye, which is exactly the kind of
 * thing that produces a mapping that looks right and silently syncs to the
 * wrong calendar.
 */
function mappingBuilder(projects: NamedId[], calendars: NamedId[]): string {
  if (projects.length === 0 || calendars.length === 0) return ''

  const options = [
    '<option value="">— not synced —</option>',
    ...calendars.map(
      (c) =>
        `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`,
    ),
  ].join('')

  const rows = projects
    .map(
      (project) => `<tr>
        <td style="padding:.35rem .75rem .35rem 0">${escapeHtml(project.name)}</td>
        <td style="padding:.35rem 0">
          <select data-project="${escapeHtml(project.id)}">${options}</select>
        </td>
      </tr>`,
    )
    .join('')

  return `<h2>Build SYNC_MAPPINGS</h2>
<p>Pick the calendar each project should sync with.</p>
<table><tbody>${rows}</tbody></table>
<p style="margin-top:1.5rem"><strong>Paste this into your environment:</strong></p>
<pre id="out" style="background:#f4f4f5;padding:1rem;border-radius:6px;white-space:pre-wrap;word-break:break-all">SYNC_MAPPINGS=</pre>
<script>
  const selects = [...document.querySelectorAll('select[data-project]')]
  const out = document.getElementById('out')
  const render = () => {
    const pairs = selects
      .filter((s) => s.value !== '')
      .map((s) => s.dataset.project + ':' + s.value)
    out.textContent = 'SYNC_MAPPINGS=' + pairs.join(',')
  }
  selects.forEach((s) => s.addEventListener('change', render))
  render()
</script>`
}

function idTable(rows: NamedId[], heading: string): string {
  if (rows.length === 0) return `<h2>${heading}</h2><p>(none found)</p>`

  const body = rows
    .map(
      (row) => `<tr>
        <td style="padding:.25rem .75rem .25rem 0"><code>${escapeHtml(row.id)}</code></td>
        <td>${escapeHtml(row.name)}</td>
      </tr>`,
    )
    .join('')

  return `<h2>${heading}</h2><table><tbody>${body}</tbody></table>`
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/health', (c) => {
    const todoist = getToken(deps.db, 'todoist') !== undefined
    const google = getToken(deps.db, 'google') !== undefined
    const mappings = getConfig().SYNC_MAPPINGS.length

    // Always 200, including before setup is finished: a failing healthcheck
    // would have the platform restart the container in a loop, and you could
    // never reach /setup to authorize it.
    return c.json({
      status: deps.getEngine() === undefined ? 'awaiting-setup' : 'ok',
      authorized: { todoist, google },
      mappings,
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
    const mappings = getConfig().SYNC_MAPPINGS.length
    const mark = (done: boolean) => (done ? '&#10003;' : '&#9679;')

    const step3 =
      mappings > 0
        ? `${mark(true)} <code>SYNC_MAPPINGS</code> &mdash; ${mappings}
           project${mappings === 1 ? '' : 's'} mapped
           (<a href="/setup/ids">change</a>)`
        : `${mark(false)} <a href="/setup/ids">Build <code>SYNC_MAPPINGS</code></a>
           &mdash; needs both authorizations first`

    return c.html(
      page(
        'Setup',
        `<ol style="padding-left:1.2rem">
           <li>${mark(todoist)} <a href="/setup/todoist">Authorize Todoist</a></li>
           <li>${mark(google)} <a href="/setup/google">Authorize Google Calendar</a></li>
           <li>${step3}</li>
         </ol>
         <p>Syncing starts once all three are done. Step 3 is an environment
            variable, so it takes a redeploy to apply.</p>`,
      ),
    )
  })

  app.get('/setup/ids', async (c) => {
    const { projects, calendars, errors } = await discover(deps.db)

    const problems =
      errors.length === 0
        ? ''
        : `<p style="color:#b91c1c">${errors
            .map((error) => escapeHtml(error))
            .join('<br>')}</p>`

    return c.html(
      page(
        'Project and calendar ids',
        problems +
          mappingBuilder(projects, calendars) +
          idTable(projects, 'Todoist projects') +
          idTable(calendars, 'Google calendars (writable only)') +
          '<p style="margin-top:2rem"><a href="/setup">Back to setup</a></p>',
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
