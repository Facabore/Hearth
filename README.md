# Hearth

Self-hosted household finance: personal finance, group expense splitting and allocated budgets in one app.

- Documentation: [`docs/README.md`](docs/README.md) · Published site: https://facabore.github.io/Hearth/
- Design spec: `docs/specs/2026-10-11-hearth-design.md`
- Backlog: `docs/backlog/README.md` · Board: https://github.com/users/Facabore/projects/4
- Stack versions: `docs/stack-versions.md`

## Development

Everything runs in Docker (see "Containerized development" below). With a host Node.js 24 and Docker:

    corepack enable
    pnpm install --frozen-lockfile
    pnpm test

`pnpm test` runs every project; the integration and acceptance projects start a disposable `postgres:18.6-alpine` container through the Docker CLI, or use `TEST_DATABASE_URL` when set, and the operations project (`pnpm test:ops`) runs the backup scripts in disposable containers, so it always needs Docker. `pnpm db:check` fails when the Drizzle schema has changes without a migration (`pnpm db:generate --name <change>`).

If a test worker crashes (on Windows Vitest sometimes reports `Worker exited unexpectedly with exit code 3221226505`), the operations project's `afterAll` never runs and its containers, volumes and network stay behind, all labelled `hearth.test.stack`. Remove them with:

    docker rm -f $(docker ps -aq --filter label=hearth.test.stack); docker volume rm $(docker volume ls -q --filter label=hearth.test.stack); docker network rm $(docker network ls -q --filter label=hearth.test.stack)

## Containerized development

Requires only Git and Docker.

    docker compose -f compose.dev.yaml up                                  # db -> deps -> migrate -> app on http://localhost:3000
    docker compose -f compose.dev.yaml --profile test run --rm test        # unit, integration and acceptance tests against a throwaway test-db

If host port 5432 is taken, set `HEARTH_DB_PORT` (for example `HEARTH_DB_PORT=55432`) and point `DATABASE_URL` in `.env` at it.

Hot reload: the source is bind-mounted and the dev server runs with webpack and polling (`WATCHPACK_POLLING`), because file events from a Windows path do not reach the container and Turbopack misses those changes. With the repository inside WSL2 or on Linux/macOS, `pnpm dev` (Turbopack) also works.
