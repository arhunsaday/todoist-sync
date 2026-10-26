import {
  EDITABLE_SETTINGS,
  type EditableSetting,
  type SettingValues,
} from '../config.js'
import type { Db } from './index.js'

const editable = new Set<string>(EDITABLE_SETTINGS)

/** Settings saved from the UI. Keys outside `EDITABLE_SETTINGS` are ignored. */
export function getSettings(db: Db): SettingValues {
  const rows = db
    .prepare<[], { key: string; value: string }>('SELECT key, value FROM settings')
    .all()

  const values: SettingValues = {}
  for (const { key, value } of rows) {
    if (editable.has(key)) values[key as EditableSetting] = value
  }
  return values
}

/** Upsert in one transaction, so a save never lands half-applied. */
export function saveSettings(db: Db, values: SettingValues): void {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  )

  db.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      if (!editable.has(key) || value === undefined) continue
      upsert.run(key, value)
    }
  })()
}
