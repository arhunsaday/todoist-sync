import type { Rule, Entity, Link, Decision, TaskFields } from '../types'
import { mergeFields, equal } from './merge'
export function matchesRule(rule: Rule, entity: Entity): boolean {
  const { filters, options } = rule
  const f = entity.fields
  if (filters.datedOnly && !f.schedule) return false
  if (!options.syncAllDay && f.schedule?.kind === 'date') return false
  if (filters.priorities.length && !filters.priorities.includes(f.priority)) return false
  if (filters.sectionIds.length && !filters.sectionIds.includes(entity.metadata.sectionId ?? ''))
    return false
  const labels: unknown = JSON.parse(entity.metadata.labels ?? '[]')
  if (
    filters.labels.length &&
    (!Array.isArray(labels) || !filters.labels.every((l) => labels.includes(l)))
  )
    return false
  return true
}
export function planPair(
  rule: Rule,
  source: Entity,
  destination: Entity | null,
  link: Link | null,
): Decision[] {
  const decision = (
    kind: Decision['kind'],
    target: Rule['source'],
    patch: Partial<TaskFields>,
    reason: string,
    targetId?: string | null,
  ): Decision => ({
    kind,
    target,
    patch,
    reason,
    entityId: source.id,
    sourceId: source.id,
    targetId,
  })
  if (
    (source.recurring && source.ref.provider === 'google') ||
    (destination?.recurring && destination.ref.provider === 'google')
  )
    return [decision('skip', rule.destination, {}, 'Les séries Google ne sont pas converties.')]
  if (destination?.deleted && link && (link.baseline.completed || !link.baseline.schedule)) {
    if (source.fields.schedule && (!source.fields.completed || rule.options.completion === 'mark'))
      return [
        decision(
          'write',
          rule.destination,
          source.fields,
          'Recréer le miroir de cette tâche.',
          destination.id,
        ),
      ]
    return []
  }
  if (source.deleted || destination?.deleted) {
    if (
      destination?.deleted &&
      rule.options.eventDeletion === 'complete' &&
      destination.ref.provider === 'google'
    )
      return [
        decision(
          'write',
          rule.source,
          { completed: true },
          'Événement supprimé : terminer la tâche.',
          source.id,
        ),
      ]
    return [decision('unlink', rule.destination, {}, 'Élément supprimé : dissociation.')]
  }
  if (link && source.ref.resourceId !== rule.source.resourceId)
    return [decision('unlink', rule.destination, {}, 'La tâche a changé de projet.')]
  if (link && rule.destination.provider === 'google' && !source.fields.schedule)
    return [
      decision(
        'write',
        rule.destination,
        { schedule: null },
        'Retirer le créneau de la tâche non datée.',
        destination?.id,
      ),
    ]
  if (!matchesRule(rule, source))
    return [decision('skip', rule.destination, {}, 'Ne correspond pas aux filtres.')]
  if (!destination) {
    const patch: Partial<TaskFields> = {}
    for (const field of rule.fields) Object.assign(patch, { [field]: source.fields[field] })
    return [decision('write', rule.destination, patch, 'Créer le miroir.', null)]
  }
  if (!link) {
    return [
      decision(
        'conflict',
        rule.destination,
        {},
        'Deux éléments existants demandent une résolution.',
        destination.id,
      ),
    ]
  }
  const merged =
    rule.direction === 'one-way'
      ? { patch: source.fields, conflicts: [] }
      : mergeFields(
          link.baseline,
          source.fields,
          destination.fields,
          rule.options.conflict,
          rule.fields,
        )
  if (merged.conflicts.length)
    return [
      decision(
        'conflict',
        rule.destination,
        {},
        `Conflit : ${merged.conflicts.join(', ')}.`,
        destination.id,
      ),
    ]
  const result: Decision[] = []
  for (const [ref, entity] of [
    [rule.destination, destination],
    [rule.source, source],
  ] as const) {
    if (rule.direction === 'one-way' && ref === rule.source) continue
    const patch: Partial<TaskFields> = {}
    for (const field of rule.fields) {
      const value = merged.patch[field]
      if (value !== undefined && !equal(value, entity.fields[field]))
        Object.assign(patch, { [field]: value })
    }
    if (Object.keys(patch).length)
      result.push(decision('write', ref, patch, 'Mettre à jour les champs modifiés.', entity.id))
  }
  if (rule.destination.provider === 'google') {
    const labels: unknown = JSON.parse(source.metadata.labels ?? '[]')
    const prefix = (Array.isArray(labels) ? labels : [])
      .flatMap((l) =>
        typeof l === 'string' && rule.options.labelPrefixes[l]
          ? [rule.options.labelPrefixes[l]]
          : [],
      )
      .join(' ')
    const commentsChanged =
      rule.options.syncComments &&
      (source.metadata.comments ?? '') !== (destination.metadata.comments ?? '')
    const prefixChanged =
      prefix !== (destination.metadata.accordLabelPrefix ?? '') ||
      (rule.options.priorityPrefix &&
        source.fields.priority !== Number(destination.metadata.accordPriority ?? 4))
    if (commentsChanged || prefixChanged) {
      const patch: Partial<TaskFields> = {}
      if (commentsChanged) patch.description = source.fields.description
      if (prefixChanged) {
        patch.title = source.fields.title
        patch.priority = source.fields.priority
      }
      const existing = result.find((d) => d.target.connectionId === rule.destination.connectionId)
      if (existing) Object.assign(existing.patch, patch)
      else
        result.push(
          decision(
            'write',
            rule.destination,
            patch,
            'Actualiser les détails du titre et les commentaires.',
            destination.id,
          ),
        )
    }
  }
  return result
}
