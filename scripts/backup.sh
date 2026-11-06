#!/usr/bin/env bash
# Wasel nightly encrypted backup — database + settings bundle → Google Drive
#
# Configuration: /etc/wasel/backup.env  (EnvironmentFile for the systemd unit)
# Run via:  scripts/wasel-backup.service + scripts/wasel-backup.timer
# Manual:   BACKUP_ENV=staging UPLOAD=0 /bin/bash /path/to/backup.sh
#
# See docs/deploy.md §Backups for install steps and restore procedure.
set -euo pipefail

# ── Pinned rclone image ───────────────────────────────────────────────────────
# Digest-pinned by default. Override with RCLONE_IMAGE in backup.env only
# after auditing the new image.  tag@digest syntax is supported by docker run.
RCLONE_IMAGE="${RCLONE_IMAGE:-rclone/rclone:1.68.2@sha256:74c51b8817e5431bd6d7ed27cb2a50d8ee78d77f6807b72a41ef6f898845942b}"

# alpine:3.20 — used read-only to export the uploads volume via tar.
# If you need to bump this, audit the new digest before changing.
ALPINE_IMAGE="alpine:3.20"

# ── Defaults (overridden by /etc/wasel/backup.env via EnvironmentFile) ────────
: "${WASEL_DIR:=/root/wasel}"
: "${BACKUP_ENV:=prod}"
: "${UPLOAD:=1}"
: "${BACKUP_DIR:=/root/backups/auto}"
: "${RCLONE_REMOTE:=gdrive}"
: "${RCLONE_BASE:=wasel-backups}"
: "${LOCAL_RETAIN_DAYS:=7}"
: "${DRIVE_DAILY_KEEP:=7}"
: "${DRIVE_WEEKLY_KEEP:=4}"

COMPOSE_ENV_FILE="/etc/wasel/compose.env"
BACKUP_KEY_FILE="/etc/wasel/backup.key"
RCLONE_CONFIG_DIR="/etc/wasel/rclone"
HEARTBEAT_URL_FILE="/etc/wasel/backup-heartbeat.url"

# ── Preflight: require gpg ────────────────────────────────────────────────────
if ! command -v gpg >/dev/null 2>&1; then
  echo "[backup] ERROR: gpg not found; install gnupg (apt install gnupg)" >&2
  exit 1
fi

# ── GnuPG: throwaway home per run ────────────────────────────────────────────
# A fresh GNUPGHOME per run means: root's keyring is never touched, no agent
# state leaks between runs, and it works under systemd PrivateTmp.
# The dir is removed (and any spawned agent killed) in the EXIT trap below.
GNUPGHOME=$(mktemp -d)
chmod 700 "$GNUPGHOME"
export GNUPGHOME

# ── Heartbeat helpers ─────────────────────────────────────────────────────────
HEARTBEAT_URL=""
if [[ -r "$HEARTBEAT_URL_FILE" ]]; then
  HEARTBEAT_URL="$(cat "$HEARTBEAT_URL_FILE")"
fi

_hc_ping() {
  local suffix="${1:-}"
  [[ -z "$HEARTBEAT_URL" ]] && return 0
  curl -fsS -m 10 --retry 3 "${HEARTBEAT_URL}${suffix}" >/dev/null 2>&1 || true
}

# ── Cleanup tracking — files/dirs to remove on EXIT ──────────────────────────
CLEANUP_FILES=()
WARNINGS=0

_on_exit() {
  local rc=$?
  # Kill any gpg-agent spawned in the throwaway home, then remove it
  gpgconf --homedir "$GNUPGHOME" --kill all 2>/dev/null || true
  rm -rf "$GNUPGHOME"
  # Remove temp files from this run; skip empty entries
  for f in "${CLEANUP_FILES[@]+"${CLEANUP_FILES[@]}"}"; do
    [[ -z "$f" ]] && continue
    rm -rf "$f" 2>/dev/null || true
  done
  if [[ $rc -ne 0 ]]; then
    echo "[backup] FAILED (exit $rc)" >&2
    _hc_ping "/fail"
  fi
}
trap '_on_exit' EXIT

