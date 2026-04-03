#!/bin/sh
set -e

# Substitute environment variables in the SQL config
envsubst < /etc/freeradius/mods-enabled/sql.template > /etc/freeradius/mods-enabled/sql
chown freerad:freerad /etc/freeradius/mods-enabled/sql
rm -f /etc/freeradius/mods-enabled/sql.template

exec "$@"
