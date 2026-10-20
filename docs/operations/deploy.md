# Deploying Hearth to a VPS

## Prerequisites

- A Linux VPS with Docker Engine and the Compose plugin, version 2.24.0 or later (`compose.yaml` loads the optional `.env.offsite` with `required: false`).
- A DNS `A`/`AAAA` record for your domain pointing at the VPS.
- Inbound TCP 80 and 443 (and UDP 443 for HTTP/3) open; nothing else needs to be public. PostgreSQL is never published.
- Access to the images: either make the GHCR packages `hearth` and `hearth-migrator` public in GitHub, or run `docker login ghcr.io` on the VPS with a token that has `read:packages`.

## First deployment

1. Copy `compose.yaml`, `Caddyfile` and the `scripts/` directory to a directory on the VPS, e.g. `/opt/hearth`. The backup containers mount their scripts from `scripts/`.
2. Create `/opt/hearth/.env` from `.env.production.example`; set `HEARTH_DOMAIN`, generate `POSTGRES_PASSWORD` with `openssl rand -hex 32` (it is embedded in a connection URL, so it must not contain `/`, `+` or `=`) and `BETTER_AUTH_SECRET` with `openssl rand -base64 48`, and set both image tags to the commit SHA built by CI on `main`.
3. `docker compose pull && docker compose up -d`
4. Verify:
   - `docker compose ps` — `migrate` exited 0; `db` and `app` healthy; `caddy` and `backup` running.
   - `docker compose exec backup sh /hearth/backup.sh` → a `backup_written` line (see [Backups and restore](backups.md)).
   - `curl -s https://$HEARTH_DOMAIN/api/v1/health` → `{"status":"ok"}` with a valid certificate.
   - `curl -s https://$HEARTH_DOMAIN/api/v1/openapi.json | head -c 40` → `{"openapi":"3.1.0"…`.

If a required variable is missing, Compose refuses to start and names it; a missing or invalid `BETTER_AUTH_SECRET` makes the `app` container exit with status 1 and the message `Missing or invalid environment variables: BETTER_AUTH_SECRET`.

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

The sign-in and sign-up throttles key on the client address from `X-Forwarded-For`. Caddy replaces any client-sent value with the real peer address because no `trusted_proxies` are configured, and the `app` service publishes no port, so it is reachable only through Caddy. Keep both properties: never publish port 3000, and only add `trusted_proxies` if another proxy you control sits in front of Caddy.

## Updating

1. Take a backup: `docker compose exec backup sh /hearth/backup.sh`.
2. Copy the release's `compose.yaml`, `Caddyfile` and `scripts/` over the old ones, and set `HEARTH_APP_IMAGE` and `HEARTH_MIGRATOR_IMAGE` in `.env` to the new SHA.
3. `docker compose pull && docker compose up -d` — `migrate` runs pending migrations before `app` starts.

## Rolling back

Set both image tags back to the previous SHA and run `docker compose up -d`. Migrations are forward-only; a release whose migration is not backward compatible must say so in its PR.

## Backups

The `backup` service dumps the database every night at 02:00 (`APP_TIMEZONE`) into the `backups` volume and keeps `BACKUP_RETENTION_DAYS` (default 14) daily files. Schedule, logs, the restore drill and how to restore: [Backups and restore](backups.md).

## Local production smoke test

Build the images and run the full stack on `localhost` (Caddy serves it with its internal CA, hence `curl -k`):

    docker compose -f compose.yaml -f compose.local.yaml --env-file .env.local-smoke up -d --build

`.env.local-smoke` follows `.env.production.example` with `HEARTH_DOMAIN=localhost` and `HEARTH_APP_IMAGE=hearth:local`, `HEARTH_MIGRATOR_IMAGE=hearth-migrator:local`. Tear down with `down -v`.
