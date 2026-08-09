/**
 * Prints the Todoist project ids and Google calendar ids needed to build
 * `SYNC_MAPPINGS`.
 *
 * Reads credentials only, never `SYNC_MAPPINGS` — this is the script you run
 * to find out what to put there.
 */
import { getDb } from '../db/index.js'
import { GoogleCalendarClient } from '../google/client.js'
import { TodoistClient } from '../todoist/client.js'
import { createTodoistTokenProvider } from '../todoist/oauth.js'

function table(rows: Array<[string, string]>, headers: [string, string]): string {
  const all = [headers, ...rows]
  const width = Math.max(...all.map(([left]) => left.length))
  const line = '  ' + '-'.repeat(width) + '  ' + '-'.repeat(40)

  return [
    `  ${headers[0].padEnd(width)}  ${headers[1]}`,
    line,
    ...rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`),
  ].join('\n')
}

async function listTodoistProjects(): Promise<void> {
  const db = getDb()
  const client = new TodoistClient({
    getAccessToken: createTodoistTokenProvider(db),
  })

  const response = await client.sync('*')
  const projects = response.projects
    .filter((project) => !project.is_deleted && !project.is_archived)
    .sort((a, b) => a.name.localeCompare(b.name))

  console.log('\nTodoist projects\n')
  console.log(table(projects.map((p) => [p.id, p.name]), ['ID', 'NAME']))
}

async function listGoogleCalendars(): Promise<void> {
  const client = new GoogleCalendarClient(getDb())
  const calendars = await client.listCalendars()

  // Only calendars you can write to are usable as sync targets.
  const writable = calendars
    .filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
    .sort((a, b) => (a.summary ?? '').localeCompare(b.summary ?? ''))

  console.log('\nGoogle calendars (writable only)\n')
  console.log(
    table(
      writable.map((c) => [c.id ?? '(no id)', c.summary ?? '(no name)']),
      ['ID', 'NAME'],
    ),
  )
}

async function main(): Promise<void> {
  // Independent, and each prints its own section, so one failing provider
  // should not hide the other's ids.
  const results = await Promise.allSettled([
    listTodoistProjects(),
    listGoogleCalendars(),
  ])

  const failures = results.filter((r) => r.status === 'rejected')
  for (const failure of failures) {
    console.error(`\n${failure.reason}`)
  }

  console.log(
    '\nSet SYNC_MAPPINGS to a comma-separated list of todoistProjectId:googleCalendarId\n',
  )

  if (failures.length > 0) process.exitCode = 1
}

await main()