# ── Concurrency lock ──────────────────────────────────────────────────────────
# /run survives PrivateTmp and is accessible to both the systemd unit and
# manual runs outside systemd (which would each have their own private /tmp).
LOCK_FILE="/run/wasel-backup.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[backup] Another backup is already running. Exiting." >&2
  exit 1
fi

# ── Signal start ─────────────────────────────────────────────────────────────
_hc_ping "/start"

# ── Housekeeping ──────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
DATE="$(date -u +%Y-%m-%d)"
TIMESTAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
DB_TMP="${BACKUP_DIR}/wasel-db-${TIMESTAMP}.dump.gpg.tmp"
DB_FILE="${BACKUP_DIR}/wasel-db-${DATE}.dump.gpg"
SETTINGS_TMP="${BACKUP_DIR}/wasel-settings-${TIMESTAMP}.tar.gpg.tmp"
SETTINGS_FILE="${BACKUP_DIR}/wasel-settings-${DATE}.tar.gpg"
CLEANUP_FILES+=("$DB_TMP" "$SETTINGS_TMP")

echo "[backup] Starting backup for env=${BACKUP_ENV} at ${TIMESTAMP}"
echo "[backup] WASEL_DIR=${WASEL_DIR}  UPLOAD=${UPLOAD}"

# ── 1. Database dump ──────────────────────────────────────────────────────────
echo "[backup] Dumping database (excluding radpostauth data)..."
T0=$SECONDS

# pipefail propagates a failed pg_dump through the pipe; write to tmp then rename.
# gpg symmetric AES-256 provides authenticated encryption (MDC/AEAD): decryption
# fails hard on any tampering, unlike plain CBC modes.  --no-symkey-cache
# prevents the passphrase being stored in the gpg-agent (the throwaway
# GNUPGHOME already ensures no cross-run leakage, but defence-in-depth).
docker compose \
  --env-file "${COMPOSE_ENV_FILE}" \
  -f "${WASEL_DIR}/docker-compose.yml" \
  exec -T postgres \
  nice -n 19 pg_dump -U wasel -Fc --exclude-table-data=radpostauth wasel < /dev/null \
  | gpg --batch --yes --quiet --pinentry-mode loopback \
      --passphrase-file "${BACKUP_KEY_FILE}" \
      --no-symkey-cache \
      --symmetric --cipher-algo AES256 --compress-algo none \
      -o "${DB_TMP}"

mv "$DB_TMP" "$DB_FILE"
DB_SIZE=$(stat -c%s "$DB_FILE" 2>/dev/null || stat -f%z "$DB_FILE")
DB_ELAPSED=$(( SECONDS - T0 ))
echo "[backup] DB dump done: $(( DB_SIZE / 1024 / 1024 )) MB in ${DB_ELAPSED}s"

# ── 2. Settings bundle ────────────────────────────────────────────────────────
echo "[backup] Building settings bundle..."
T0=$SECONDS

# Resolve uploads volume via compose: ask which container is 'backend', then
# read its /app/uploads mount. This avoids false positives from other compose
# stacks on the same box (staging shares the host).
UPLOADS_VOLUME=""
BACKEND_CTR=$(docker compose \
  --env-file "${COMPOSE_ENV_FILE}" \
  -f "${WASEL_DIR}/docker-compose.yml" \
  ps -q backend 2>/dev/null || true)

if [[ -n "$BACKEND_CTR" ]]; then
  UPLOADS_VOLUME=$(docker inspect \
    -f '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Name}}{{end}}{{end}}' \
    "$BACKEND_CTR" 2>/dev/null || true)
fi

