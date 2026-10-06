export interface Entitlement {
  trialEndsAt: number
  subscription: { status: string; periodEnd: number; pastDueSince: number | null } | null
}
export function canSync(account: Entitlement, now: number): boolean {
  const s = account.subscription
  if (s) {
    if (s.status === 'active' || s.status === 'trialing') return s.periodEnd > now
    if (s.status === 'past_due')
      return s.pastDueSince !== null && now < s.pastDueSince + 3 * 86400000
    return false
  }
  return now < account.trialEndsAt
}
