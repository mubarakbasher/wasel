# Wasel Operational Runbooks

Operator-only procedures. Everything here requires production access.

> **Crash / outage / "what happened?"** → see [`OBSERVABILITY.md`](./OBSERVABILITY.md) — alert setup (Sentry, Uptime Kuma, WhatsApp) and the step-by-step incident runbook.

## 1. Secret rotation + git history purge (URGENT — first-time)

The original `docker-compose.yml` contained plaintext Postgres and Redis passwords and was committed to git (visible since commit `e1b31e9`). The file has since been refactored to read from a compose env-file, but the old values are still in git history. Until rotated, any clone/fork/GitHub cache exposes those credentials.

### Step 1 — Schedule a maintenance window (10–15 min expected downtime)

Backups first:

```bash
# On the VPS, full repo + backups snapshot
cd /opt/wasel
tar czf ~/wasel-presnapshot-$(date +%F).tgz .git docker-compose.yml backend/.env
# Copy off-host
scp ~/wasel-presnapshot-*.tgz <backup-host>:/secure/wasel/
```

### Step 2 — Generate new secrets on the VPS

```bash
NEW_PG=$(openssl rand -hex 32)
NEW_REDIS=$(openssl rand -hex 32)
echo "new PG: $NEW_PG"
echo "new REDIS: $NEW_REDIS"
```

### Step 3 — Write the compose env-file (out of repo)

```bash
sudo install -d -m 0700 /etc/wasel
sudo tee /etc/wasel/compose.env >/dev/null <<EOF
POSTGRES_PASSWORD=$NEW_PG
REDIS_PASSWORD=$NEW_REDIS
EOF
sudo chmod 0600 /etc/wasel/compose.env
```

### Step 4 — Apply the new passwords to running services

```bash
cd /opt/wasel

# Change Postgres user password
docker compose exec -T postgres psql -U wasel -c "ALTER USER wasel WITH PASSWORD '$NEW_PG';"

# Change Redis requirepass (persistent on container restart below)
docker compose exec -T redis redis-cli -a "$OLD_REDIS" CONFIG SET requirepass "$NEW_REDIS"

# Update backend/.env so the app can still connect
sudo sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=$NEW_PG|" backend/.env
sudo sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$NEW_REDIS|" backend/.env

# Restart with new compose env-file
docker compose --env-file /etc/wasel/compose.env down
docker compose --env-file /etc/wasel/compose.env up -d
```

### Step 5 — Also rotate (precautionary)

These were never in git but may have been on dev machines / backups. Rotate them if you suspect any exposure; otherwise defer.

| Secret | How to rotate |
|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `openssl rand -hex 32`, update `backend/.env`, restart backend. **All users are logged out** (existing tokens become invalid). |
| `SMTP_PASS` (Resend API key) | Rotate in Resend dashboard, paste into `backend/.env`, restart backend. |
| `WG_SERVER_PRIVATE_KEY` | Generate new key + new public key, update `/etc/wireguard/wg0.conf`, **re-issue config for every router** (they must be reconfigured). Heavy; only if compromise is suspected. |
| `ENCRYPTION_KEY` | Rotating **breaks all encrypted DB columns** (`routers.api_pass_enc`, `routers.radius_secret_enc`, `routers.wg_preshared_key_enc`). You must run a one-shot migration that decrypts with the old key and re-encrypts with the new key inside a single transaction. Only do this if key compromise is suspected. |

### Step 6 — Purge the old secrets from git history

Do this on a **fresh clone** so there's no risk of stale state.

```bash
# Local workstation
pip install git-filter-repo
git clone <your-repo-url> wasel-purge && cd wasel-purge

# Scrub the two known secrets from every revision of every file
git filter-repo --replace-text <(cat <<'EOF'
53094ff06b673713c6392c1573f2ef2fc35fcb6563a55dd2d9eca5ee52e3ec8d==>REDACTED_PG_PASSWORD
fb456714f3a5df62538fbb1ef88381111af9fb3c597e431a1d461899960d4114==>REDACTED_REDIS_PASSWORD
EOF
)

# Verify no matches remain
git log --all -p | grep -E "53094ff06b|fb456714f3" && echo "STILL PRESENT — abort" || echo "clean"

# Force-push (DESTRUCTIVE — coordinate with anyone else with a clone)
git push --force --all origin
git push --force --tags origin
```

