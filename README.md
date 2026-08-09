# todoist-to-google-calendar

Two-way sync between Todoist projects and Google calendars, **one project per
calendar**. Todoist's official integration collapses every task into a single
calendar; this routes each project to its own.

## How it works

> Webhooks are wake-up signals. Sync tokens are the source of truth.

Both webhook handlers do the same thing: validate, wake the reconciler, return
`200`. Neither reads task data out of its payload. The reconciler then pulls
the authoritative diff via Todoist's `sync_token` and Google's `syncToken`.

That split removes out-of-order, duplicate, and dropped deliveries as classes
of bug — a lost webhook costs latency, not correctness, because the periodic
reconcile catches it. Google forces this shape anyway: its push payload is an
empty body, so the data has to be fetched separately regardless.

### Loop prevention

The hard part of two-way sync. Our write to Google fires a Google push →
reconcile → write back to Todoist → fires a Todoist webhook → forever.

After every write, the resulting fingerprint is stored for **both** sides. When
the notification that write triggered comes back, the recomputed fingerprint
matches what was stored and the change is dropped as an echo. Fingerprints
cover only the fields that participate in the sync — never `etag`, `updated`,
or `sequence`, which change on their own.

### What syncs

| Todoist | Google Calendar |
|---|---|
| `content` | event title |
| `description` | event description |
| due date, no time | all-day event |
| due date with time | timed event, `duration` long (default 60 min) |
| no due date | no event |
| task completed | event deleted |
| task moved to another mapped project | event moved to that calendar |
| task in an unmapped project | no event |
| recurring task | current occurrence only, as a plain event |

Reverse: renaming, rescheduling, or resizing an event updates the task;
dragging it to another mapped calendar moves the task to that project;
**deleting an event completes the task**.

Events created directly on a mapped calendar become tasks in the paired
project, and are then tagged so they are managed from that point on. Skipped:
recurring series, birthdays, working-location and Gmail-generated events, and
invitations you declined.

**Recurring calendar events are not turned into tasks.** `timeMin`/`timeMax`
are forbidden alongside `syncToken`, so a recurring series cannot be expanded
into instances under incremental sync, and a half-synced series is worse than
none. Set `SYNC_RECURRING_FOREIGN_EVENTS=true` only once an RRULE translation
layer exists — the flag alone does nothing.

### Conflict policy

`pullTodoist` runs before `pullGoogle`, so if the same task is edited on both
sides within one window, **Todoist wins**. This is a deliberate simplification
over timestamp comparison: it needs no extra fetch per change and no clock-skew
handling, at the cost of losing a simultaneous calendar-side edit.

## Setup

**Disable the official Todoist ↔ Google Calendar integration first.** Two sync
engines on the same events will fight.

### 1. Todoist app

Create an app in the [App Management console](https://app.todoist.com/app/settings/integrations/developer):

- OAuth redirect URI: `https://<your-domain>/setup/todoist/callback`
- Webhook URL: `https://<your-domain>/webhooks/todoist`
- Webhook events: `item:added`, `item:updated`, `item:completed`,
  `item:uncompleted`, `item:deleted`
- Scope: `data:read_write`

Webhooks only fire for **OAuth-authorized apps**. A personal API token will not
trigger them, no matter how it is configured.

### 2. Google Cloud project

Enable the Calendar API, create an OAuth client (Web application) with redirect
URI `https://<your-domain>/setup/google/callback`, and **publish the consent
screen to "In production"**. In "Testing" status, refresh tokens expire after
7 days and the sync dies silently every week.

Your work account may block creating OAuth clients — a personal Google Cloud
project is the path of least resistance.

### 3. Configure and authorize

```bash
cp .env.example .env
```

Fill in the credentials, then resolve the ids:

```bash
pnpm list-ids
```

Put the four pairs into `SYNC_MAPPINGS`, deploy, and visit `/setup` to
authorize both providers.

### 4. Dry run before the first live sync

```bash
pnpm reconcile:once --dry-run
```

Logs every intended write without performing one, and persists no state. This
is the cheapest way to catch a wrong mapping before it creates 400 events.

## Deployment

Any host works. Requirements:

- **HTTPS with a valid CA certificate** — Google refuses to deliver push
  notifications to anything else.
- **A persistent volume** mounted at the `DATABASE_PATH` directory.
- `PUBLIC_URL` set to the public origin.

```bash
docker build -t t2gc . && docker run -p 3000:3000 -v t2gc-data:/data --env-file .env t2gc
```

### Google may require a verified domain

If `events.watch` fails with `pushNotificationsNotAllowed`, the receiving
domain must be verified in Search Console and added to the Cloud project's
authorized domains. **A `*.up.railway.app` subdomain cannot be verified**,
because you do not own it — use a custom domain.

This is not fatal. Channel registration failures are logged and the app falls
back to polling on `RECONCILE_INTERVAL_MINUTES`; you lose push latency, not
correctness.

## Recovery

The SQLite file is a **cache, not the source of truth** — every managed event
carries `extendedProperties.private.todoistId`. If the volume is lost:

```bash
pnpm rebuild-links          # reconstruct pairings from the calendars
pnpm rebuild-links --prune  # also delete events whose task is gone
```

Links are rebuilt with a blank Todoist fingerprint, so the next reconcile
re-pushes every task. That costs one write per task but guarantees
convergence, rather than silently accepting drift from the downtime.

## Development

```bash
pnpm install
pnpm test          # 113 tests, no network
pnpm typecheck
pnpm dev
```

Local webhook delivery needs a public URL — `cloudflared tunnel --url
http://localhost:3000`, then set `PUBLIC_URL` to the tunnel origin.

The mapping, fingerprint, and time modules are pure and directly testable. The
engine tests run against in-memory fakes that reproduce the one behaviour that
matters: **a write is reported back on the next incremental read**, exactly as
the real services do. Without that, an echo-suppression test proves nothing.

## Known sharp edges

- Todoist's command API returns no item body, so the post-write task state is
  reconstructed rather than read back. If Todoist normalises a field
  differently, the next reconcile corrects it in one extra pass. It cannot
  loop — that pass stores what Todoist actually reported.
- A change that fails to apply does not hold back the sync cursor. Stalling
  every other change behind one broken task is worse; failures are logged at
  `error` and that is the signal to look.
- Multi-day all-day events map to a Todoist `duration` in days. Watch the
  first live run for `item_update` rejections if Todoist declines a day
  duration on a date-only task.
