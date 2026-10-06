import Stripe from 'stripe'
import { AppError } from '@accord/domain'
import type { Env } from '../env'
import { billing } from '../storage/db'
export function stripeFor(env: Env) {
  if (!env.STRIPE_SECRET_KEY)
    throw new AppError('CONFIGURATION', 'La facturation Stripe n’est pas configurée.', 503)
  return new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() })
}
export async function checkout(env: Env, userId: string) {
  if (!env.STRIPE_PRICE_ID)
    throw new AppError('CONFIGURATION', 'L’abonnement n’est pas configuré.', 503)
  const stripe = stripeFor(env),
    b = await billing(env.DB, userId)
  if (b.subscription && ['active', 'trialing', 'past_due'].includes(b.subscription.status))
    throw new AppError(
      'SUBSCRIPTION_EXISTS',
      'Utilisez le portail pour gérer votre abonnement existant.',
      409,
    )
  const price = await stripe.prices.retrieve(env.STRIPE_PRICE_ID)
  if (
    !price.active ||
    price.recurring?.interval !== 'month' ||
    price.currency.toUpperCase() !== env.STRIPE_PRICE_CURRENCY ||
    price.unit_amount !== Number(env.STRIPE_PRICE_AMOUNT) * 100
  )
    throw new AppError(
      'CONFIGURATION',
      'Le tarif affiché et le tarif Stripe doivent correspondre.',
      503,
    )
  let customerId = b.customerId
  if (!customerId) {
    const user = await env.DB.prepare('SELECT email,name FROM user WHERE id=?')
      .bind(userId)
      .first<{ email: string; name: string }>()
    const customer = await stripe.customers.create(
      { email: user?.email, name: user?.name, metadata: { accordUserId: userId } },
      { idempotencyKey: 'accord-customer-' + userId },
    )
    customerId = customer.id
    await env.DB.prepare('UPDATE customers SET stripe_customer_id=? WHERE user_id=?')
      .bind(customerId, userId)
      .run()
  }
  const session = await stripe.checkout.sessions.create(
    {
      customer: customerId,
      mode: 'subscription',
      client_reference_id: userId,
      line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: env.PUBLIC_URL + '/app/billing?checkout=success',
      cancel_url: env.PUBLIC_URL + '/app/billing',
      subscription_data: { metadata: { accordUserId: userId } },
    },
    { idempotencyKey: 'accord-checkout-' + userId + '-' + Math.floor(Date.now() / 1800000) },
  )
  return { url: session.url }
}
export async function portal(env: Env, userId: string) {
  const b = await billing(env.DB, userId)
  if (!b.customerId) throw new AppError('NOT_FOUND', 'Aucun abonnement à gérer.', 404)
  const r = await stripeFor(env).billingPortal.sessions.create({
    customer: b.customerId,
    return_url: env.PUBLIC_URL + '/app/billing',
  })
  return { url: r.url }
}
export async function refreshSubscription(env: Env, userId: string, subscriptionId: string) {
  const stripe = stripeFor(env),
    b = await billing(env.DB, userId)
  const sub = await stripe.subscriptions.retrieve(subscriptionId)
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  if (customer !== b.customerId)
    throw new AppError('FORBIDDEN', 'Cet abonnement appartient à un autre compte.', 403)
  const periodEnd = Math.max(0, ...sub.items.data.map((x) => x.current_period_end)) * 1000
  const prior = b.subscription
  const subscription = {
    id: sub.id,
    status: sub.status,
    periodEnd,
    pastDueSince: sub.status === 'past_due' ? (prior?.pastDueSince ?? Date.now()) : null,
  }
  await env.DB.prepare(
    'UPDATE customers SET subscription_json=? WHERE user_id=? AND stripe_customer_id=?',
  )
    .bind(JSON.stringify(subscription), userId, customer)
    .run()
  return { ok: true }
}
export async function consumeBillingEvents(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    "SELECT event_id,subscription_id FROM billing_events WHERE user_id=? AND status='pending' ORDER BY created_at",
  )
    .bind(userId)
    .all<{ event_id: string; subscription_id: string }>()
  for (const row of rows.results) {
    await refreshSubscription(env, userId, row.subscription_id)
    await env.DB.prepare("UPDATE billing_events SET status='done' WHERE event_id=? AND user_id=?")
      .bind(row.event_id, userId)
      .run()
  }
}
export async function receiveStripe(env: Env, request: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET)
    throw new AppError('CONFIGURATION', 'Le webhook Stripe n’est pas configuré.', 503)
  let event: Stripe.Event
  try {
    event = await stripeFor(env).webhooks.constructEventAsync(
      await request.text(),
      request.headers.get('stripe-signature') ?? '',
      env.STRIPE_WEBHOOK_SECRET,
      300,
      Stripe.createSubtleCryptoProvider(),
    )
  } catch {
    throw new AppError('WEBHOOK_SIGNATURE', 'Signature Stripe invalide.', 400)
  }
  let subscriptionId: string | null = null,
    customerId: string | null = null
  const obj = event.data.object as {
    id?: string
    customer?: string | { id: string }
    subscription?: string | { id: string } | null
  }
  if (event.type.startsWith('customer.subscription.')) subscriptionId = obj.id ?? null
  else if (event.type === 'checkout.session.completed')
    subscriptionId =
      typeof obj.subscription === 'string' ? obj.subscription : (obj.subscription?.id ?? null)
  customerId = typeof obj.customer === 'string' ? obj.customer : (obj.customer?.id ?? null)
  if (!subscriptionId || !customerId) return { ok: true }
  const owner = await env.DB.prepare('SELECT user_id FROM customers WHERE stripe_customer_id=?')
    .bind(customerId)
    .first<{ user_id: string }>()
  if (!owner) return { ok: true }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO billing_events(event_id,user_id,subscription_id,status,created_at) VALUES(?,?,?,'pending',?)",
  )
    .bind(event.id, owner.user_id, subscriptionId, Date.now())
    .run()
  await env.SYNC_QUEUE.send({ userId: owner.user_id, reason: 'billing' })
  return { ok: true }
}
