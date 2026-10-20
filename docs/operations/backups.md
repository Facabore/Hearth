# Backups and restore

Hearth keeps everything in one PostgreSQL database. The `backup` service of [`compose.yaml`](https://github.com/Facabore/Hearth/blob/development/compose.yaml) dumps it every night and keeps the newest 14 backups on the VPS by default (`BACKUP_RETENTION_DAYS`, counted as files, not days) (HU-E8-01). Every delete in Hearth is logical, so a dump holds the whole history, deleted rows included.

## What runs, and when

- **Schedule:** every day at 02:00 in `APP_TIMEZONE` (America/Bogota by default). busybox `crond` runs in the `backup` container, which uses the `db` image (`postgres:18.6-alpine`), so `pg_dump` always matches the server. `scripts/cron-entrypoint.sh` writes the crontab when the container starts, and removes any hidden `.partial` file a run killed by a restart left behind. The `scripts/` directory is mounted read-only at `/hearth`.
- **File:** `hearth-YYYY-MM-DD.sql.gz`, for example `hearth-2026-11-12.sql.gz`, in the `backups` volume (`hearth_backups` on the VPS): a gzip-compressed plain-SQL `pg_dump --no-owner --no-privileges`. Its first line, `-- hearth-backup transactions=<n>`, is the number of rows in `transactions` in the dump's own snapshot; the restore drill checks it. The dump is written to a hidden `.partial` file and renamed only once it is complete, so a failed run never leaves a broken backup. A second run on the same day replaces that day's file.
- **Retention:** `BACKUP_RETENTION_DAYS` in `.env` (default `14`, a whole number from 1 to 9999) is how many daily files are kept. After each successful dump, every `hearth-YYYY-MM-DD.sql.gz` older than the newest `BACKUP_RETENTION_DAYS` is deleted. Pruning counts files, not age, so a run of failed nights never deletes the last good backups. Nothing else in the volume is touched.

The `backup` service publishes no port, and PostgreSQL stays unpublished.

**Disk space:** the `backups` volume is on the VPS's own disk, the same one as the database's. A dump needs room for itself; if the disk is full the run fails as `DumpFailed` and deletes its partial file, but a disk that is nearly full can also make PostgreSQL fail its own writes. Keep an eye on the free space (`df -h`) and lower `BACKUP_RETENTION_DAYS` or move backups off the VPS before it gets close. The job does not check free space and nothing alerts on a failed night yet: read `docker compose logs backup`.

## Settings

Set these in `.env` on the VPS only to change the default; `compose.yaml` gives each one, so none is required:

| Variable | Default | What it sets |
|---|---|---|
| `BACKUP_RETENTION_DAYS` | `14` | How many daily backup files the volume keeps: a whole number from 1 to 9999, written without a leading zero. |
| `APP_TIMEZONE` | `America/Bogota` | The zone of the 02:00 schedule and of the date in each file name; the app uses it too. |
| `COMPOSE_PROFILES` | unset | `offsite` turns on the optional off-site copy (see "Off-site copy" below); its remote is set in `.env.offsite`, not in `.env`. |

The job connects as `hearth` with the `POSTGRES_PASSWORD` the `db` service already uses.

## Logs and failures

Each run writes one JSON line per event to the container's output (`docker compose logs backup`), like the app does:

- `backup_written` (`file`, `transactions`): the night's dump is complete.
- `backup_pruned` (`file`): the retention deleted an old dump.
- `backup_failed` (`reason`): the job exited with status 1. For `DumpFailed` and `InvalidRetention` it wrote nothing and pruned nothing, so every existing backup is kept, and so it does for `Interrupted` unless a `backup_written` line came before it (then the night's backup was kept and the pruning ran); for `PruneFailed` the night's backup was written and pruning stopped at the file it could not delete, possibly after deleting some older ones. The `reason` is:
    - `DumpFailed`: the database was unreachable or refused the connection, `pg_dump` did not finish, or a table lock held by someone else (a migration, say) was not released in time: each table lock is waited for at most 5 minutes (300 s) instead of hanging, in the count that comes first and again in `pg_dump`, so a run can wait about 10 minutes in the worst case. The `psql` or `pg_dump` lines just before it name the cause.
    - `InvalidRetention`: `BACKUP_RETENTION_DAYS` is not a whole number from 1 to 9999; nothing was dumped.
    - `Interrupted`: a signal reached the job itself, such as Ctrl-C in `docker compose exec`; it removed its partial file and stopped `pg_dump` on its way out. The signal can arrive after the backup was written, while the job prunes; then the log shows `backup_written` before `backup_failed`. `docker compose stop` signals only `crond`, so it kills a job that is running without a log line.
    - `PruneFailed`: an old backup could not be deleted.

Every line carries `"job":"nightly-backup"`. The password is never logged.

If `docker compose ps` shows `backup` restarting and its logs say `cron-entrypoint.sh: /hearth/backup.sh is not a file`, or `sh: can't open '/hearth/cron-entrypoint.sh'`, `scripts/` is missing or incomplete on the VPS. Older deploys that copied only `compose.yaml` and `Caddyfile` may have left empty root-owned directories under `scripts/` (Docker creates a missing bind source as a directory): remove them (`sudo rm -r scripts`), copy `scripts/` next to `compose.yaml` again and run `docker compose up -d`.

## Run a backup now

After the first deployment and before every update:

    docker compose exec backup sh /hearth/backup.sh
    docker compose exec backup ls -l /backups

It replaces today's file if the 02:00 run already wrote one, once the new dump has passed its checks; a dump that fails leaves today's file as it was. To keep both, make a copy first with the safety-copy command under [Restoring for real](#restoring-for-real).

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

## Off-site copy (optional)

The `backups` volume is on the VPS's own disk, next to the database: losing the disk loses both. The optional `backup-offsite` service copies the backups to any storage [rclone](https://rclone.org/) supports (an S3-compatible bucket, Backblaze B2, SFTP, …). It is off by default.

- **When:** every day at 03:00 in `APP_TIMEZONE`, an hour after the backup. It runs `rclone copy` of every `hearth-YYYY-MM-DD.sql.gz` to `BACKUP_OFFSITE_REMOTE`; files already there are skipped.
- **Never deletes:** `rclone copy` removes nothing on the remote, so a wiped or pruned volume never empties it. It does overwrite a remote file whose local namesake changed, for example after a second backup on the same day, or if the files on the VPS were tampered with. So enable versioning or object lock on the bucket, and set the remote's own retention, for example a lifecycle rule that deletes old versions and objects after 90 days.
- **Isolated:** it reads the `backups` volume read-only and is on its own network, with no route to the database.

To turn it on:

1. Check that Docker Compose is 2.24.0 or later (`docker compose version`): `compose.yaml` loads `.env.offsite` with `required: false`, which older versions reject, with the profile off too. Then create `/opt/hearth/.env.offsite` from `.env.offsite.example` and `chmod 600` it. `BACKUP_OFFSITE_REMOTE` names the remote and path (`offsite:<bucket>/hearth`; the remote's name is letters, digits, `_` and `-`, and the script refuses anything else); the `RCLONE_CONFIG_OFFSITE_*` variables configure the remote `offsite` (rclone reads every backend option as `RCLONE_CONFIG_<REMOTE>_<OPTION>`). The file holds credentials and is never committed.
2. Prefer an encrypted remote, since the dumps hold the household's financial history: configure the storage as a remote named, say, `raw`, and make `offsite` an rclone `crypt` remote over it:

        RCLONE_CONFIG_RAW_TYPE=s3
        RCLONE_CONFIG_RAW_PROVIDER=Other
        RCLONE_CONFIG_RAW_ENDPOINT=https://s3.example.com
        RCLONE_CONFIG_RAW_ACCESS_KEY_ID=…
        RCLONE_CONFIG_RAW_SECRET_ACCESS_KEY=…
        RCLONE_CONFIG_OFFSITE_TYPE=crypt
        RCLONE_CONFIG_OFFSITE_REMOTE=raw:my-bucket/hearth
        # The next value is the output of: docker run --rm -i rclone/rclone:1.75.1 obscure -   (type the passphrase, then Ctrl-D).
        # Keep comments on their own lines: `docker run --env-file` would read a trailing comment as part of the value.
        RCLONE_CONFIG_OFFSITE_PASSWORD=…
        BACKUP_OFFSITE_REMOTE=offsite:

   Keep the passphrase somewhere other than the VPS: without it the copies cannot be read.
3. Add `COMPOSE_PROFILES=offsite` to `.env` and run `docker compose up -d`.
4. Check it without waiting for 03:00: `docker compose exec backup-offsite sh /hearth/offsite-copy.sh` prints `offsite_copy_finished`; `docker compose exec backup-offsite sh -c 'rclone ls "$BACKUP_OFFSITE_REMOTE"'` lists the files. A wrong endpoint or credentials can take a few minutes to report: rclone makes two attempts (`--retries 2`, so one retry), each with a 30 s connect timeout and a 2 minute stall timeout, before the script prints `offsite_copy_failed`. The low-level retries are also cut to two, so a flaky link fails a large upload sooner; the next night's copy sends the file again.

Its logs (`docker compose logs backup-offsite`) carry `"job":"offsite-copy"`: `offsite_copy_finished` (`remote`, the remote's name only), or `offsite_copy_failed` with exit status 1 and the `reason` `MissingRemote` (`BACKUP_OFFSITE_REMOTE` is not set) `InvalidRemote` (`BACKUP_OFFSITE_REMOTE` has no `remote:` part, or the remote's name has other characters than letters, digits, `_` and `-`, for example a connection string with parameters or a local path: nothing is run and the value is not logged), or `CopyFailed` (rclone's lines before it name the cause).

To turn it off, remove `COMPOSE_PROFILES=offsite` from `.env` and stop the running service, which `docker compose up -d` does not do: `docker compose --profile offsite rm -sf backup-offsite`. The copies already on the remote stay there.

To restore from the off-site copy, download the file next to `compose.yaml` (`backup-offsite` cannot write to the volume), put it in the volume with `docker compose cp`, and follow [Restoring for real](#restoring-for-real):

    docker run --rm --env-file .env.offsite -v "$PWD:/data" --entrypoint sh rclone/rclone:1.75.1 -c 'rclone copy "$BACKUP_OFFSITE_REMOTE" /data --include hearth-2026-11-12.sql.gz'
    docker compose cp hearth-2026-11-12.sql.gz backup:/backups/
