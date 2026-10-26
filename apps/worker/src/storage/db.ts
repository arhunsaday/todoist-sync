import { AppError, isOwnerEmail, type Rule, type Link, type Operation } from '@accord/domain'
export interface ConnectionRow {
  id: string
  user_id: string
  provider: 'todoist' | 'google' | 'notion'
  name: string
  external_user_id: string
  status: string
  encrypted_tokens: string
}
export async function getRule(db: D1Database, userId: string, id: string): Promise<Rule | null> {
  const row = await db
    .prepare('SELECT payload,status,revision FROM rules WHERE user_id=? AND id=?')
    .bind(userId, id)
    .first<{ payload: string; status: Rule['status']; revision: number }>()
  return row ? { ...JSON.parse(row.payload), status: row.status, revision: row.revision } : null
}
export async function listRules(db: D1Database, userId: string): Promise<Rule[]> {
  const rows = await db
    .prepare('SELECT payload,status,revision FROM rules WHERE user_id=?')
    .bind(userId)
    .all<{ payload: string; status: Rule['status']; revision: number }>()
  return rows.results.map((r) => ({
    ...JSON.parse(r.payload),
    status: r.status,
    revision: r.revision,
  }))
}
export async function connection(
  db: D1Database,
  userId: string,
  id: string,
): Promise<ConnectionRow> {
  const c = await db
    .prepare('SELECT * FROM connections WHERE user_id=? AND id=?')
    .bind(userId, id)
    .first<ConnectionRow>()
  if (!c) throw new AppError('NOT_FOUND', 'Connexion introuvable.', 404)
  if (c.status !== 'connected')
    throw new AppError('RECONNECT_REQUIRED', 'Reconnectez cet outil avant de continuer.', 409)
  return c
}
export async function connections(db: D1Database, userId: string) {
  return (
    await db.prepare('SELECT * FROM connections WHERE user_id=?').bind(userId).all<ConnectionRow>()
  ).results
}
export async function billing(db: D1Database, userId: string, ownerEmails?: string) {
  const c = await db
    .prepare('SELECT c.*,u.email FROM user u LEFT JOIN customers c ON c.user_id=u.id WHERE u.id=?')
    .bind(userId)
    .first<{
      trial_ends_at: number | null
      stripe_customer_id: string | null
      subscription_json: string | null
      deleting: number | null
      email: string | null
    }>()
  return {
    owner: isOwnerEmail(c?.email, ownerEmails),
    trialEndsAt: c?.trial_ends_at ?? 0,
    subscription: c?.subscription_json ? JSON.parse(c.subscription_json) : null,
    customerId: c?.stripe_customer_id ?? null,
    deleting: c?.deleting === 1,
  }
}
export async function getLink(
  db: D1Database,
  userId: string,
  ruleId: string,
  sourceId: string,
): Promise<Link | null> {
  const r = await db
    .prepare('SELECT payload FROM entity_links WHERE user_id=? AND rule_id=? AND source_id=?')
    .bind(userId, ruleId, sourceId)
    .first<{ payload: string }>()
  return r ? JSON.parse(r.payload) : null
}
export async function saveLink(db: D1Database, userId: string, link: Link) {
  await db
    .prepare(
      'INSERT INTO entity_links(user_id,rule_id,group_id,source_id,destination_id,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,rule_id,source_id) DO UPDATE SET destination_id=excluded.destination_id,payload=excluded.payload',
    )
    .bind(
      userId,
      link.ruleId,
      link.groupId,
      link.sourceId,
      link.destinationId,
      JSON.stringify(link),
    )
    .run()
}
export async function logActivity(
  db: D1Database,
  userId: string,
  ruleId: string | null,
  status: string,
  title: string,
  detail: string,
  sourceId: string | null = null,
) {
  await db
    .prepare(
      'INSERT INTO activity(id,user_id,rule_id,source_id,status,title,detail,created_at) VALUES(?,?,?,?,?,?,?,?)',
    )
    .bind(crypto.randomUUID(), userId, ruleId, sourceId, status, title, detail, Date.now())
    .run()
}
export async function loadOperation(
  db: D1Database,
  userId: string,
  id: string,
): Promise<Operation | null> {
  const r = await db
    .prepare(
      'SELECT payload,status,attempts,next_attempt_at FROM operations WHERE id=? AND user_id=?',
    )
    .bind(id, userId)
    .first<{
      payload: string
      status: Operation['status']
      attempts: number
      next_attempt_at: number
    }>()
  return r
    ? {
        ...JSON.parse(r.payload),
        status: r.status,
        attempts: r.attempts,
        nextAttemptAt: r.next_attempt_at,
      }
    : null
}
