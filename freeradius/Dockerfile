FROM freeradius/freeradius-server:3.2.8

# Install PostgreSQL driver for FreeRADIUS and envsubst (gettext-base)
RUN apt-get update && \
    apt-get install -y --no-install-recommends freeradius-postgresql gettext-base && \
    rm -rf /var/lib/apt/lists/*

# Enable SQL module (symlink from mods-available to mods-enabled)
RUN ln -sf /etc/freeradius/mods-available/sql /etc/freeradius/mods-enabled/sql

# Enable expiration module so FreeRADIUS enforces the Expiration attribute
RUN ln -sf /etc/freeradius/mods-available/expiration /etc/freeradius/mods-enabled/expiration

# Keep rlm_expr enabled explicitly (the base image enables it by default).
# It registers the Packet-Src-IP-Address comparison (rlm_expr/paircmp.c
# generic_attrs[]) that the per-voucher router-lock radcheck row relies on
# (migration 041). Without it the compare fails closed and EVERY voucher rejects.
RUN ln -sf /etc/freeradius/mods-available/expr /etc/freeradius/mods-enabled/expr

# Timestamp accounting rows with the time FreeRADIUS received the packet, not
# the NAS-supplied Event-Timestamp. The stock queries.conf documents this
# option for servers that distrust the provided Event-Timestamp. MikroTik L009
# boards have no RTC battery, so after a power cut their clock is hours behind:
# radacct.acctstarttime then lands in the past, validityExpiration computes an
# Expiration that has already passed (the voucher dies on first use), and
# staleSessionReaper closes every live session. The grep checks fail the build
# if the stock line ever changes and the sed silently stops matching.
RUN f=/etc/freeradius/mods-config/sql/main/postgresql/queries.conf && \
    sed -i 's|^event_timestamp_epoch = "%{%{integer:Event-Timestamp}:-%l}"$|event_timestamp_epoch = "%l"|' "$f" && \
    grep -qxF 'event_timestamp_epoch = "%l"' "$f" && \
    ! grep -q '^event_timestamp_epoch = "%{' "$f"

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

# Override sites-enabled with our auth/acct/coa config
COPY raddb/sites-enabled/default         /etc/freeradius/sites-enabled/default
COPY raddb/sites-enabled/coa             /etc/freeradius/sites-enabled/coa
COPY raddb/sites-enabled/control-socket  /etc/freeradius/sites-enabled/control-socket
COPY raddb/sites-enabled/dynamic-clients /etc/freeradius/sites-enabled/dynamic-clients

# Disable the base image's inner-tunnel (EAP-TTLS/PEAP inner-auth vserver)
# and the eap module itself. Wasel is voucher-PAP-only over WireGuard —
# no EAP on the wire — so both are unused. On FR 3.2.8 the upstream eap
# module fails to instantiate with
#   mods-enabled/eap[14]: Failed to find 'Auth-Type EAP' section.
#   Instantiation failed for module "eap"
# because our sites-enabled/default has no `Auth-Type EAP {}` section.
# Simplest fix is to remove the enabled-by-default symlinks for both.
RUN rm -f /etc/freeradius/sites-enabled/inner-tunnel \
    && rm -f /etc/freeradius/mods-enabled/eap

# Add custom clients (WireGuard subnet)
COPY raddb/clients.conf /etc/freeradius/clients.conf

# Add Mikrotik vendor dictionary
COPY dictionary /etc/freeradius/dictionary

# Ensure correct ownership
RUN chown -R freerad:freerad /etc/freeradius

# Ensure run_dir exists and is writable by the freerad user so the radmin
# control socket can be created there.  The directory itself is set to 0755
# by docker-entrypoint.sh (world-traversable) and the socket is chmod'd to
# 0666 by the background wait-loop in that script — no GID matching or
# group membership is required.  The directory is shared with the backend
# via the `freeradius_control` named volume declared in docker-compose.yml.
RUN install -d -o freerad -g freerad -m 0755 /var/run/freeradius

# Add entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Status-Server watchdog, called by Docker's healthcheck.  Executable by any
# UID (healthcheck runs as the container user).  Must be copied after the
# chown above so it lands outside /etc/freeradius and is not affected by it.
COPY healthcheck.sh /usr/local/bin/wasel-healthcheck
RUN chmod 0755 /usr/local/bin/wasel-healthcheck

EXPOSE 1812/udp 1813/udp 3799/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeradius", "-f"]
