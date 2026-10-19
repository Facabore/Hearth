# M5 Nightly Backups and Restore Drill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver HU-E8-01 (issue #61, milestone M5, Must): the production stack writes a compressed `pg_dump` named `hearth-YYYY-MM-DD.sql.gz` to a backup volume every night at 02:00 America/Bogota, keeps the newest `BACKUP_RETENTION_DAYS` (default 14), fails visibly (exit 1, a JSON error line with the job name `nightly-backup`), and `scripts/restore-drill.sh` restores the newest backup into a scratch database, compares its transaction count with the one recorded at backup time and removes the scratch database; an optional, provider-agnostic off-site copy (rclone, off by default) and the operator guide `docs/operations/backups.md` complete it.

**Architecture:** No application code changes. A new `backup` service in `compose.yaml` runs the pinned `postgres:18.6-alpine` image (the `db` image, so `pg_dump` matches the server) with busybox `crond` in the foreground; `scripts/cron-entrypoint.sh` writes root's crontab at start (busybox `crond` ignores crontabs root does not own) and the job runs `scripts/backup.sh` (Tasks 1–3). `backup.sh` opens a `REPEATABLE READ` transaction in `psql`, exports its snapshot, counts `transactions` in it and runs `pg_dump --snapshot` from that session, so the count written on the dump's first line (`-- hearth-backup transactions=<n>`) is exactly the dump's (ruling P108). `scripts/restore-drill.sh` runs in the same container and restores into `hearth_restore_drill` on the same server (Task 4). The optional `backup-offsite` service (compose profile `offsite`, `rclone/rclone:1.75.1`) copies the files to any rclone remote at 03:00 (Task 5). Scripts are bind-mounted read-only, like the `Caddyfile`. Every script is tested automatically in the new Vitest project `operations`, which drives disposable containers through the Docker CLI.

