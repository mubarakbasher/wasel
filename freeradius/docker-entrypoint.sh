#!/bin/sh
set -e

# Substitute environment variables in the SQL config
# The template is kept at a separate path so it survives container restarts
envsubst < /etc/freeradius/sql.template > /etc/freeradius/mods-enabled/sql
chown freerad:freerad /etc/freeradius/mods-enabled/sql

exec "$@"
