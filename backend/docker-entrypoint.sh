#!/bin/sh
set -e

mkdir -p /app/uploads/receipts
chown -R app:app /app/uploads

# Grant the non-root `app` user access to the host's docker socket so that
# `docker restart wasel-freeradius` in freeradius.service.ts can actually
# run. The socket is bind-mounted with its host ownership (root:docker on
# the host), and the `docker` group's GID is assigned at docker install
# time — typically 999 on Debian/Ubuntu and 994 on RHEL/Alma, but it can
# be anything. Detect it at runtime and match an in-container group so we
# don't have to hard-code a GID in the image.
#
# Without this, `docker restart` fails with EACCES on /var/run/docker.sock
# and new-router adds leave the `nas` table diverged from FreeRADIUS's
# in-memory client list — vouchers silently reject until someone manually
# restarts the FR container.
if [ -S /var/run/docker.sock ]; then
  DOCKER_SOCK_GID=$(stat -c '%g' /var/run/docker.sock)
  if [ -n "$DOCKER_SOCK_GID" ] && [ "$DOCKER_SOCK_GID" != "0" ]; then
    # Reuse an existing group with this GID, or create one. Some alpine
    # base images already carry groups at low GIDs (ping, tty, etc.); we
    # don't want to clash.
    EXISTING_GROUP=$(getent group "$DOCKER_SOCK_GID" | cut -d: -f1 || true)
    if [ -z "$EXISTING_GROUP" ]; then
      addgroup -g "$DOCKER_SOCK_GID" dockerhost
      EXISTING_GROUP=dockerhost
    fi
    # Add app as a supplementary member. Idempotent on re-exec because
    # addgroup <user> <group> silently succeeds if already a member.
    addgroup app "$EXISTING_GROUP" >/dev/null 2>&1 || true
  fi
fi

# Use `su-exec app` (not `app:app`) so initgroups() runs and picks up the
# supplementary group we just added. The `user:group` form explicitly sets
# only the primary GID and skips initgroups, which would strip the
# docker-socket access we just granted.
exec su-exec app "$@"
