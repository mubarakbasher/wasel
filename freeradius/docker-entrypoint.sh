#!/bin/sh
set -e

# Substitute environment variables in the SQL config
# The template is kept at a separate path so it survives container restarts
envsubst '$RADIUS_DB_HOST $RADIUS_DB_PORT $RADIUS_DB_USER $RADIUS_DB_PASS $RADIUS_DB_NAME' \
  < /etc/freeradius/sql.template > /etc/freeradius/mods-enabled/sql
chown freerad:freerad /etc/freeradius/mods-enabled/sql

exec "$@"
