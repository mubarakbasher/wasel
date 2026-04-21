#!/bin/sh
set -e

# Substitute environment variables in the SQL config
# The template is kept at a separate path so it survives container restarts
envsubst '$RADIUS_DB_HOST $RADIUS_DB_PORT $RADIUS_DB_USER $RADIUS_DB_PASS $RADIUS_DB_NAME' \
  < /etc/freeradius/sql.template > /etc/freeradius/mods-enabled/sql
chown freerad:freerad /etc/freeradius/mods-enabled/sql

# The `freeradius_control` named volume is mounted at /var/run/freeradius
# so the backend container can reach the radmin Unix socket. Docker
# creates the mount as root:root, 0755 — fix ownership/permissions here
# so the control-socket listener can create the socket on startup and
# the backend's `app` user (GID 101) can connect to it.
mkdir -p /var/run/freeradius
chown freerad:freerad /var/run/freeradius
chmod 0770 /var/run/freeradius

exec "$@"
