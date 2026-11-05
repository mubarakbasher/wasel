#!/usr/bin/env bash
# Wasel backup restore drill.
#
# Decrypts a DB dump into a THROWAWAY Postgres container (never the live one)
# and prints row counts for core tables. Also supports inspecting the settings
# bundle without extracting it.
#
# USAGE
#   Restore drill (DB dump):
#     ./backup-restore.sh [--keep] <encrypted-db-dump.dump.gpg>
#
#   Inspect settings bundle (list contents without extracting):
#     ./backup-restore.sh --settings <encrypted-settings.tar.gpg>
#
#   Download from Drive first if needed:
#     docker run --rm \
#       -v /etc/wasel/rclone:/config/rclone \
#       -v /root/backups:/data \
#       "rclone/rclone:1.68.2@sha256:74c51b8817e5431bd6d7ed27cb2a50d8ee78d77f6807b72a41ef6f898845942b" \
#       rclone copy gdrive:wasel-backups/prod/daily/wasel-db-2026-11-06.dump.gpg /data/
#
# FLAGS
#   --keep        Leave the throwaway container + volume for manual inspection.
#                 Print cleanup command on exit.
#   --settings    Inspect mode: decrypt settings bundle, list contents with
#                 `tar -tzf -`, and exit (no Postgres container).
#
# This script NEVER touches the live Postgres container.
set -euo pipefail

BACKUP_KEY_FILE="${BACKUP_KEY_FILE:-/etc/wasel/backup.key}"
RESTORE_CPU="${RESTORE_CPU:-1.0}"

KEEP=0
SETTINGS_MODE=0
INPUT_FILE=""

for arg in "$@"; do
  case "$arg" in
    --keep)     KEEP=1 ;;
    --settings) SETTINGS_MODE=1 ;;
    *)          INPUT_FILE="$arg" ;;
  esac
done

if [[ -z "$INPUT_FILE" ]]; then
  echo "Usage: $0 [--keep] <encrypted-db-dump.dump.gpg>" >&2
  echo "       $0 --settings <encrypted-settings.tar.gpg>" >&2
  exit 1
fi

if [[ ! -f "$INPUT_FILE" ]]; then
  echo "ERROR: file not found: $INPUT_FILE" >&2
  exit 1
fi

if [[ ! -r "$BACKUP_KEY_FILE" ]]; then
  echo "ERROR: backup key not readable: $BACKUP_KEY_FILE" >&2
  exit 1
fi

# ── Preflight: require gpg ────────────────────────────────────────────────────
if ! command -v gpg >/dev/null 2>&1; then
  echo "ERROR: gpg not found; install gnupg (apt install gnupg)" >&2
  exit 1
fi

# ── GnuPG: throwaway home per run ────────────────────────────────────────────
# A fresh GNUPGHOME per run means: root's keyring is never touched, no agent
# state leaks between invocations, and it works under systemd PrivateTmp.
# The dir is removed (and any spawned agent killed) in the EXIT trap.
GNUPGHOME=$(mktemp -d)
chmod 700 "$GNUPGHOME"
export GNUPGHOME

_on_exit() {
  gpgconf --homedir "$GNUPGHOME" --kill all 2>/dev/null || true
  rm -rf "$GNUPGHOME"
}
trap '_on_exit' EXIT

# ── Settings inspect mode ────────────────────────────────────────────────────
if [[ $SETTINGS_MODE -eq 1 ]]; then
  echo "[restore] Listing contents of settings bundle: ${INPUT_FILE}"
  gpg --batch --quiet --pinentry-mode loopback \
      --passphrase-file "${BACKUP_KEY_FILE}" \
      --no-symkey-cache \
      -d "${INPUT_FILE}" \
    | tar -tzf -
  echo ""
  echo "[restore] Done. backend_uploads.tar.gz listed above is the uploads volume export."
  exit 0
fi