UPLOADS_TMPDIR=""
if [[ -z "$UPLOADS_VOLUME" ]]; then
  echo "[backup] WARNING: backend container not running or uploads volume not found — skipping uploads archive" >&2
  WARNINGS=1
else
  echo "[backup] Uploads volume: ${UPLOADS_VOLUME}"

  # Export the uploads volume to a temp dir so it can be bundled as one named
  # file inside the tar archive (backend_uploads.tar.gz).
  # A separate inner archive avoids the multi-stream tar problem: the restore
  # untars ONE outer archive, then untars the inner file into the volume.
  UPLOADS_TMPDIR=$(mktemp -d)
  CLEANUP_FILES+=("$UPLOADS_TMPDIR")
  echo "[backup] Exporting uploads volume..."
  docker run --rm \
    -v "${UPLOADS_VOLUME}:/v:ro" \
    "${ALPINE_IMAGE}" \
    tar -czf - -C /v . \
    > "${UPLOADS_TMPDIR}/backend_uploads.tar.gz"
  echo "[backup] Uploads volume exported: $(( $(stat -c%s "${UPLOADS_TMPDIR}/backend_uploads.tar.gz" 2>/dev/null || stat -f%z "${UPLOADS_TMPDIR}/backend_uploads.tar.gz") / 1024 )) KB"
fi

# Collect paths; warn and skip missing optional ones
BUNDLE_PATHS=()
_add_path() {
  if [[ -e "$1" ]]; then
    BUNDLE_PATHS+=("$1")
  else
    echo "[backup] WARNING: optional path not found, skipping: $1" >&2
  fi
}

# backend/.env is mandatory — it holds ENCRYPTION_KEY for router credentials
if [[ ! -f "${WASEL_DIR}/backend/.env" ]]; then
  echo "[backup] ERROR: ${WASEL_DIR}/backend/.env not found" >&2
  exit 1
fi
BUNDLE_PATHS+=("${WASEL_DIR}/backend/.env")

_add_path "${WASEL_DIR}/backend/secrets"
_add_path "/etc/wireguard"

# /etc/wasel — include individual files; never backup.key or the rclone folder
for f in /etc/wasel/compose.env /etc/wasel/heartbeat.url \
          /etc/wasel/backup-heartbeat.url /etc/wasel/backup.env; do
  [[ -e "$f" ]] && BUNDLE_PATHS+=("$f")
done

# Add the uploads temp dir only if the volume was successfully exported
if [[ -n "$UPLOADS_TMPDIR" ]]; then
  BUNDLE_PATHS+=("${UPLOADS_TMPDIR}/backend_uploads.tar.gz")
fi

# Build ONE tar of everything, encrypt with gpg, rename on success.
# Paths are stored relative to / (no "Removing leading /" noise), and the
# uploads export is stored at the fixed name uploads/backend_uploads.tar.gz.
REL_PATHS=("${BUNDLE_PATHS[@]#/}")
if [[ -n "$UPLOADS_TMPDIR" ]]; then
  UPLOADS_REL="${UPLOADS_TMPDIR#/}"
  tar -C / -czf - --transform "s#^${UPLOADS_REL}/#uploads/#" "${REL_PATHS[@]}" \
    | gpg --batch --yes --quiet --pinentry-mode loopback \
        --passphrase-file "${BACKUP_KEY_FILE}" \
        --no-symkey-cache \
        --symmetric --cipher-algo AES256 --compress-algo none \
        -o "${SETTINGS_TMP}"
else
  tar -C / -czf - "${REL_PATHS[@]}" \
    | gpg --batch --yes --quiet --pinentry-mode loopback \
        --passphrase-file "${BACKUP_KEY_FILE}" \
        --no-symkey-cache \
        --symmetric --cipher-algo AES256 --compress-algo none \
        -o "${SETTINGS_TMP}"
fi

