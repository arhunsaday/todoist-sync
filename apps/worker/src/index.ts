import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { ZodError } from 'zod'
import { AppError, providerSchema } from '@accord/domain'
import type { Env } from './env'
import { authFor } from './auth/config'
import { startOAuth } from './connections/oauth'
import { billing, listRules } from './storage/db'
import { requireRule } from './rules/service'
import { coordinate } from './jobs/coordinate'
import { receiveProviderWebhook } from './webhooks/receive'
import { receiveStripe } from './billing/stripe'
import { processQueue, scheduleUsers } from './jobs/scheduler'
export { SyncCoordinator } from './jobs/coordinator'
export function createApp() {
  const app = new Hono<{
    Bindings: Env
    Variables: { user: { id: string; name: string; email: string } }
  }>()
  app.onError((e, c) => {
    if (e instanceof AppError)
      return c.json({ error: { code: e.code, message: e.message } }, e.status as 400)
    if (e instanceof ZodError || e instanceof SyntaxError)
      return c.json(
        { error: { code: 'VALIDATION', message: 'Les informations envoyées sont invalides.' } },
        400,
      )
    console.error('request failed', e.name)
    return c.json(
      { error: { code: 'INTERNAL', message: 'La requête n’a pas abouti. Réessayez.' } },
      500,
    )
  })
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 512 * 1024,
      onError: (c) =>
        c.json(
          { error: { code: 'PAYLOAD_TOO_LARGE', message: 'La requête est trop volumineuse.' } },
          413,
        ),
    }),
  )
  app.use('/api/*', async (c, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      !c.req.path.startsWith('/api/webhooks/')
    ) {
      const origin = c.req.header('Origin')
      if (
        (origin && origin !== new URL(c.env.PUBLIC_URL).origin) ||
        c.req.header('Sec-Fetch-Site') === 'cross-site'
      )
        return c.json({ error: { code: 'FORBIDDEN', message: 'Origine non autorisée.' } }, 403)
    }
    await next()
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  })
  app.get('/api/health', (c) => c.json({ status: 'ok' }))
  app.get('/api/session', async (c) => {
    if (!c.env.BETTER_AUTH_SECRET) return c.json({ user: null })
    const session = await authFor(c.env).api.getSession({ headers: c.req.raw.headers })
    return c.json({ user: session?.user ?? null })
  })
  app.get('/api/config', (c) =>
    c.json({
      googleAuth: !!(
        c.env.BETTER_AUTH_SECRET &&
        c.env.GOOGLE_CLIENT_ID &&
        c.env.GOOGLE_CLIENT_SECRET
      ),
      billing: !!(c.env.STRIPE_SECRET_KEY && c.env.STRIPE_PRICE_ID),
      price: { amount: c.env.STRIPE_PRICE_AMOUNT, currency: c.env.STRIPE_PRICE_CURRENCY },
    }),
  )
  app.all('/api/auth/*', (c) => {
    if (!c.env.BETTER_AUTH_SECRET)
      throw new AppError(
        'CONFIGURATION',
        'La connexion n’est pas configurée sur cette instance.',
        503,
      )
    return authFor(c.env).handler(c.req.raw)
  })
  app.post('/api/webhooks/stripe', async (c) => c.json(await receiveStripe(c.env, c.req.raw)))
  app.post('/api/webhooks/:provider', async (c) =>
    c.json(
      await receiveProviderWebhook(c.env, providerSchema.parse(c.req.param('provider')), c.req.raw),
    ),
  )
  app.use('/api/*', async (c, next) => {
    if (!c.env.BETTER_AUTH_SECRET)
      return c.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Connectez-vous pour ouvrir votre espace.' } },
        401,
      )
    const s = await authFor(c.env).api.getSession({ headers: c.req.raw.headers })
    if (!s)
      return c.json(
        {
          error: { code: 'UNAUTHENTICATED', message: 'Votre session a expiré. Reconnectez-vous.' },
        },
        401,
      )
    const b = await billing(c.env.DB, s.user.id)
    if (b.deleting)
      return c.json(
        {
          error: {
            code: 'ACCOUNT_DELETING',
            message: 'La suppression de votre compte est en cours.',
          },
        },
        403,
      )
    c.set('user', s.user)
    await next()
  })
  app.get('/api/me', (c) => c.json(c.get('user')))
  app.get('/api/bootstrap', async (c) =>
    c.json(await coordinate(c.env, c.get('user').id, 'bootstrap')),
  )
  app.post('/api/connections/:provider/authorize', async (c) =>
    c.json(
      await startOAuth(c.env, c.get('user').id, providerSchema.parse(c.req.param('provider'))),
    ),
  )
  app.get('/api/connections/:provider/callback', async (c) => {
    if (c.req.query('error'))
      return c.redirect(c.env.PUBLIC_URL + '/app/connections?error=authorization')
    await coordinate(c.env, c.get('user').id, 'finish-oauth', {
      provider: providerSchema.parse(c.req.param('provider')),
      code: c.req.query('code') ?? '',
      state: c.req.query('state') ?? '',
    })
    return c.redirect(c.env.PUBLIC_URL + '/app/connections')
  })
  app.delete('/api/connections/:id', async (c) =>
    c.json(await coordinate(c.env, c.get('user').id, 'disconnect', { id: c.req.param('id') })),
  )
  app.get('/api/rules', async (c) => c.json(await listRules(c.env.DB, c.get('user').id)))
  app.get('/api/rules/:id', async (c) =>
    c.json(await requireRule(c.env, c.get('user').id, c.req.param('id'))),
  )
  app.get('/api/rules/:id/conflicts/:sourceId', async (c) =>
    c.json(
      await coordinate(c.env, c.get('user').id, 'conflict-detail', {
        id: c.req.param('id'),
        sourceId: c.req.param('sourceId'),
      }),
    ),
  )
  app.post('/api/rules', async (c) =>
    c.json(await coordinate(c.env, c.get('user').id, 'save-rule', { rule: await c.req.json() })),
  )
  app.patch('/api/rules/:id', async (c) =>
    c.json(
      await coordinate(c.env, c.get('user').id, 'save-rule', {
        rule: await c.req.json(),
        id: c.req.param('id'),
      }),
    ),
  )
  app.delete('/api/rules/:id', async (c) =>
    c.json(await coordinate(c.env, c.get('user').id, 'delete-rule', { id: c.req.param('id') })),
  )
  for (const [path, action] of [
    ['pause', 'pause-rule'],
    ['preview', 'preview-rule'],
    ['activate', 'activate-rule'],
    ['resolve', 'resolve-conflict'],
    ['retry', 'retry-rule'],
  ] as const)
    app.post('/api/rules/:id/' + path, async (c) => {
      const input = await c.req.text()
      const body = input ? JSON.parse(input) : {}
      return c.json(
        await coordinate(c.env, c.get('user').id, action, { ...body, id: c.req.param('id') }),
      )
    })
  app.post('/api/billing/checkout', async (c) =>
    c.json(await coordinate(c.env, c.get('user').id, 'checkout')),
  )
  app.post('/api/billing/portal', async (c) =>
    c.json(await coordinate(c.env, c.get('user').id, 'portal')),
  )
  app.delete('/api/account', async (c) => {
    const body = await c.req.json()
    if (body.confirmation !== 'SUPPRIMER')
      throw new AppError('VALIDATION', 'Confirmez explicitement la suppression du compte.', 400)
    return c.json(await coordinate(c.env, c.get('user').id, 'delete-account'))
  })
  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Cette route n’existe pas.' } }, 404),
  )
  return app
}
const app = createApp()
export default {
  fetch: app.fetch,
  queue: processQueue,
  scheduled: (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(scheduleUsers(env))
  },
}
