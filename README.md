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

The webhook signature is an HMAC of the raw body under the **client secret**.
The "Verification Token" shown in the console is not used here.

### 2. Google Cloud project

The consent screen now lives under **Google Auth Platform**, not the old
"OAuth consent screen" menu item.

1. Enable the [Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com).
2. **Google Auth Platform → Get started**: app name, support email,
   **Audience: External**, contact email.
3. **Data Access → Add or remove scopes**: add
   `https://www.googleapis.com/auth/calendar`. It is marked sensitive; that is
   expected.
4. **Audience → Publish app.** In *Testing* status, refresh tokens expire after
   7 days and the sync dies silently every week. Publishing unverified is fine
   for a single user — you get an "unverified app" interstitial at consent
   (Advanced → Go to…), but refresh tokens stop expiring. Verification only
   matters past 100 users.
5. **Clients → Create client**, type **Web application**:
   - Authorized redirect URI: `https://<your-domain>/setup/google/callback`
   - Authorized JavaScript origins: **leave empty** — that field is for
     browser-side flows, and this is a server-side code exchange.

`GOOGLE_REDIRECT_URI` must be byte-identical to the console entry; Google
compares it as an exact string. A work account may block creating OAuth
clients, in which case use a personal Cloud project.

### 3. Deploy, then authorize, then map

**`SYNC_MAPPINGS` is deliberately optional at boot**, because the setup would
otherwise deadlock: you need the running server to authorize Google, and you
need Google authorized before the calendar ids are discoverable.

```bash
cp .env.example .env   # credentials only; leave SYNC_MAPPINGS empty for now
```

Deploy, then:

1. Visit **`/setup`** and authorize both providers.
2. Visit **`/setup/ids`**. It lists every Todoist project and writable Google
   calendar, with a picker that assembles the `SYNC_MAPPINGS` line for you —
   worth using rather than copying `c_1a2b…@group.calendar.google.com` by eye.
3. Set `SYNC_MAPPINGS` in your environment and redeploy.

`/setup` shows all three steps and which are done. Until all three are, the
app boots, serves the setup pages, and syncs nothing — `/health` reports
`awaiting-setup` and returns `200` so the platform does not restart-loop it.

`pnpm list-ids` prints the same lists from a terminal, but only works where the
OAuth tokens are — on a hosted deploy that is the server, so use `/setup/ids`.

Both ids are also readable from the two UIs, if you would rather not wait for
the deploy:

- **Google calendar id** — Calendar → Settings → pick the calendar under
  "Settings for my calendars" → **Integrate calendar** → *Calendar ID*. Your
  own calendar is your email address; the rest look like
  `c_1a2b…@group.calendar.google.com`.
- **Todoist project id** — open the project on the web; the id is the trailing
  segment of the URL, `app.todoist.com/app/project/<slug>-<id>`, e.g.
  `6Jf837c4fJQw5Hg8`. In API v1 this is the same id the API uses, but
  `/setup/ids` is worth a glance to confirm.

Each entry needs **both** halves separated by a colon. A bare project id is
rejected at boot with `expected "todoistProjectId:googleCalendarId"`:

```
SYNC_MAPPINGS=6Jf837c4fJQw5Hg8:c_1a2b@group.calendar.google.com,6Jf837qfR3px2795:me@gmail.com
```

### 4. Dry run before the first live sync

```bash
pnpm reconcile:once --dry-run
```

Logs every intended write without performing one, and persists no state. This
is the cheapest way to catch a wrong mapping before it creates 400 events.
Needs local tokens, so run it after authorizing locally, or accept that the
first hosted reconcile is the live one.

## Deployment

Any host works. Requirements:

- **HTTPS with a valid CA certificate** — Google refuses to deliver push
  notifications to anything else.
- **Persistent storage** mounted at the `DATABASE_PATH` directory (`/data` in
  the image).
- `PUBLIC_URL` set to the public origin.

```bash
docker build -t t2gc . && docker run -p 3000:3000 -v t2gc-data:/data --env-file .env t2gc
```

### Railway

`railway.toml` covers the build and deploy settings. What it cannot express:

**Attach a volume** — Service → Settings → Volumes, mount path `/data`.
Without it the link table is wiped on every redeploy and the next sync
duplicates every event (`pnpm rebuild-links` recovers, but avoid needing it).
The Dockerfile deliberately has no `VOLUME` instruction; Railway rejects builds
that use one.

Then set these service variables:

```
DATABASE_PATH=/data/sync.db
PUBLIC_URL=https://<name>.up.railway.app
SYNC_MAPPINGS=            # empty on first deploy; build it at /setup/ids
```

`DATABASE_PATH` **must be absolute and inside the mount.** Copying the
relative local default out of `.env` is the most likely way to break this: it
resolves to `/app/data`, which is not writable, and would not survive a
redeploy even if it were. Railway injects `PORT` itself.

`RAILWAY_RUN_UID=0` is **not** needed, despite being Railway's documented
answer to volume permissions. Railway mounts volumes root-owned after the image
is built, so no build-time `chown` can help — but the entrypoint takes
ownership of the database directory at startup and then drops to the
unprivileged `node` user, so the process never runs as root. Verified against a
`root:root` mode-`700` mount.

### Webhook URL requirements

HTTPS with a certificate from a trusted CA, matching the hostname. Self-signed,
revoked, or mismatched certificates are all rejected silently — Google simply
stops delivering.

Domain verification is **not** required. Google [removed that
requirement](https://support.google.com/googleapi/answer/7072069): *"Domain
verification in the API Console is no longer required to make push
notifications work with your domains."* A platform-issued subdomain such as
`*.up.railway.app` works without a custom domain.

If `events.watch` fails anyway, it is not fatal. Registration failures are
logged and the app falls back to polling on `RECONCILE_INTERVAL_MINUTES` — you
lose push latency, not correctness.

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
