#!/bin/sh
# Nightly backup (HU-E8-01). Writes one gzip-compressed plain-SQL pg_dump of the database to
# $BACKUP_DIR/hearth-YYYY-MM-DD.sql.gz (the date in the container's TZ). Its first line records how many rows
# `transactions` holds in the dump's own snapshot, deleted ones included; the restore drill checks it.
# Then keeps the newest $BACKUP_RETENTION_DAYS (1 to 9999, default 14) of them.
# Connects with the libpq variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE). Exits 1 on any failure. A table lock
# held by someone else (a migration at 02:00, say) is waited for at most 300 s, then the run fails as DumpFailed.
set -eu

JOB=nightly-backup
dir=${BACKUP_DIR:-/backups}
keep=${BACKUP_RETENTION_DAYS:-14}
# lock_timeout bounds the count below; pg_dump gets the same bound from --lock-wait-timeout.
export PGOPTIONS='-c client_min_messages=warning -c lock_timeout=300s'

# One JSON object per line on stdout, like the app's logger; $3 holds extra members, already JSON.
log() {
  printf '{"level":"%s","event":"%s","time":"%s","job":"%s"%s}\n' \
    "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$JOB" "${3:+,$3}"
}
fail() {
  log error backup_failed "\"reason\":\"$1\""
  exit 1
}

# 1 to 9999, digits only: a leading zero is refused because sh arithmetic would read it as octal, and five or more
# digits are refused so the arithmetic below never sees a number that can wrap.
case $keep in '' | *[!0-9]* | 0* | ?????*) fail InvalidRetention ;; esac

name="hearth-$(date +%F).sql.gz"
# A partial per run: two overlapping runs on one day never write into each other's file.
partial="$dir/.$name.$$.partial"
trap 'rm -f "$partial"' EXIT
# A signal skips the EXIT trap in busybox ash: turn it into a failure, which exits and so removes the partial.
# psql runs under setsid, so its pid is also its process group's: killing the group ends psql and the pg_dump | gzip
# it started, and `${psql_pid:-$!}` still finds the group when the signal lands before `psql_pid` is set. The `|| :`
# keeps `set -e` from ending the trap before it logs.
psql_pid=
trap 'kill -TERM -- "-${psql_pid:-$!}" 2>/dev/null || :; fail Interrupted' HUP INT TERM
export HEARTH_BACKUP_PARTIAL="$partial"

# pg_dump runs from inside this transaction and reads the snapshot it exports, so the count is the dump's own.
# In the background, so that `wait` returns as soon as a signal arrives instead of when psql is done.
setsid psql -X -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SELECT pg_export_snapshot() AS snapshot, count(*) AS transactions FROM public.transactions \gset
\setenv HEARTH_SNAPSHOT :snapshot
\setenv HEARTH_TRANSACTIONS :transactions
\! { printf -- '-- hearth-backup transactions=%s\n' "$HEARTH_TRANSACTIONS" && pg_dump --snapshot="$HEARTH_SNAPSHOT" --lock-wait-timeout=300s --no-owner --no-privileges; } | gzip > "$HEARTH_BACKUP_PARTIAL"
COMMIT;
SQL
psql_pid=$!
wait "$psql_pid" || fail DumpFailed
psql_pid=

# pg_dump's exit status does not reach psql: keep the file only if it is whole. gzip -t catches a damaged trailer
# or CRC; the marker catches a dump pg_dump did not finish.
gzip -t "$partial" 2>/dev/null || fail DumpFailed
gunzip -c "$partial" | tail -n 10 | grep -qx -- '-- PostgreSQL database dump complete' || fail DumpFailed
transactions=$(gunzip -c "$partial" | head -n 1 | sed 's/^-- hearth-backup transactions=//')
case $transactions in '' | *[!0-9]*) fail DumpFailed ;; esac
# Flush the data before the rename, so a power loss never leaves a final name on an empty file.
sync
mv -f "$partial" "$dir/$name" || fail DumpFailed
log info backup_written "\"file\":\"$name\",\"transactions\":$transactions"

# Keep the newest $keep backups by name, one per day; pruning counts files, not age, and runs only after a good
# dump, so a run of failed nights never deletes the last good backups. Nothing else in $dir is touched.
# `set -e` is off inside a `||` list and the loop's status is its last command's, so a failed rm exits the loop's
# subshell with 1 itself. The file this run just wrote is never deleted, even when a clock that ran ahead left
# newer names in the directory: it still counts toward the $keep, so such a run keeps one file more.
ls "$dir" | grep -E '^hearth-[0-9]{4}-[0-9]{2}-[0-9]{2}\.sql\.gz$' | sort -r | tail -n "+$((keep + 1))" |
  while read -r old; do
    if [ "$old" != "$name" ]; then
      rm -f "$dir/$old" || exit 1
      log info backup_pruned "\"file\":\"$old\""
    fi
  done || fail PruneFailed
