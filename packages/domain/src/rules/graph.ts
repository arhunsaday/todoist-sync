import type { Rule } from '../types'
export interface ValidationIssue {
  path: string
  message: string
}
export function validateGraph(rules: Rule[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const adjacency = new Map<string, Set<string>>()
  const pairs = new Set<string>()
  const bidirectionalOwners = new Map<string, string>()
  const key = (r: Rule['source']) => `${r.connectionId}:${r.resourceId}`
  for (const r of rules) {
    if (r.status === 'paused') continue
    const a = key(r.source),
      b = key(r.destination)
    if (r.direction === 'two-way') {
      for (const [central, other] of [
        [a, r.destination],
        [b, r.source],
      ] as const) {
        const ownerKey = central + ':' + other.provider
        const previous = bidirectionalOwners.get(ownerKey)
        if (previous && previous !== key(other))
          issues.push({
            path: r.id,
            message:
              'Une ressource ne peut pas créer des éléments dans deux projets du même outil. Choisissez un seul projet de destination ou une direction unique.',
          })
        bidirectionalOwners.set(ownerKey, key(other))
      }
    }
    const pair = [a, b].sort().join('|')
    if (pairs.has(pair))
      issues.push({ path: r.id, message: 'Deux règles utilisent la même paire de ressources.' })
    pairs.add(pair)
    // Bidirectional edges form one undirected pair; any additional path between its endpoints is a cycle.
    const seen = new Set<string>()
    const reaches = (s: string): boolean => {
      if (s === b) return true
      if (seen.has(s)) return false
      seen.add(s)
      return [...(adjacency.get(s) ?? [])].some(reaches)
    }
    if (reaches(a))
      issues.push({ path: r.id, message: 'Ces règles forment une boucle. Retirez une liaison.' })
    if (!adjacency.has(a)) adjacency.set(a, new Set())
    if (!adjacency.has(b)) adjacency.set(b, new Set())
    adjacency.get(a)!.add(b)
    adjacency.get(b)!.add(a)
  }
  return issues
}
