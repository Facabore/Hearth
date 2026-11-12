#!/bin/sh
# ADR 0008: keeps the staging stack on the newest `:development` images. hearth-deploy's cron runs it every minute:
#   * * * * * sh /opt/hearth-staging/scripts/staging-update.sh >> /opt/hearth-staging/update.log 2>&1
# It pulls the images and runs `up -d` (migrate first, as compose.yaml orders it) only when one of them changed or the
# app is not running. It logs one JSON line per update or failure and nothing on a quiet minute. It holds no secret:
# the images are public and the stack's .env never leaves the VPS.
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

# A minute's run never overlaps a slow one before it.
exec 9>"$STACK_DIR/.update.lock"
flock -n 9 || exit 0

images=$(compose config --images) || fail config
ids() { for image in $images; do docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || echo none; done; }

before=$(ids)
compose pull --quiet app migrate web >/dev/null || fail pull
after=$(ids)

if [ "$before" = "$after" ] && [ -n "$(compose ps -q app)" ]; then
  exit 0
fi
compose up -d --remove-orphans >/dev/null || fail up
log info staging_updated ",\"images\":\"$(echo "$images" | tr '\n' ' ' | sed 's/ $//')\""
