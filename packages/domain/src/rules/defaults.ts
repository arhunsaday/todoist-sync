import type { Rule } from '../types'
export function makeRule(userId: string): Rule {
  return {
    id: crypto.randomUUID(),
    userId,
    revision: 1,
    name: 'Nouvelle règle',
    source: { connectionId: '', provider: 'todoist', resourceId: '' },
    destination: { connectionId: '', provider: 'google', resourceId: '' },
    direction: 'two-way',
    fields: ['title', 'description', 'schedule', 'completed'],
    filters: { sectionIds: [], labels: [], priorities: [], datedOnly: true },
    options: {
      timeZone: 'Europe/Paris',
      durationMinutes: 60,
      syncAllDay: true,
      priorityPrefix: false,
      labelPrefixes: {},
      syncComments: false,
      conflict: 'manual',
      eventDeletion: 'unlink',
      completion: 'mark',
      maxMutations: 25,
      adoptLegacy: false,
    },
    notionMapping: null,
    status: 'draft',
  }
}
