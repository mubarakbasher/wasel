#!/usr/bin/env bash
# Dead-man's switch heartbeat — detects "whole VPS down".
#
# Uptime Kuma runs ON the VPS, so it cannot alert when the VPS itself dies.
# This script pings healthchecks.io every minute; if pings stop arriving,
# healthchecks.io fires its notifications (webhook → CallMeBot → WhatsApp).
# Setup steps: docs/OBSERVABILITY.md §3.
#
# Crontab (root):
#   * * * * * /root/wasel/scripts/vps-heartbeat.sh
set -u

# Create at https://healthchecks.io (free) — paste the ping URL here or in
# /etc/wasel/heartbeat.url (preferred; survives git pulls).
URL_FILE="/etc/wasel/heartbeat.url"
HEARTBEAT_URL="${HEARTBEAT_URL:-}"

if [[ -z "$HEARTBEAT_URL" && -r "$URL_FILE" ]]; then
  HEARTBEAT_URL="$(cat "$URL_FILE")"
fi

if [[ -z "$HEARTBEAT_URL" ]]; then
  echo "vps-heartbeat: no URL configured (set HEARTBEAT_URL or $URL_FILE)" >&2
  exit 1
fi

# Only ping when the machine is actually healthy enough to matter:
# require the backend health endpoint to answer. If the backend is down,
# the missed heartbeat doubles as a backend-down alert path of last resort.
if curl -fsS -m 5 http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1; then
  curl -fsS -m 10 --retry 3 "$HEARTBEAT_URL" >/dev/null 2>&1
fi
