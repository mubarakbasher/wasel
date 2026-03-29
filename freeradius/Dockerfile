FROM freeradius/freeradius-server:latest

# Install PostgreSQL driver for FreeRADIUS (Debian-based image)
RUN apt-get update && \
    apt-get install -y --no-install-recommends freeradius-postgresql && \
    rm -rf /var/lib/apt/lists/*

# Remove default config files that we are replacing
RUN rm -f /etc/freeradius/radiusd.conf \
          /etc/freeradius/clients.conf \
          /etc/freeradius/sites-enabled/default \
          /etc/freeradius/mods-enabled/sql

# Copy our custom configuration
COPY raddb/radiusd.conf      /etc/freeradius/radiusd.conf
COPY raddb/clients.conf      /etc/freeradius/clients.conf
COPY raddb/mods-enabled/sql  /etc/freeradius/mods-enabled/sql
COPY raddb/mods-enabled/pap  /etc/freeradius/mods-enabled/pap
COPY raddb/sites-enabled/default /etc/freeradius/sites-enabled/default
COPY raddb/sites-enabled/coa    /etc/freeradius/sites-enabled/coa
COPY dictionary               /etc/freeradius/dictionary

# Ensure correct ownership
RUN chown -R freerad:freerad /etc/freeradius

# RADIUS Auth, Accounting, CoA/Disconnect
EXPOSE 1812/udp 1813/udp 3799/udp

# Run in foreground with stdout logging (debug with -xx, normal with -f)
CMD ["freeradius", "-f"]
