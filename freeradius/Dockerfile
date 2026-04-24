FROM freeradius/freeradius-server:3.2.4@sha256:1cfb2e830f73d8fd3dfcb3dada7cabbeb3010cf5ff0bc9363488db1b217b3dcf

# Install PostgreSQL driver for FreeRADIUS and envsubst (gettext-base)
RUN apt-get update && \
    apt-get install -y --no-install-recommends freeradius-postgresql gettext-base && \
    rm -rf /var/lib/apt/lists/*

# Enable SQL module (symlink from mods-available to mods-enabled)
RUN ln -sf /etc/freeradius/mods-available/sql /etc/freeradius/mods-enabled/sql

# Enable expiration module so FreeRADIUS enforces the Expiration attribute
RUN ln -sf /etc/freeradius/mods-available/expiration /etc/freeradius/mods-enabled/expiration

# Copy SQL config as a template (env vars substituted at runtime by entrypoint)
COPY raddb/mods-enabled/sql /etc/freeradius/sql.template

# Copy sqlcounter module config for time/data limit enforcement
COPY raddb/mods-enabled/sqlcounter /etc/freeradius/mods-enabled/sqlcounter

# Override main radiusd.conf with Wasel's version. Without this COPY the
# repo's raddb/radiusd.conf is dead — commit 7bd107c's move of the
# BlastRADIUS mitigation knobs (require_message_authenticator = no,
# limit_proxy_state = no) into the security{} block only takes effect if
# the file we COPY is the one the running server reads.
COPY raddb/radiusd.conf /etc/freeradius/radiusd.conf

# Override sites-enabled with our auth/acct/coa config and the
# dynamic-clients virtual server used to look up unknown NASes from the
# `nas` table on-demand (replaces the prior read_clients + docker-restart
# approach — see sites-enabled/dynamic-clients header for detail).
COPY raddb/sites-enabled/default         /etc/freeradius/sites-enabled/default
COPY raddb/sites-enabled/coa             /etc/freeradius/sites-enabled/coa
COPY raddb/sites-enabled/control-socket  /etc/freeradius/sites-enabled/control-socket
COPY raddb/sites-enabled/dynamic-clients /etc/freeradius/sites-enabled/dynamic-clients

# Add custom clients (WireGuard subnet)
COPY raddb/clients.conf /etc/freeradius/clients.conf

# Add Mikrotik vendor dictionary
COPY dictionary /etc/freeradius/dictionary

# Ensure correct ownership
RUN chown -R freerad:freerad /etc/freeradius

# Ensure run_dir exists and is writable by the freerad user so the radmin
# control socket can be created there. Mode 0770 (group-accessible) lets
# the backend container — whose non-root `app` user is added to GID 101
# (matching freerad) — open the Unix socket for hup / show-clients. The
# directory is shared with the backend via the `freeradius_control` named
# volume declared in docker-compose.yml.
RUN install -d -o freerad -g freerad -m 0770 /var/run/freeradius

# Add entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 1812/udp 1813/udp 3799/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeradius", "-f"]
