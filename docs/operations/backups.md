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

## Copy a backup off the VPS

    docker compose cp backup:/backups/hearth-2026-11-12.sql.gz .
