# Deployment

Todoist Sync is one long-running Node process and one SQLite file, shipped as
a Docker image that also serves the web UI. Any host that can run that image
24/7 with a persistent disk and public HTTPS works. This page covers what
every host needs, then the steps for Railway, a plain VPS, Coolify, Fly.io and
Render.

- [What every host needs](#what-every-host-needs)
- [Railway](#railway)
- [Any VPS (Docker Compose + Caddy)](#any-vps-docker-compose--caddy)
- [Coolify](#coolify)
- [Fly.io](#flyio)
- [Render](#render)
- [Hosts that do not fit](#hosts-that-do-not-fit)
- [After the first deploy](#after-the-first-deploy)
- [Moving to another host](#moving-to-another-host)
- [Webhook URL requirements](#webhook-url-requirements)

## What every host needs

| Need | Why |
| --- | --- |
| **Runs the Dockerfile** | The image builds the server and the UI; nothing else to install. |
| **Always on** | The process keeps timers (reconcile every 15 min, watch-channel renewal) and must answer webhooks. A host that sleeps idle containers loses both. |
| **Persistent disk at `/data`** | Holds the OAuth tokens, the task ↔ event links, sync cursors and the settings saved in the UI. Without it every redeploy forgets the links and the next sync duplicates every event. |
| **Public HTTPS with a real certificate** | Google only delivers push notifications to a valid CA-signed certificate. A platform subdomain (`*.up.railway.app`, `*.fly.dev`, `*.onrender.com`) is fine. |

### Environment variables

Only credentials and the URL have to be set as variables. Pairs and options
are configured in the UI after the first deploy (they can still be seeded from
variables — see `.env.example`).

| Variable | Value |
| --- | --- |
| `PUBLIC_URL` | The public origin, e.g. `https://sync.example.com`, no trailing slash. |
| `ADMIN_TOKEN` | `openssl rand -hex 24`. Basic-auth password for the UI (username `admin`). **Required in practice**: without it anyone with the URL can reconnect the accounts, and settings cannot be saved. |
| `DATABASE_PATH` | `/data/sync.db`. The image already defaults to this. **Do not copy the relative `./data/sync.db` from `.env.example`**: it resolves inside the app directory, which is not writable and is wiped on redeploy. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From your Google Cloud OAuth client. |
| `GOOGLE_REDIRECT_URI` | `<PUBLIC_URL>/setup/google/callback` |
| `TODOIST_CLIENT_ID`, `TODOIST_CLIENT_SECRET` | From the Todoist App Management console. |
| `TODOIST_REDIRECT_URI` | `<PUBLIC_URL>/setup/todoist/callback` |
| `PORT` | Optional, defaults to `3000`. Most platforms inject it. |

### URLs to register with the providers

These follow `PUBLIC_URL`, so they change whenever the host or domain does:

- **Google Cloud** → OAuth client → Authorized redirect URIs:
  `<PUBLIC_URL>/setup/google/callback`
- **Todoist App Management** → OAuth redirect URL:
  `<PUBLIC_URL>/setup/todoist/callback`
- **Todoist App Management** → Webhooks → Callback URL:
  `<PUBLIC_URL>/webhooks/todoist` (events `item:added`, `item:updated`,
  `item:completed`, `item:uncompleted`, `item:deleted`), then activate the
  webhook.

Google's push channels need nothing registered: the app creates them itself
against `<PUBLIC_URL>/webhooks/google`.

### Health check

`GET /health` is public and returns `200` even before setup is finished
(`awaiting-setup`), so a fresh deploy passes its health check and you can open
the UI to connect the accounts. Point any platform health check at it.

### Run it locally first (optional)

```bash
docker build -t todoist-sync .
docker run -p 3000:3000 -v todoist-sync-data:/data --env-file .env todoist-sync
```

Make sure `.env` has `DATABASE_PATH=/data/sync.db` or drop the line.

## Railway

`railway.toml` already sets the Dockerfile build, the `/health` check and the
restart policy.

1. **New project → Deploy from GitHub repo**, pick this repository.
2. **Service → Settings → Volumes → Add volume**, mount path `/data`. The
   Dockerfile deliberately has no `VOLUME` instruction because Railway rejects
   it, so this step is manual.
3. **Service → Settings → Networking → Generate domain**. That gives
   `https://<name>.up.railway.app`; use it as `PUBLIC_URL`.
4. **Service → Variables**: add the variables from the table above.
   Railway injects `PORT` itself.
5. Redeploy, then continue with [After the first deploy](#after-the-first-deploy).

`RAILWAY_RUN_UID=0` is **not** needed, despite being Railway's documented
answer to volume permissions. Railway mounts volumes root-owned after the
image is built, so the image's entrypoint takes ownership of the database
directory at startup and then drops to the unprivileged `node` user.

A custom domain (Settings → Networking → Custom domain) only needs a `CNAME`
record at your DNS provider; Railway issues the certificate. Update
`PUBLIC_URL` and the three provider URLs afterwards.

## Any VPS (Docker Compose + Caddy)

Works on any Linux machine with Docker (Hetzner, OVH, Scaleway, a Raspberry Pi
with a public IP…). `deploy/` contains a Compose file that runs the app behind
[Caddy](https://caddyserver.com), which gets and renews the Let's Encrypt
certificate on its own.

1. Point a DNS record at the machine: `A sync.example.com → <server IP>`
   (plus `AAAA` for IPv6). Any DNS provider works, OVH included.
2. Open ports 80 and 443.
3. On the server:

   ```bash
   git clone https://github.com/arhunsaday/todoist-sync.git
   cd todoist-sync
   cp .env.example .env     # fill in credentials, ADMIN_TOKEN,
                            # PUBLIC_URL=https://sync.example.com
   cd deploy
   DOMAIN=sync.example.com docker compose up -d --build
   ```

4. Check `https://sync.example.com/health`, then continue with
   [After the first deploy](#after-the-first-deploy).

The database lives in the `data` Docker volume. To update:

```bash
git pull && cd deploy && DOMAIN=sync.example.com docker compose up -d --build
```

Logs: `docker compose logs -f app`.

## Coolify

[Coolify](https://coolify.io) is a self-hosted Railway on your own VPS, and
handles the HTTPS proxy for you.

1. **New resource → Public/Private repository**, pick this repository,
   build pack **Dockerfile**.
2. **Configuration → General → Domains**: `https://sync.example.com` (or the
   generated `sslip.io` domain). Port exposed: `3000`.
3. **Persistent storage → Add**: volume mounted at `/data`.
4. **Environment variables**: the table above.
5. **Health check**: path `/health`, port `3000`.
6. Deploy, then continue with [After the first deploy](#after-the-first-deploy).

## Fly.io

Fly runs the Docker image as a Machine with a volume. Install `flyctl`, then
from the repository:

```bash
fly launch --no-deploy        # detects the Dockerfile; pick a name and region
fly volumes create data --size 1 --region <region>
```

Edit the generated `fly.toml` so it contains:

```toml
[env]
  DATABASE_PATH = "/data/sync.db"

[mounts]
  source = "data"
  destination = "/data"

[http_service]
  internal_port = 3000
  force_https = true
  # Keep exactly one machine running: the app holds timers, and SQLite on
  # a volume cannot be shared between machines.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

[[http_service.checks]]
  method = "GET"
  path = "/health"
  interval = "30s"
  timeout = "5s"
```

Then set the secrets and deploy:

```bash
fly secrets set PUBLIC_URL=https://<app>.fly.dev ADMIN_TOKEN=... \
  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
  GOOGLE_REDIRECT_URI=https://<app>.fly.dev/setup/google/callback \
  TODOIST_CLIENT_ID=... TODOIST_CLIENT_SECRET=... \
  TODOIST_REDIRECT_URI=https://<app>.fly.dev/setup/todoist/callback
fly deploy
fly scale count 1             # never more than one machine
```

A custom domain: `fly certs add sync.example.com`, then the `CNAME` (or
`A`/`AAAA`) records it prints.

## Render

1. **New → Web Service**, connect the repository; Render detects the
   Dockerfile.
2. Instance type: a **paid** one. Free instances sleep after inactivity
   (timers stop, webhooks hit a cold start) and cannot have a disk.
3. **Advanced → Add disk**: mount path `/data`, 1 GB.
4. **Health check path**: `/health`.
5. **Environment**: the table above, with
   `PUBLIC_URL=https://<name>.onrender.com`.
6. Create, then continue with [After the first deploy](#after-the-first-deploy).

A service with a disk cannot scale beyond one instance, which is what this
app needs anyway.

## Hosts that do not fit

- **Vercel, Netlify, Cloudflare Workers/Pages and other serverless hosts.**
  The app is a long-running process with in-memory timers and a native SQLite
  binding (`better-sqlite3`) writing to a local file. Serverless functions are
  short-lived and have no persistent disk. (The Cloudflare-native rewrite,
  Accord, lives on the `accord` branch.)
- **Anything that sleeps idle containers** (free tiers of Render, Koyeb, etc.)
  — the reconcile timer and watch-channel renewal stop while asleep.
- **More than one replica.** Two processes would both sync and race on the
  same SQLite file. Run exactly one.

## After the first deploy

1. Open `PUBLIC_URL`, sign in with `admin` / your `ADMIN_TOKEN`.
2. **Vue d'ensemble** → connect Todoist, then Google Agenda.
3. **Paires** → choose a calendar for each project and save. Syncing starts
   immediately.
4. Check `/health`: `"status": "ok"` and no blocked calendar.

## Moving to another host

Move the database and nothing is re-synced:

1. Stop the old service (so nothing writes during the copy).
2. Copy `/data/sync.db` from the old volume to the new one (`railway ssh`,
   `fly ssh sftp`, `docker cp`, `scp`…). The database uses WAL mode: copy any
   `sync.db-wal` and `sync.db-shm` next to it as well.
3. Start the new service with the same Google and Todoist client ids.
4. Update `PUBLIC_URL`, the two redirect URIs and the Todoist webhook URL to
   the new origin. Google push channels registered by the old host keep
   pointing at it until they come up for renewal (within days); until then the
   periodic reconcile picks up calendar changes, just with up to 15 minutes of
   delay.

Starting from an empty disk instead also works: connect both accounts again,
save the pairs, then run `pnpm rebuild-links` on the server to re-attach the
existing events instead of duplicating them (see [Recovery](how-it-works.md#recovery-after-losing-the-database)).

### Backups

The file is small. The platform's volume snapshots (Railway and Fly both offer
them), or a copy of `/data` taken while the service is stopped, are enough. Even
without one, every managed event carries the Todoist task id, so
`pnpm rebuild-links` can reconstruct the links from the calendars.

## Webhook URL requirements

HTTPS with a certificate from a trusted CA, matching the hostname.
Self-signed, revoked, or mismatched certificates are all rejected silently —
Google simply stops delivering.

Domain verification is **not** required. Google [removed that
requirement](https://support.google.com/googleapi/answer/7072069): *"Domain
verification in the API Console is no longer required to make push
notifications work with your domains."* A platform-issued subdomain works
without a custom domain.

If `events.watch` fails anyway, it is not fatal. Registration failures are
logged and the app falls back to polling on `RECONCILE_INTERVAL_MINUTES` — you
lose push latency, not correctness.
