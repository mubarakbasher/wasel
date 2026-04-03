FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine

RUN apk add --no-cache wireguard-tools

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY src/migrations/sql ./dist/migrations/sql

EXPOSE 3000

CMD ["node", "dist/server.js"]
