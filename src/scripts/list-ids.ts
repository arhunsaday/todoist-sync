/**
 * Prints the Todoist project ids and Google calendar ids needed to build
 * `SYNC_MAPPINGS`.
 *
 * Requires the OAuth tokens in the local database. For a hosted deployment
 * those live on the server, so use the `/setup/ids` page there instead.
 */
import { closeDb, getDb } from '../db/index.js'
import { discover, type NamedId } from '../discovery.js'

function table(rows: NamedId[], heading: string): string {
  if (rows.length === 0) return `\n${heading}\n\n  (none found)`

  const width = Math.max(...rows.map((row) => row.id.length), 2)
  return [
    `\n${heading}\n`,
    `  ${'ID'.padEnd(width)}  NAME`,
    `  ${'-'.repeat(width)}  ${'-'.repeat(30)}`,
    ...rows.map((row) => `  ${row.id.padEnd(width)}  ${row.name}`),
  ].join('\n')
}

const db = getDb()
const { projects, calendars, errors } = await discover(db)

console.log(table(projects, 'Todoist projects'))
console.log(table(calendars, 'Google calendars (writable only)'))

for (const error of errors) console.error(`\n${error}`)

console.log(
  '\nSet SYNC_MAPPINGS to a comma-separated list of todoistProjectId:googleCalendarId\n',
)

if (errors.length > 0) process.exitCode = 1
closeDb()
