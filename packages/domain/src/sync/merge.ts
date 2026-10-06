import type { Field, TaskFields } from '../types'
export const allFields: Field[] = ['title', 'description', 'schedule', 'completed', 'priority']
export function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
export function mergeFields(
  base: TaskFields,
  source: TaskFields,
  destination: TaskFields,
  policy: 'manual' | 'source' | 'destination',
  fields: Field[] = allFields,
): { patch: Partial<TaskFields>; conflicts: Field[] } {
  const patch: Partial<TaskFields> = {}
  const conflicts: Field[] = []
  for (const field of fields) {
    const sc = !equal(base[field], source[field]),
      dc = !equal(base[field], destination[field])
    if (!sc && !dc) continue
    if (sc && dc && !equal(source[field], destination[field])) {
      if (policy === 'manual') {
        conflicts.push(field)
        continue
      }
      Object.assign(patch, { [field]: policy === 'source' ? source[field] : destination[field] })
    } else Object.assign(patch, { [field]: sc ? source[field] : destination[field] })
  }
  return { patch, conflicts }
}
