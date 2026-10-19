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
# A signal skips the EXIT trap in busybox ash: turn it into a failure, which exits and so drops the scratch database.
trap 'fail Interrupted' HUP INT TERM
admin "CREATE DATABASE $SCRATCH TEMPLATE template0" || fail RestoreFailed
set -o pipefail
# In the background, so that `wait` returns as soon as a signal arrives instead of when psql is done.
(gunzip -c "$file" | psql -X -q -v ON_ERROR_STOP=1 -d "$SCRATCH" >/dev/null) &
wait $! || fail RestoreFailed
actual=$(psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$SCRATCH" -c 'SELECT count(*) FROM public.transactions') || fail RestoreFailed
[ "$actual" = "$expected" ] || fail CountMismatch "\"expected\":$expected,\"actual\":$actual"
trap - EXIT
drop_scratch || fail ScratchNotRemoved
log info restore_drill_passed "\"file\":\"$(basename "$file")\",\"transactions\":$actual"
