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
# The log line carries the remote's name, so the name must be plain: a value rclone would read as a connection string
# ("offsite,secret_access_key=…:bucket") or a local path is refused before anything is run or logged.
remote=${BACKUP_OFFSITE_REMOTE%%:*}
case $BACKUP_OFFSITE_REMOTE in *:*) ;; *) fail InvalidRemote ;; esac
case $remote in '' | *[!A-Za-z0-9_-]*) fail InvalidRemote ;; esac
# Bounded retries and timeouts: an unreachable endpoint fails in a few minutes, not rclone's default of about seven.
rclone copy "$dir" "$BACKUP_OFFSITE_REMOTE" --max-depth 1 --include 'hearth-????-??-??.sql.gz' \
  --retries 2 --low-level-retries 2 --contimeout 30s --timeout 2m || fail CopyFailed
# Only the remote's name: its path may name a bucket.
log info offsite_copy_finished "\"remote\":\"$remote\""
