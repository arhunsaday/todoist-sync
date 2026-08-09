import {
  itemSchema,
  type TodoistItem,
  type TodoistNote,
} from '../todoist/types.js'
import type { Db } from './index.js'

/**
 * Local mirror of the Todoist state we last saw.
 *
 * This exists because comments are a separate resource: editing one does not
 * touch its task, so an incremental sync reports the note on its own. To
 * re-render that task's event we need its fields, and the sync response no
 * longer contains them. Caching the item is cheaper and less fragile than
 * fetching it back one id at a time.
 *
 * Still a cache, not a source of truth — a cold start does a full sync and
 * repopulates the lot.
 */

export function putItem(db: Db, item: TodoistItem): void {
  db.prepare(
    `INSERT INTO items (id, payload) VALUES (?, ?)
     ON CONFLICT (id) DO UPDATE SET payload = excluded.payload`,
  ).run(item.id, JSON.stringify(item))
}

export function getItem(db: Db, id: string): TodoistItem | undefined {
  const row = db
    .prepare<[string], { payload: string }>(
      'SELECT payload FROM items WHERE id = ?',
    )
    .get(id)

  if (row === undefined) return undefined

  // A cached payload written by an older build may not satisfy the current
  // schema; treat that as a miss rather than crashing the sync.
  const parsed = itemSchema.safeParse(JSON.parse(row.payload))
  return parsed.success ? parsed.data : undefined
}

export function removeItem(db: Db, id: string): void {
  db.prepare('DELETE FROM items WHERE id = ?').run(id)
}

export function putNote(db: Db, note: TodoistNote): void {
  if (note.item_id == null) return

  db.prepare(
    `INSERT INTO notes (id, item_id, content, posted_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       item_id   = excluded.item_id,
       content   = excluded.content,
       posted_at = excluded.posted_at`,
  ).run(note.id, note.item_id, note.content, note.posted_at ?? null)
}

export function removeNote(db: Db, id: string): void {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id)
}

export interface StoredNote {
  content: string
  postedAt: string | null
}

/** Oldest first, so the rendered thread reads in the order it was written. */
export function getNotes(db: Db, itemId: string): StoredNote[] {
  return db
    .prepare<[string], { content: string; posted_at: string | null }>(
      `SELECT content, posted_at FROM notes
       WHERE item_id = ?
       ORDER BY COALESCE(posted_at, '') ASC, id ASC`,
    )
    .all(itemId)
    .map((row) => ({ content: row.content, postedAt: row.posted_at }))
}

export function removeNotesForItem(db: Db, itemId: string): void {
  db.prepare('DELETE FROM notes WHERE item_id = ?').run(itemId)
}
