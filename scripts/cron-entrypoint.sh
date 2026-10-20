#!/bin/sh
# Runs one command on a cron schedule in the container's TZ (HU-E8-01): busybox crond in the foreground.
# Usage: cron-entrypoint.sh '<schedule>' '<command>'. The crontab is written here, owned by root, because
# busybox crond silently ignores a crontab file that root does not own, such as a bind-mounted one.
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: cron-entrypoint.sh '<schedule>' '<command>'" >&2
  exit 64
fi
# compose.yaml mounts the whole scripts/ directory at /hearth. A missing scripts/ then fails before this file runs
# (sh: can't open it); a scripts/ without the script the command runs, or with an empty directory Docker made of it,
# is refused here instead of crond running a job that does nothing.
set -f
for word in $2; do
  case $word in
    /hearth/*)
      [ -f "$word" ] || {
        echo "cron-entrypoint.sh: $word is not a file: copy scripts/ next to compose.yaml, after removing any empty directories Docker made under scripts/" >&2
        exit 66
      }
      ;;
  esac
done
set +f
# A backup killed by `docker compose stop` or a reboot leaves its hidden partial file, and none of this service's
# runs is live at start. Only the service that writes the partials cleans them: another service sharing the volume
# (backup-offsite) may start while the nightly dump is writing one.
case $2 in
  *"/hearth/backup.sh"*)
    rm -f "${BACKUP_DIR:-/backups}"/.hearth-*.partial || echo "cron-entrypoint.sh: could not remove stale partial backups" >&2
    ;;
esac
mkdir -p /etc/crontabs
# The job's output goes to the container's own stdout and stderr, so `docker compose logs` shows it.
printf '%s %s > /proc/1/fd/1 2> /proc/1/fd/2\n' "$1" "$2" > /etc/crontabs/root
exec crond -f -d 8
