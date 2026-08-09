import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'

import { getCredentials } from '../config.js'
import { logger } from '../logger.js'
import { migrations } from './migrations.js'

export type Db = Database.Database

let instance: Db | undefined

function open(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }

  const db = new Database(path)
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
