import type { Db } from './db/index.js'
import { createGoogleClient } from './runtime.js'
import { TodoistClient } from './todoist/client.js'
import { createTodoistTokenProvider } from './todoist/oauth.js'

export interface NamedId {
  id: string
  name: string
}

export interface Discovered {
  projects: NamedId[]
  calendars: NamedId[]
  /** Per-source failures, so one dead provider does not hide the other's ids. */
  errors: string[]
}

/**
 * List the Todoist projects and Google calendars available for mapping.
 *
 * Shared by `pnpm list-ids` and the `/setup/ids` page. The page matters more
 * than the script for a hosted deployment: the OAuth tokens live in the
 * server's database, so the machine that can list the ids is the server.
 */
export async function discover(db: Db): Promise<Discovered> {
  const errors: string[] = []
  let projects: NamedId[] = []
  let calendars: NamedId[] = []

  try {
    const todoist = new TodoistClient({
      getAccessToken: createTodoistTokenProvider(db),
    })
    const snapshot = await todoist.sync('*')

    projects = snapshot.projects
      .filter((project) => !project.is_deleted && !project.is_archived)
      .map((project) => ({ id: project.id, name: project.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    errors.push(`Todoist: ${(error as Error).message}`)
  }

  try {
    const entries = await createGoogleClient(db).listCalendars()

    // Only calendars you can write to are usable as sync targets.
    calendars = entries
      .filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
      .map((c) => ({ id: c.id ?? '', name: c.summary ?? '(unnamed)' }))
      .filter((c) => c.id !== '')
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    errors.push(`Google: ${(error as Error).message}`)
  }

  return { projects, calendars, errors }
}
