FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

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