mv "$SETTINGS_TMP" "$SETTINGS_FILE"
SETTINGS_SIZE=$(stat -c%s "$SETTINGS_FILE" 2>/dev/null || stat -f%z "$SETTINGS_FILE")
SETTINGS_ELAPSED=$(( SECONDS - T0 ))
echo "[backup] Settings bundle done: $(( SETTINGS_SIZE / 1024 / 1024 )) MB in ${SETTINGS_ELAPSED}s"

# Temp uploads dir is no longer needed — remove it and rebuild CLEANUP_FILES
# without that entry (avoids leaving an empty element in the array).
if [[ -n "$UPLOADS_TMPDIR" ]]; then
  rm -rf "$UPLOADS_TMPDIR"
  _new_cleanup=()
  for _f in "${CLEANUP_FILES[@]+"${CLEANUP_FILES[@]}"}"; do
    [[ -z "$_f" || "$_f" == "$UPLOADS_TMPDIR" ]] && continue
    _new_cleanup+=("$_f")
  done
  CLEANUP_FILES=("${_new_cleanup[@]+"${_new_cleanup[@]}"}")
fi

# ── 3. Verify DB dump ─────────────────────────────────────────────────────────
echo "[backup] Verifying DB dump (decrypt + pg_restore dry-run)..."
T0=$SECONDS
gpg --batch --quiet --pinentry-mode loopback \
    --passphrase-file "${BACKUP_KEY_FILE}" \
    --no-symkey-cache \
    -d "${DB_FILE}" \
  | docker compose \
      --env-file "${COMPOSE_ENV_FILE}" \
      -f "${WASEL_DIR}/docker-compose.yml" \
      exec -T postgres pg_restore -f /dev/null
VERIFY_ELAPSED=$(( SECONDS - T0 ))
echo "[backup] Verification passed in ${VERIFY_ELAPSED}s"

# Size sanity check against previous *verified* dump (±50%: range [50%, 150%]).
# Only compare against a dump that has a .sha256 file — written after verification.
PREV_DB=""
while IFS= read -r f; do
  if [[ -f "${f}.sha256" ]]; then
    PREV_DB="$f"
    break
  fi
done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'wasel-db-*.dump.gpg' ! -path "$DB_FILE" \
           -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2- || true)

if [[ -n "$PREV_DB" ]]; then
  PREV_SIZE=$(stat -c%s "$PREV_DB" 2>/dev/null || stat -f%z "$PREV_DB")
  LOW=$(( PREV_SIZE / 2 ))
  HIGH=$(( PREV_SIZE * 3 / 2 ))
  if [[ $DB_SIZE -lt $LOW || $DB_SIZE -gt $HIGH ]]; then
    echo "[backup] ERROR: DB dump size ${DB_SIZE} B is outside ±50% of previous ${PREV_SIZE} B" >&2
    exit 1
  fi
  echo "[backup] Size check OK (prev=$(( PREV_SIZE / 1024 / 1024 )) MB, now=$(( DB_SIZE / 1024 / 1024 )) MB)"
else
  echo "[backup] Size check skipped (no previous verified dump found)"
fi

# ── 4. SHA-256 checksums ──────────────────────────────────────────────────────
# The .sha256 detects file corruption and accidental truncation during transfer.
# Integrity against intentional tampering is provided by gpg's authenticated
# encryption (MDC/AEAD); the .sha256 alone is not an integrity guarantee.
sha256sum "$DB_FILE"       > "${DB_FILE}.sha256"
sha256sum "$SETTINGS_FILE" > "${SETTINGS_FILE}.sha256"
echo "[backup] SHA-256 files written"

