#!/bin/sh
set -e

# Substitute environment variables in the SQL config
# The template is kept at a separate path so it survives container restarts
envsubst '$RADIUS_DB_HOST $RADIUS_DB_PORT $RADIUS_DB_USER $RADIUS_DB_PASS $RADIUS_DB_NAME' \
  < /etc/freeradius/sql.template > /etc/freeradius/mods-enabled/sql
chown freerad:freerad /etc/freeradius/mods-enabled/sql

# The `freeradius_control` named volume is mounted at /var/run/freeradius
# so the backend container can reach the radmin Unix socket. Docker
# creates the mount as root:root, 0755 — fix ownership so the control-
# socket listener can bind, and set the dir world-traversable so any
# container sharing the volume can reach the socket by path.
mkdir -p /var/run/freeradius
chown freerad:freerad /var/run/freeradius
chmod 0755 /var/run/freeradius

# Watchdog state (healthcheck.sh) lives in this container's own /tmp, not on
# the shared volume.  Clear the failure counters so the new process starts
# with a fresh count, and any operator hold so a forgotten one cannot outlive
# a restart.
rm -f /tmp/wasel-fr-watchdog.* /tmp/wasel-fr-watchdog-hold

# Do NOT delete /var/run/freeradius/radmin.sock here.  That directory is the
# shared `freeradius_control` named volume, and the deploy config gate
# `docker compose run --rm --no-deps -T freeradius freeradius -XC` runs this
# same entrypoint while the live server is still up.  -XC never binds a
# control socket, so deleting the path would leave the live server with no
# reachable socket: every backend radmin call (status card, client eviction)
# would fail with ENOENT until FreeRADIUS restarts.  A stale socket left by a
# SIGKILLed server (watchdog, incident 2026-09-15) needs no cleanup here:
# FreeRADIUS unlinks a stale path itself before it binds.
#
# Background-wait for a socket created AFTER this entrypoint started, then
# relax its perms to 0666 so the backend's non-root `app` user can connect
# without needing to match the freerad GID (which differs across base images).
# Comparing against a start marker makes the loop ignore a stale socket from
# the previous process; otherwise it would chmod the stale file, stop, and
# leave the new socket with restrictive perms.  GNU `find -newer` compares
# full-resolution mtimes.  Wait up to 60 s (300 × 0.2 s) to cover slow module
# initialisation on a resource-constrained host.
RADMIN_SOCK=/var/run/freeradius/radmin.sock
START_MARKER=/tmp/.wasel-fr-entrypoint-start
touch "$START_MARKER"
fresh_radmin_sock() {
  [ -S "$RADMIN_SOCK" ] && [ -n "$(find "$RADMIN_SOCK" -newer "$START_MARKER" 2>/dev/null)" ]
}
(
  i=0
  while ! fresh_radmin_sock && [ "$i" -lt 300 ]; do
    sleep 0.2
    i=$((i + 1))
  done
  if fresh_radmin_sock; then
    chmod 0666 "$RADMIN_SOCK"
  fi
) &

exec "$@"
