# Backups and restore

Hearth keeps everything in one PostgreSQL database. The `backup` service of [`compose.yaml`](https://github.com/Facabore/Hearth/blob/development/compose.yaml) dumps it every night and keeps the newest 14 backups on the VPS by default (`BACKUP_RETENTION_DAYS`, counted as files, not days) (HU-E8-01). Every delete in Hearth is logical, so a dump holds the whole history, deleted rows included.

## What runs, and when

- **Schedule:** every day at 02:00 in `APP_TIMEZONE` (America/Bogota by default). busybox `crond` runs in the `backup` container, which uses the `db` image (`postgres:18.6-alpine`), so `pg_dump` always matches the server. `scripts/cron-entrypoint.sh` writes the crontab when the container starts, and removes any hidden `.partial` file a run killed by a restart left behind. The `scripts/` directory is mounted read-only at `/hearth`.
- **File:** `hearth-YYYY-MM-DD.sql.gz`, for example `hearth-2026-11-12.sql.gz`, in the `backups` volume (`hearth_backups` on the VPS): a gzip-compressed plain-SQL `pg_dump --no-owner --no-privileges`. Its first line, `-- hearth-backup transactions=<n>`, is the number of rows in `transactions` in the dump's own snapshot; the restore drill checks it. The dump is written to a hidden `.partial` file and renamed only once it is complete, so a failed run never leaves a broken backup. A second run on the same day replaces that day's file.
- **Retention:** `BACKUP_RETENTION_DAYS` in `.env` (default `14`, a whole number from 1 to 9999) is how many daily files are kept. After each successful dump, every `hearth-YYYY-MM-DD.sql.gz` older than the newest `BACKUP_RETENTION_DAYS` is deleted. Pruning counts files, not age, so a run of failed nights never deletes the last good backups. Nothing else in the volume is touched.

The `backup` service publishes no port, and PostgreSQL stays unpublished.

## Settings

Set these in `.env` on the VPS only to change the default; `compose.yaml` gives each one, so none is required:

| Variable | Default | What it sets |
|---|---|---|
| `BACKUP_RETENTION_DAYS` | `14` | How many daily backup files the volume keeps: a whole number from 1 to 9999, written without a leading zero. |
| `APP_TIMEZONE` | `America/Bogota` | The zone of the 02:00 schedule and of the date in each file name; the app uses it too. |

The job connects as `hearth` with the `POSTGRES_PASSWORD` the `db` service already uses.

## Logs and failures

Each run writes one JSON line per event to the container's output (`docker compose logs backup`), like the app does:

- `backup_written` (`file`, `transactions`): the night's dump is complete.
- `backup_pruned` (`file`): the retention deleted an old dump.
- `backup_failed` (`reason`): the job exited with status 1 and kept every existing backup. The `reason` is `DumpFailed` (the database was unreachable or refused the connection, or `pg_dump` did not finish; the `psql` or `pg_dump` lines just before it name the cause), `InvalidRetention` (`BACKUP_RETENTION_DAYS` is not a whole number from 1 to 9999; nothing was dumped) or `PruneFailed`.

Every line carries `"job":"nightly-backup"`. The password is never logged.

If `docker compose ps` shows `backup` restarting and its logs say `cron-entrypoint.sh: /hearth/backup.sh is not a file`, or `sh: can't open '/hearth/cron-entrypoint.sh'`, `scripts/` is missing or incomplete on the VPS. Older deploys that copied only `compose.yaml` and `Caddyfile` may have left empty root-owned directories under `scripts/` (Docker creates a missing bind source as a directory): remove them (`sudo rm -r scripts`), copy `scripts/` next to `compose.yaml` again and run `docker compose up -d`.

## Run a backup now

After the first deployment and before every update:

    docker compose exec backup sh /hearth/backup.sh
    docker compose exec backup ls -l /backups

## Restore drill

`scripts/restore-drill.sh` proves that a backup restores. It runs in the `backup` container, against the same server:

1. It takes the newest `hearth-YYYY-MM-DD.sql.gz` in the volume, or the file given as its argument, and reads the transaction count from its first line.
2. It drops the scratch database `hearth_restore_drill` if an earlier drill left it, creates it and restores the dump into it.
3. It counts the rows of `transactions` there, deleted ones included, and compares them with the count recorded at backup time.
4. It drops `hearth_restore_drill` again, whether the drill passed or failed. It never writes to the `hearth` database.

It logs `restore_drill_passed` (`file`, `transactions`) and exits 0, or logs `restore_drill_failed` with a `reason` and exits 1: `NoBackup`, `MissingCount` (the file has no `-- hearth-backup` first line, such as a dump the backup job did not make), `ServerUnreachable`, `RestoreFailed` (the `psql` lines before it name the statement), `CountMismatch` (with `expected` and `actual`), `Interrupted` (a signal reached the drill itself, such as Ctrl-C in `docker compose exec`; it removed the scratch database on its way out. `docker compose stop` signals only `crond`, so it kills a drill that is running without a log line and leaves `hearth_restore_drill` for the next drill to drop) or `ScratchNotRemoved`. Every line carries `"job":"restore-drill"`. The automated tests (`pnpm test:ops`) run the same drill against a disposable database.

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

Only when the database is lost or damaged: this replaces the `hearth` database with a dump. Step 3 stops the `backup` service first, so the 02:00 job can never dump a half-restored database over that day's file; that is why steps 4 and 5 use `docker compose run`, which starts a one-off container from the same service (same image, network, volumes and variables) without its cron, where `docker compose exec` needs the service running.

1. Run the [drill](#run-the-drill-on-the-vps) on the file you will restore, and see it pass.
2. Keep a copy of the current database under a name the retention never prunes (skip it if the database is unreachable). It checks the copy and prints `safety copy ok` only when `pg_dump` finished and the file is a whole gzip with the end-of-dump marker; continue only after you see it, and if it fails, stop and find out why before going on:

        docker compose exec backup sh -c 'set -o pipefail; f=/backups/before-restore-$(date +%F-%H%M).sql.gz; { pg_dump --no-owner --no-privileges | gzip > "$f" && gzip -t "$f" && gunzip -c "$f" | tail -n 10 | grep -qx -- "-- PostgreSQL database dump complete" && echo "safety copy ok: $f"; } || { rm -f "$f"; exit 1; }'

3. Stop the app and the nightly job: `docker compose stop app backup`.
4. Recreate the database and restore the dump. The restore runs in one transaction, so if it fails the database is left empty, not half restored: fix the cause and run both commands again.

        docker compose run --rm --no-deps --entrypoint sh backup -c 'psql -X -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS hearth WITH (FORCE)" -c "CREATE DATABASE hearth TEMPLATE template0"'
        docker compose run --rm --no-deps --entrypoint sh backup -c 'set -o pipefail; gunzip -c /backups/hearth-2026-11-12.sql.gz | psql -1 -X -q -v ON_ERROR_STOP=1 -d hearth'

5. Check the restored database before starting anything. The first line is the count the backup recorded, the second the count in the database; they must be equal:

        docker compose run --rm --no-deps --entrypoint sh backup -c 'gunzip -c /backups/hearth-2026-11-12.sql.gz | head -n 1; psql -X -Atc "SELECT count(*) FROM public.transactions"'

6. Start the stack: `docker compose up -d`. `migrate` applies any migration newer than the dump before `app` starts.
7. Run the drill again, and delete `before-restore-…` once you no longer need it.

## Copy a backup off the VPS

    docker compose cp backup:/backups/hearth-2026-11-12.sql.gz .
