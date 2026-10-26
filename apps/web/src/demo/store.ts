import { makeRule, type Rule, type ProviderResource } from '@accord/domain'
export interface ConnectionView {
  id: string
  provider: 'todoist' | 'google' | 'notion'
  name: string
  status: string
  configured?: boolean
}
export interface ActivityView {
  id: string
  title: string
  detail: string
  status: string
  createdAt: number
  ruleId?: string
  sourceId?: string
}
export const demoResources: ProviderResource[] = [
  {
    name: 'Travail',
    writable: true,
    ref: { provider: 'todoist', connectionId: 'demo-todoist', resourceId: 'work' },
  },
  {
    name: 'Personnel',
    writable: true,
    ref: { provider: 'todoist', connectionId: 'demo-todoist', resourceId: 'personal' },
  },
  {
    name: 'Calendrier Travail',
    writable: true,
    ref: { provider: 'google', connectionId: 'demo-google', resourceId: 'work-cal' },
  },
  {
    name: 'Calendrier Personnel',
    writable: true,
    ref: { provider: 'google', connectionId: 'demo-google', resourceId: 'personal-cal' },
  },
  {
    name: 'Projets & idées',
    writable: true,
    ref: { provider: 'notion', connectionId: 'demo-notion', resourceId: 'notion-projects' },
    properties: [
      { id: 'title', name: 'Nom', type: 'title' },
      { id: 'date', name: 'Date', type: 'date' },
      { id: 'status', name: 'Statut', type: 'status', options: ['À faire', 'Terminé'] },
      { id: 'mirror', name: 'Accord ID', type: 'rich_text' },
    ],
  },
]
export const demoConnections: ConnectionView[] = [
  { id: 'demo-todoist', provider: 'todoist', name: 'Votre Todoist', status: 'connected' },
  { id: 'demo-google', provider: 'google', name: 'Votre Google Agenda', status: 'connected' },
  { id: 'demo-notion', provider: 'notion', name: 'Votre Notion', status: 'connected' },
]
export function demoRules(): Rule[] {
  const r = makeRule('demo')
  return [
    {
      ...r,
      id: 'demo-work',
      name: 'Du travail à mon agenda',
      source: demoResources[0]!.ref,
      destination: demoResources[2]!.ref,
      status: 'active',
    },
    {
      ...r,
      id: 'demo-notion',
      name: 'Mes projets prennent date',
      source: demoResources[4]!.ref,
      destination: demoResources[3]!.ref,
      notionMapping: {
        title: 'title',
        date: 'date',
        status: 'status',
        doneValues: ['Terminé'],
        openValue: 'À faire',
        doneValue: 'Terminé',
        mirrorKey: 'mirror',
      },
      status: 'paused',
    },
  ]
}
export function loadDemoRules(): Rule[] {
  try {
    const saved = localStorage.getItem('accord-demo-rules')
    return saved ? JSON.parse(saved) : demoRules()
  } catch {
    return demoRules()
  }
}
export const demoActivity: ActivityView[] = [
  {
    id: 'a1',
    title: 'Préparer la présentation',
    detail: 'Créé dans Calendrier Travail',
    status: 'done',
    createdAt: Date.now() - 120000,
  },
  {
    id: 'a2',
    title: 'Faire le point sur le projet',
    detail: 'Horaire mis à jour dans Todoist',
    status: 'done',
    createdAt: Date.now() - 480000,
  },
  {
    id: 'a3',
    title: 'Définir les prochaines étapes',
    detail: 'Une tâche attend votre résolution',
    status: 'conflict',
    createdAt: Date.now() - 900000,
  },
]
