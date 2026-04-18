# TODO(digest): pin after next pull → docker pull node:20-alpine && docker image inspect node:20-alpine --format '{{index .RepoDigests 0}}'
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# TODO(digest): pin node:20-alpine to same digest as builder stage above
FROM node:20-alpine

RUN apk add --no-cache wireguard-tools

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY src/migrations/sql ./dist/migrations/sql

# Create non-root user and fix ownership
RUN addgroup -S app && adduser -S -G app app \
    && mkdir -p /app/uploads \
    && chown -R app:app /app

USER app

EXPOSE 3000

CMD ["node", "dist/server.js"]
