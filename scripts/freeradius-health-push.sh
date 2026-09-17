#!/usr/bin/env bash
# FreeRADIUS container health -> Uptime Kuma Push monitor (WhatsApp alert path).
#
# Why this exists (incident 2026-09-15 remediation):
#   Uptime Kuma 1.x (louislam/uptime-kuma:1 in docker-compose.monitoring.yml)
#   turns a RUNNING container whose Docker health is not "healthy" into
#   PENDING, never DOWN, and UP -> PENDING sends no notification.  A hung
#   FreeRADIUS stays running while its health is "unhealthy", and a watchdog
#   restart still reports State.Running=true, so Kuma's "Docker Container"
#   monitor never pages for a hang.  This script reads Docker's real health
#   status and pushes it to a Kuma Push monitor, which does go DOWN and notify.
#
#   healthy / starting    -> status=up
#   unhealthy / no health -> status=down
#   container missing     -> status=down
#   script stops running  -> the Push monitor goes DOWN when pushes stop
#
# Setup steps: docs/OBSERVABILITY.md §1.3.
#
# Crontab (root):
#   * * * * * /root/wasel/scripts/freeradius-health-push.sh
set -u

# Push URL from the Kuma monitor page, e.g.
#   http://127.0.0.1:3001/api/push/<token>?status=up&msg=OK&ping=
# Keep it in /etc/wasel/kuma-freeradius-push.url (survives git pulls).
URL_FILE="/etc/wasel/kuma-freeradius-push.url"
PUSH_URL="${KUMA_FREERADIUS_PUSH_URL:-}"
CONTAINER="${FREERADIUS_CONTAINER:-wasel-freeradius-1}"

if [[ -z "$PUSH_URL" && -r "$URL_FILE" ]]; then
  PUSH_URL="$(cat "$URL_FILE")"
fi

if [[ -z "$PUSH_URL" ]]; then
  echo "freeradius-health-push: no URL configured (set KUMA_FREERADIUS_PUSH_URL or $URL_FILE)" >&2
  exit 1
fi

if ! HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null)"; then
  HEALTH="missing"
fi

case "$HEALTH" in
  healthy|starting) STATUS="up" ;;
  *)                STATUS="down" ;;
esac

# The URL copied from Kuma already carries ?status=up&msg=OK&ping= — drop that
# query and send our own values.
curl -fsS -m 10 --retry 2 -G "${PUSH_URL%%\?*}" \
  --data-urlencode "status=${STATUS}" \
  --data-urlencode "msg=${CONTAINER} health: ${HEALTH}" \
  --data-urlencode "ping=" >/dev/null 2>&1
