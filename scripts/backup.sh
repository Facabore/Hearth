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
# A partial per run: two overlapping runs on one day never write into each other's file.
partial="$dir/.$name.$$.partial"
trap 'rm -f "$partial"' EXIT
# A signal skips the EXIT trap in busybox ash: turn it into an exit.
trap 'exit 1' HUP INT TERM
export HEARTH_BACKUP_PARTIAL="$partial"

# pg_dump runs from inside this transaction and reads the snapshot it exports, so the count is the dump's own.
psql -X -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL' || fail DumpFailed
BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SELECT pg_export_snapshot() AS snapshot, count(*) AS transactions FROM public.transactions \gset
\setenv HEARTH_SNAPSHOT :snapshot
\setenv HEARTH_TRANSACTIONS :transactions
\! { printf -- '-- hearth-backup transactions=%s\n' "$HEARTH_TRANSACTIONS" && pg_dump --snapshot="$HEARTH_SNAPSHOT" --no-owner --no-privileges; } | gzip > "$HEARTH_BACKUP_PARTIAL"
COMMIT;
SQL

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
