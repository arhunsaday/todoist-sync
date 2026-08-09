import { randomBytes } from 'node:crypto'

/**
 * Pending OAuth `state` values, for CSRF protection on the callback.
 *
 * In-memory is sufficient: this is a single-process app and the flow is a
 * one-off during setup. A restart mid-flow just means clicking the link again.
 */
const STATE_TTL_MS = 5 * 60_000

const pending = new Map<string, { provider: string; createdAt: number }>()

export function issueState(provider: string): string {
  const state = randomBytes(24).toString('hex')
  pending.set(state, { provider, createdAt: Date.now() })
  prune()
  return state
}

export function consumeState(provider: string, state: string | undefined): boolean {
  if (state === undefined) return false

  const entry = pending.get(state)
  if (entry === undefined) return false

  // Single use, whatever the outcome.
  pending.delete(state)

  if (entry.provider !== provider) return false
  return Date.now() - entry.createdAt <= STATE_TTL_MS
}

function prune(): void {
  const cutoff = Date.now() - STATE_TTL_MS
  for (const [state, entry] of pending) {
    if (entry.createdAt < cutoff) pending.delete(state)
  }
}