# ── 5. Upload to Google Drive ─────────────────────────────────────────────────
if [[ "$UPLOAD" == "1" ]]; then
  DRIVE_DAILY="${RCLONE_BASE}/${BACKUP_ENV}/daily"
  DRIVE_WEEKLY="${RCLONE_BASE}/${BACKUP_ENV}/weekly"

  _rclone() {
    # Read-write config mount (rclone refreshes OAuth token in place); data read-only
    docker run --rm \
      -v "${RCLONE_CONFIG_DIR}:/config/rclone" \
      -v "${BACKUP_DIR}:/data:ro" \
      "${RCLONE_IMAGE}" \
      "$@"
  }

  _rclone_rw() {
    # Config only — used for Drive-to-Drive operations (copyto, lsf, deletefile)
    docker run --rm \
      -v "${RCLONE_CONFIG_DIR}:/config/rclone" \
      "${RCLONE_IMAGE}" \
      "$@"
  }

  # Check Drive free space: need at least 2× today's total
  TODAY_TOTAL=$(( DB_SIZE + SETTINGS_SIZE ))
  FREE_BYTES=0
  if FREE_JSON=$(_rclone_rw about --json "${RCLONE_REMOTE}:" 2>/dev/null); then
    FREE_BYTES=$(printf '%s' "$FREE_JSON" \
      | grep -oE '"free": *[0-9]+' | grep -oE '[0-9]+$' || echo 0)
  fi
  if [[ "${FREE_BYTES:-0}" -gt 0 ]]; then
    MIN_FREE=$(( TODAY_TOTAL * 2 ))
    if [[ $FREE_BYTES -lt $MIN_FREE ]]; then
      echo "[backup] ERROR: Drive free ${FREE_BYTES} B < 2× today's size ${MIN_FREE} B" >&2
      exit 1
    fi
    echo "[backup] Drive free: $(( FREE_BYTES / 1024 / 1024 )) MB, need $(( MIN_FREE / 1024 / 1024 )) MB — OK"
  else
    echo "[backup] WARNING: could not determine Drive free space, proceeding" >&2
  fi

  # Upload today's four files (rclone --include filters are OR-ed)
  echo "[backup] Uploading to ${RCLONE_REMOTE}:${DRIVE_DAILY}/"
  T0=$SECONDS
  _rclone copy /data/ "${RCLONE_REMOTE}:${DRIVE_DAILY}/" \
    --include "wasel-db-${DATE}.dump.gpg" \
    --include "wasel-db-${DATE}.dump.gpg.sha256" \
    --include "wasel-settings-${DATE}.tar.gpg" \
    --include "wasel-settings-${DATE}.tar.gpg.sha256" \
    --stats-one-line --stats 30s
  UPLOAD_ELAPSED=$(( SECONDS - T0 ))
  echo "[backup] Upload done in ${UPLOAD_ELAPSED}s"

  # Weekly: server-side copy when no file in weekly/ is <7 days old
  NEED_WEEKLY=1
  WEEKLY_LATEST=$(_rclone_rw lsjson "${RCLONE_REMOTE}:${DRIVE_WEEKLY}/" 2>/dev/null \
    | grep -o '"ModTime":"[^"]*"' | sort -r | head -1 \
    | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}' || true)

  if [[ -n "$WEEKLY_LATEST" ]]; then
    LATEST_EPOCH=$(date -d "$WEEKLY_LATEST" +%s 2>/dev/null \
      || date -j -f "%Y-%m-%d" "$WEEKLY_LATEST" +%s 2>/dev/null || echo 0)
    NOW_EPOCH=$(date -u +%s)
    AGE_DAYS=$(( (NOW_EPOCH - LATEST_EPOCH) / 86400 ))
    if [[ $AGE_DAYS -lt 7 ]]; then
      NEED_WEEKLY=0
      echo "[backup] Weekly copy up to date (${AGE_DAYS}d old)"
    fi
  fi

  if [[ $NEED_WEEKLY -eq 1 ]]; then
    echo "[backup] Writing weekly slot: ${RCLONE_REMOTE}:${DRIVE_WEEKLY}/"
    for fname in \
      "wasel-db-${DATE}.dump.gpg" \
      "wasel-db-${DATE}.dump.gpg.sha256" \
      "wasel-settings-${DATE}.tar.gpg" \
      "wasel-settings-${DATE}.tar.gpg.sha256"
    do
      _rclone_rw copyto \
        "${RCLONE_REMOTE}:${DRIVE_DAILY}/${fname}" \
        "${RCLONE_REMOTE}:${DRIVE_WEEKLY}/${fname}"
    done
    echo "[backup] Weekly copy done"
  fi

  # ── Retention: Drive daily + weekly ────────────────────────────────────────
  # _prune_drive_prefix <remote_path> <keep_N> <name_prefix>
  # Lists files matching prefix (excluding .sha256), sorts newest-first,
  # deletes both the file and its .sha256 for entries beyond keep_N.
  _prune_drive_prefix() {
    local remote_path="$1" keep="$2" prefix="$3"
    local all_files count fname
    all_files=$(_rclone_rw lsf "${RCLONE_REMOTE}:${remote_path}/" 2>/dev/null \
      | grep "^${prefix}" | grep -v '\.sha256$' | sort -r || true)
    count=0
    while IFS= read -r fname; do
      [[ -z "$fname" ]] && continue
      count=$(( count + 1 ))
      if [[ $count -gt $keep ]]; then
        echo "[backup]   Pruning ${remote_path}/${fname}"
        _rclone_rw deletefile --drive-use-trash=false \
          "${RCLONE_REMOTE}:${remote_path}/${fname}" || true
        _rclone_rw deletefile --drive-use-trash=false \
          "${RCLONE_REMOTE}:${remote_path}/${fname}.sha256" 2>/dev/null || true
      fi
    done <<< "$all_files"
  }

  echo "[backup] Pruning Drive daily/ (keep ${DRIVE_DAILY_KEEP})..."
  _prune_drive_prefix "$DRIVE_DAILY" "$DRIVE_DAILY_KEEP" "wasel-db-"
  _prune_drive_prefix "$DRIVE_DAILY" "$DRIVE_DAILY_KEEP" "wasel-settings-"

  echo "[backup] Pruning Drive weekly/ (keep ${DRIVE_WEEKLY_KEEP})..."
  _prune_drive_prefix "$DRIVE_WEEKLY" "$DRIVE_WEEKLY_KEEP" "wasel-db-"
  _prune_drive_prefix "$DRIVE_WEEKLY" "$DRIVE_WEEKLY_KEEP" "wasel-settings-"

