#!/bin/sh
set -e

mkdir -p /app/uploads/receipts
chown -R app:app /app/uploads

# Use `su-exec app` (not `app:app`) so initgroups() runs. No supplementary
# groups are currently required, but the single-arg form is the standard
# invocation and keeps future group-add plumbing (if the image ever needs
# it) a one-line change.
exec su-exec app "$@"
