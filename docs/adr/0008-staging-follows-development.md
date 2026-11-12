# ADR 0008 — A staging environment that follows development

- Status: Accepted (2026-11-12)
- Story: the owner's request of 2026-11-12 (feature doc `odd/tasks/staging-environment.md`)

## Context

Every change reaches a deployed site only through `main`: a pull request, the full CI (lint, boundaries, typecheck, the test suites against PostgreSQL, the e2e suite, the performance gate on `main`, the image build and its smoke tests), then a manual deploy over SSH. That takes about an hour per release, and the owner reviews changes only once they are in production. The owner, 2026-11-12: "tengamos un entorno desplegado que sea de test, para que yo pueda ir revisando allí directamente todo sin que pase por tantas revisiones del actions, para pruebas de una, algo rápido, ya el despliegue a prod es otra cosa … tipo PR a develop desplega acá, PR a main allí".

The production VPS has room (about 100 GB of disk and 4 GiB of memory free), serves other sites behind its own host Caddy, and production runs there as the non-root `hearth-deploy` from `/opt/hearth`. The images on GHCR are public.

## Decision

`development` deploys itself to a staging site; `main` keeps everything it has.

- **Gate.** `.github/workflows/staging.yml` runs on every push to `development`: `pnpm typecheck` and the unit tests (the owner's choice, "Typecheck y unit"), then it builds the app, migrator and web images and pushes them as `:<sha>`, and only then moves `:development` to all three, back to back, so the VPS never pulls an app without its migrator. A newer push cancels an older run, and a manual run publishes only from `development`. The full CI still runs on `development`, as information.
- **Stack.** Staging lives in `/home/hearth-deploy/hearth-staging` on the same VPS (`hearth-deploy` may not create directories in `/opt`, and its home needs no root step): the same `compose.yaml` and `scripts/`, with `deploy/staging/compose.staging.yaml` as its override. That override names the project `hearth-staging` (its own database volume, network and containers), publishes the app and the web service on loopback ports 5310 and 5311, and keeps the bundled Caddy off. Its `.env` (domain, database password, auth secret) is generated on the VPS and never leaves it.
- **Updates.** `scripts/staging-update.sh`, run by `hearth-deploy`'s cron every minute, pulls the `:development` images and runs `docker compose up -d` (migrations first) only when one of them changed, the app is not running, or the last `up` failed (it is tried again every minute until one succeeds). It then removes only the images it replaced, never another project's on this shared VPS, and logs one JSON line per change or failure. Nothing pushes to the VPS, so no SSH key or other secret is stored in GitHub; a new version is live about a minute after its images are pushed.
- **Proxy.** The host Caddy serves the staging domain from `/etc/caddy/sites/hearth-dev.caddy`, which the owner adds (the file is root's).
- **Production** is unchanged: `main`, the full CI, `:main` and `:<sha>` images, and the manual deploy of `docs/operations/deploy.md`.

## Consequences

- A change is on staging about 5 minutes after it is pushed to `development`; a type error or a failing unit test keeps it off.
- Staging's database is its own, starts empty and keeps what is entered there; it is not production's data and it is not backed up off-site.
- Staging may run code that the e2e suite or the performance gate would reject. That is its purpose: the gate for production stays on `main`.
- The VPS runs a second Hearth (about 300 MB of memory more).

## Alternatives

- **Push-based deploy from GitHub Actions over SSH:** needs a private key in GitHub's secrets and a key on the VPS that a workflow can use; the pull keeps every secret on the VPS.
- **Watchtower or a container with the Docker socket:** a third-party updater with root-equivalent access to every container on a shared VPS; a 30-line script under the user that already runs production does the same.
- **Preview environments per pull request:** more than the owner asked for, and a database per preview.
- **Deploying `development` to production:** what the owner explicitly kept apart ("ya el despliegue a prod es otra cosa").