**Tech Stack:** POSIX `sh` (busybox ash 1.37.0 on Alpine 3.24.2 inside `postgres:18.6-alpine`; Alpine in `rclone/rclone:1.75.1`), PostgreSQL 18.6 client tools (`psql`, `pg_dump`), busybox `crond`, Docker Compose (v2.24.0 or later for `env_file.required`), rclone 1.75.1 (optional), Node.js 24.21.0, Vitest 5.0.3, pg 8.23.1. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-10-11-hearth-design.md` (section 7 "Architecture", the Deploy row: "Docker Compose on VPS: app + PostgreSQL + Caddy (automatic TLS); nightly `pg_dump` backups"; section 10 "Delivery", milestone M5 Hardening: "Backups, observability, import from Splitwise/CSV"; decision D8, every delete is logical). Story: `docs/backlog/E8-hardening-and-later.md`, HU-E8-01 (four scenarios and two technical notes), dependency HU-E0-07 (`Done`). Format template and precedent: `docs/superpowers/plans/2026-10-15-m3b-plan-lifecycle.md` and `docs/superpowers/plans/2026-10-17-m4-insight-api.md`. Rulings in force: every ruling through P106 (the M4 fix wave takes P105 and P106); this plan rules P107–P114. GitHub Project: https://github.com/users/Facabore/projects/4.

**Baseline: `development` at `1b76fc3` or later (the M4 fix wave may land first; it touches none of the files below except `docs/decisions/README.md`, whose lines this plan anchors on as they read with P1–P106).** The planning dry run verified on 2026-10-19, against Docker 29.4.2 and Compose v5.1.3: `postgres:18.6-alpine` declares `VOLUME /var/lib/postgresql`, has `ENTRYPOINT ["docker-entrypoint.sh"]` and runs as root; it ships busybox `crond`, `tzdata` (`TZ=America/Bogota date -d @0` prints `1969-12-31 19:00 -05`), `gzip`, `psql` and `pg_dump` 18.6; busybox `crond -f -d 8` runs a root-owned `/etc/crontabs/root`, its jobs inherit the container environment (`TZ` included), and a job's `> /proc/1/fd/1` reaches `docker logs`; a crontab owned by uid 1000 is silently never run (ruling P107). The draft `backup.sh` and `restore-drill.sh` of Tasks 1, 2 and 4 ran against a database migrated with every `drizzle/` migration: the dump restores (PostgreSQL 18.6 dumps open with `\restrict` and end with `-- PostgreSQL database dump complete` followed by `\unrestrict`), the count header matched, pruning kept 14 of 21 files, an unreachable host and a role that may read only `transactions` both ended in `DumpFailed` with no file written, and every drill path dropped the scratch database. `rclone/rclone` tags carry no `v`: `1.75.2` (pushed 2026-10-09) and `1.75.1` (2026-09-04) exist; its image is Alpine with `tzdata` and `ENTRYPOINT ["rclone"]`. The table is `public.transactions` (`drizzle/0005_ledger.sql`). No migration and no `src/` change.

**Out of scope (later plans):** HU-E8-02 (structured logging and the health check; an alert when no backup was written is follow-up 2), point-in-time recovery (WAL archiving), encrypting the dumps at rest on the VPS, backing up the `caddy-data` volume (certificates are re-issued), a restore UI, and the manual drill on the VPS itself, which the owner performs and records (follow-up 1; the story requires it before M5 is declared done).

## Global Constraints

- Images are pinned to exact tags, like every dependency: `postgres:18.6-alpine` (`db`, `backup`, the tests), `caddy:2.11.7-alpine` and `node:24.21.0-alpine` unchanged, and the one new image `rclone/rclone:1.75.1` (optional; 1.75.2 is under two weeks old on 2026-10-19, follow-up 6). No npm dependency is added; `pnpm check:pinned` keeps passing. `docs/stack-versions.md` lists every image.
- **PostgreSQL is never published.** In `compose.yaml` only `caddy` publishes ports; `backup` and `backup-offsite` publish none, and `backup-offsite` is not even on the network `db` is on. Tests publish a disposable database on `127.0.0.1` only, as `tests/support/postgres-global-setup.ts` does.
- **Every delete is logical (D8), so a backup holds everything:** `pg_dump` of the whole database, soft-deleted rows included; the recorded count is `count(*)` of `transactions`, deleted rows included. No script deletes a row. The only physical deletions are of backup files by the retention, and only after a successful dump (ruling P109); the drill never writes to the `hearth` database (ruling P111).
- Scripts are POSIX `sh` for busybox ash: no bash-isms except `set -o pipefail` (POSIX.1-2024, supported by busybox). They are always invoked as `sh <file>`, so the executable bit (lost on Windows checkouts) never matters; `.gitattributes` (`* text=auto eol=lf`) keeps LF endings on Windows.
- **Docker hygiene in tests:** every container a test starts is `--rm`, has `--tmpfs /var/lib/postgresql` (so the image's declared volume creates no anonymous volume) and carries the label `hearth.test.stack=<uuid>`; the stack's network and volumes carry the same label and are removed in its `stop()`; `tests/operations/backup-stack.test.ts` pins that nothing with the label survives `stop()`. Every Docker CLI call times out after 110 s, so a script that blocks fails its test instead of hanging the suite. The harness refuses a script missing on the host before mounting it (`Missing script …`), because Docker Desktop turns a missing bind source into an empty directory. If a crashed test worker leaves a labelled stack behind, the README's one-line cleanup removes it.
- **Log format** (ruling P110): one JSON object per line on stdout, `{"level","event","time","job",…}` like `jsonLogger` (`src/shared/http/logger.ts`), with `job` `nightly-backup`, `restore-drill` or `offsite-copy`, stable PascalCase `reason` codes on errors, and only file names, counts and codes as values (no escaping needed). The password is never logged; the tools' own stderr lines are kept for diagnosis.
- Secrets: `PGPASSWORD` comes from `POSTGRES_PASSWORD` in `.env`; the off-site credentials live only in `.env.offsite`, which `.gitignore` (`.env.*`) already excludes. The `backups` volume is as sensitive as `db-data`.
- **Agents never read or edit `.env.production.example`** (ruling P114): the owner's deny rule on `.env.*` blocks it, on purpose. Every new variable read from `.env` gets its default in `compose.yaml` and is documented in `docs/operations/backups.md`; the lines for the example file are in the Self-Review's "Owner action", copied into the pull request description for the owner to paste.
- No schema change: no migration, no `*.schema.ts` and no `src/` edit; `pnpm db:check` keeps reporting no drift.
- Strict TDD: every behaviour starts with a failing test that is run and seen failing; the scripts' tests run them in the real images against a migrated PostgreSQL 18.6.
- Code, comments, docs and generated artifacts in English. Conventional commits referencing the story (`Refs #61`); no AI attribution or `Co-Authored-By` lines.
- Gates for every task: `pnpm exec vitest run --project unit`, `pnpm exec vitest run --project integration`, `pnpm exec vitest run --project acceptance`, `pnpm exec vitest run --project operations`, `pnpm format`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec prettier --check .`, `pnpm lint:boundaries`, `pnpm db:check`, `pnpm check:pinned`.

## Review Focus

1. **A crontab busybox will not run, or a clock in UTC.** busybox `crond` silently ignores a crontab that root does not own (a bind-mounted file on a Linux VPS is owned by the deploy user), and without `TZ` the job would fire at 02:00 UTC and name the file with the UTC date. Expected: the crontab is written at start, owned by uid 0, and the container's clock reads `-05` — pinned in Task 3 (the cron test reads `/etc/crontabs/root`, its owner and `date +%Z` in the container started with the shipped entrypoint and command) and Task 1 (the file is named with the Bogota date).
2. **A failed or unfinished dump next to good backups** (database unreachable, a dump `pg_dump` aborts halfway, a crash mid-write). Expected: exit 1, `backup_failed`, no `.partial` left, the day's previous file and every older one untouched and nothing pruned — pinned in Task 1 (unreachable host, a role that may read only `transactions`) and Task 2 (20 files survive a failed run).
3. **Writes during and after the backup, and soft-deleted rows.** Expected: the recorded count is the dump snapshot's, deleted rows included, and the drill compares with it even after production has grown — pinned in Task 1 (3 live + 1 deleted → 4) and Task 4 (a transaction recorded after the backup: production 5, drill passes with 4).
4. **The scratch database on every path, and production untouched.** Expected: `hearth_restore_drill` is gone after a pass, a count mismatch and a restore that fails, a leftover from an earlier drill is dropped first, and `hearth` keeps its rows — pinned in Task 4.
5. **Retention values and foreign files** (`0`, `014`, `-3`, `two weeks`; fewer files than the retention; `notes.txt` and a stale `.partial` in the volume). Expected: invalid values refuse before dumping, nothing is pruned below the retention, and only `hearth-YYYY-MM-DD.sql.gz` files are ever deleted — pinned in Task 2.

## Execution Workflow

- Work on the long-lived branch `development` (`1b76fc3` or later); every task is implemented there with Strict TDD. Implementers stage; the controller commits.
- **This plan is committed before Task 1.** The controller commits this file on `development` first (`docs(plans): add the M5 nightly backups plan (Refs #61)`), because Task 5 adds it to the `mkdocs.yml` nav and links it from `docs/decisions/README.md`, and `mkdocs build --strict` (CI's docs job) fails on a page missing from the repository. Task 5 checks it is tracked before those edits.
- **RDD before every commit** (receipt-driven development is on; check with `gentle-ai review mode status`). Each "Commit" step means:
  1. Run every source-mutating normalizer first (`pnpm format`), then stage exactly the files of the task.
  2. Run `gentle-ai review status --cwd . --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition` and follow only the returned `next_transition` (`execute` its operation, satisfy `collect` inputs, or stop on `stop` and report its reason code with its documented continuation). Medium/high-risk candidates may return a consent envelope; relay it to the owner and wait.
  3. Commit only after the provider-returned `review.validate` allows the `pre-commit` gate for that exact staged candidate; the commit must not change the reviewed bytes.
  4. If the owner disables RDD (`gentle-ai review mode disable --scope clone --cwd .`), commit under ordinary policy and report `disabled/unmanaged`.
- Code blocks are complete but not guaranteed to match Prettier's wrapping: run `pnpm format` before the gates (Prettier formats the TypeScript and YAML files; it does not touch `.sh` files, and `docs/` is in `.prettierignore`). Every code block the executor writes is introduced by a line naming its file in backticks; "Create" blocks are whole files; edits name a unique anchor line ("after the line …", "replace the line …", "insert before the line …").
- Five tasks, five commits, in order 1 → 5. Each task's scripts must exist before `compose.yaml` mounts them: a missing bind source makes `docker run --mount` fail on Linux, while Docker Desktop and Compose create an empty directory in its place, which `sh` runs as a silent no-op (the harness refuses a missing script with `Missing script …`, and `cron-entrypoint.sh` exits 66 on one). So Task 3 mounts `backup.sh` and `cron-entrypoint.sh`, Task 4 adds `restore-drill.sh` and Task 5 adds `offsite-copy.sh`.
- **Measured sizes (preflight, carried):** each task is one commit sized for review, target under ~400 changed lines, and a task over ~500 is split into two commits, each green on its own. Measured by the preflight dry run (`git diff --cached --numstat` after `pnpm format`, with the folded fixes): Task 1 ~403 (split point if over ~500: the harness, its leftover test, the project, CI and the README | `backup.sh` and `backup.test.ts`), Task 2 ~104, Task 3 ~221, Task 4 201, Task 5 ~229 (split point: `offsite-copy.sh`, its test, the compose service and `.env.offsite.example` | the docs, stack versions, decisions index and backlog note). The controller measures each staged candidate (`git diff --cached --numstat`) before RDD.
- When Task 1 starts, move #61 to **In Progress** on Project #4. When all tasks are done, open one pull request from `development` into `main` that closes #61. Its description lists, as PR notes: (1) the `backup` service, its schedule and retention, and the new `operations` test project (`pnpm test:ops`, Docker CLI required; `compose.dev.yaml`'s `test` service skips it); (2) the operator steps on the VPS: copy `compose.yaml`, `Caddyfile` and `scripts/`, set `BACKUP_RETENTION_DAYS` if not 14, run `docker compose up -d`, run a backup and the drill once and record it in `docs/operations/backups.md` ("Drill record") — required before M5 is declared done; (3) the rulings P107–P114 as ruled; (4) the follow-ups, with the issue for the rclone bump (follow-up 6); (5) the Self-Review's "Owner action": the exact lines to paste into `.env.production.example` (P114), as a checklist item for the owner.
- Task-to-issue map: HU-E8-01 → #61 (Tasks 1–5).

## File Structure

```
.
├── compose.yaml                         # backup service + backups volume (Task 3), restore-drill mount (Task 4), backup-offsite + offsite network (Task 5)
├── compose.dev.yaml                     # test service skips the operations project (Task 1)
├── .github/workflows/ci.yml             # the test step's name (Task 1)
├── .env.production.example              # not edited by agents (P114): the owner pastes the Self-Review's "Owner action" lines
├── .env.offsite.example                 # new: the rclone remote of the off-site copy (Task 5)
├── .gitignore                           # !.env.offsite.example (Task 5)
├── mkdocs.yml                           # nav: Backups and restore (Task 3), the M5 plan (Task 5)
├── package.json                         # test:ops (Task 1)
├── vitest.config.ts                     # operations project (Task 1)
├── README.md                            # the operations project (Task 1)
├── scripts/
│   ├── backup.sh                        # new: the nightly dump (Task 1) and retention (Task 2)
│   ├── cron-entrypoint.sh               # new: root-owned crontab + crond in the foreground (Task 3)
│   ├── restore-drill.sh                 # new: the restore drill (Task 4)
│   └── offsite-copy.sh                  # new: rclone copy to the off-site remote (Task 5)
├── tests/
│   ├── support/
│   │   ├── backup-stack.ts              # new: disposable network + PostgreSQL + backups volume, Docker CLI (Task 1; Tasks 3–5 add scripts)
│   │   └── postgres-global-setup.ts     # export waitForPostgres (Task 1)
│   └── operations/
│       ├── backup-stack.test.ts         # new: no leftovers after stop() (Task 1)
│       ├── backup.test.ts               # new: Task 1
│       ├── backup-retention.test.ts     # new: Task 2
│       ├── compose.test.ts              # new: Task 3, extended in Task 5
│       ├── restore-drill.test.ts        # new: Task 4
│       └── offsite-copy.test.ts         # new: Task 5
└── docs/
    ├── README.md                        # the ruling range, through P114 (Task 5)
    ├── operations/backups.md            # new: Task 3, extended in Tasks 4 and 5
    ├── operations/deploy.md             # Task 3
    ├── architecture/README.md           # Tasks 4 and 5
    ├── decisions/README.md              # P107–P114 (Task 5)
    ├── stack-versions.md                # Tasks 3 and 5
    └── backlog/E8-hardening-and-later.md  # HU-E8-01 note (Task 5)
```

---

### Task 1: The nightly dump, with the transaction count of its own snapshot

Scenarios "Nightly dump is produced" (the file and its name) and "Backup failure is visible". Adds the Docker-driven test harness and the `operations` Vitest project the later tasks reuse.

**Files:**
- Create: `scripts/backup.sh`, `tests/support/backup-stack.ts`, `tests/operations/backup-stack.test.ts`, `tests/operations/backup.test.ts`
- Modify: `tests/support/postgres-global-setup.ts`, `vitest.config.ts`, `package.json`, `compose.dev.yaml`, `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Consumes: `POSTGRES_IMAGE`, `parsePublishedPort` and (exported here) `waitForPostgres(url: string, timeoutMs?: number): Promise<void>` from `tests/support/postgres-global-setup.ts`; `runMigrations(url, folder)` from `scripts/migrate.mjs`; `createDatabase(url): { db: Database; pool: Pool }` from `@/shared/infrastructure/db/client`; `personalSpaceFixture(db, pool)` and `categoryFixture(db, space)` from `tests/support/fixtures.ts`.
- Produces (in `tests/support/backup-stack.ts`): `DockerResult`, `docker(...args): DockerResult`, `HEARTH_SCRIPTS: string[]`, `RunOptions`, `BackupStack` (`label`, `db`, `pool`, `run`, `start`, `volume`, `backups`, `logs`, `stop`), `startBackupStack(): Promise<BackupStack>`, `leftovers(label): string[]`, `logEvents(output): Record<string, unknown>[]`, `waitFor(check, timeoutMs?): Promise<void>`, `bogotaToday(): string`, `seedLedger(stack, { live, deleted }): Promise<void>`, `transactionCount(stack): Promise<number>`. `scripts/backup.sh` (`BACKUP_DIR`, libpq variables) writes `hearth-YYYY-MM-DD.sql.gz` with first line `-- hearth-backup transactions=<n>` and logs `backup_written` / `backup_failed`.

- [ ] **Step 1: Export `waitForPostgres`**

In `tests/support/postgres-global-setup.ts`, replace the line `const waitForPostgres = async (url: string, timeoutMs = 60_000): Promise<void> => {` with:

```ts
export const waitForPostgres = async (url: string, timeoutMs = 60_000): Promise<void> => {
```

- [ ] **Step 2: Add the `operations` project, its script and where it runs**

In `vitest.config.ts`, replace the closing lines of the acceptance project

```ts
          fileParallelism: false,
          ...dbProject,
        },
      },
```

with:

```ts
          fileParallelism: false,
          ...dbProject,
        },
      },
      {
        // Runs the backup scripts in disposable containers through the Docker CLI (tests/support/backup-stack.ts).
        test: {
          name: "operations",
          include: ["tests/operations/**/*.test.ts"],
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
```

In `package.json`, replace the line `    "test:acceptance": "vitest run --project acceptance"` with:

```json
    "test:acceptance": "vitest run --project acceptance",
    "test:ops": "vitest run --project operations"
```

In `compose.dev.yaml`, replace the line `    command: sh -c "corepack enable && pnpm test"` with:

```yaml
    # The operations project drives the Docker CLI, which this container does not have: run `pnpm test:ops` on the host.
    command: sh -c "corepack enable && pnpm exec vitest run --project unit --project integration --project acceptance"
```

In `.github/workflows/ci.yml`, replace the line `      - name: Unit, integration and acceptance tests (PostgreSQL started through the Docker CLI)` with (the step's `run: pnpm test` now runs the operations project too):

```yaml
      - name: Unit, integration, acceptance and operations tests (disposable containers through the Docker CLI)
```

In `README.md`, replace the line starting with `` `pnpm test` runs every project; `` with:

```markdown
`pnpm test` runs every project; the integration and acceptance projects start a disposable `postgres:18.6-alpine` container through the Docker CLI, or use `TEST_DATABASE_URL` when set, and the operations project (`pnpm test:ops`) runs the backup scripts in disposable containers, so it always needs Docker. `pnpm db:check` fails when the Drizzle schema has changes without a migration (`pnpm db:generate --name <change>`).

If a test worker crashes (on Windows Vitest sometimes reports `Worker exited unexpectedly with exit code 3221226505`), the operations project's `afterAll` never runs and its containers, volumes and network stay behind, all labelled `hearth.test.stack`. Remove them with:

    docker rm -f $(docker ps -aq --filter label=hearth.test.stack); docker volume rm $(docker volume ls -q --filter label=hearth.test.stack); docker network rm $(docker network ls -q --filter label=hearth.test.stack)
```

and replace the line `    docker compose -f compose.dev.yaml --profile test run --rm test        # full test suite against a throwaway test-db` with:

```
    docker compose -f compose.dev.yaml --profile test run --rm test        # unit, integration and acceptance tests against a throwaway test-db
```

- [ ] **Step 3: Write the harness**

`tests/support/backup-stack.ts`:

```ts
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Pool } from "pg";
import { createDatabase, type Database } from "@/shared/infrastructure/db/client";
import { runMigrations } from "../../scripts/migrate.mjs";
import { categoryFixture, personalSpaceFixture } from "./fixtures";
import { parsePublishedPort, POSTGRES_IMAGE, waitForPostgres } from "./postgres-global-setup";

export interface DockerResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the Docker CLI; a failing command is a result to assert on, not an exception. A call still running after
 * 110 s is killed and throws (`spawnSync docker ETIMEDOUT`): Vitest's test timeout cannot interrupt a synchronous call.
 */
export const docker = (...args: string[]): DockerResult => {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 110_000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const dockerOk = (...args: string[]): string => {
  const result = docker(...args);
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} exited ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
};

/** The scripts compose.yaml mounts into the backup containers, mounted at the same paths: /hearth/<name>. */
export const HEARTH_SCRIPTS: string[] = ["backup.sh"];

export interface RunOptions {
  /** Defaults to POSTGRES_IMAGE, the image of the backup service. */
  readonly image?: string;
  /** Added to, and overriding, DEFAULT_ENV. */
  readonly env?: Readonly<Record<string, string>>;
  /** More volumes by mount target, besides the backups volume at /backups. */
  readonly volumes?: Readonly<Record<string, string>>;
}

export interface BackupStack {
  /** The value of the `hearth.test.stack` label on every container, volume and network of the stack. */
  readonly label: string;
  /** The migrated database, from the host, for seeding and checks. */
  readonly db: Database;
  readonly pool: Pool;
  /** Runs `sh -c <script>` in a throwaway container on the stack's network. */
  run(script: string, options?: RunOptions): DockerResult;
  /** Starts a long-running container with this entrypoint and command; returns its id. */
  start(entrypoint: readonly string[], command: readonly string[], options?: RunOptions): string;
  /** Creates a labelled volume and returns its name. */
  volume(): string;
  /** The entries of the backups volume, hidden ones included, sorted by name. */
  backups(): string[];
  /** A container's output, stdout then stderr. */
  logs(id: string): string;
  /** Removes every container, volume and network of the stack; best effort, never hiding an earlier error. */
  stop(): Promise<void>;
}

/** What the backup service gets in compose.yaml, pointed at this stack's database. */
const DEFAULT_ENV: Readonly<Record<string, string>> = {
  PGHOST: "db",
  PGUSER: "hearth",
  PGPASSWORD: "hearth",
  PGDATABASE: "hearth",
  PGCONNECT_TIMEOUT: "5",
  TZ: "America/Bogota",
  BACKUP_DIR: "/backups",
};

const LABEL = "hearth.test.stack";

/** The ids of every container, volume and network that still carries the stack's label. */
export const leftovers = (label: string): string[] =>
  [
    ["ps", "-aq"],
    ["volume", "ls", "-q"],
    ["network", "ls", "-q"],
  ].flatMap((list) => dockerOk(...list, "--filter", `label=${LABEL}=${label}`).split("\n").filter(Boolean));

/** Starts PostgreSQL on a fresh network with a fresh backups volume, migrates it and returns the stack. */
export const startBackupStack = async (): Promise<BackupStack> => {
  const label = randomUUID();
  const network = `hearth-test-${label}`;
  const backupsVolume = `hearth-test-backups-${label}`;
  const tag = ["--label", `${LABEL}=${label}`];
  const containerArgs = (options: RunOptions): string[] => [
    ...tag,
    "--network",
    network,
    // The postgres image declares a volume there: a tmpfs leaves no anonymous volume behind.
    "--tmpfs",
    "/var/lib/postgresql",
    ...Object.entries({ ...DEFAULT_ENV, ...options.env }).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    "--mount",
    `type=volume,source=${backupsVolume},target=/backups`,
    ...Object.entries(options.volumes ?? {}).flatMap(([target, source]) => [
      "--mount",
      `type=volume,source=${source},target=${target}`,
    ]),
    ...HEARTH_SCRIPTS.flatMap((name) => {
      const source = resolve("scripts", name);
      // Docker Desktop creates a missing bind source as an empty directory, which `sh` then runs as a no-op.
      if (!statSync(source, { throwIfNoEntry: false })?.isFile()) throw new Error(`Missing script ${source}`);
      return ["--mount", `type=bind,source=${source},target=/hearth/${name},readonly`];
    }),
  ];
  const stop = async (pool?: Pool) => {
    await pool?.end().catch(() => undefined);
    for (const [list, remove] of [
      [["ps", "-aq"], ["rm", "-f", "--volumes"]],
      [["volume", "ls", "-q"], ["volume", "rm", "-f"]],
      [["network", "ls", "-q"], ["network", "rm"]],
    ] as const) {
      const ids = docker(...list, "--filter", `label=${LABEL}=${label}`).stdout.split("\n").filter(Boolean);
      if (ids.length > 0 && docker(...remove, ...ids).status !== 0) console.warn(`Could not remove ${ids.join(", ")}`);
    }
  };
  try {
    dockerOk("network", "create", ...tag, network);
    dockerOk("volume", "create", ...tag, backupsVolume);
    const db = dockerOk(
      "run", "-d", "--rm", ...tag, "--network", network, "--network-alias", "db",
      "--tmpfs", "/var/lib/postgresql",
      "-e", "POSTGRES_DB=hearth", "-e", "POSTGRES_USER=hearth", "-e", "POSTGRES_PASSWORD=hearth",
      "-p", `${process.env.TEST_DOCKER_PUBLISH_HOST ?? "127.0.0.1"}::5432`,
      POSTGRES_IMAGE,
    );
    const port = parsePublishedPort(dockerOk("port", db, "5432/tcp"));
    const url = `postgres://hearth:hearth@${process.env.TEST_DATABASE_HOST ?? "127.0.0.1"}:${port}/hearth`;
    await waitForPostgres(url);
    await runMigrations(url, "drizzle");
    const { db: database, pool } = createDatabase(url);
    return {
      label,
      db: database,
      pool,
      run: (script, options = {}) =>
        docker("run", "--rm", ...containerArgs(options), "--entrypoint", "sh", options.image ?? POSTGRES_IMAGE, "-c", script),
      start: (entrypoint, command, options = {}) =>
        dockerOk(
          "run", "-d", "--rm", ...containerArgs(options),
          "--entrypoint", entrypoint[0]!, options.image ?? POSTGRES_IMAGE, ...entrypoint.slice(1), ...command,
        ),
      volume: () => dockerOk("volume", "create", ...tag, `hearth-test-${randomUUID()}`),
      backups: () =>
        dockerOk("run", "--rm", ...containerArgs({}), "--entrypoint", "ls", POSTGRES_IMAGE, "-A", "/backups")
          .split("\n")
          .filter(Boolean)
          .sort(),
      logs: (id) => {
        const result = docker("logs", id);
        return result.stdout + result.stderr;
      },
      stop: () => stop(pool),
    };
  } catch (error) {
    await stop();
    throw error;
  }
};

