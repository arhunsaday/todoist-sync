import { describe, expect, it } from 'vitest'
import {
  ruleSchema,
  makeRule,
  validateGraph,
  mergeFields,
  canSync,
  isOwnerEmail,
  toEventSchedule,
  planPair,
} from './index'
const a = { connectionId: 'a', provider: 'todoist' as const, resourceId: 'project' }
const b = { connectionId: 'b', provider: 'google' as const, resourceId: 'calendar' }
const c = { connectionId: 'c', provider: 'notion' as const, resourceId: 'tasks' }
const base = {
  title: 'Titre',
  description: '',
  schedule: null,
  completed: false,
  priority: 4 as const,
}
describe('rules', () => {
  it('requires resources before activation', () => {
    expect(ruleSchema.safeParse(makeRule('u')).success).toBe(false)
  })
  it('accepts a simple two way pair but refuses a triangle', () => {
    const r = makeRule('u')
    r.source = a
    r.destination = b
    expect(validateGraph([r])).toEqual([])
    expect(
      validateGraph([
        r,
        { ...r, id: 'r2', source: b, destination: c },
        { ...r, id: 'r3', source: c, destination: a },
      ]).length,
    ).toBeGreaterThan(0)
  })
  it('rejects two writers for the same pair', () => {
    const r = { ...makeRule('u'), source: a, destination: b }
    expect(validateGraph([r, { ...r, id: 'r2' }]).length).toBeGreaterThan(0)
  })
  it('rejects invalid time zones', () => {
    const r = { ...makeRule('u'), source: a, destination: b }
    r.options.timeZone = 'Paris'
    expect(ruleSchema.safeParse(r).success).toBe(false)
  })
})
describe('merge', () => {
  it('merges independent edits', () => {
    expect(
      mergeFields(base, { ...base, title: 'A' }, { ...base, completed: true }, 'manual'),
    ).toEqual({ patch: { title: 'A', completed: true }, conflicts: [] })
  })
  it('surfaces concurrent edits to same field', () => {
    expect(
      mergeFields(base, { ...base, title: 'A' }, { ...base, title: 'B' }, 'manual').conflicts,
    ).toEqual(['title'])
  })
  it('honors explicit source preference', () => {
    expect(
      mergeFields(base, { ...base, title: 'A' }, { ...base, title: 'B' }, 'source').patch.title,
    ).toBe('A')
  })
  it('treats equal edits as agreement', () => {
    expect(
      mergeFields(base, { ...base, title: 'A' }, { ...base, title: 'A' }, 'manual').conflicts,
    ).toEqual([])
  })
})
describe('dates', () => {
  it('preserves real duration across winter DST', () => {
    const s = toEventSchedule({
      kind: 'timed',
      start: '2026-10-25T00:30:00Z',
      timeZone: 'Europe/Paris',
      durationMinutes: 120,
    })
    expect(s.end.dateTime).toBe('2026-10-25T02:30:00.000Z')
  })
  it('uses exclusive all day end', () => {
    expect(toEventSchedule({ kind: 'date', date: '2026-10-06', days: 1 }).end.date).toBe(
      '2026-10-07',
    )
  })
  it('rejects ambiguous floating timestamps', () => {
    expect(() =>
      toEventSchedule({
        kind: 'timed',
        start: '2026-10-25T02:30:00',
        timeZone: 'Europe/Paris',
        durationMinutes: 60,
      }),
    ).toThrow()
  })
})
describe('entitlements', () => {
  it('uses an exclusive trial boundary', () => {
    expect(canSync({ trialEndsAt: 10, subscription: null }, 10)).toBe(false)
    expect(canSync({ trialEndsAt: 11, subscription: null }, 10)).toBe(true)
  })
  it('keeps access until paid cancellation date', () => {
    expect(
      canSync(
        { trialEndsAt: 0, subscription: { status: 'active', periodEnd: 11, pastDueSince: null } },
        10,
      ),
    ).toBe(true)
  })
  it('lets the instance owner sync without trial or subscription', () => {
    expect(canSync({ owner: true, trialEndsAt: 0, subscription: null }, 10)).toBe(true)
    expect(isOwnerEmail('Me@Example.com', ' other@x.fr, me@example.com ')).toBe(true)
    expect(isOwnerEmail('me@example.com', '')).toBe(false)
    expect(isOwnerEmail('me@example.com', 'me@example.co')).toBe(false)
    expect(isOwnerEmail(null, 'me@example.com')).toBe(false)
  })
  it('does not renew past due grace on notifications', () => {
    expect(
      canSync(
        { trialEndsAt: 0, subscription: { status: 'past_due', periodEnd: 0, pastDueSince: 1 } },
        1 + 3 * 86400000,
      ),
    ).toBe(false)
  })
})
it('recreates an app-removed calendar mirror when a task is reopened', () => {
  const rule = { ...makeRule('u'), source: a, destination: b }
  rule.options.completion = 'remove'
  const fields = { ...base, schedule: { kind: 'date' as const, date: '2026-10-06', days: 1 } }
  const source = {
    id: 'task',
    ref: a,
    fields,
    revision: '2',
    deleted: false,
    recurring: false,
    metadata: {},
  }
  const destination = { ...source, id: 'event', ref: b, deleted: true }
  const link = {
    groupId: 'g',
    ruleId: rule.id,
    sourceId: 'task',
    destinationId: 'event',
    removedByRule: 'completion' as const,
    baseline: { ...fields, completed: true },
    sourceRevision: '1',
    destinationRevision: '1',
  }
  expect(planPair(rule, source, destination, link)[0]?.kind).toBe('write')
})
it('recreates a mirror when a previously undated task receives a date', () => {
  const rule = { ...makeRule('u'), source: a, destination: b }
  const fields = { ...base, schedule: { kind: 'date' as const, date: '2026-10-06', days: 1 } }
  const source = {
    id: 'task',
    ref: a,
    fields,
    revision: '2',
    deleted: false,
    recurring: false,
    metadata: {},
  }
  const destination = { ...source, id: 'event', ref: b, deleted: true }
  const link = {
    groupId: 'g',
    ruleId: rule.id,
    sourceId: 'task',
    destinationId: 'event',
    removedByRule: 'undated' as const,
    baseline: { ...fields, schedule: null },
    sourceRevision: '1',
    destinationRevision: '1',
  }
  expect(planPair(rule, source, destination, link)[0]?.kind).toBe('write')
})

it('unlinks a manually deleted completed mirror when completion marks events', () => {
  const rule = { ...makeRule('u'), source: a, destination: b }
  rule.options.completion = 'mark'
  const fields = {
    ...base,
    completed: true,
    schedule: { kind: 'date' as const, date: '2026-10-06', days: 1 },
  }
  const source = {
    id: 'task',
    ref: a,
    fields,
    revision: '2',
    deleted: false,
    recurring: false,
    metadata: {},
  }
  const destination = { ...source, id: 'event', ref: b, deleted: true }
  const link = {
    groupId: 'g',
    ruleId: rule.id,
    sourceId: 'task',
    destinationId: 'event',
    baseline: fields,
    sourceRevision: '1',
    destinationRevision: '1',
  }
  expect(planPair(rule, source, destination, link)[0]?.kind).toBe('unlink')
})