**After force-push:**
- Everyone else with a clone must delete it and `git clone` fresh.
- GitHub caches old commit SHAs for ~90 days and serves them via direct URL. For faster scrub: open a support ticket with GitHub to expire the cache, **or** delete the repository and recreate it (nuclear option — loses issues/PRs).

### Step 7 — Audit

```bash
git log --all -p -- docker-compose.yml \
  | grep -E "POSTGRES_PASSWORD|requirepass" \
  | grep -v '\${'
# expected: no output
```

---

## 2. Disaster recovery from backup

Assumes daily encrypted `pg_dump` backups exist (see deploy.md).

```bash
# On a fresh VPS with docker compose installed
cd /opt/wasel
# Restore compose env
sudo mkdir -p /etc/wasel
sudo cp <backup>/compose.env /etc/wasel/compose.env
sudo chmod 0600 /etc/wasel/compose.env

# Start Postgres + Redis
docker compose --env-file /etc/wasel/compose.env up -d postgres redis

# Decrypt + restore
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/etc/wasel/backup.key \
  -in <backup>/wasel-<date>.sql.gz.enc \
  | gunzip \
  | docker compose exec -T postgres psql -U wasel -d wasel

# Restore WireGuard config
sudo cp <backup>/wg0.conf /etc/wireguard/wg0.conf

# Start everything
docker compose --env-file /etc/wasel/compose.env up -d
```

RTO target: 2 hours. RPO: 24 hours (daily backup cadence).

## 3. Incident log

### 2026-09-10 12:39 UTC — prod backend crash-restart (uncaught RouterOS socket timeout)

- **Impact:** `wasel-backend-1` exited with code 1 and was auto-restarted by Docker (`restart: unless-stopped`) in ~5 s. API unavailable for those seconds; every open RouterOS call and in-flight request failed. Host did **not** reboot (uptime 128 d); no OOM. Container `RestartCount` reached 5 — the earlier four restarts are outside retained logs and almost certainly the same bug.
- **Trigger:** a fleet-wide WireGuard flap at 12:39:09 (dozens of `Router status changed offline→online`, 77 RouterOS timeout errors that day) — the known recurring Hostinger path black-hole.
- **Root cause:** `connectToRouter()` (`backend/src/services/routerOs.service.ts`) never attached an `'error'` listener to the `RouterOSClient`. After login, `node-routeros` re-routes socket `timeout`/`error` to `emit('error')` on the client instead of rejecting the connect promise. With zero listeners Node throws synchronously inside the socket timer callback → not catchable by callers → `process.on('uncaughtException')` in `server.ts` → `exit(1)`. Log signature: `Uncaught exception — exiting` / `RosException: Timed out after 30 seconds` at `node-routeros/dist/connector/Connector.js:187`.
- **Fix (on `dev`):** `client.on('error', …)` attached before `connect()` (logs a warn + counts a circuit-breaker failure); abandoned retry clients are now `disconnect()`ed; regression test `backend/src/tests/services/routerOs.connect.test.ts`.
- **How to triage a repeat:** `docker inspect --format '{{.RestartCount}} {{.State.OOMKilled}} {{.State.FinishedAt}}' wasel-backend-1`, then `docker logs --since <t-2m> --until <t> wasel-backend-1 | grep -E 'Uncaught|Unhandled|received, shutting down'`.
- **Side note (not the cause):** Ubuntu `unattended-upgrades` runs daily ~06:00 UTC on prod. On 2026-09-11 06:02 it upgraded libc6 + python3.12 and **restarted containerd**; dockerd reconnected and containers kept running.
