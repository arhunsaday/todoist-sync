import { env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import Stripe from 'stripe'
import { sealToken, openToken, verifyHmac } from './connections/crypto'
import { receiveStripe, stripeFor, checkout } from './billing/stripe'
it('binds encrypted tokens to the customer and provider', async () => {
  const key = btoa('01234567890123456789012345678901')
  const cipher = await sealToken({ access_token: 'private' }, key, 'v1', 'alice:t:todoist')
  await expect(openToken(cipher, key, 'v1', 'bob:t:todoist')).rejects.toThrow()
  await expect(openToken(cipher, key, 'v1', 'alice:t:todoist')).resolves.toEqual({
    access_token: 'private',
  })
})
it('rejects a Stripe event older than the replay tolerance', async () => {
  env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  const payload = JSON.stringify({
    id: 'evt_old',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { customer: null, subscription: null } },
  })
  const signature = await stripeFor(env).webhooks.generateTestHeaderStringAsync({
    payload,
    secret: 'whsec_test',
    timestamp: Math.floor(Date.now() / 1000) - 600,
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
  })
  await expect(
    receiveStripe(
      env,
      new Request('https://local.test/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': signature },
        body: payload,
      }),
    ),
  ).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE' })
})
it('accepts a freshly signed Stripe event', async () => {
  env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  const payload = JSON.stringify({
    id: 'evt_new',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { customer: null, subscription: null } },
  })
  const signature = await stripeFor(env).webhooks.generateTestHeaderStringAsync({
    payload,
    secret: 'whsec_test',
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
  })
  await expect(
    receiveStripe(
      env,
      new Request('https://local.test/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': signature },
        body: payload,
      }),
    ),
  ).resolves.toEqual({ ok: true })
})

it('blocks live checkout before legal publication without accessing Stripe or D1', async () => {
  await expect(
    checkout(
      { ...env, STRIPE_SECRET_KEY: 'sk_live_fixture', STRIPE_PRICE_ID: 'price_fixture' },
      'u',
    ),
  ).rejects.toMatchObject({ code: 'LAUNCH_NOT_READY' })
})

it('also blocks restricted Stripe live keys before legal approval', async () => {
  await expect(
    checkout(
      { ...env, STRIPE_SECRET_KEY: 'rk_live_fixture', STRIPE_PRICE_ID: 'price_fixture' },
      'u',
    ),
  ).rejects.toMatchObject({ code: 'LAUNCH_NOT_READY' })
})
