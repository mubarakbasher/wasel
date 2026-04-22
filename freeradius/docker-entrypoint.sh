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

# Background-wait for the radmin socket to be created by freeradius, then
# relax its perms to 0666 so the backend's non-root `app` user can connect
# without needing to match the freerad GID (which differs across base images).
(
  i=0
  while [ ! -S /var/run/freeradius/radmin.sock ] && [ "$i" -lt 50 ]; do
    sleep 0.2
    i=$((i + 1))
  done
  if [ -S /var/run/freeradius/radmin.sock ]; then
    chmod 0666 /var/run/freeradius/radmin.sock
  fi
) &

exec "$@"
