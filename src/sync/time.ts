/**
 * Date and time helpers shared by the mapping and fingerprint layers.
 *
 * Everything here is pure and timezone-safe: no call depends on the host's
 * local timezone, because a sync running in UTC on Railway must produce
 * byte-identical output to one running on a laptop in Europe/Paris.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/

/** `2026-08-09` rather than `2026-08-09T13:00:00`. */
export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value)
}

/**
 * True when the string pins an absolute instant. A Todoist "floating" time
 * (`2026-08-09T13:00:00`) does not — it means that wall-clock time in
 * whatever timezone the reader is in.
 */
export function hasExplicitZone(value: string): boolean {
  return HAS_ZONE.test(value)
}

/** `2026-08-09` + 1 → `2026-08-10`. Pure UTC arithmetic, no DST involvement. */
export function addDaysToDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return formatDateOnly(parsed)
}

/** Whole days between two date-only strings. Google's `end.date` is exclusive. */
export function daysBetweenDates(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000)
}

export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/** `2026-08-09T13:00:00` — no zone suffix, for floating wall-clock times. */
export function formatFloating(value: Date): string {
  return value.toISOString().slice(0, 19)
}

/**
 * Parse a Todoist due timestamp into a `Date`.
 *
 * Floating times are read as if UTC. That is deliberate: arithmetic on them
 * must move the wall clock (13:00 + 30min = 13:30) rather than an instant, and
 * treating them as UTC makes that exact — whereas `new Date('2026-08-09T13:00')`
 * would silently apply the host's local offset.
 */
export function parseTodoistTimestamp(value: string): Date {
  return new Date(hasExplicitZone(value) ? value : `${value}Z`)
}

export function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000)
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000)
}

export const MINUTES_PER_DAY = 1440

/** Todoist durations come in minutes or days; normalise to minutes. */
export function durationToMinutes(amount: number, unit: 'minute' | 'day'): number {
  return unit === 'day' ? amount * MINUTES_PER_DAY : amount
}
