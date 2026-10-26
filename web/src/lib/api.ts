export interface Mapping {
  todoistProjectId: string
  googleCalendarId: string
}

export interface Settings {
  mappings: Mapping[]
  defaultEventDurationMinutes: number
  syncForeignEvents: boolean
  priorityPrefixes: boolean
  labelPrefixes: { match: string; prefix: string }[]
  syncComments: boolean
  maxCompletionsPerSync: number
}

export interface State {
  authorized: { todoist: boolean; google: boolean }
  canEdit: boolean
  syncing: boolean
  engine: { running: boolean; lastRunAt?: number; lastError?: string } | null
  blockedCalendars: string[]
  linkCounts: Record<string, number>
  settings: Settings
  webhooks: { todoist: string; google: string }
}

export interface NamedId {
  id: string
  name: string
}

export interface Discovery {
  projects: NamedId[]
  calendars: NamedId[]
  errors: string[]
}

/** Server errors come back as `{ errors: string[] }`; surface them as one message. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const errors = (body as { errors?: string[] } | null)?.errors
    throw new Error(errors?.join('\n') ?? `HTTP ${response.status}`)
  }
  return body as T
}

export const api = {
  state: () => call<State>('/api/state'),
  discovery: () => call<Discovery>('/api/discovery'),
  saveSettings: (settings: Settings) =>
    call<State>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  resync: () => call<State>('/api/resync', { method: 'POST' }),
}
