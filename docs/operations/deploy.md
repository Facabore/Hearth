# Deploying Hearth to a VPS

## Prerequisites

- A Linux VPS with Docker Engine and the Compose plugin, version 2.24.0 or later (`compose.yaml` loads the optional `.env.offsite` with `required: false`).
- A DNS `A`/`AAAA` record for your domain pointing at the VPS.
- Inbound TCP 80 and 443 (and UDP 443 for HTTP/3) open; nothing else needs to be public. PostgreSQL is never published.
- Access to the images: either make the GHCR packages `hearth`, `hearth-migrator` and `hearth-web` public in GitHub, or run `docker login ghcr.io` on the VPS with a token that has `read:packages`.

## First deployment

1. Copy `compose.yaml`, `Caddyfile` and the `scripts/` directory to a directory on the VPS, e.g. `/opt/hearth`. The backup containers mount their scripts from `scripts/`.
2. Create `/opt/hearth/.env` from `.env.production.example`; set `HEARTH_DOMAIN`, generate `POSTGRES_PASSWORD` with `openssl rand -hex 32` (it is embedded in a connection URL, so it must not contain `/`, `+` or `=`) and `BETTER_AUTH_SECRET` with `openssl rand -base64 48`, and set the three image tags (`HEARTH_APP_IMAGE`, `HEARTH_MIGRATOR_IMAGE` and `HEARTH_WEB_IMAGE`) to the commit SHA built by CI on `main`.
3. `docker compose pull && docker compose up -d`
4. Verify:
   - `docker compose ps` — `migrate` exited 0; `db`, `app` and `web` healthy; `caddy` and `backup` running.
   - `docker compose exec backup sh /hearth/backup.sh` → a `backup_written` line (see [Backups and restore](backups.md)).
   - `curl -s https://$HEARTH_DOMAIN/api/v1/health` → `{"status":"ok"}` with a valid certificate.
   - `curl -s https://$HEARTH_DOMAIN/api/v1/openapi.json | head -c 40` → `{"openapi":"3.1.0"…`.
   - `curl -s https://$HEARTH_DOMAIN/ | grep -c 'id="root"'` → `1`: the single-page app (see Web UI).
   - `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' https://$HEARTH_DOMAIN/app/sign-in` → `308 https://$HEARTH_DOMAIN/sign-in`: an old `/app/…` bookmark lands on the same screen.

If a required variable is missing, Compose refuses to start and names it; a missing or invalid `BETTER_AUTH_SECRET` makes the `app` container exit with status 1 and the message `Missing or invalid environment variables: BETTER_AUTH_SECRET`.

## Behind a reverse proxy the host already runs

When the VPS already serves other sites through its own proxy on 80 and 443 (for example a Caddy installed on the host), the bundled `caddy` service cannot bind those ports. Keep it off and let the host proxy reach the app and the web service on loopback only:

1. Next to `compose.yaml`, create `compose.override.yaml` (Compose merges it on its own):

   ```yaml
   services:
     app:
       ports: ["127.0.0.1:5300:3000"]
     web:
       ports: ["127.0.0.1:5301:8080"]
     caddy:
       profiles: [bundled-proxy]
   ```

   Pick any free loopback ports. Never publish the app or the web service on `0.0.0.0`.

