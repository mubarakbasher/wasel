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

# Override sites-enabled with our auth/acct/coa config
COPY raddb/sites-enabled/default        /etc/freeradius/sites-enabled/default
COPY raddb/sites-enabled/coa            /etc/freeradius/sites-enabled/coa
COPY raddb/sites-enabled/control-socket /etc/freeradius/sites-enabled/control-socket

# Add custom clients (WireGuard subnet)
COPY raddb/clients.conf /etc/freeradius/clients.conf

# Add Mikrotik vendor dictionary
COPY dictionary /etc/freeradius/dictionary

# Log to stdout for Docker
RUN sed -i 's/destination = files/destination = stdout/' /etc/freeradius/radiusd.conf && \
    sed -i 's/auth = no/auth = yes/' /etc/freeradius/radiusd.conf

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
