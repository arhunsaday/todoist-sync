export interface Entitlement {
  /** Instance owner listed in OWNER_EMAILS: syncs without trial or subscription. */
  owner?: boolean
  trialEndsAt: number
  subscription: { status: string; periodEnd: number; pastDueSince: number | null } | null
}
export function isOwnerEmail(email: string | null | undefined, ownerEmails?: string): boolean {
  if (!email || !ownerEmails) return false
  const wanted = email.trim().toLowerCase()
  return ownerEmails
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .some((e) => e !== '' && e === wanted)
}
export function canSync(account: Entitlement, now: number): boolean {
  if (account.owner) return true
  const s = account.subscription
  if (s) {
    if (s.status === 'active' || s.status === 'trialing') return s.periodEnd > now
    if (s.status === 'past_due')
      return s.pastDueSince !== null && now < s.pastDueSince + 3 * 86400000
    return false
  }
  return now < account.trialEndsAt
}
