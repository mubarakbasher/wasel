FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

# - wireguard-tools: wg CLI used by wireguardPeer.ts
# - freeradius: ships radclient (synthetic RADIUS auth probe in
#   routerHealth.service.ts) and radmin (used only by the reconciliation
#   probe's `show clients` call — reloads now use `docker restart`).
# - iputils: `ping` used by the tunnel-reachability health probe
# - docker-cli: used to `docker restart wasel-freeradius` after nas writes.
#   The host docker daemon socket is mounted via docker-compose.yml; this
#   package supplies only the client binary, no daemon.
RUN apk add --no-cache wireguard-tools libcap freeradius iputils su-exec docker-cli \
    && setcap cap_net_admin+eip /usr/bin/wg

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY src/migrations/sql ./dist/migrations/sql

# Create non-root user. The radmin socket in the freeradius_control volume
# is chmod 0666 by the freeradius entrypoint, so no GID matching is needed.
# Entrypoint runs as root to chown the uploads volume (named volumes can carry
# stale ownership from earlier image builds), then drops to `app` via su-exec.
RUN addgroup -S app \
    && adduser -S -G app -s /sbin/nologin app \
    && mkdir -p /app/uploads/receipts \
    && chown -R app:app /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
