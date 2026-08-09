# Two-way Todoist ↔ Google Calendar sync (4 projects → 4 calendars)

## Context

Todoist's official Google Calendar integration collapses every task into a **single**
calendar. The goal is per-project routing: 4 Todoist projects each mirrored to their own
Google calendar, syncing in both directions.

`/Users/asaday/Repos/todoist-to-google-calendar` already exists but is an empty Go
scaffold — one commit, a hello-world `main.go` (zerolog + godotenv) and an `.env.example`
stubbed for Google OAuth + Todoist. We keep the repo and `.env.example` key names, delete
`main.go` / `go.mod` / `go.sum`, and rebuild in TypeScript.

**Decisions locked with the user:** two-way sync; TypeScript/Node; SQLite on a persistent
volume; complete task → delete event, delete event → complete task; events created
directly in a mapped calendar become tasks in the paired project; recurring foreign
events are skipped (config flag).

## Trigger design: webhooks _and_ polling, with a clean split

The key insight that keeps this simple:

> **Webhooks are wake-up signals. Sync tokens are the source of truth.**

Both webhook handlers do the same thing — validate, mark a side dirty, kick the
reconciler, return 200 immediately. Neither one reads task data out of the payload.
The reconciler then pulls the authoritative diff via `sync_token` (Todoist) and
`syncToken` (Google). This removes out-of-order delivery, missed deliveries, and
duplicate deliveries as classes of bug — a lost webhook only costs latency, because the
periodic reconcile catches it.

Three triggers, one code path:

- `POST /webhooks/todoist` — HMAC-verified
- `POST /webhooks/google` — channel-token-verified (Google's payload is an empty body;
  data must be fetched separately regardless, so this fits naturally)
- `setInterval` reconcile every 15 min — safety net, plus daily Google watch-channel renewal

## Stack

| Concern    | Choice                     | Note                                                         |
| ---------- | -------------------------- | ------------------------------------------------------------ |
| HTTP       | `hono`                     | Clean raw-body access, needed for HMAC verification          |
| Google     | `googleapis`               | Official SDK, handles refresh-token rotation                 |
| Todoist    | hand-rolled `fetch` client | The official TS SDK wraps only REST, not Sync                |
| DB         | `better-sqlite3`           | Synchronous, no pool, plain SQL + numbered `.sql` migrations |
| Validation | `zod`                      | Config + API response parsing                                |
| Logging    | `pino`                     |                                                              |
| Tests      | `vitest`                   |                                                              |

No scheduler dependency — `setInterval` covers both timers.

## Repo layout

```
src/
  index.ts                  bootstrap: migrate, restore watches, start server + timers
  config.ts                 zod-validated env; the 4 project↔calendar pairs
  db/
    index.ts                connection + migrate()
    migrations/001_init.sql
    links.ts  state.ts      link CRUD; sync tokens, channels, oauth tokens
  todoist/
    client.ts               read: sync();  write: commands()
    types.ts                zod schemas for Item / Project
    oauth.ts
  google/
    client.ts               authed calendar client
    oauth.ts
    watch.ts                watch / renew / stop channels
  sync/
    engine.ts               mutex-guarded reconcile loop
    todoist-to-google.ts
    google-to-todoist.ts
    fingerprint.ts          canonical hashing — echo suppression
    mapping.ts
  web/
    server.ts  todoist-webhook.ts  google-webhook.ts  setup.ts
data/                       SQLite volume mount point
```

## Data model

```sql
links (                                  -- one row per synced pair
  todoist_item_id     TEXT PRIMARY KEY,
  google_event_id     TEXT NOT NULL,
  google_calendar_id  TEXT NOT NULL,
  todoist_project_id  TEXT NOT NULL,
  todoist_fingerprint TEXT NOT NULL,     -- last state we know both sides agreed on
  google_fingerprint  TEXT NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE(google_calendar_id, google_event_id)
)
sync_state     (key TEXT PRIMARY KEY, value TEXT)   -- 'todoist_sync_token', 'gcal_sync_token:<calId>'
watch_channels (calendar_id TEXT PRIMARY KEY, channel_id, resource_id, token, expiration INTEGER)
oauth_tokens   (provider TEXT PRIMARY KEY, access_token, refresh_token, expires_at INTEGER)
```

**SQLite is a cache, not the source of truth.** Every event we create carries
`extendedProperties.private.todoistId`, so if the volume is ever lost the link table is
rebuilt by listing each calendar with `privateExtendedProperty=todoistId=*`. Build that
recovery path (`pnpm rebuild-links`) — it turns "volume wiped on redeploy" from a
duplicate-event disaster into a slow startup.

## The reconcile loop (`sync/engine.ts`)

Single in-process mutex with coalescing, so concurrent webhooks can't interleave writes:

```
reconcile():
  if running: dirty = true; return
  running = true
  do { dirty = false; pullTodoist(); for (cal of mapped) pullGoogle(cal) }
  while (dirty)
  running = false
```

**`pullTodoist()`** — POST `/api/v1/sync`, `resource_types: ["items","projects"]`, stored
token. Per changed item: if its project isn't mapped but a link exists → delete the event
and drop the link. Otherwise compute the Todoist fingerprint; if it equals the stored one
this is our own echo → skip. Else push to Google. Persist the new `sync_token` last.