2. Add a site to the host proxy. For a host Caddy, put this site in `/etc/caddy/sites/hearth.caddy` (with your domain in place of `hearth.example.com`), then run `caddy validate --config /etc/caddy/Caddyfile` and `systemctl reload caddy`:

   ```
   hearth.example.com {
   	encode zstd gzip
   	@api path /api /api/*
   	handle @api {
   		reverse_proxy 127.0.0.1:5300
   	}
   	handle {
   		reverse_proxy 127.0.0.1:5301
   	}
   }
   ```

   `/api` and `/api/*` go to the app; everything else goes to the web service, the single-page app (see Web UI), which also redirects the app's old `/app/…` addresses to the same screen at the root.

   A site from before the cut-over (#199) sends `/app` and `/app/*` to 127.0.0.1:5301 and everything else to 127.0.0.1:5300. Replace it with the block above in the same release as the cut-over: the old block would send every screen to the app, which since the cut-over answers only `/api/*`.

   Without `trusted_proxies`, the host Caddy also replaces any client-sent `X-Forwarded-For`, so the sign-in throttles keep keying on the real address (see Reverse proxy and client addresses).

Everything else, including `HEARTH_DOMAIN` in `.env`, stays as in First deployment.

## Recurring transactions job

The `app` container records due recurring transactions itself (HU-E4-12): a timer runs the job when the server starts, so a restart catches up the days it missed, and then `RECURRENCE_JOB_INTERVAL_SECONDS` after each run ends (default 300; `0` turns it off), so two runs of one container never overlap. No endpoint triggers it. Running it in two containers is safe: runs of one recurrence take turns on its row and a date is never recorded twice. Each run logs JSON lines, and never an error message, a query or its parameters:

- `recurrence_occurrence_skipped` (`recurrenceId`, `spaceId`, `date`, `reason`): a date that was not recorded, with its reason, e.g. `PeriodClosed` for a closed plan's period.
- `recurrence_paused` (`recurrenceId`, `spaceId`, `reason`): the recurrence paused, for `PayerLeft`, `CreatorLeft` or the code that refused its date.
- `recurrence_materialization_failed` (`recurrenceId`, `spaceId`, `error`, and `code` and `constraint` for a database error): one recurrence failed and rolled back; the next run retries it.
- `recurrence_job_failed` (`name`, and `code` and `constraint` for a database error): a whole run failed, for example because the database was unreachable; the next tick runs again.

`next build` never starts the job. `next dev` does, every 300 s by default like the server: set `RECURRENCE_JOB_INTERVAL_SECONDS=0` in your local environment to keep it off while you develop.

## Closing sign-up

By default anyone who reaches your domain can create an account, and the email address is never verified. Once your own household has accounts, set `HEARTH_SIGN_UP=closed` in `.env` to make sign-up invite-only: a visitor without an invitation gets `403 SignUpClosed`, the sign-up screen says so, and the sign-in screen hides its "Create account" link. People you invite can still join. They open the invitation link, create their account (the link carries the token that lets them through) and accept it as usual; an invitation by email only admits the address it names, while a link invitation or a claim link admits any address. Revoked, used and expired invitations admit nobody. The values are `open` (the default) and `closed`; anything else makes the app refuse to start.

Recommended order:

1. Sign up your household while sign-up is open.
2. Set `HEARTH_SIGN_UP=closed` in `.env`.
3. Run `docker compose up -d`: Compose recreates the `app` container with the new value.

To let someone join later, send them an invitation from a shared space. To reopen sign-up, set `HEARTH_SIGN_UP=open` and run `docker compose up -d` again.

## Reverse proxy and client addresses

The sign-in and sign-up throttles key on the client address from `X-Forwarded-For`. Caddy replaces any client-sent value with the real peer address because no `trusted_proxies` are configured, and the `app` and `web` services publish no port, so they are reachable only through Caddy. Keep both properties: never publish ports 3000 or 8080 beyond loopback (behind a host proxy, `127.0.0.1` only), and only add `trusted_proxies` if another proxy you control sits in front of Caddy.

## Web UI

The web UI is the single-page app of [ADR 0006](../adr/0006-client-first-single-page-app.md), at the root (`/`, `/sign-in`, `/spaces/…`) since the cut-over of epic #199. Its static files live in the `web` image, whose Caddy serves `index.html` for every screen's path and a 404 for a file that is not there (ruling N1). Its hashed assets are cached for a year and `index.html` is revalidated on every visit, so a release shows at once. It calls `/api/v1` on the same origin with the session cookie and needs no variable of its own. The app's first address, `/app/…`, redirects to the same path at the root, so bookmarks keep working.

The `app` container serves the API only (`/api/*`). `HEARTH_E2E_FIXED_NOW` fixes the clock for the end-to-end tests only and must never be set in production.

## Updating

1. Take a backup: `docker compose exec backup sh /hearth/backup.sh`.
2. Copy the release's `compose.yaml`, `Caddyfile` and `scripts/` over the old ones, and set `HEARTH_APP_IMAGE`, `HEARTH_MIGRATOR_IMAGE` and `HEARTH_WEB_IMAGE` in `.env` to the new SHA. The first release with the web service adds `HEARTH_WEB_IMAGE` (`ghcr.io/facabore/hearth-web:<sha>`); without it Compose refuses to start and names it. Behind a host proxy, also keep the `web` port and the host site of Behind a reverse proxy the host already runs as they are written there: the release of the cut-over (#199) changes that site.
3. `docker compose pull && docker compose up -d` — `migrate` runs pending migrations before `app` starts.

## Rolling back

Set the image tags back to the previous SHA and run `docker compose up -d`. Rolling back past the cut-over (#199) also needs that release's `Caddyfile` and, behind a host proxy, its host site (`/app` and `/app/*` to the web service, everything else to the app): before the cut-over the app served the screens. A release from before the web service has no `hearth-web` image: keep `HEARTH_WEB_IMAGE` at the first release that has one, or restore that release's `compose.yaml` and `Caddyfile` too. Migrations are forward-only; a release whose migration is not backward compatible must say so in its PR.

## Staging

ADR 0008: `development` deploys itself to a staging site, so changes can be tried before they go through `main`. Production is not involved.

- Every push to `development` runs `.github/workflows/staging.yml`: typecheck and the tests that need no database, then the app, migrator and web images are pushed as `:development` and `:<sha>`. A newer push cancels an older run.
- On the VPS, `scripts/staging-update.sh` runs every minute from `hearth-deploy`'s cron. It pulls the `:development` images and runs `up -d` (migrations first) only when one of them changed or the app is not running. It logs one JSON line per update or failure to `/opt/hearth-staging/update.log`.

### Setting it up once

As `hearth-deploy` on the VPS:

1. Create `/opt/hearth-staging` with `compose.yaml`, `scripts/` and `deploy/staging/compose.staging.yaml` (saved there as `compose.staging.yaml`) from the repository. The override names the project `hearth-staging`, so its containers, network and database volume are its own, and publishes the app on 127.0.0.1:5310 and the web service on 127.0.0.1:5311.
2. Write its `.env` (mode 600) on the VPS: `HEARTH_DOMAIN` (the staging name), a new `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` (`openssl rand -hex 32` each, never production's), `HEARTH_APP_IMAGE=ghcr.io/facabore/hearth:development`, `HEARTH_MIGRATOR_IMAGE=ghcr.io/facabore/hearth-migrator:development`, `HEARTH_WEB_IMAGE=ghcr.io/facabore/hearth-web:development` and `APP_TIMEZONE=America/Bogota`.
3. Add the cron line: `* * * * * sh /opt/hearth-staging/scripts/staging-update.sh >> /opt/hearth-staging/update.log 2>&1`.

As the owner of the DNS name and of the host proxy:

4. Point the staging name (for example `hearth-dev.duckdns.org`) at the VPS.
5. Put the site in `/etc/caddy/sites/hearth-dev.caddy`, with the staging name and ports, then run `caddy validate --config /etc/caddy/Caddyfile` and `systemctl reload caddy`:

   ```
   hearth-dev.duckdns.org {
   	encode zstd gzip
   	@api path /api /api/*
   	handle @api {
   		reverse_proxy 127.0.0.1:5310
   	}
   	handle {
   		reverse_proxy 127.0.0.1:5311
   	}
   }
   ```

Staging's database starts empty and keeps what is entered there; to start it afresh, run `docker compose -f compose.yaml -f compose.staging.yaml down -v` in `/opt/hearth-staging` and let the next minute bring it up again.

## Backups

The `backup` service dumps the database every night at 02:00 (`APP_TIMEZONE`) into the `backups` volume and keeps `BACKUP_RETENTION_DAYS` (default 14) daily files. Schedule, logs, the restore drill and how to restore: [Backups and restore](backups.md).

## Local production smoke test

Build the images and run the full stack on `localhost` (Caddy serves it with its internal CA, hence `curl -k`):

    docker compose -f compose.yaml -f compose.local.yaml --env-file .env.local-smoke up -d --build

`.env.local-smoke` follows `.env.production.example` with `HEARTH_DOMAIN=localhost` and `HEARTH_APP_IMAGE=hearth:local`, `HEARTH_MIGRATOR_IMAGE=hearth-migrator:local`, `HEARTH_WEB_IMAGE=hearth-web:local`. Tear down with `down -v`.
