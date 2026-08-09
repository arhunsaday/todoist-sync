import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

import Database from 'better-sqlite3'

import { getCredentials } from '../config.js'
import { logger } from '../logger.js'
import { migrations } from './migrations.js'

export type Db = Database.Database

let instance: Db | undefined

/**
 * A permission error here is nearly always a misconfigured volume, and the
 * raw EACCES stack sends you looking at the code instead. Two causes account
 * for almost all of them, so name both.
 */
function describeOpenFailure(path: string, error: unknown): string {
  const directory = dirname(resolve(path))
  const relative = !isAbsolute(path)

  return [
    `Cannot open the database at ${path} (resolved to ${directory}).`,
    relative
      ? '\nDATABASE_PATH is RELATIVE, so it resolves inside the app directory ' +
        'rather than your mounted volume — the data would not survive a ' +
        'redeploy even if this succeeded. Set it to an absolute path under the ' +
        'mount, e.g. DATABASE_PATH=/data/sync.db.'
      : '\nThe directory is not writable by this process. If the mount is ' +
        'owned by root and the container runs as a non-root user, grant access ' +
        '— on Railway that means setting RAILWAY_RUN_UID=0 on the service.',
    `\nUnderlying error: ${(error as Error).message}`,
  ].join('')
}

function open(path: string): Db {
  if (path !== ':memory:') {
    try {
      mkdirSync(dirname(path), { recursive: true })
    } catch (error) {
      throw new Error(describeOpenFailure(path, error))
    }
  }

  let db: Db
  try {
    db = new Database(path)
  } catch (error) {
    throw new Error(describeOpenFailure(path, error))
  }

  // WAL keeps the reconcile loop's writes from blocking webhook handlers.
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `)

  const isApplied = db.prepare<[string], { name: string }>(
    'SELECT name FROM schema_migrations WHERE name = ?',
  )
  const markApplied = db.prepare(
    'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
  )

  for (const migration of migrations) {
    if (isApplied.get(migration.name) !== undefined) continue

    // Each migration is atomic: schema change and its bookkeeping row commit
    // together, so a crash mid-migration cannot leave it half-applied.
    db.transaction(() => {
      db.exec(migration.sql)
      markApplied.run(migration.name, Date.now())
    })()

    logger.info({ migration: migration.name }, 'applied migration')
  }
}

/** Process-wide connection, opened and migrated on first use. */
export function getDb(): Db {
  if (instance === undefined) {
    instance = open(getCredentials().DATABASE_PATH)
    migrate(instance)
  }
  return instance
}

/** For tests: an isolated, migrated in-memory database. */
export function createTestDb(): Db {
  const db = open(':memory:')
  migrate(db)
  return db
}

export function closeDb(): void {
  instance?.close()
  instance = undefined
}