**`pullGoogle(cal)`** — `events.list` with stored `syncToken`; on **410 GONE** clear the
token and do a full resync (`singleEvents=false`, `showDeleted=true`). Per changed event:

- has `recurrence` and no `todoistId` → recurring foreign event, skip + log
- has `todoistId` → `status==='cancelled'` ⇒ `item_complete` + drop link; else compare
  fingerprint, skip echoes, apply `item_update` / `item_move`
- no `todoistId`, single, not cancelled → `item_add` in the paired project, then patch the
  event with the new `todoistId`, create the link

`timeMin`/`timeMax` are **forbidden** alongside `syncToken`, which is precisely why
`singleEvents=false` is required — it keeps unbounded recurring series from expanding
into infinite instances on the initial full sync.

## Field mapping

**Todoist → Google**

| Todoist                  | Google                                                  |
| ------------------------ | ------------------------------------------------------- |
| `content`                | `summary`                                               |
| `description`            | `description` + task deep link via `source`             |
| `due.date`, no time      | all-day: `start.date`, `end.date` = +1 day              |
| `due.date` with time     | `start.dateTime`, `end.dateTime` = start + duration     |
| `duration {amount,unit}` | event length; default 60 min when absent (configurable) |
| no due date              | no event — delete if one exists                         |
| `checked` / `is_deleted` | delete event, drop link                                 |
| `project_id` changed     | `events.move` (preserves the event id)                  |
| recurring task           | current occurrence only, as a plain single event        |

**Google → Todoist**: `summary`→`content`, start/end→`due`+`duration`, calendar
change→`item_move`, cancelled→`item_complete`.

All managed events get `extendedProperties.private = { todoistId, managedBy: 't2gc' }`.

## Loop prevention

The hard part of two-way sync. Our write to Google fires a Google push → reconcile →
would write back to Todoist → fires a Todoist webhook → ∞.

After **every** write, recompute and store _both_ fingerprints from the API response.
When the resulting notification arrives, the incoming fingerprint matches the stored one
and the change is discarded as an echo. Fingerprint = sha256 of canonical JSON over only
the fields that participate in sync (not `updated_at`, not `etag`).

**Conflict** (both fingerprints differ in one pass): last-writer-wins on Todoist
`updated_at` vs Google `updated`. Log at `warn` — silent conflict resolution is how you
lose data without noticing.

## One-time setup

1. **Disable the official Todoist ↔ Google Calendar integration first.** Otherwise both
   sync engines fight over the same events.
2. **Todoist app** (App Management console): webhook URL, events `item:added`,
   `item:updated`, `item:completed`, `item:uncompleted`, `item:deleted`, scope
   `data:read_write`. Webhooks require an **OAuth token — a personal API token will not
   fire them.** Run the OAuth flow once against your own account via `/setup/todoist`.
3. **Google Cloud project**: enable Calendar API, OAuth consent screen, scope
   `.../auth/calendar`, `access_type=offline` + `prompt=consent`. Authorize via
   `/setup/google`.
4. Resolve the 4 project ids and 4 calendar ids into config (`pnpm list-ids` helper).

## Deployment

Railway or a VPS — both fine. Requirements: HTTPS with a valid CA certificate (Google
refuses self-signed), a mounted volume at `data/`, and the two webhook URLs reachable.

## Sharp edges

1. **Google OAuth in "Testing" publishing status expires refresh tokens after 7 days.**
   Publish the consent screen to "In production" or the sync silently dies each week.
2. **Google push likely requires a verified receiving domain.** A `*.up.railway.app`
   subdomain can't be verified in Search Console because you don't own it — budget for a
   custom domain. If `events.watch` returns `webhookUrlUnauthorized`, this is why.
3. Watch channels expire (~30 days max, often less) and Google **never** auto-renews.
   Read `expiration` from the response, renew anything inside 48h, `channels.stop` the old
   one after the new one is live.

## Build order

1. Scaffold + config + SQLite migrations + `pnpm list-ids`
2. Todoist Sync client (read + commands) and Google client, both with `--dry-run`
3. `fingerprint.ts` + field mapping as **pure functions** — unit-testable, no network
4. `pullTodoist` (Todoist → Google one-way), verified end to end
5. `pullGoogle` (Google → Todoist), including foreign-event creation
6. Webhook endpoints + HMAC/channel-token verification + watch registration/renewal
7. `rebuild-links` recovery path, deploy, cut over

## Verification

- **Unit** (`vitest`, no network): fingerprint stability and echo suppression; every row
  of the field-mapping table including all-day vs timed vs no-due-date; RRULE-present
  skip logic; 410 recovery.
- **Dry run**: `pnpm reconcile:once --dry-run` against real accounts logs every intended
  write without performing it. Run this before the first live write — it is the cheapest
  way to catch a mapping error before it creates 400 events.
- **Local webhooks**: `cloudflared tunnel` to expose the dev server for real deliveries.
- **Manual end-to-end checklist**: task with due date → event in the correct calendar;
  drag event → task due date moves; complete task → event disappears; delete event → task
  completes; move task between projects → event changes calendar; create event directly →
  task appears in the paired project; recurring meeting → no task, logged as skipped.
- **Loop check**: after each of the above, confirm the reconcile pass that follows logs
  an echo-skip and performs **zero** writes. This is the one that catches infinite loops.
