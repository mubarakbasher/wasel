#!/bin/sh
set -e

mkdir -p /app/uploads/receipts
chown -R app:app /app/uploads

exec su-exec app "$@"
