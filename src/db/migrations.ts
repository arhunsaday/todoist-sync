/**
 * Migrations are inlined rather than read from `.sql` files so that `tsc`
 * output in `dist/` is self-contained with no asset-copying build step.
 *
 * Append only. Never edit an entry that has shipped.
 */
export const migrations: ReadonlyArray<{ name: string; sql: string }> = [
  {
    name: '001_init',
    sql: `
      -- One row per synced pair. Note this table is a CACHE, not the source of
      -- truth: every managed event carries extendedProperties.private.todoistId,
      -- so a lost volume is recoverable via \`pnpm rebuild-links\`.
      CREATE TABLE links (
        todoist_item_id     TEXT PRIMARY KEY,
        google_event_id     TEXT NOT NULL,
        google_calendar_id  TEXT NOT NULL,
        todoist_project_id  TEXT NOT NULL,
        -- Fingerprints of the last state both sides agreed on. A change whose
        -- fingerprint still matches is our own write echoing back.
        todoist_fingerprint TEXT NOT NULL,
        google_fingerprint  TEXT NOT NULL,
        updated_at          INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX links_google_event
        ON links (google_calendar_id, google_event_id);

      -- 'todoist_sync_token', 'gcal_sync_token:<calendarId>'
      CREATE TABLE sync_state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE watch_channels (
        calendar_id TEXT PRIMARY KEY,
        channel_id  TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        token       TEXT NOT NULL,
        expiration  INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX watch_channels_channel_id
        ON watch_channels (channel_id);

      CREATE TABLE oauth_tokens (
        provider      TEXT PRIMARY KEY,
        access_token  TEXT NOT NULL,
        refresh_token TEXT,
        expires_at    INTEGER
      );
    `,
  },
]
