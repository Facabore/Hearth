#!/bin/sh
# ADR 0008: keeps the staging stack on the newest `:development` images. hearth-deploy's cron runs it every minute:
#   * * * * * sh /opt/hearth-staging/scripts/staging-update.sh >> /opt/hearth-staging/update.log 2>&1
# It pulls the images and runs `up -d` (migrate first, as compose.yaml orders it) only when one of them changed, the
# app is not running, or the last up failed. It logs one JSON line per update or failure and nothing on a quiet minute.
# After an update it removes only the images it replaced, never another project's on this shared VPS. It holds no
# secret: the images are public and the stack's .env never leaves the VPS.
set -u

STACK_DIR="${STACK_DIR:-/opt/hearth-staging}"
cd "$STACK_DIR" || exit 1

log() {
  printf '{"level":"%s","event":"%s","time":"%s","job":"staging-update"%s}\n' \
    "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${3:-}"
}
compose() { docker compose -f compose.yaml -f compose.staging.yaml "$@"; }
fail() {
  log error staging_update_failed ",\"step\":\"$1\""
  exit 1
}
# An up that failed is tried again every minute until one succeeds, even though nothing new is pulled.
PENDING="$STACK_DIR/.update.pending"

# A minute's run never overlaps a slow one before it.
exec 9>"$STACK_DIR/.update.lock"
flock -n 9 || exit 0

images=$(compose config --images) || fail config
ids() { for image in $images; do docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || echo none; done; }

before=$(ids)
compose pull --quiet app migrate web >/dev/null || fail pull
after=$(ids)

if [ "$before" = "$after" ] && [ ! -f "$PENDING" ] && [ -n "$(compose ps -q app)" ]; then
  exit 0
fi
touch "$PENDING"
compose up -d --remove-orphans >/dev/null || fail up
rm -f "$PENDING"
log info staging_updated ",\"images\":\"$(echo "$images" | tr '\n' ' ' | sed 's/ $//')\""

# The images this update replaced; one still used by any container stays, since `image rm` refuses it.
current=" $(echo "$after" | tr '\n' ' ') "
for old in $before; do
  case "$current" in
    *" $old "*) ;;
    *) [ "$old" = none ] || docker image rm "$old" >/dev/null 2>&1 || true ;;
  esac
done