/** The JSON log lines of a script's output, in order; other lines (libpq, pg_dump, crond) are skipped. */
export const logEvents = (output: string): Record<string, unknown>[] =>
  output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);

export const waitFor = async (check: () => boolean, timeoutMs = 15_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Condition not met after ${timeoutMs} ms`);
    await sleep(250);
  }
};

/** Today's date in America/Bogota as YYYY-MM-DD, the date a backup is named with. */
export const bogotaToday = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());

/** Ana's personal space with one category and `live + deleted` expenses; the deleted ones are soft-deleted (D8). */
export const seedLedger = async (stack: BackupStack, counts: { live: number; deleted: number }): Promise<void> => {
  const space = await personalSpaceFixture(stack.db, stack.pool);
  const category = await categoryFixture(stack.db, space);
  for (let i = 0; i < counts.live + counts.deleted; i++) {
    await stack.pool.query(
      `INSERT INTO transactions (id, space_id, type, description, date, category_id, amount, currency, created_by,
         created_at, updated_at, deleted_at)
       VALUES ($1, $2, 'EXPENSE', 'Market', '2026-10-05', $3, 100, 'COP', $4, now(), now(), $5)`,
      [randomUUID(), space.spaceId, category, space.userId, i >= counts.live ? new Date() : null],
    );
  }
};

export const transactionCount = async (stack: BackupStack): Promise<number> =>
  (await stack.pool.query("SELECT count(*)::int AS n FROM transactions")).rows[0].n;
```

- [ ] **Step 4: Write the failing tests**

`tests/operations/backup-stack.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { leftovers, startBackupStack } from "../support/backup-stack";

describe("the backup test stack", () => {
  it("leaves no container, volume or network behind once stopped", async () => {
    const stack = await startBackupStack();
    try {
      stack.start(["sleep"], ["300"]);
      stack.volume();
      expect(stack.run("echo ok").stdout).toBe("ok\n");
      // The network, the backups volume, the database, the sleeping container and the extra volume.
      expect(leftovers(stack.label)).toHaveLength(5);
    } finally {
      await stack.stop();
    }
    expect(leftovers(stack.label)).toEqual([]);
  });
});
```

`tests/operations/backup.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bogotaToday, logEvents, seedLedger, startBackupStack, type BackupStack } from "../support/backup-stack";

describe("nightly backup (HU-E8-01)", () => {
  let stack: BackupStack;
  beforeAll(async () => {
    stack = await startBackupStack();
    await seedLedger(stack, { live: 3, deleted: 1 });
  });
  afterAll(() => stack.stop());

  it("writes hearth-<Bogota date>.sql.gz recording the 4 transactions of its own snapshot, the deleted one included", () => {
    const days = [bogotaToday()];
    const result = stack.run("sh /hearth/backup.sh");
    days.push(bogotaToday());
    expect(result.status).toBe(0);
    const events = logEvents(result.stdout);
    expect(events).toEqual([
      expect.objectContaining({ level: "info", event: "backup_written", job: "nightly-backup", transactions: 4 }),
    ]);
    const file = String(events[0]!.file);
    expect(days.map((day) => `hearth-${day}.sql.gz`)).toContain(file);
    expect(stack.backups()).toEqual([file]);
    const dump = stack.run(`gunzip -c /backups/${file} | sed -n '1p;/^COPY public.transactions /p'`);
    expect(dump.stdout).toMatch(/^-- hearth-backup transactions=4\nCOPY public\.transactions \(/);
  });

  it("exits 1 and logs backup_failed for nightly-backup when the database is unreachable, keeping every backup", () => {
    const before = stack.backups();
    const result = stack.run("sh /hearth/backup.sh", { env: { PGHOST: "db-down" } });
    expect(result.status).toBe(1);
    expect(logEvents(result.stdout)).toEqual([
      expect.objectContaining({ level: "error", event: "backup_failed", job: "nightly-backup", reason: "DumpFailed" }),
    ]);
    expect(stack.backups()).toEqual(before);
  });

  it("keeps no file when pg_dump cannot finish, such as for a role that may read only transactions", async () => {
    await stack.pool.query("CREATE ROLE reader LOGIN PASSWORD 'reader'");
    await stack.pool.query("GRANT SELECT ON transactions TO reader");
    const before = stack.backups();
    const result = stack.run("sh /hearth/backup.sh", { env: { PGUSER: "reader", PGPASSWORD: "reader" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("permission denied");
    expect(logEvents(result.stdout)).toEqual([expect.objectContaining({ event: "backup_failed", reason: "DumpFailed" })]);
    expect(stack.backups()).toEqual(before);
    expect(stack.run(`gunzip -c /backups/${before[0]} | head -n 1`).stdout).toBe("-- hearth-backup transactions=4\n");
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project operations`
Expected: `backup-stack.test.ts` FAILS at `stack.start` with `Error: Missing script …/scripts/backup.sh`, and its `finally` still removes the stack; every `backup.test.ts` test FAILS the same way at `stack.run`, and its `afterAll` removes the stack. No `scripts/backup.sh` directory appears on the host. (If `docker` is not on the PATH, every test fails in `startBackupStack` with `spawnSync docker ENOENT`.)

- [ ] **Step 6: Write `scripts/backup.sh`**

`scripts/backup.sh`:

```sh
#!/bin/sh
# Nightly backup (HU-E8-01). Writes one gzip-compressed plain-SQL pg_dump of the database to
# $BACKUP_DIR/hearth-YYYY-MM-DD.sql.gz (the date in the container's TZ). Its first line records how many rows
# `transactions` holds in the dump's own snapshot, deleted ones included; the restore drill checks it.
# Connects with the libpq variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE). Exits 1 on any failure.
set -eu

JOB=nightly-backup
dir=${BACKUP_DIR:-/backups}
export PGOPTIONS='-c client_min_messages=warning'

# One JSON object per line on stdout, like the app's logger; $3 holds extra members, already JSON.
log() {
  printf '{"level":"%s","event":"%s","time":"%s","job":"%s"%s}\n' \
    "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$JOB" "${3:+,$3}"
}
fail() {
  log error backup_failed "\"reason\":\"$1\""
  exit 1
}

name="hearth-$(date +%F).sql.gz"
partial="$dir/.$name.partial"
trap 'rm -f "$partial"' EXIT
export HEARTH_BACKUP_PARTIAL="$partial"

# pg_dump runs from inside this transaction and reads the snapshot it exports, so the count is the dump's own.
psql -X -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL' || fail DumpFailed
BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SELECT pg_export_snapshot() AS snapshot, count(*) AS transactions FROM transactions \gset
\setenv HEARTH_SNAPSHOT :snapshot
\setenv HEARTH_TRANSACTIONS :transactions
\! { printf -- '-- hearth-backup transactions=%s\n' "$HEARTH_TRANSACTIONS" && pg_dump --snapshot="$HEARTH_SNAPSHOT" --no-owner --no-privileges; } | gzip > "$HEARTH_BACKUP_PARTIAL"
COMMIT;
SQL

# pg_dump's exit status does not reach psql: keep the file only if it is whole.
gzip -t "$partial" 2>/dev/null || fail DumpFailed
gunzip -c "$partial" | tail -n 10 | grep -qx -- '-- PostgreSQL database dump complete' || fail DumpFailed
transactions=$(gunzip -c "$partial" | head -n 1 | sed 's/^-- hearth-backup transactions=//')
mv -f "$partial" "$dir/$name"
log info backup_written "\"file\":\"$name\",\"transactions\":$transactions"
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project operations`
Expected: PASS (4 tests). Then `docker ps -a --filter label=hearth.test.stack` lists nothing.

- [ ] **Step 8: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm exec vitest run --project operations && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check && pnpm check:pinned`
Expected: all exit 0.

- [ ] **Step 9: Commit**

```bash
git add scripts/backup.sh tests/support/backup-stack.ts tests/support/postgres-global-setup.ts tests/operations/backup-stack.test.ts tests/operations/backup.test.ts vitest.config.ts package.json compose.dev.yaml .github/workflows/ci.yml README.md
git commit -m "feat(backups): write a nightly pg_dump with its snapshot's transaction count (Refs #61)"
```

---

### Task 2: Retention — keep the newest `BACKUP_RETENTION_DAYS` backups

Scenario "Old backups are pruned".

**Files:**
- Modify: `scripts/backup.sh`
- Create: `tests/operations/backup-retention.test.ts`

**Interfaces:**
- Consumes: `startBackupStack`, `logEvents`, `BackupStack` (Task 1).
- Produces: `BACKUP_RETENTION_DAYS` (default `14`; a positive whole number without a leading zero) and the events `backup_pruned` (`file`) and `backup_failed` with `reason` `InvalidRetention` or `PruneFailed`.

- [ ] **Step 1: Write the failing tests**

`tests/operations/backup-retention.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { logEvents, startBackupStack, type BackupStack } from "../support/backup-stack";

/** Twenty daily backups, oldest first, far older than any real run's date. */
const JANUARY = Array.from({ length: 20 }, (_, i) => `hearth-2020-01-${String(i + 1).padStart(2, "0")}.sql.gz`);

describe("backup retention (HU-E8-01)", () => {
  let stack: BackupStack;
  const seed = (names: string[]) =>
    expect(stack.run(names.map((name) => `echo old | gzip > /backups/${name}`).join(" && ")).status).toBe(0);
  const backup = (env: Record<string, string> = {}) => {
    const result = stack.run("sh /hearth/backup.sh", { env });
    return { ...result, events: logEvents(result.stdout) };
  };
  const writtenFile = (events: Record<string, unknown>[]) =>
    String(events.find((e) => e.event === "backup_written")!.file);

  beforeAll(async () => {
    stack = await startBackupStack();
  });
  beforeEach(() => {
    stack.run("rm -rf /backups/* /backups/.[!.]*");
  });
  afterAll(() => stack.stop());

  it("keeps only the 14 most recent backups when 20 days exist and the retention is 14 days, the default", () => {
    seed(JANUARY);
    const result = backup();
    expect(result.status).toBe(0);
    const file = writtenFile(result.events);
    expect(stack.backups()).toEqual([...JANUARY.slice(7), file]);
    expect(result.events.filter((e) => e.event === "backup_pruned").map((e) => e.file)).toEqual(
      JANUARY.slice(0, 7).reverse(),
    );
  });

  it("follows BACKUP_RETENTION_DAYS and never touches files that are not backups", () => {
    seed([...JANUARY.slice(0, 5), "notes.txt", ".hearth-2020-01-06.sql.gz.partial"]);
    const result = backup({ BACKUP_RETENTION_DAYS: "3" });
    expect(result.status).toBe(0);
    expect(stack.backups()).toEqual([
      ".hearth-2020-01-06.sql.gz.partial",
      "hearth-2020-01-04.sql.gz",
      "hearth-2020-01-05.sql.gz",
      writtenFile(result.events),
      "notes.txt",
    ]);
  });

  it("prunes nothing while fewer backups than the retention exist", () => {
    seed(JANUARY.slice(0, 2));
    const result = backup();
    expect(stack.backups()).toEqual([...JANUARY.slice(0, 2), writtenFile(result.events)]);
    expect(result.events.map((e) => e.event)).toEqual(["backup_written"]);
  });

  it("prunes nothing when the dump fails", () => {
    seed(JANUARY);
    expect(backup({ PGHOST: "db-down" }).status).toBe(1);
    expect(stack.backups()).toEqual(JANUARY);
  });

  it("exits 1 with PruneFailed when an old backup cannot be deleted, after keeping the new one", () => {
    seed(JANUARY.slice(1, 5));
    // A directory named like a backup makes `rm -f` fail, even as root.
    expect(stack.run(`mkdir /backups/${JANUARY[0]}`).status).toBe(0);
    const result = backup({ BACKUP_RETENTION_DAYS: "3" });
    expect(result.status).toBe(1);
    expect(result.events.map((e) => e.event)).toEqual(["backup_written", "backup_pruned", "backup_pruned", "backup_failed"]);
    expect(result.events.at(-1)).toEqual(expect.objectContaining({ reason: "PruneFailed" }));
  });

  it.each(["0", "014", "-3", "two weeks"])("refuses BACKUP_RETENTION_DAYS=%j before dumping", (value) => {
    seed(JANUARY.slice(0, 1));
    const result = backup({ BACKUP_RETENTION_DAYS: value });
    expect(result.status).toBe(1);
    expect(result.events).toEqual([
      expect.objectContaining({ level: "error", event: "backup_failed", job: "nightly-backup", reason: "InvalidRetention" }),
    ]);
    expect(stack.backups()).toEqual(JANUARY.slice(0, 1));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project operations tests/operations/backup-retention.test.ts`
Expected: FAIL — the first two tests keep every seeded file, the `PruneFailed` test exits 0 with only `backup_written`, and the `InvalidRetention` cases exit 0 with `backup_written`.

- [ ] **Step 3: Add the retention to `scripts/backup.sh`**

In `scripts/backup.sh`, after the line `dir=${BACKUP_DIR:-/backups}` insert:

```sh
keep=${BACKUP_RETENTION_DAYS:-14}
```

Insert before the line `name="hearth-$(date +%F).sql.gz"`:

```sh
# A positive whole number; a leading zero is refused because sh arithmetic would read it as octal.
case $keep in '' | *[!0-9]* | 0*) fail InvalidRetention ;; esac

```

Append to the end of the file (after the `backup_written` line):

```sh

# Keep the newest $keep backups by name, one per day; pruning counts files, not age, and runs only after a good
# dump, so a run of failed nights never deletes the last good backups. Nothing else in $dir is touched.
# `set -e` is off inside a `||` list and the loop's status is its last command's, so a failed rm exits the loop's
# subshell with 1 itself.
ls "$dir" | grep -E '^hearth-[0-9]{4}-[0-9]{2}-[0-9]{2}\.sql\.gz$' | sort -r | tail -n "+$((keep + 1))" |
  while read -r old; do
    rm -f "$dir/$old" || exit 1
    log info backup_pruned "\"file\":\"$old\""
  done || fail PruneFailed
```

In the header comment of the file, replace the line `# Connects with the libpq variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE). Exits 1 on any failure.` with:

```sh
# Then keeps the newest $BACKUP_RETENTION_DAYS (default 14) of them.
# Connects with the libpq variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE). Exits 1 on any failure.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project operations`
Expected: PASS (Task 1's tests too: they hold one backup, under the retention).

- [ ] **Step 5: Gates**

Run the gate command of Task 1, Step 8.
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/backup.sh tests/operations/backup-retention.test.ts
git commit -m "feat(backups): keep the newest BACKUP_RETENTION_DAYS backups (Refs #61)"
```

---

### Task 3: The `backup` service — 02:00 America/Bogota in Docker Compose

Scenario "Nightly dump is produced" (the schedule and the backup volume on the VPS), the technical note "Backup container or cron sidecar in Docker Compose; retention configurable", and the operator guide.

**Files:**
- Create: `scripts/cron-entrypoint.sh`, `tests/operations/compose.test.ts`, `docs/operations/backups.md`
- Modify: `compose.yaml`, `tests/support/backup-stack.ts`, `docs/operations/deploy.md`, `docs/stack-versions.md`, `mkdocs.yml` (not `.env.production.example`: P114)

**Interfaces:**
- Consumes: `startBackupStack`, `BackupStack.start`, `BackupStack.logs`, `BackupStack.backups`, `docker`, `logEvents`, `waitFor`, `bogotaToday`, `HEARTH_SCRIPTS` (Task 1); `scripts/backup.sh` (Tasks 1–2).
- Produces: `scripts/cron-entrypoint.sh '<schedule>' '<command>'` (exit 64 on other arguments, 66 when an entry of `/hearth` is not a file); the compose service `backup` and volume `backups`; in `compose.test.ts`, `ComposeService`, `compose(args, env?)`, `services(env?)` and `mounts(service)` (Task 5 extends this file).

- [ ] **Step 1: Mount the entrypoint in the harness**

In `tests/support/backup-stack.ts`, replace the line `export const HEARTH_SCRIPTS: string[] = ["backup.sh"];` with:

```ts
export const HEARTH_SCRIPTS: string[] = ["backup.sh", "cron-entrypoint.sh"];
```

- [ ] **Step 2: Write the failing tests**

`tests/operations/compose.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bogotaToday, docker, logEvents, startBackupStack, waitFor, type BackupStack } from "../support/backup-stack";

interface ComposeService {
  readonly image: string;
  readonly entrypoint?: string[];
  readonly command?: string[];
  readonly environment?: Record<string, string>;
  readonly ports?: unknown[];
  readonly tmpfs?: string[];
  readonly profiles?: string[];
  readonly networks?: Record<string, unknown>;
  readonly volumes?: { type: string; source: string; target: string; read_only?: boolean | null }[];
}

/** `docker compose` on the production file, with the variables an operator copies from .env.production.example. */
const compose = (args: string[], env: Record<string, string> = {}): string => {
  const environment: NodeJS.ProcessEnv = { ...process.env, POSTGRES_PASSWORD: "test", ...env };
  if (!("COMPOSE_PROFILES" in env)) delete environment.COMPOSE_PROFILES;
  const result = spawnSync(
    "docker",
    ["compose", "-f", "compose.yaml", "--env-file", ".env.production.example", ...args],
    { encoding: "utf8", env: environment },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
};
const services = (env: Record<string, string> = {}): Record<string, ComposeService> =>
  JSON.parse(compose(["config", "--format", "json"], env)).services;
/** Each mount as [kind:source, target, read-only]; a bind's source is its path under scripts/. */
const mounts = (service: ComposeService) =>
  (service.volumes ?? []).map((v) => [
    v.type === "bind" ? `bind:${v.source.replaceAll("\\", "/").split("/scripts/")[1]}` : `${v.type}:${v.source}`,
    v.target,
    v.read_only === true,
  ]);

describe("compose.yaml backups (HU-E8-01)", () => {
  it("publishes ports from caddy only, never from PostgreSQL or the backups", () => {
    const published = Object.entries(services()).filter(([, s]) => s.ports !== undefined);
    expect(published.map(([name]) => name)).toEqual(["caddy"]);
  });

  it("runs backup from the db image at 02:00 in APP_TIMEZONE, America/Bogota by default, keeping 14 backups", () => {
    const { backup, db } = services();
    expect(backup).toMatchObject({
      image: db!.image,
      entrypoint: ["sh", "/hearth/cron-entrypoint.sh"],
      command: ["0 2 * * *", "sh /hearth/backup.sh"],
      tmpfs: ["/var/lib/postgresql"],
    });
    expect(backup!.environment).toEqual({
      TZ: "America/Bogota",
      PGHOST: "db",
      PGUSER: "hearth",
      PGPASSWORD: "test",
      PGDATABASE: "hearth",
      PGCONNECT_TIMEOUT: "10",
      BACKUP_DIR: "/backups",
      BACKUP_RETENTION_DAYS: "14",
    });
    expect(mounts(backup!)).toEqual([
      ["volume:backups", "/backups", false],
      ["bind:cron-entrypoint.sh", "/hearth/cron-entrypoint.sh", true],
      ["bind:backup.sh", "/hearth/backup.sh", true],
    ]);
    expect(services({ APP_TIMEZONE: "America/Lima", BACKUP_RETENTION_DAYS: "30" }).backup!.environment).toMatchObject({
      TZ: "America/Lima",
      BACKUP_RETENTION_DAYS: "30",
    });
  });

  describe("the scheduled job", () => {
    let stack: BackupStack;
    beforeAll(async () => {
      stack = await startBackupStack();
    });
    afterAll(() => stack.stop());

    it("is a root-owned crontab line in a container on Bogota time, whose command writes a backup and logs it", async () => {
      const backup = services().backup!;
      const id = stack.start(backup.entrypoint!, backup.command!, { env: { TZ: backup.environment!.TZ! } });
      await waitFor(() => stack.logs(id).includes("crond (busybox"));
      const exec = (...args: string[]) => docker("exec", id, ...args).stdout.trim();
      const crontab = exec("cat", "/etc/crontabs/root");
      expect(crontab).toBe("0 2 * * * sh /hearth/backup.sh > /proc/1/fd/1 2> /proc/1/fd/2");
      expect(exec("stat", "-c", "%u", "/etc/crontabs/root")).toBe("0");
      expect(exec("date", "+%Z")).toBe("-05");
      const today = bogotaToday();
      expect(docker("exec", id, "sh", "-c", crontab.slice("0 2 * * * ".length)).status).toBe(0);
      await waitFor(() => stack.logs(id).includes("backup_written"));
      expect(logEvents(stack.logs(id))).toEqual([expect.objectContaining({ event: "backup_written", job: "nightly-backup" })]);
      expect(stack.backups()).toEqual([`hearth-${today}.sql.gz`]);
    });

    it("refuses to start when a mounted script is a directory, as Docker makes of a missing bind source", () => {
      // Without the guard crond -f would run forever: `timeout 10` keeps the synchronous call short.
      const result = stack.run("timeout 10 sh /hearth/cron-entrypoint.sh '0 2 * * *' 'sh /hearth/backup.sh'", {
        volumes: { "/hearth/missing.sh": stack.volume() },
      });
      expect(result.status).toBe(66);
      expect(result.stderr).toContain("/hearth/missing.sh is not a file");
    });

    it("refuses to start without exactly a schedule and a command", () => {
      const result = stack.run("sh /hearth/cron-entrypoint.sh '0 2 * * *'");
      expect(result.status).toBe(64);
      expect(result.stderr).toContain("usage: cron-entrypoint.sh");
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project operations tests/operations/compose.test.ts`
Expected: FAIL — `services().backup` is undefined (no `backup` service), and the scheduled-job tests fail at `stack.start` / `stack.run` with `Error: Missing script …/scripts/cron-entrypoint.sh`. "publishes ports from caddy only" already passes: it pins the rule the new service must keep.

- [ ] **Step 4: Write `scripts/cron-entrypoint.sh`**

`scripts/cron-entrypoint.sh`:

```sh
#!/bin/sh
# Runs one command on a cron schedule in the container's TZ (HU-E8-01): busybox crond in the foreground.
# Usage: cron-entrypoint.sh '<schedule>' '<command>'. The crontab is written here, owned by root, because
# busybox crond silently ignores a crontab file that root does not own, such as a bind-mounted one.
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: cron-entrypoint.sh '<schedule>' '<command>'" >&2
  exit 64
fi
# A bind mount whose source is missing becomes an empty directory, which `sh` would run as a silent no-op.
for script in /hearth/*; do
  [ -f "$script" ] || { echo "cron-entrypoint.sh: $script is not a file: copy scripts/ next to compose.yaml" >&2; exit 66; }
done
mkdir -p /etc/crontabs
# The job's output goes to the container's own stdout and stderr, so `docker compose logs` shows it.
printf '%s %s > /proc/1/fd/1 2> /proc/1/fd/2\n' "$1" "$2" > /etc/crontabs/root
exec crond -f -d 8
```

- [ ] **Step 5: Add the service and its volume**

In `compose.yaml`, insert before the line `  caddy:`:

```yaml
  # Nightly pg_dump at 02:00 in APP_TIMEZONE into the backups volume (HU-E8-01, docs/operations/backups.md).
  backup:
    image: postgres:18.6-alpine
    restart: unless-stopped
    entrypoint: ["sh", "/hearth/cron-entrypoint.sh"]
    command: ["0 2 * * *", "sh /hearth/backup.sh"]
    environment:
      TZ: ${APP_TIMEZONE:-America/Bogota}
      PGHOST: db
      PGUSER: hearth
      PGPASSWORD: ${POSTGRES_PASSWORD}
      PGDATABASE: hearth
      PGCONNECT_TIMEOUT: "10"
      BACKUP_DIR: /backups
      BACKUP_RETENTION_DAYS: ${BACKUP_RETENTION_DAYS:-14}
    # The image declares a volume for PostgreSQL's data; a tmpfs there leaves no anonymous volume behind.
    tmpfs: [/var/lib/postgresql]
    volumes:
      - backups:/backups
      - ./scripts/cron-entrypoint.sh:/hearth/cron-entrypoint.sh:ro
      - ./scripts/backup.sh:/hearth/backup.sh:ro
    depends_on:
      db: { condition: service_healthy }
    networks: [internal]

```

In `compose.yaml`, after the line `  db-data: {}` insert:

```yaml
  backups: {}
```

Do not open or edit `.env.production.example` (P114): `compose.yaml` defaults `BACKUP_RETENTION_DAYS` to `14`, `docs/operations/backups.md` documents it (Step 7), and its example line is in the Self-Review's "Owner action". The compose test reads the file as it is.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project operations`
Expected: PASS.

- [ ] **Step 7: Write the operator guide and point the deploy guide at it**

`docs/operations/backups.md`:

```markdown
# Backups and restore

Hearth keeps everything in one PostgreSQL database. The `backup` service of [`compose.yaml`](https://github.com/Facabore/Hearth/blob/development/compose.yaml) dumps it every night and keeps the last two weeks on the VPS (HU-E8-01). Every delete in Hearth is logical, so a dump holds the whole history, deleted rows included.

## What runs, and when

- **Schedule:** every day at 02:00 in `APP_TIMEZONE` (America/Bogota by default). busybox `crond` runs in the `backup` container, which uses the `db` image (`postgres:18.6-alpine`), so `pg_dump` always matches the server. `scripts/cron-entrypoint.sh` writes the crontab when the container starts.
- **File:** `hearth-YYYY-MM-DD.sql.gz`, for example `hearth-2026-11-12.sql.gz`, in the `backups` volume (`hearth_backups` on the VPS): a gzip-compressed plain-SQL `pg_dump --no-owner --no-privileges`. Its first line, `-- hearth-backup transactions=<n>`, is the number of rows in `transactions` in the dump's own snapshot; the restore drill checks it. The dump is written to a hidden `.partial` file and renamed only once it is complete, so a failed run never leaves a broken backup. A second run on the same day replaces that day's file.
- **Retention:** `BACKUP_RETENTION_DAYS` in `.env` (default `14`, a positive whole number) is how many daily files are kept. After each successful dump, every `hearth-YYYY-MM-DD.sql.gz` older than the newest 14 is deleted. Pruning counts files, not age, so a run of failed nights never deletes the last good backups. Nothing else in the volume is touched.

The `backup` service publishes no port, and PostgreSQL stays unpublished.

## Settings

Set these in `.env` on the VPS only to change the default; `compose.yaml` gives each one, so none is required:

| Variable | Default | What it sets |
|---|---|---|
| `BACKUP_RETENTION_DAYS` | `14` | How many daily backup files the volume keeps: a positive whole number without a leading zero. |
| `APP_TIMEZONE` | `America/Bogota` | The zone of the 02:00 schedule and of the date in each file name; the app uses it too. |

The job connects as `hearth` with the `POSTGRES_PASSWORD` the `db` service already uses.

## Logs and failures

Each run writes one JSON line per event to the container's output (`docker compose logs backup`), like the app does:

- `backup_written` (`file`, `transactions`): the night's dump is complete.
- `backup_pruned` (`file`): the retention deleted an old dump.
- `backup_failed` (`reason`): the job exited with status 1 and kept every existing backup. The `reason` is `DumpFailed` (the database was unreachable or refused the connection, or `pg_dump` did not finish; the `psql` or `pg_dump` lines just before it name the cause), `InvalidRetention` (`BACKUP_RETENTION_DAYS` is not a positive whole number; nothing was dumped) or `PruneFailed`.

Every line carries `"job":"nightly-backup"`. The password is never logged.

If `docker compose ps` shows `backup` restarting and its logs say `cron-entrypoint.sh: /hearth/<script> is not a file`, a script is missing on the VPS (Docker mounts a missing file as an empty directory): copy `scripts/` next to `compose.yaml` and run `docker compose up -d`.

## Run a backup now

After the first deployment and before every update:

    docker compose exec backup sh /hearth/backup.sh
    docker compose exec backup ls -l /backups

## Copy a backup off the VPS

    docker compose cp backup:/backups/hearth-2026-11-12.sql.gz .
```

In `docs/operations/deploy.md`:

1. Replace the line ``1. Copy `compose.yaml` and `Caddyfile` to a directory on the VPS, e.g. `/opt/hearth`.`` with:

```markdown
1. Copy `compose.yaml`, `Caddyfile` and the `scripts/` directory to a directory on the VPS, e.g. `/opt/hearth`. The backup containers mount their scripts from `scripts/`.
```

2. Replace the line ``   - `docker compose ps` — `migrate` exited 0; `db` and `app` healthy; `caddy` running.`` with:

```markdown
   - `docker compose ps` — `migrate` exited 0; `db` and `app` healthy; `caddy` and `backup` running.
   - `docker compose exec backup sh /hearth/backup.sh` → a `backup_written` line (see [Backups and restore](backups.md)).
```

3. Replace the lines

```markdown
1. Set `HEARTH_APP_IMAGE` and `HEARTH_MIGRATOR_IMAGE` in `.env` to the new SHA.
2. `docker compose pull && docker compose up -d` — `migrate` runs pending migrations before `app` starts.
```

with:

```markdown
1. Take a backup: `docker compose exec backup sh /hearth/backup.sh`.
2. Copy the release's `compose.yaml`, `Caddyfile` and `scripts/` over the old ones, and set `HEARTH_APP_IMAGE` and `HEARTH_MIGRATOR_IMAGE` in `.env` to the new SHA.
3. `docker compose pull && docker compose up -d` — `migrate` runs pending migrations before `app` starts.
```

4. Replace the lines from `## Backups` through `    docker compose exec db pg_dump -U hearth -Fc hearth > hearth-$(date +%F).dump` (five lines: the heading, a blank line, the sentence, a blank line and the command) with:

```markdown
## Backups

The `backup` service dumps the database every night at 02:00 (`APP_TIMEZONE`) into the `backups` volume and keeps `BACKUP_RETENTION_DAYS` (default 14) daily files. Schedule, logs, the restore drill and how to restore: [Backups and restore](backups.md).
```

In `docs/stack-versions.md`, replace the line ``| PostgreSQL | 18.6 (`postgres:18.6-alpine`) | Same image in dev, tests and production |`` with:

```markdown
| PostgreSQL | 18.6 (`postgres:18.6-alpine`) | Same image in dev, tests and production, and for the `backup` service, so `pg_dump` matches the server (its busybox `crond` runs the schedule) |
```

In `mkdocs.yml`, after the line `      - Deploying to a VPS: operations/deploy.md` insert:

```yaml
      - Backups and restore: operations/backups.md
```

- [ ] **Step 8: Gates**

Run the gate command of Task 1, Step 8.
Expected: all exit 0. If Python is at hand, `pip install -r docs/requirements.txt && mkdocs build` also exits 0 (CI's docs job runs it in strict mode).

- [ ] **Step 9: Commit**

```bash
git add scripts/cron-entrypoint.sh compose.yaml tests/support/backup-stack.ts tests/operations/compose.test.ts docs/operations/backups.md docs/operations/deploy.md docs/stack-versions.md mkdocs.yml
git commit -m "feat(backups): run the backup at 02:00 Bogota time as a compose service (Refs #61)"
```

---

### Task 4: The restore drill

Scenario "Restore drill succeeds", the documented manual drill on the VPS, and the architecture page.

**Files:**
- Create: `scripts/restore-drill.sh`, `tests/operations/restore-drill.test.ts`
- Modify: `compose.yaml`, `tests/support/backup-stack.ts`, `tests/operations/compose.test.ts`, `docs/operations/backups.md`, `docs/architecture/README.md`

**Interfaces:**
- Consumes: `startBackupStack`, `seedLedger`, `transactionCount`, `logEvents`, `bogotaToday` (Task 1); `scripts/backup.sh` (Tasks 1–2); `mounts`, `services` (Task 3, in `compose.test.ts`).
- Produces: `scripts/restore-drill.sh [file]` (`BACKUP_DIR`, libpq variables); events `restore_drill_passed` (`file`, `transactions`) and `restore_drill_failed` (`reason`: `NoBackup`, `MissingCount`, `ServerUnreachable`, `RestoreFailed`, `CountMismatch` with `expected` and `actual`, `ScratchNotRemoved`); the scratch database `hearth_restore_drill`.

- [ ] **Step 1: Mount the drill in the harness**

In `tests/support/backup-stack.ts`, replace the line `export const HEARTH_SCRIPTS: string[] = ["backup.sh", "cron-entrypoint.sh"];` with:

```ts
export const HEARTH_SCRIPTS: string[] = ["backup.sh", "cron-entrypoint.sh", "restore-drill.sh"];
```

- [ ] **Step 2: Write the failing tests**

`tests/operations/restore-drill.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  logEvents,
  seedLedger,
  startBackupStack,
  transactionCount,
  type BackupStack,
} from "../support/backup-stack";

describe("restore drill (HU-E8-01)", () => {
  let stack: BackupStack;
  let latest: string;
  const drill = (script = "sh /hearth/restore-drill.sh") => {
    const result = stack.run(script);
    return { ...result, events: logEvents(result.stdout) };
  };
  const scratchDatabases = async () =>
    (await stack.pool.query("SELECT datname FROM pg_database WHERE datname = 'hearth_restore_drill'")).rows;

  beforeAll(async () => {
    stack = await startBackupStack();
    await seedLedger(stack, { live: 3, deleted: 1 });
    // An older backup the drill must not pick: its header claims 999 transactions.
    stack.run("echo '-- hearth-backup transactions=999' | gzip > /backups/hearth-2020-01-01.sql.gz");
    const backup = stack.run("sh /hearth/backup.sh");
    latest = String(logEvents(backup.stdout)[0]!.file);
    // Production moves on after the backup: the drill compares with the count at backup time.
    await seedLedger(stack, { live: 1, deleted: 0 });
  });
  afterAll(() => stack.stop());

  it("restores the newest backup into a scratch database, finds its 4 transactions and removes the scratch database", async () => {
    const result = drill();
    expect(result.status).toBe(0);
    expect(result.events).toEqual([
      expect.objectContaining({ level: "info", event: "restore_drill_passed", job: "restore-drill", file: latest, transactions: 4 }),
    ]);
    expect(await scratchDatabases()).toEqual([]);
    expect(await transactionCount(stack)).toBe(5);
  });

  it("drops a scratch database an earlier drill left behind before restoring", async () => {
    await stack.pool.query("CREATE DATABASE hearth_restore_drill");
    expect(drill().status).toBe(0);
    expect(await scratchDatabases()).toEqual([]);
  });

  it("fails with CountMismatch when the restored count is not the recorded one, and still removes the scratch database", async () => {
    const result = drill(
      `gunzip -c /backups/${latest} | sed '1s/=.*/=999/' | gzip > /tmp/tampered.sql.gz && sh /hearth/restore-drill.sh /tmp/tampered.sql.gz`,
    );
    expect(result.status).toBe(1);
    expect(result.events).toEqual([
      expect.objectContaining({ level: "error", event: "restore_drill_failed", job: "restore-drill", reason: "CountMismatch", expected: 999, actual: 4 }),
    ]);
    expect(await scratchDatabases()).toEqual([]);
  });

  it("fails with RestoreFailed on a dump that does not restore, and still removes the scratch database", async () => {
    const result = drill(
      "{ echo '-- hearth-backup transactions=4'; echo 'SELECT * FROM missing_table;'; } | gzip > /tmp/broken.sql.gz && sh /hearth/restore-drill.sh /tmp/broken.sql.gz",
    );
    expect(result.status).toBe(1);
    expect(result.events).toEqual([expect.objectContaining({ event: "restore_drill_failed", reason: "RestoreFailed" })]);
    expect(await scratchDatabases()).toEqual([]);
  });

  it.each([
    ["a missing file", "sh /hearth/restore-drill.sh /backups/hearth-1999-01-01.sql.gz", "NoBackup"],
    ["an empty backup directory", "mkdir /tmp/empty && BACKUP_DIR=/tmp/empty sh /hearth/restore-drill.sh", "NoBackup"],
    ["a dump without the count line", "echo 'SELECT 1;' | gzip > /tmp/plain.sql.gz && sh /hearth/restore-drill.sh /tmp/plain.sql.gz", "MissingCount"],
  ])("fails with %s", (_, script, reason) => {
    const result = drill(script);
    expect(result.status).toBe(1);
    expect(result.events).toEqual([expect.objectContaining({ event: "restore_drill_failed", reason })]);
  });
});
```

In `tests/operations/compose.test.ts`, replace the lines

```ts
      ["bind:backup.sh", "/hearth/backup.sh", true],
    ]);
```

with:

```ts
      ["bind:backup.sh", "/hearth/backup.sh", true],
      ["bind:restore-drill.sh", "/hearth/restore-drill.sh", true],
    ]);
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project operations`
Expected: FAIL — every stack test fails at `stack.run` / `stack.start` with `Error: Missing script …/scripts/restore-drill.sh` (the harness now mounts it), and the compose test misses the `restore-drill.sh` mount.

- [ ] **Step 4: Write `scripts/restore-drill.sh`**

`scripts/restore-drill.sh`:

```sh
#!/bin/sh
# Restore drill (HU-E8-01). Restores a backup into the scratch database hearth_restore_drill on the same server,
# checks that it holds as many transactions as the backup recorded, then drops it again on every path.
# Usage: restore-drill.sh [file]; without a file, the newest hearth-YYYY-MM-DD.sql.gz in $BACKUP_DIR.
# Connects with the libpq variables, like backup.sh, and never writes to $PGDATABASE. Exits 1 on any failure.
set -eu

JOB=restore-drill
SCRATCH=hearth_restore_drill
dir=${BACKUP_DIR:-/backups}
export PGOPTIONS='-c client_min_messages=warning'

log() {
  printf '{"level":"%s","event":"%s","time":"%s","job":"%s"%s}\n' \
    "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$JOB" "${3:+,$3}"
}
fail() {
  log error restore_drill_failed "\"reason\":\"$1\"${2:+,$2}"
  exit 1
}
admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "$1" >/dev/null; }
drop_scratch() { admin "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)"; }

if [ "$#" -gt 0 ]; then
  file=$1
else
  file=$dir/$(ls "$dir" | grep -E '^hearth-[0-9]{4}-[0-9]{2}-[0-9]{2}\.sql\.gz$' | sort | tail -n 1)
fi
[ -f "$file" ] || fail NoBackup
expected=$(gunzip -c "$file" | head -n 1 | sed -n 's/^-- hearth-backup transactions=\([0-9][0-9]*\)$/\1/p')
[ -n "$expected" ] || fail MissingCount

drop_scratch || fail ServerUnreachable
trap 'drop_scratch || log error restore_drill_failed "\"reason\":\"ScratchNotRemoved\""' EXIT
admin "CREATE DATABASE $SCRATCH TEMPLATE template0" || fail RestoreFailed
set -o pipefail
gunzip -c "$file" | psql -X -q -v ON_ERROR_STOP=1 -d "$SCRATCH" >/dev/null || fail RestoreFailed
actual=$(psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$SCRATCH" -c 'SELECT count(*) FROM transactions') || fail RestoreFailed
[ "$actual" = "$expected" ] || fail CountMismatch "\"expected\":$expected,\"actual\":$actual"
trap - EXIT
drop_scratch || fail ScratchNotRemoved
log info restore_drill_passed "\"file\":\"$(basename "$file")\",\"transactions\":$actual"
```

In `compose.yaml`, after the line `      - ./scripts/backup.sh:/hearth/backup.sh:ro` insert:

```yaml
      - ./scripts/restore-drill.sh:/hearth/restore-drill.sh:ro
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project operations`
Expected: PASS.

- [ ] **Step 6: Document the drill and update the architecture page**

In `docs/operations/backups.md`, insert before the line `## Copy a backup off the VPS`:

```markdown
## Restore drill

`scripts/restore-drill.sh` proves that a backup restores. It runs in the `backup` container, against the same server:

1. It takes the newest `hearth-YYYY-MM-DD.sql.gz` in the volume, or the file given as its argument, and reads the transaction count from its first line.
2. It drops the scratch database `hearth_restore_drill` if an earlier drill left it, creates it and restores the dump into it.
3. It counts the rows of `transactions` there, deleted ones included, and compares them with the count recorded at backup time.
4. It drops `hearth_restore_drill` again, whether the drill passed or failed. It never writes to the `hearth` database.

It logs `restore_drill_passed` (`file`, `transactions`) and exits 0, or logs `restore_drill_failed` with a `reason` and exits 1: `NoBackup`, `MissingCount` (the file has no `-- hearth-backup` first line, such as a dump the backup job did not make), `ServerUnreachable`, `RestoreFailed` (the `psql` lines before it name the statement), `CountMismatch` (with `expected` and `actual`) or `ScratchNotRemoved`. Every line carries `"job":"restore-drill"`. The automated tests (`pnpm test:ops`) run the same drill against a disposable database.

### Run the drill on the VPS

Run it after the first deployment, after every real restore and at least once a quarter. M5 is not done until it has passed once on the VPS.

    cd /opt/hearth
    docker compose exec backup sh /hearth/restore-drill.sh
    docker compose exec backup sh /hearth/restore-drill.sh /backups/hearth-2026-11-12.sql.gz   # a given day

Expect one line such as `{"level":"info","event":"restore_drill_passed",…,"file":"hearth-2026-11-12.sql.gz","transactions":1234}`. Production may hold more transactions by now: the drill compares with the count at backup time. Then check that the scratch database is gone (expect `0`):

    docker compose exec db psql -U hearth -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname = 'hearth_restore_drill'"

While it runs, the drill needs free disk space about the size of the database. Record each drill below.

### Drill record

| Date | Backup file | Transactions | Result | By |
|---|---|---|---|---|

## Restoring for real

Only when the database is lost or damaged: this replaces the `hearth` database with a dump.

1. Run the drill on the file you will restore, and see it pass.
2. Keep a copy of the current database under a name the retention never prunes (skip it if the database is unreachable): `docker compose exec backup sh -c 'pg_dump --no-owner --no-privileges | gzip > /backups/before-restore-$(date +%F-%H%M).sql.gz'`.
3. Stop the app: `docker compose stop app`.
4. Recreate the database and restore the dump:

        docker compose exec backup psql -X -v ON_ERROR_STOP=1 -d postgres -c 'DROP DATABASE hearth WITH (FORCE)' -c 'CREATE DATABASE hearth TEMPLATE template0'
        docker compose exec backup sh -c 'gunzip -c /backups/hearth-2026-11-12.sql.gz | psql -X -q -v ON_ERROR_STOP=1 -d hearth'

5. Start the stack: `docker compose up -d`. `migrate` applies any migration newer than the dump before `app` starts.
6. Run the drill again, and delete `before-restore-…` once you no longer need it.

```

In `docs/architecture/README.md`:

1. Replace the line starting with `The production stack is Docker Compose on a VPS: Caddy, the `app` container, PostgreSQL and a one-shot `migrate` container.` — only that first sentence — with `The production stack is Docker Compose on a VPS: Caddy, the `app` container, PostgreSQL, a one-shot `migrate` container and the nightly `backup` container.` (the rest of the line stays).
2. After the line `        db[("PostgreSQL: never published")]` insert:

```
        backup["backup: nightly pg_dump at 02:00, keeps 14"]
```

3. Delete the line `    backups["Nightly backups (HU-E8-01, planned)"]`.
4. Replace the line `    backups -.-> db` with:

```
    backup -->|"pg_dump, restore drill"| db
```

5. Replace the line ``- **PostgreSQL** is on the internal network only. Its data lives in the `db-data` volume.`` with:

```markdown
- **PostgreSQL** is on the internal network only. Its data lives in the `db-data` volume, and its nightly dumps in the `backups` volume.
```

6. Replace the line ``- **Backups** are not built yet. Until HU-E8-01 arrives, the deploy guide asks for a manual `pg_dump` before every update.`` with:

```markdown
- **`backup`** runs `pg_dump` every night at 02:00 in `APP_TIMEZONE` into the `backups` volume and keeps the newest `BACKUP_RETENTION_DAYS` (14) files; `scripts/restore-drill.sh` restores the newest into a scratch database, checks its transaction count and drops it (HU-E8-01, [Backups and restore](../operations/backups.md)). It publishes no port.
```

- [ ] **Step 7: Gates**

Run the gate command of Task 1, Step 8.
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add scripts/restore-drill.sh compose.yaml tests/support/backup-stack.ts tests/operations/restore-drill.test.ts tests/operations/compose.test.ts docs/operations/backups.md docs/architecture/README.md
git commit -m "feat(backups): add the restore drill into a scratch database (Refs #61)"
```

---

### Task 5: The optional off-site copy, and the rulings in the index

Technical note "Off-site copy target documented in `docs/operations/backups.md`". Records P107–P114 and closes the story's docs.

**Files:**
- Create: `scripts/offsite-copy.sh`, `.env.offsite.example`, `tests/operations/offsite-copy.test.ts`
- Modify: `compose.yaml`, `.gitignore`, `tests/support/backup-stack.ts`, `tests/operations/compose.test.ts`, `docs/operations/backups.md`, `docs/architecture/README.md`, `docs/stack-versions.md`, `docs/decisions/README.md`, `docs/README.md`, `docs/backlog/E8-hardening-and-later.md`, `mkdocs.yml` (not `.env.production.example`: P114)

**Interfaces:**
- Consumes: `startBackupStack`, `BackupStack.run` (with `image`, `env`, `volumes`), `BackupStack.volume`, `BackupStack.start`, `logEvents`, `waitFor`, `docker` (Task 1); `compose`, `services`, `mounts` (Task 3).
- Produces: `RCLONE_IMAGE = "rclone/rclone:1.75.1"` (exported from `tests/support/backup-stack.ts`); `scripts/offsite-copy.sh` (`BACKUP_DIR`, `BACKUP_OFFSITE_REMOTE`, `RCLONE_CONFIG_OFFSITE_*`); events `offsite_copy_finished` (`remote`) and `offsite_copy_failed` (`reason`: `MissingRemote`, `CopyFailed`); the compose service `backup-offsite` (profile `offsite`) and network `offsite`.

- [ ] **Step 1: Mount the copy script and name the image in the harness**

In `tests/support/backup-stack.ts`, replace the line `export const HEARTH_SCRIPTS: string[] = ["backup.sh", "cron-entrypoint.sh", "restore-drill.sh"];` with:

```ts
export const HEARTH_SCRIPTS: string[] = ["backup.sh", "cron-entrypoint.sh", "restore-drill.sh", "offsite-copy.sh"];

/** The image of the optional backup-offsite service. */
export const RCLONE_IMAGE = "rclone/rclone:1.75.1";
```

- [ ] **Step 2: Write the failing tests**

`tests/operations/offsite-copy.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { logEvents, RCLONE_IMAGE, startBackupStack, type BackupStack } from "../support/backup-stack";

describe("off-site copy (HU-E8-01, optional)", () => {
  let stack: BackupStack;
  let offsite: string;
  /** rclone's local backend stands in for a real provider: the remote "offsite" is a directory of another volume. */
  const LOCAL = { RCLONE_CONFIG_OFFSITE_TYPE: "local", BACKUP_OFFSITE_REMOTE: "offsite:/offsite/hearth" };
  const copy = (env: Record<string, string>) => {
    const result = stack.run("sh /hearth/offsite-copy.sh", { image: RCLONE_IMAGE, env, volumes: { "/offsite": offsite } });
    return { ...result, events: logEvents(result.stdout) };
  };
  const remoteFiles = () =>
    stack.run("ls -A /offsite/hearth", { volumes: { "/offsite": offsite } }).stdout.split("\n").filter(Boolean);

  beforeAll(async () => {
    stack = await startBackupStack();
    offsite = stack.volume();
    stack.run(
      "echo a | gzip > /backups/hearth-2026-10-18.sql.gz && echo b | gzip > /backups/hearth-2026-10-19.sql.gz && touch /backups/notes.txt /backups/.hearth-2026-10-20.sql.gz.partial",
    );
  });
  afterAll(() => stack.stop());

  it("copies every backup, and nothing else, to the configured remote", () => {
    const result = copy(LOCAL);
    expect(result.status).toBe(0);
    expect(result.events).toEqual([
      expect.objectContaining({ level: "info", event: "offsite_copy_finished", job: "offsite-copy", remote: "offsite" }),
    ]);
    expect(remoteFiles()).toEqual(["hearth-2026-10-18.sql.gz", "hearth-2026-10-19.sql.gz"]);
  });

  it("never deletes on the remote a backup the volume no longer holds", () => {
    stack.run("rm /backups/hearth-2026-10-18.sql.gz");
    expect(copy(LOCAL).status).toBe(0);
    expect(remoteFiles()).toEqual(["hearth-2026-10-18.sql.gz", "hearth-2026-10-19.sql.gz"]);
  });

  it.each([
    ["no remote is set", {}, "MissingRemote"],
    ["the remote is not configured", { BACKUP_OFFSITE_REMOTE: "nowhere:hearth" }, "CopyFailed"],
  ])("exits 1 when %s", (_, env, reason) => {
    const result = copy(env);
    expect(result.status).toBe(1);
    expect(result.events).toEqual([
      expect.objectContaining({ level: "error", event: "offsite_copy_failed", job: "offsite-copy", reason }),
    ]);
  });
});
```

In `tests/operations/compose.test.ts`:

1. In the import from `"../support/backup-stack"` (which `pnpm format` wrapped onto one name per line in Task 3), after the line `  logEvents,` insert:

```ts
  RCLONE_IMAGE,
```

2. Insert before the line `  describe("the scheduled job", () => {`:

```ts
  it("leaves backup-offsite out unless COMPOSE_PROFILES names offsite", () => {
    const names = (env: Record<string, string> = {}) => compose(["config", "--services"], env).trim().split("\n").sort();
    expect(names()).toEqual(["app", "backup", "caddy", "db", "migrate"]);
    expect(names({ COMPOSE_PROFILES: "offsite" })).toContain("backup-offsite");
  });

  it("runs backup-offsite at 03:00 from rclone, reading the backups read-only, on a network without the database", () => {
    const offsite = services({ COMPOSE_PROFILES: "offsite" })["backup-offsite"]!;
    expect(offsite).toMatchObject({
      image: RCLONE_IMAGE,
      profiles: ["offsite"],
      entrypoint: ["sh", "/hearth/cron-entrypoint.sh"],
      command: ["0 3 * * *", "sh /hearth/offsite-copy.sh"],
      environment: { TZ: "America/Bogota", BACKUP_DIR: "/backups" },
    });
    expect(Object.keys(offsite.networks ?? {})).toEqual(["offsite"]);
    expect(mounts(offsite)).toEqual([
      ["volume:backups", "/backups", true],
      ["bind:cron-entrypoint.sh", "/hearth/cron-entrypoint.sh", true],
      ["bind:offsite-copy.sh", "/hearth/offsite-copy.sh", true],
    ]);
  });

```

3. Insert before the line `    it("refuses to start without exactly a schedule and a command", () => {`:

```ts
    it("schedules the off-site copy the same way in the rclone image", async () => {
      const offsite = services({ COMPOSE_PROFILES: "offsite" })["backup-offsite"]!;
      const id = stack.start(offsite.entrypoint!, offsite.command!, { image: RCLONE_IMAGE, env: { TZ: "America/Bogota" } });
      await waitFor(() => stack.logs(id).includes("crond (busybox"));
      const exec = (...args: string[]) => docker("exec", id, ...args).stdout.trim();
      expect(exec("cat", "/etc/crontabs/root")).toBe("0 3 * * * sh /hearth/offsite-copy.sh > /proc/1/fd/1 2> /proc/1/fd/2");
      expect(exec("stat", "-c", "%u", "/etc/crontabs/root")).toBe("0");
      expect(exec("date", "+%Z")).toBe("-05");
    });

```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project operations`
Expected: FAIL — every stack test fails at `stack.run` / `stack.start` with `Error: Missing script …/scripts/offsite-copy.sh`, and `services(...)["backup-offsite"]` is undefined.

- [ ] **Step 4: Write `scripts/offsite-copy.sh` and the service**

`scripts/offsite-copy.sh`:

```sh
#!/bin/sh
# Off-site copy (HU-E8-01, optional). Copies every backup in $BACKUP_DIR to the rclone remote and path
# $BACKUP_OFFSITE_REMOTE (for example "offsite:my-bucket/hearth"); the remote "offsite" is configured by the
# RCLONE_CONFIG_OFFSITE_* variables. It never deletes on the remote: retention there is the provider's own rule.
# Exits 1 on any failure.
set -eu

JOB=offsite-copy
dir=${BACKUP_DIR:-/backups}

log() {
  printf '{"level":"%s","event":"%s","time":"%s","job":"%s"%s}\n' \
    "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$JOB" "${3:+,$3}"
}
fail() {
  log error offsite_copy_failed "\"reason\":\"$1\""
  exit 1
}

[ -n "${BACKUP_OFFSITE_REMOTE:-}" ] || fail MissingRemote
rclone copy "$dir" "$BACKUP_OFFSITE_REMOTE" --max-depth 1 --include 'hearth-????-??-??.sql.gz' || fail CopyFailed
# Only the remote's name: its path may name a bucket.
log info offsite_copy_finished "\"remote\":\"${BACKUP_OFFSITE_REMOTE%%:*}\""
```

In `compose.yaml`, insert before the line `  caddy:`:

```yaml
  # Optional off-site copy of the backups (HU-E8-01): runs only with COMPOSE_PROFILES=offsite in .env.
  backup-offsite:
    image: rclone/rclone:1.75.1
    profiles: [offsite]
    restart: unless-stopped
    entrypoint: ["sh", "/hearth/cron-entrypoint.sh"]
    command: ["0 3 * * *", "sh /hearth/offsite-copy.sh"]
    environment:
      TZ: ${APP_TIMEZONE:-America/Bogota}
      BACKUP_DIR: /backups
    # BACKUP_OFFSITE_REMOTE and the RCLONE_CONFIG_OFFSITE_* variables of the remote (.env.offsite.example).
    env_file:
      - path: .env.offsite
        required: false
    volumes:
      - backups:/backups:ro
      - ./scripts/cron-entrypoint.sh:/hearth/cron-entrypoint.sh:ro
      - ./scripts/offsite-copy.sh:/hearth/offsite-copy.sh:ro
    # Its own network: it reaches the internet, never the database.
    networks: [offsite]

```

In `compose.yaml`, after the line `  internal: {}` insert:

```yaml
  offsite: {}
```

`.env.offsite.example`:

```
# Copy to .env.offsite on the VPS (chmod 600) and add COMPOSE_PROFILES=offsite to .env (docs/operations/backups.md).
# The rclone remote and path the nightly backups are copied to, at 03:00 in APP_TIMEZONE.
BACKUP_OFFSITE_REMOTE=offsite:my-bucket/hearth
# The remote "offsite": any rclone backend, every option as RCLONE_CONFIG_OFFSITE_<OPTION>. Example: S3-compatible.
RCLONE_CONFIG_OFFSITE_TYPE=s3
RCLONE_CONFIG_OFFSITE_PROVIDER=Other
RCLONE_CONFIG_OFFSITE_ENDPOINT=https://s3.example.com
RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=
RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=
```

In `.gitignore`, after the line `!.env.production.example` insert:

```
!.env.offsite.example
```

Do not open or edit `.env.production.example` (P114): `COMPOSE_PROFILES` is unset by default, so the service is off; `docs/operations/backups.md` documents it (Step 6), and its commented example line is in the Self-Review's "Owner action". If the deny rule also blocks writing `.env.offsite.example`, stop and report it: its content then joins the Owner action (the preflight wrote it without hitting the rule).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project operations`
Expected: PASS. (The first run pulls `rclone/rclone:1.75.1`, about 33 MB.)

- [ ] **Step 6: Document the off-site copy, the versions and the rulings**

First check that this plan is tracked (the controller committed it before Task 1), since the `mkdocs.yml` and `docs/decisions/README.md` edits below link it: `git ls-files --error-unmatch docs/superpowers/plans/2026-10-19-m5-nightly-backups.md` exits 0. If it does not, stop and ask the controller to commit it.

In `docs/operations/backups.md`, after the line starting with ``| `APP_TIMEZONE` |`` insert:

```markdown
| `COMPOSE_PROFILES` | unset | `offsite` turns on the optional off-site copy (see "Off-site copy" below); its remote is set in `.env.offsite`, not in `.env`. |
```

In `docs/operations/backups.md`, append to the end of the file:

```markdown

## Off-site copy (optional)

The `backups` volume is on the VPS's own disk, next to the database: losing the disk loses both. The optional `backup-offsite` service copies the backups to any storage [rclone](https://rclone.org/) supports (an S3-compatible bucket, Backblaze B2, SFTP, …). It is off by default.

- **When:** every day at 03:00 in `APP_TIMEZONE`, an hour after the backup. It runs `rclone copy` of every `hearth-YYYY-MM-DD.sql.gz` to `BACKUP_OFFSITE_REMOTE`; files already there are skipped.
- **Never deletes:** nothing on the remote is ever removed, so a wiped or pruned volume never empties it. Set the remote's own retention, for example a bucket lifecycle rule that deletes objects after 90 days.
- **Isolated:** it reads the `backups` volume read-only and is on its own network, with no route to the database.

To turn it on:

1. Create `/opt/hearth/.env.offsite` from `.env.offsite.example` and `chmod 600` it. `BACKUP_OFFSITE_REMOTE` names the remote and path (`offsite:<bucket>/hearth`); the `RCLONE_CONFIG_OFFSITE_*` variables configure the remote `offsite` (rclone reads every backend option as `RCLONE_CONFIG_<REMOTE>_<OPTION>`). The file holds credentials and is never committed.
2. Prefer an encrypted remote, since the dumps hold the household's financial history: configure the storage as a remote named, say, `raw`, and make `offsite` an rclone `crypt` remote over it:

        RCLONE_CONFIG_RAW_TYPE=s3
        RCLONE_CONFIG_RAW_PROVIDER=Other
        RCLONE_CONFIG_RAW_ENDPOINT=https://s3.example.com
        RCLONE_CONFIG_RAW_ACCESS_KEY_ID=…
        RCLONE_CONFIG_RAW_SECRET_ACCESS_KEY=…
        RCLONE_CONFIG_OFFSITE_TYPE=crypt
        RCLONE_CONFIG_OFFSITE_REMOTE=raw:my-bucket/hearth
        RCLONE_CONFIG_OFFSITE_PASSWORD=…   # the output of: docker run --rm rclone/rclone:1.75.1 obscure '<passphrase>'
        BACKUP_OFFSITE_REMOTE=offsite:

   Keep the passphrase somewhere other than the VPS: without it the copies cannot be read.
3. Add `COMPOSE_PROFILES=offsite` to `.env` and run `docker compose up -d`.
4. Check it without waiting for 03:00: `docker compose exec backup-offsite sh /hearth/offsite-copy.sh` prints `offsite_copy_finished`; `docker compose exec backup-offsite sh -c 'rclone ls "$BACKUP_OFFSITE_REMOTE"'` lists the files.

Its logs (`docker compose logs backup-offsite`) carry `"job":"offsite-copy"`: `offsite_copy_finished` (`remote`, the remote's name only), or `offsite_copy_failed` with exit status 1 and the `reason` `MissingRemote` (`BACKUP_OFFSITE_REMOTE` is not set) or `CopyFailed` (rclone's lines before it name the cause).

To restore from the off-site copy, download the file with rclone wherever it is configured, put it in the volume with `docker compose cp hearth-2026-11-12.sql.gz backup:/backups/`, and follow [Restoring for real](#restoring-for-real).
```

In `docs/architecture/README.md`:

1. After the line `    end` (the close of the `vps` subgraph, the only `end` in the file), insert, outside the subgraph because the service is not on the private network:

```
    offsite["backup-offsite (optional, own network): rclone copy at 03:00"]
```

2. After the line `    ghcr["GHCR images, tagged by commit SHA"]` insert:

```
    remote["Off-site storage: any rclone remote"]
```

3. After the line `    backup -->|"pg_dump, restore drill"| db` insert:

```
    offsite -.->|"reads the backups volume"| backup
    offsite -.->|HTTPS| remote
```

4. After the line starting with ``- **`backup`** runs `pg_dump` every night`` insert:

```markdown
- **`backup-offsite`** is optional (compose profile `offsite`, off by default): it copies the backups to any rclone remote at 03:00 and never deletes there; it is on its own network, without the database.
```

In `docs/stack-versions.md`, after the line ``| Caddy | 2.11.7 (`caddy:2.11.7-alpine`) | Automatic TLS |`` insert:

```markdown
| rclone | 1.75.1 (`rclone/rclone:1.75.1`) | Pinned on 2026-10-19 (HU-E8-01), published 2026-09-04; 1.75.2 (2026-10-09, a security release) was under two weeks old: the optional `backup-offsite` service (profile `offsite`) and its test |
```

In `docs/decisions/README.md`:

1. Replace the line starting with `- **Rulings (P1–P106)**` — only `(P1–P106)` — with `(P1–P114)`.
2. Replace the line `## Rulings P1–P106` with `## Rulings P1–P114`.
3. In the line starting with `The ranges are:`, replace `and M4 P32–P39, P74–P77, P80–P83 and P95–P106.` with `M4 P32–P39, P74–P77, P80–P83 and P95–P106, and M5 P107–P114.`
4. Insert before the line `### Preflight notes and findings`:

```markdown
### M5: nightly backups (P107–P114)

Plan: [`2026-10-19-m5-nightly-backups.md`](../superpowers/plans/2026-10-19-m5-nightly-backups.md).

| ID | Ruling | Where |
|---|---|---|
| P107 | A `backup` sidecar from the `db` image runs busybox `crond` at 02:00 in `APP_TIMEZONE`; its crontab is written at start because `crond` ignores crontabs root does not own; scripts are bind-mounted read-only. | Rulings, 1 |
| P108 | One gzip plain-SQL `pg_dump --no-owner --no-privileges` per day, `hearth-YYYY-MM-DD.sql.gz`, written as `.partial`, verified, then renamed; its first line records the transaction count of the dump's own exported snapshot. | Rulings, 2 |
| P109 | `BACKUP_RETENTION_DAYS` counts files: the newest N by name are kept, only after a good dump, and nothing but backup files is deleted. | Rulings, 3 |
| P110 | Backup scripts log JSON lines like the app, with `job` and stable PascalCase `reason` codes; the tools' own stderr is kept. | Rulings, 4 |
| P111 | The drill runs in the `backup` container, restores into `hearth_restore_drill` on the same server, compares every row of `transactions` with the header and drops the scratch database on every path. | Rulings, 5 |
| P112 | The off-site copy is an optional `backup-offsite` service (profile `offsite`, `rclone/rclone:1.75.1`; 1.75.2 follows on or after 2026-10-23, once two weeks old) configured only by `.env.offsite`; it runs `rclone copy`, never `sync`, at 03:00. | Rulings, 6 |
| P113 | Script tests live in a new Vitest project `operations` that drives labelled disposable containers through the Docker CLI; `compose.dev.yaml`'s `test` service skips it. | Rulings, 7 |
| P114 | Agents cannot read or edit `.env.production.example` (the owner's deny rule on `.env.*`, kept on purpose): every new variable gets a default in `compose.yaml` and is documented in `docs/operations/backups.md`, and the example file's lines go in the pull request for the owner to paste. | Rulings, 8 |

```

In `docs/backlog/E8-hardening-and-later.md`, after the line ``- Off-site copy target documented in `docs/operations/backups.md`; restore drill performed at least once before declaring M5 done.`` insert:

```markdown
- Built in M5 (plan `2026-10-19-m5-nightly-backups.md`, rulings P107–P114): the `backup` service (`postgres:18.6-alpine`, busybox `crond`, 02:00 in `APP_TIMEZONE`) runs `scripts/backup.sh`, which writes `hearth-YYYY-MM-DD.sql.gz` with its snapshot's transaction count on the first line and then keeps the newest `BACKUP_RETENTION_DAYS` files; `scripts/restore-drill.sh` restores into `hearth_restore_drill`, compares the count and drops it; the optional `backup-offsite` service (`rclone/rclone:1.75.1`, profile `offsite`) copies the files to any rclone remote at 03:00. Logs are JSON lines with the `job` `nightly-backup`, `restore-drill` or `offsite-copy`. The drill on the VPS is recorded in `docs/operations/backups.md`.
```

In `mkdocs.yml`, after the line `      - "M4 Insight API": superpowers/plans/2026-10-17-m4-insight-api.md` insert:

```yaml
      - "M5 Nightly backups": superpowers/plans/2026-10-19-m5-nightly-backups.md
```

In `docs/README.md`:

1. In the line starting with ``- **`decisions/`** is the single``, replace `every ruling P1 to P106` with `every ruling P1 to P114`.
2. In the line starting with ``- **`operations/`** holds the guides``, replace `starting with [deploying to a VPS](operations/deploy.md).` with `[deploying to a VPS](operations/deploy.md) and [backups and restore](operations/backups.md).`

- [ ] **Step 7: Gates**

Run the gate command of Task 1, Step 8.
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add scripts/offsite-copy.sh .env.offsite.example .gitignore compose.yaml tests/support/backup-stack.ts tests/operations/offsite-copy.test.ts tests/operations/compose.test.ts docs/operations/backups.md docs/architecture/README.md docs/stack-versions.md docs/decisions/README.md docs/README.md docs/backlog/E8-hardening-and-later.md mkdocs.yml
git commit -m "feat(backups): copy the backups off-site with an optional rclone service (Refs #61)"
```

---

## Self-Review

### Story coverage

| Scenario or technical note | Automated test | Manual check on the VPS |
|---|---|---|
| Nightly dump is produced: compressed `pg_dump`, named with the date (`hearth-2026-11-12.sql.gz`), on the backup volume | Task 1 "writes hearth-<Bogota date>.sql.gz …" (name in Bogota time, gzip, `COPY public.transactions`, count header); Task 3 "is a root-owned crontab line …" (the shipped schedule `0 2 * * *`, uid 0, `-05`, the job's command writes to the volume and logs) and the compose test (`backups` volume, `TZ` from `APP_TIMEZONE`) | Deploy guide: `backup` running; `docker compose exec backup ls -l /backups` the next morning |
| …when the clock reaches 02:00 America/Bogota | Task 3 (crontab line and the container's zone); the clock itself is not waited for | `docker compose logs backup` shows `backup_written` after 02:00 |
| Old backups are pruned (20 days, retention 14 → 14 remain) | Task 2 "keeps only the 14 most recent …", plus custom retention, fewer files, a failed dump, invalid values | — |
| Backup failure is visible (exit non-zero, error log with `nightly-backup`) | Task 1 (unreachable host; unfinished `pg_dump`); Task 2 (`InvalidRetention`, `PruneFailed`); Task 3 (a mounted script that is a directory: the entrypoint exits 66 instead of a silent no-op) | `docker compose logs backup`; `docker compose ps` |
| Restore drill succeeds: restored into a scratch database, same transaction count as at backup time, scratch removed | Task 4 (pass with 4 while production holds 5, leftover scratch dropped, `CountMismatch`, `RestoreFailed`, `NoBackup`, `MissingCount`, scratch gone on every path) | `docs/operations/backups.md` "Run the drill on the VPS" and its Drill record |
| Note: backup container or cron sidecar in Compose; `BACKUP_RETENTION_DAYS`, default 14 | Task 3 compose test (service, env, mounts, no ports; the default 14 is `compose.yaml`'s, P114) | `docs/operations/backups.md` "Settings" |
| Note: off-site copy target documented in `docs/operations/backups.md` | Task 5 (copy, never deletes, two failure codes, profile, network, schedule) | `docker compose exec backup-offsite sh /hearth/offsite-copy.sh` |
| Note: restore drill performed at least once before declaring M5 done | — (an owner action) | Follow-up 1; PR note 2 |

No scenario is left without a test. The 02:00 firing itself is covered by the crontab line, the container's zone and the job's command, not by waiting for the clock.

### Review Focus pins

| Review Focus | Pinned by |
|---|---|
| 1. Crontab busybox will not run; UTC clock | Task 3 "is a root-owned crontab line …" (`stat -c %u` is `0`, `date +%Z` is `-05`); Task 5 the same in the rclone image; Task 1 file named with `bogotaToday()` |
| 2. Failed or unfinished dump next to good backups | Task 1 (unreachable; a role that cannot finish `pg_dump`: no file, today's backup intact with its header); Task 2 "prunes nothing when the dump fails" and "exits 1 with PruneFailed …" |
| 3. Writes after the backup; soft-deleted rows | Task 1 (3 live + 1 deleted → 4); Task 4 (production 5, drill passes with 4) |
| 4. Scratch database on every path; production untouched | Task 4 (pass, leftover, `CountMismatch`, `RestoreFailed`; `transactionCount` 5) |
| 5. Retention values and foreign files | Task 2 (`0`, `014`, `-3`, `two weeks`; two files under 14; `notes.txt` and a `.partial` kept) |

### Rulings

1. **Where the backup runs** (Tasks 1, 3). **Ruled by the controller (P107):** accepted a `backup` sidecar in `compose.yaml` from the pinned `postgres:18.6-alpine` image (the `db` image, so `pg_dump` 18.6 matches the server, and no image to build or publish), with busybox `crond -f -d 8` in the foreground at `0 2 * * *` in `TZ` = `APP_TIMEZONE` (default America/Bogota; the image ships `tzdata`). `scripts/cron-entrypoint.sh` writes `/etc/crontabs/root` at start because busybox `crond` silently ignores a crontab root does not own (measured: a uid 1000 crontab never ran), and a bind-mounted file on a Linux VPS is owned by the deploy user. The job's output goes to `/proc/1/fd/1` and `/proc/1/fd/2`, so `docker compose logs backup` shows it. The scripts are bind-mounted read-only from `scripts/`, like the `Caddyfile`, and invoked with `sh`. Because Docker turns a missing bind source into an empty directory, which `sh` runs as a silent no-op (preflight: Compose's short syntax does this, and Docker Desktop does it even with `create_host_path: false`), the entrypoint exits 66 when an entry of `/hearth` is not a file. The service needs `tmpfs: [/var/lib/postgresql]` so the image's declared volume leaves no anonymous volume. Alternatives rejected: host cron (outside Compose; the story asks for a container), a third CI-built image (more to publish for three small scripts), a Node timer in `app` (no `pg_dump` there, and the dump would share the app's fate).
2. **Dump format and the count at backup time** (Task 1). **Ruled by the controller (P108):** accepted one gzip-compressed plain-SQL `pg_dump --no-owner --no-privileges` per day, named `hearth-YYYY-MM-DD.sql.gz` with the date in `TZ`; a same-day rerun replaces that day's file. The dump is written as `.hearth-YYYY-MM-DD.sql.gz.partial`, kept only if `gzip -t` passes and its tail holds `-- PostgreSQL database dump complete`, then renamed, because `pg_dump`'s exit status does not reach `psql` through `\!`. "The same transaction count as production at backup time" is made exact: `psql` opens a `REPEATABLE READ, READ ONLY` transaction, exports its snapshot, counts `transactions` in it, and runs `pg_dump --snapshot` from that session, writing `-- hearth-backup transactions=<n>` as the dump's first line (a SQL comment, ignored on restore). The count is `count(*)`, deleted rows included (D8). Alternatives rejected: a separate count before the dump (a write in between makes it wrong), counting the dump's `COPY` rows at drill time (circular), a side file next to the dump (two files to keep and prune together), the custom format `-Fc` (the story names `.sql.gz`, and a plain dump restores with `psql` alone).
3. **Retention** (Task 2). **Ruled by the controller (P109):** accepted that `BACKUP_RETENTION_DAYS` (default 14; a positive whole number, a leading zero refused because `sh` arithmetic reads it as octal) is how many `hearth-YYYY-MM-DD.sql.gz` files are kept, the newest by name, one per day; pruning runs only after a successful dump and never touches another file. Reason: deleting by age would delete every good backup after a two-week outage; counting files keeps the last 14 good ones. An invalid value fails before dumping, so a typo is noticed the first night.
4. **Logs and exit codes** (Tasks 1, 2, 4, 5). **Ruled by the controller (P110):** accepted one JSON object per line on stdout, `{"level","event","time","job",…}` like `jsonLogger`, with `job` `nightly-backup`, `restore-drill` or `offsite-copy`; events `backup_written`, `backup_pruned`, `backup_failed`, `restore_drill_passed`, `restore_drill_failed`, `offsite_copy_finished`, `offsite_copy_failed`; error `reason` codes `DumpFailed`, `InvalidRetention`, `PruneFailed`, `NoBackup`, `MissingCount`, `ServerUnreachable`, `RestoreFailed`, `CountMismatch` (with `expected`, `actual`), `ScratchNotRemoved`, `MissingRemote`, `CopyFailed`; exit status 1 on every failure (64 for a wrong use of the cron entrypoint, 66 when a mounted script is not a file, which is what a missing bind source becomes). `PruneFailed` is reachable: a failed `rm` exits the pruning loop with 1 (`rm -f … || exit 1`), since `set -e` does not apply inside the `||` list. Unlike the app, the tools' own stderr lines (`psql`, `pg_dump`, `rclone`) are kept: they name the host, user or statement and never the password, and they are the operator's only diagnosis. Values are file names, counts and codes, so no JSON escaping is needed.
5. **The restore drill** (Task 4). **Ruled by the controller (P111):** accepted that `scripts/restore-drill.sh` runs inside the `backup` container (`docker compose exec backup sh /hearth/restore-drill.sh [file]`), takes the newest backup by name unless given a file, and restores into `hearth_restore_drill` on the same server: dropped first if an earlier drill left it, created from `template0`, and dropped again on every path through an `EXIT` trap. It compares `count(*)` of `transactions` with the header and never writes to `hearth`. Alternatives rejected: a separate scratch server (the container would need the Docker socket), restoring with the header count trusted without a restore (proves nothing).
6. **The off-site copy** (Task 5). **Ruled by the controller (P112):** accepted an optional `backup-offsite` service in the compose profile `offsite`, off by default and turned on with `COMPOSE_PROFILES=offsite` in `.env`, from `rclone/rclone:1.75.1` (published 2026-09-04; Alpine, `tzdata`), scheduled by the same `cron-entrypoint.sh` at `0 3 * * *`. Its remote is configured only by environment variables in `.env.offsite` (`BACKUP_OFFSITE_REMOTE` and rclone's `RCLONE_CONFIG_OFFSITE_*`, so any rclone backend works), loaded with `env_file … required: false` (Compose 2.24.0 or later) so no other secret of `.env` reaches the container. It runs `rclone copy`, never `sync`: a wiped or pruned local volume never deletes the off-site copies, and retention there is the provider's lifecycle rule. It mounts the `backups` volume read-only and sits on its own `offsite` network, without a route to `db`. The guide recommends an rclone `crypt` remote. **Amended after the preflight:** 1.75.2 (published 2026-10-09) is a security release (the b2 account token and SSE-C key leaked on redirects, Go 1.26.9 with `net/http` and `crypto/tls` CVEs, `--header` values dropped after an HTTPS downgrade), but on 2026-10-19 it is under two weeks old, so the two-week rule pins 1.75.1, which passes the same tests (preflight: Alpine 3.24.1, BusyBox 1.37.0 `crond`, `tzdata`, `ENTRYPOINT ["rclone"]`). A follow-up (6) bumps it to 1.75.2 on or after 2026-10-23; the service is off by default, so the window costs nothing in production. Alternatives rejected: a provider SDK or a fixed provider (not agnostic), a mounted `rclone.conf` (another secret file format; environment variables match the owner's direction), `rclone sync` (mirrors a loss), 1.75.2 now (under two weeks old on the pin date).
7. **How the scripts are tested** (Tasks 1–5). **Ruled by the controller (P113):** accepted a fourth Vitest project, `operations` (`tests/operations/**/*.test.ts`, `pnpm test:ops`, files in sequence, 120 s per test), whose harness `tests/support/backup-stack.ts` creates a labelled network, a migrated `postgres:18.6-alpine` database (published on `127.0.0.1` only) and a labelled backups volume, runs each script in the real image with the same mount paths as `compose.yaml`, and removes everything in `stop()`; `backup-stack.test.ts` pins that nothing labelled survives. The harness refuses a script missing on the host before mounting it (`Missing script …`), since Docker Desktop would create it as an empty directory that `sh` runs as a no-op, and every Docker CLI call times out after 110 s, since Vitest's test timeout cannot interrupt a synchronous `spawnSync`. `pnpm test` (and CI's `test` job) runs it; `compose.dev.yaml`'s `test` service, whose `node` container has no Docker CLI, runs the other three projects. `compose.test.ts` reads `docker compose config` with `.env.production.example`, so the schedule and mounts tested are the shipped ones. Alternatives rejected: Testcontainers (rejected in `docs/stack-versions.md`), bats or shellspec (a new dependency), skipping when Docker is missing (a silent pass).
8. **The production env example** (Tasks 3, 5). **Ruled by the controller (P114):** agents cannot read or edit `.env.production.example`: the owner's deny rule on `.env.*` blocks every command that names it, and the owner keeps it on purpose. So every new variable the stack reads from `.env` gets its default in `compose.yaml` (`BACKUP_RETENTION_DAYS` defaults to `14`; `COMPOSE_PROFILES` is unset, so the off-site copy is off) and is documented in `docs/operations/backups.md` ("Settings"); no task edits the example file, and no test depends on new lines in it (`compose.test.ts` reads it as it is, and the defaults give the tested values). The exact lines for the file are under "Owner action" below and are copied into the pull request description; the owner pastes them. The off-site credentials are not in it: they live in `.env.offsite`, whose template `.env.offsite.example` Task 5 creates whole (the preflight wrote it without hitting the rule). Alternatives rejected: lifting the deny rule for this plan (the owner keeps it), editing the file through another tool or path (a workaround of the rule).

### Owner action (P114)

Before the pull request merges, the owner appends these lines to `.env.production.example`. The pull request description carries them as a checklist item:

```
# Nightly backups (HU-E8-01, docs/operations/backups.md): how many daily dumps the backups volume keeps.
BACKUP_RETENTION_DAYS=14
# Optional off-site copy of the backups: uncomment after creating .env.offsite from .env.offsite.example.
# COMPOSE_PROFILES=offsite
```

They change no test result: `compose.test.ts` already gets `14` from `compose.yaml`'s default, a shell variable still overrides the file's value, and the test removes `COMPOSE_PROFILES` unless it sets it.

### Preflight fixes folded in

The preflight dry run (`.superpowers/sdd/2026-10-19-m5-nightly-backups/preflight.md`, verdict READY WITH FIXES) found two blocking and eleven non-blocking issues; every fix is now in the tasks:

- B1: the harness refuses a missing script (`Missing script …`), and the four RED steps expect that error (Tasks 1, 3, 4, 5).
- B2: Task 5 adds `RCLONE_IMAGE` after `  logEvents,` in the import Prettier wrapped in Task 3.
- N1: `rclone/rclone:1.75.1`, P112 amended, follow-up 6.
- N2: `rm -f … || exit 1`, so `PruneFailed` is logged, and its test (Task 2).
- N3: the entrypoint exits 66 on a mounted script that is not a file, and its test (Task 3).
- N4: `docker()` times out after 110 s (Task 1).
- N5: the README's cleanup line for a stack leaked by a crashed worker (Task 1).
- N6: CI's test step name (Task 1). N7: `docs/README.md`'s ruling range, through P114 (Task 5). N8: `backup-offsite` outside the private-network subgraph (Task 5). N9: the plan is committed before Task 1 (Execution Workflow; Task 5 checks it). N10: the deploy guide's five-line range and the measured sizes.

### Risks

- The drill restores on the production server: while it runs it needs free disk space about the size of the database and some CPU; at household scale this is seconds (the dry run's empty schema restored in 0.2 s). Run it outside busy hours.
- The `backups` volume shares the VPS disk with `db-data`; until the off-site copy is on, a disk loss loses both. The guide says so and recommends enabling it.
- Dumps are not encrypted at rest on the VPS (follow-up 3); the off-site guide recommends an rclone `crypt` remote.
- `crond` does not catch up a night the container was down at 02:00 (unlike the recurrence job); nothing alerts on a missing backup yet (follow-up 2).
- The VPS runs the scripts the operator copied: a stale `scripts/` runs old code. The deploy guide's update steps copy `scripts/` with every release.
- PostgreSQL 18.6 dumps begin with `\restrict`, which only a psql from the same maintenance line or later understands; restores always run with the `backup` container's psql 18.6.
- CI pulls `rclone/rclone:1.75.1` (about 33 MB) for the `operations` tests.
- Until follow-up 6, the optional `backup-offsite` service runs rclone 1.75.1 without 1.75.2's security fixes; it is off by default, and 1.75.2 is pinned once two weeks old.
- On Windows, a crashed Vitest worker (`exit code 3221226505`) skips `afterAll` and leaks a labelled stack; the README's cleanup line removes it. CI on Linux is not affected.
- Until the owner pastes the "Owner action" lines, `.env.production.example` does not mention `BACKUP_RETENTION_DAYS` or `COMPOSE_PROFILES`; `docs/operations/backups.md` documents both, and the defaults need neither.

### Follow-ups

1. The owner runs the drill on the VPS and records it in `docs/operations/backups.md` ("Drill record"); required before M5 is declared done (story note).
2. Alert when no `backup_written` was logged in 26 hours, with HU-E8-02's observability.
3. Encrypt the dumps at rest on the VPS (for example `age`) if the disk itself is a concern.
4. Point-in-time recovery (WAL archiving) if losing up to a day of entries becomes unacceptable.
5. Move HU-E8-01 to `Done` in `docs/backlog/README.md` when the pull request merges.
6. Bump rclone to 1.75.2 (the security release of 2026-10-09) on or after 2026-10-23, when it is two weeks old: `compose.yaml`, `RCLONE_IMAGE` in `tests/support/backup-stack.ts`, the `obscure` command in `docs/operations/backups.md`, `docs/stack-versions.md`, and P112's row in `docs/decisions/README.md`. Open its issue with the pull request.
7. The owner pastes the "Owner action" lines into `.env.production.example` (P114).

### Placeholder and consistency scan

- No "TBD" or step without its code; every code step names its file and anchor, every test step its command and expected outcome.
- Names across tasks: `DockerResult`, `docker`, `HEARTH_SCRIPTS` (grows in Tasks 3, 4, 5), `RunOptions`, `BackupStack` (`label`, `db`, `pool`, `run`, `start`, `volume`, `backups`, `logs`, `stop`), `startBackupStack`, `leftovers`, `logEvents`, `waitFor`, `bogotaToday`, `seedLedger`, `transactionCount` (Task 1), `RCLONE_IMAGE` (Task 5); `ComposeService`, `compose`, `services`, `mounts` (Task 3, `compose.test.ts`). Script paths in containers are `/hearth/<name>` in the harness and in `compose.yaml` alike.
- Environment variables: `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_OFFSITE_REMOTE`, `RCLONE_CONFIG_OFFSITE_*`, `APP_TIMEZONE` → `TZ`, `POSTGRES_PASSWORD` → `PGPASSWORD`, `PGHOST`, `PGUSER`, `PGDATABASE`, `PGCONNECT_TIMEOUT`, `COMPOSE_PROFILES`; the existing `TEST_DOCKER_PUBLISH_HOST` and `TEST_DATABASE_HOST` keep their meaning.
- Images: `postgres:18.6-alpine`, `rclone/rclone:1.75.1`; no other image is added.
- Files agents do not touch: `.env.production.example` (P114); its lines are under "Owner action".
- Migrations: none. `src/`: unchanged. npm dependencies: none.

## Open questions for the owner

None.