else
  echo "[backup] UPLOAD=0 — skipping Drive upload and Drive retention"
fi

# ── 6. Local retention (keep LOCAL_RETAIN_DAYS days) ─────────────────────────
echo "[backup] Pruning local backups older than ${LOCAL_RETAIN_DAYS} days..."
find "$BACKUP_DIR" -maxdepth 1 \
  \( -name "wasel-db-*.dump.gpg" -o -name "wasel-settings-*.tar.gpg" \
     -o -name "wasel-db-*.dump.gpg.sha256" -o -name "wasel-settings-*.tar.gpg.sha256" \) \
  ! -newer "$DB_FILE" \
  -mtime "+${LOCAL_RETAIN_DAYS}" \
  -print -delete
echo "[backup] Local prune done"

# ── Done ──────────────────────────────────────────────────────────────────────
TOTAL_ELAPSED=$SECONDS
echo "[backup] All done in ${TOTAL_ELAPSED}s. DB=$(( DB_SIZE / 1024 / 1024 )) MB  Settings=$(( SETTINGS_SIZE / 1024 / 1024 )) MB"

# Exit 3 if there were non-fatal warnings (e.g. uploads volume not found).
# systemd marks the unit failed; _on_exit fires the heartbeat /fail endpoint.
# The DB backup has already been uploaded successfully at this point.
if [[ $WARNINGS -ne 0 ]]; then
  echo "[backup] Completed with warnings (exit 3) — review log above" >&2
  exit 3
fi

_hc_ping ""