# ── DB restore drill ──────────────────────────────────────────────────────────
RESTORE_VOL="wasel-restore-$$"
RESTORE_CTR="wasel-restore-$$"

cleanup() {
  if [[ $KEEP -eq 1 ]]; then
    echo "[restore] --keep set; leaving container '${RESTORE_CTR}' and volume '${RESTORE_VOL}'"
    echo "[restore] Cleanup: docker rm -f ${RESTORE_CTR} && docker volume rm ${RESTORE_VOL}"
    return
  fi
  echo "[restore] Cleaning up container and volume..."
  docker rm -f "$RESTORE_CTR"    2>/dev/null || true
  docker volume rm "$RESTORE_VOL" 2>/dev/null || true
  echo "[restore] Cleaned up."
}
trap 'cleanup; _on_exit' EXIT

echo "[restore] Creating throwaway volume: ${RESTORE_VOL}"
docker volume create "$RESTORE_VOL" >/dev/null

echo "[restore] Starting throwaway Postgres 16 container: ${RESTORE_CTR}"
docker run -d \
  --name "$RESTORE_CTR" \
  --cpus="$RESTORE_CPU" \
  -e POSTGRES_USER=wasel \
  -e POSTGRES_PASSWORD=restore_drill \
  -e POSTGRES_DB=wasel \
  -v "${RESTORE_VOL}:/var/lib/postgresql/data" \
  postgres:16-alpine >/dev/null

# Wait for TCP readiness (not unix socket — the temp initdb server uses only the
# unix socket; TCP comes up only when the real server is ready).
echo "[restore] Waiting for Postgres TCP readiness (up to 60s)..."
READY=0
for _ in $(seq 1 60); do
  if docker exec "$RESTORE_CTR" pg_isready -h 127.0.0.1 -U wasel -q 2>/dev/null; then
    READY=1
    break
  fi
  sleep 1
done
if [[ $READY -eq 0 ]]; then
  echo "ERROR: throwaway Postgres never became ready after 60s" >&2
  exit 1
fi
echo "[restore] Postgres ready."

# Restore — capture exit codes without letting set -e abort before row counts
echo "[restore] Decrypting and restoring dump..."
T0=$SECONDS
GPG_RC=0
PGRESTORE_RC=0

gpg --batch --quiet --pinentry-mode loopback \
    --passphrase-file "${BACKUP_KEY_FILE}" \
    --no-symkey-cache \
    -d "${INPUT_FILE}" \
  | docker exec -i "$RESTORE_CTR" \
      pg_restore -U wasel -d wasel --no-owner --no-privileges \
  || { GPG_RC=${PIPESTATUS[0]}; PGRESTORE_RC=${PIPESTATUS[1]}; }

ELAPSED=$(( SECONDS - T0 ))
echo "[restore] pg_restore finished in ${ELAPSED}s  (gpg_rc=${GPG_RC} pg_restore_rc=${PGRESTORE_RC})"
if [[ $PGRESTORE_RC -ne 0 ]]; then
  echo "[restore] pg_restore reported ${PGRESTORE_RC} errors — check output above" >&2
fi

# Always print row counts regardless of restore exit code
echo ""
echo "[restore] Row counts:"
echo "─────────────────────────────────────────────"
for tbl in users routers voucher_meta radcheck radacct subscriptions payments; do
  COUNT=$(docker exec "$RESTORE_CTR" \
    psql -U wasel -d wasel -t -c \
    "SELECT COUNT(*) FROM ${tbl};" 2>/dev/null | tr -d ' ' || echo "N/A")
  printf "  %-20s %s\n" "${tbl}" "${COUNT}"
done
echo "─────────────────────────────────────────────"
echo ""
echo "[restore] Restore drill complete. Verify counts look sane against prod/staging."

# Exit non-zero if either stage failed
if [[ $GPG_RC -ne 0 || $PGRESTORE_RC -ne 0 ]]; then
  exit 1
fi
