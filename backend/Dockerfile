FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

# - wireguard-tools: wg CLI used by wireguardPeer.ts
# - freeradius: ships radmin (control-socket HUP after nas table changes)
#   and radclient (synthetic RADIUS auth probe in routerHealth.service.ts)
# - iputils: `ping` used by the tunnel-reachability health probe
RUN apk add --no-cache wireguard-tools libcap freeradius iputils \
    && setcap cap_net_admin+eip /usr/bin/wg

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY src/migrations/sql ./dist/migrations/sql

# Create non-root user and fix ownership. The `freerad` group is shared
# with the freeradius container via the freeradius_control named volume —
# the app user joins that group (GID 101 matches the Debian freeradius
# image default) so it can read/write the radmin Unix socket.
RUN addgroup -S -g 101 freerad 2>/dev/null || true \
    && addgroup -S app \
    && adduser -S -G app -s /sbin/nologin app \
    && addgroup app freerad \
    && mkdir -p /app/uploads \
    && chown -R app:app /app

USER app

EXPOSE 3000

CMD ["node", "dist/server.js"]
