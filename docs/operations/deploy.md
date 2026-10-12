# Deploying Hearth to a VPS

## Prerequisites

- A Linux VPS with Docker Engine and the Compose plugin.
- A DNS `A`/`AAAA` record for your domain pointing at the VPS.
- Inbound TCP 80 and 443 (and UDP 443 for HTTP/3) open; nothing else needs to be public. PostgreSQL is never published.
- Access to the images: either make the GHCR packages `hearth` and `hearth-migrator` public in GitHub, or run `docker login ghcr.io` on the VPS with a token that has `read:packages`.

## First deployment

1. Copy `compose.yaml` and `Caddyfile` to a directory on the VPS, e.g. `/opt/hearth`.
2. Create `/opt/hearth/.env` from `.env.production.example`; set `HEARTH_DOMAIN`, generate `POSTGRES_PASSWORD` with `openssl rand -hex 32` (it is embedded in a connection URL, so it must not contain `/`, `+` or `=`) and `BETTER_AUTH_SECRET` with `openssl rand -base64 48`, and set both image tags to the commit SHA built by CI on `main`.
3. `docker compose pull && docker compose up -d`
4. Verify:
   - `docker compose ps` — `migrate` exited 0; `db` and `app` healthy; `caddy` running.
   - `curl -s https://$HEARTH_DOMAIN/api/v1/health` → `{"status":"ok"}` with a valid certificate.
   - `curl -s https://$HEARTH_DOMAIN/api/v1/openapi.json | head -c 40` → `{"openapi":"3.1.0"…`.

If a required variable is missing, Compose refuses to start and names it; a missing or invalid `BETTER_AUTH_SECRET` makes the `app` container exit with status 1 and the message `Missing or invalid environment variables: BETTER_AUTH_SECRET`.

## Reverse proxy and client addresses

The sign-in and sign-up throttles key on the client address from `X-Forwarded-For`. Caddy replaces any client-sent value with the real peer address because no `trusted_proxies` are configured, and the `app` service publishes no port, so it is reachable only through Caddy. Keep both properties: never publish port 3000, and only add `trusted_proxies` if another proxy you control sits in front of Caddy.

## Updating

1. Set `HEARTH_APP_IMAGE` and `HEARTH_MIGRATOR_IMAGE` in `.env` to the new SHA.
2. `docker compose pull && docker compose up -d` — `migrate` runs pending migrations before `app` starts.

## Rolling back

Set both image tags back to the previous SHA and run `docker compose up -d`. Migrations are forward-only; a release whose migration is not backward compatible must say so in its PR.

## Backups

Nightly `pg_dump` and a restore drill arrive with HU-E8-01. Until then, take a manual dump before every update:

    docker compose exec db pg_dump -U hearth -Fc hearth > hearth-$(date +%F).dump

## Local production smoke test

Build the images and run the full stack on `localhost` (Caddy serves it with its internal CA, hence `curl -k`):

    docker compose -f compose.yaml -f compose.local.yaml --env-file .env.local-smoke up -d --build

`.env.local-smoke` follows `.env.production.example` with `HEARTH_DOMAIN=localhost` and `HEARTH_APP_IMAGE=hearth:local`, `HEARTH_MIGRATOR_IMAGE=hearth-migrator:local`. Tear down with `down -v`.
