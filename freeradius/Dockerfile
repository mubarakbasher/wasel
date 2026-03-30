FROM freeradius/freeradius-server:latest

# Install PostgreSQL driver for FreeRADIUS
RUN apt-get update && \
    apt-get install -y --no-install-recommends freeradius-postgresql && \
    rm -rf /var/lib/apt/lists/*

# Enable SQL module (symlink from mods-available to mods-enabled)
RUN ln -sf /etc/freeradius/mods-available/sql /etc/freeradius/mods-enabled/sql

# Override only the SQL module config with our PostgreSQL settings
COPY raddb/mods-enabled/sql /etc/freeradius/mods-enabled/sql

# Override sites-enabled with our auth/acct/coa config
COPY raddb/sites-enabled/default /etc/freeradius/sites-enabled/default
COPY raddb/sites-enabled/coa     /etc/freeradius/sites-enabled/coa

# Add custom clients (WireGuard subnet)
COPY raddb/clients.conf /etc/freeradius/clients.conf

# Add Mikrotik vendor dictionary
COPY dictionary /etc/freeradius/dictionary

# Log to stdout for Docker
RUN sed -i 's/destination = files/destination = stdout/' /etc/freeradius/radiusd.conf && \
    sed -i 's/auth = no/auth = yes/' /etc/freeradius/radiusd.conf

# Ensure correct ownership
RUN chown -R freerad:freerad /etc/freeradius

EXPOSE 1812/udp 1813/udp 3799/udp

CMD ["freeradius", "-f"]
