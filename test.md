# Wasel — Testing Guide

Comprehensive test plan covering local verification, post-deploy VPS smoke tests, runtime resilience checks (the R0 hardening fixes), mobile device tests, cross-stack integration, and security spot-checks. Use the **Quick Pre-Deploy Gate** before every push to prod; drop into deeper sections when a gate fails.

---

## 0. Quick Pre-Deploy Gate

Run everything in this section from the repo root on a developer machine. If any step fails, do **not** push.

```bash
# Backend
( cd backend && npm test && npx tsc --noEmit )

# Mobile
( cd mobile && flutter test && flutter analyze )

# Release APK (signed)
( cd mobile && flutter build apk --release )
# → expect: build/app/outputs/flutter-apk/app-release.apk exists, ~60 MB

# Compose syntax
POSTGRES_PASSWORD=dummy REDIS_PASSWORD=dummy docker compose config >/dev/null
```

Expected: 126/126 vitest pass, tsc clean, 94/94 flutter tests pass, flutter analyze 0 err/0 warn, APK produced, compose config exits 0.

---

## 1. Local Tests (developer machine)

### 1.1 Backend

| # | Command | Expected |
|---|---------|----------|
| 1.1.1 | `cd backend && npm test` | `Test Files 10 passed (10)`, `Tests 126 passed (126)` |
| 1.1.2 | `cd backend && npx tsc --noEmit` | no output, exit 0 |
| 1.1.3 | `cd backend && npm run lint` (if present) | 0 errors |
| 1.1.4 | Start a Postgres + Redis + backend locally and hit `GET /api/v1/health` | 200 + `{"status":"ok",...}` |

### 1.2 Mobile

| # | Command | Expected |
|---|---------|----------|
| 1.2.1 | `cd mobile && flutter test` | `All tests passed!` — 94 tests |
| 1.2.2 | `cd mobile && flutter analyze` | `No issues found!` (info-level hints OK) |
| 1.2.3 | `cd mobile && flutter build apk --release` | signed APK at `build/app/outputs/flutter-apk/app-release.apk` |
| 1.2.4 | `keytool -list -keystore mobile/android/wasel-release.jks -storepass <pwd>` | 1 entry, alias `wasel` |

### 1.3 Infra syntax

| # | Command | Expected |
|---|---------|----------|
| 1.3.1 | `POSTGRES_PASSWORD=x REDIS_PASSWORD=y docker compose config` | valid YAML, anchors expanded, every service has `logging:` and `healthcheck:` blocks |
| 1.3.2 | `docker compose config \| grep 'max-size'` | appears 6× (one per service) |
| 1.3.3 | `git diff origin/main --stat` | only the files you intended to change |

---

## 2. Post-Deploy Smoke Tests (on VPS, ~5 min)

After `git pull && docker compose build && docker compose up -d`:

| # | Check | Expected |
|---|-------|----------|
| 2.1 | `docker compose ps` | all 6 services show `healthy` within 60 s (wireguard, postgres, redis, backend, freeradius, admin) |
| 2.2 | `docker compose logs backend \| grep -i 'migration'` | `All migrations completed successfully` (or equivalent); no errors |
| 2.3 | `curl -sS https://api.wa-sel.com/api/v1/health` | 200 + `{"status":"ok"}` |
| 2.4 | `docker compose logs backend \| grep -i 'error\\|unhandled'` | empty or only expected 4xx |
| 2.5 | `docker compose exec postgres pg_isready -U wasel` | `accepting connections` |
| 2.6 | `docker compose exec redis redis-cli -a "$REDIS_PASSWORD" PING` | `PONG` |
| 2.7 | `docker compose exec freeradius radtest test test 127.0.0.1 0 <shared-secret>` | `Access-Reject` (expected — user "test" doesn't exist; confirms FreeRADIUS is reachable) |
| 2.8 | `docker compose exec wireguard wg show wg0` | interface up, peer list as expected |
| 2.9 | `df -h /var/lib/docker` | plenty of free disk (<70% used) |

---

## 3. Runtime Resilience Tests (R0 fix verification)

These are chaos-style tests that confirm the R0 hardening actually works. Run them on a **staging** VPS, not prod. Each one takes <5 min.

### 3.1 R0-1 — Email timeout

Simulates a hung SMTP server.

```bash
# On the VPS, drop outbound 465 for 60 seconds:
sudo iptables -A OUTPUT -p tcp --dport 465 -j DROP
# Trigger a password reset (from another machine or the mobile app):
curl -X POST https://api.wa-sel.com/api/v1/auth/forgot-password \
     -H 'content-type: application/json' \
     -d '{"email":"you@example.com"}' -w '\nHTTP %{http_code}  %{time_total}s\n'
# Undo:
sudo iptables -D OUTPUT -p tcp --dport 465 -j DROP
```

**Expected:** response returns in ≤ 6 s (not 60+ s). The email fails internally but the API does not hang.

### 3.2 R0-2 — DB statement timeout

Simulates a stuck query.

```bash
# In one terminal on the VPS:
docker compose exec postgres psql -U wasel -d wasel -c "SELECT pg_sleep(60);"
# In another terminal, immediately hit an endpoint that hits the DB:
curl -sS https://api.wa-sel.com/api/v1/dashboard -H "Authorization: Bearer $TOKEN"
```

**Expected:** pg_sleep is killed at 30 s with `ERROR: canceling statement due to statement timeout`. The `/dashboard` request completes normally (doesn't wait behind it) because the pool has other connections.

### 3.3 R0-3 — Redis healthcheck authenticates

Force Redis into a bad-auth state:

```bash
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" CONFIG SET requirepass wrongpass
sleep 30
docker compose ps redis
# Restore:
docker compose restart redis
```

**Expected:** after ~30 s Redis is marked `unhealthy` in `docker compose ps`. (Before R0-3 it would stay "healthy" despite auth being broken.)

### 3.4 R0-4 — FreeRADIUS reconnect after Postgres restart

```bash
docker compose restart postgres
sleep 5
docker compose exec freeradius radtest test test 127.0.0.1 0 <shared-secret>
```

**Expected:** `Access-Reject` (fast, within 1-2 s). **Bad:** timeout or request hangs — indicates FreeRADIUS is not reconnecting.

### 3.5 R0-5 — Docker log rotation

```bash
docker inspect $(docker compose ps -q backend) \
  --format '{{json .HostConfig.LogConfig}}' | jq .
```

**Expected output:**

```json
{ "Type": "json-file", "Config": { "max-file": "3", "max-size": "10m" } }
```

Repeat for every other service (wireguard, postgres, redis, freeradius, admin) — all six should show the same config.

---

## 4. Mobile Device Tests

Install the release APK on a real Android device (`adb install app-release.apk`).

| # | Action | Expected |
|---|--------|----------|
| 4.1 | Tap the launcher icon | label reads **Wasel** (capitalized, not `wasel`) |
| 4.2 | Open the app | no splash crash, login screen loads |
| 4.3 | Log in with a valid account | succeeds — confirms cert pinning accepts the production cert |
| 4.4 | Tamper check: use a MITM tool (Charles Proxy, mitmproxy) | login fails — confirms cert pinning rejects non-matching cert |
| 4.5 | Dashboard tab | data loads within 2 s |
| 4.6 | Routers tab | list of routers loads (not blank / not stub) |
| 4.7 | Vouchers tab | list + create flow works |
| 4.8 | Settings tab | subscription + logout work |
| 4.9 | Switch device to Arabic locale, reopen app | app name shown as **واصل**, UI strings in Arabic |
| 4.10 | Log out + log in again | refresh-token rotation works (no re-prompt for password within session) |
| 4.11 | Toggle airplane mode + back on | app recovers, data reloads |

---

## 5. Cross-Stack Integration Smoke (manual end-to-end)

Fresh account; tests the voucher-to-Wi-Fi round-trip.

| # | Action | Expected |
|---|--------|----------|
| 5.1 | Create a router via the mobile app | router appears; RouterOS setup script shown; WireGuard peer created on VPS (`wg show wg0` lists a new peer) |
| 5.2 | Configure the Mikrotik per the setup script | router's WireGuard tunnel comes up; router status flips to **online** within 2 min |
| 5.3 | Create a profile (e.g., 1-day / 10 Mbps) | profile appears; `radgroupreply` rows written for the group |
| 5.4 | Create a voucher against that profile | voucher code appears; `radcheck` row inserted with the voucher code |
| 5.5 | Connect a device to the router's hotspot SSID and enter the voucher code | authentication succeeds; `radacct` row starts |
| 5.6 | Observe sessions in the mobile app (Router detail → Sessions) | active session shown |
| 5.7 | Disconnect the session from the app | CoA disconnect sent; `radacct.acctstoptime` populated |
| 5.8 | Disable the voucher | re-auth attempt is rejected (`Auth-Type := Reject`) |
| 5.9 | Delete the voucher | `radcheck` row removed; any active session is CoA-disconnected |

---

## 6. Security Spot-Checks

| # | Action | Expected |
|---|--------|----------|
| 6.1 | POST `/api/v1/auth/login` 11× in 60 s from one IP with wrong creds | 11th request returns **429** (rate-limited) |
| 6.2 | Call an admin endpoint with a non-admin JWT | **403 Forbidden** |
| 6.3 | Start the backend with `DB_PASSWORD` unset | startup fails loudly with `DB_PASSWORD must be set in .env` (before the R0 fix, it would have silently tried `changeme`) |
| 6.4 | Make a request from a browser with an `Origin` not in `CORS_ORIGIN` | CORS pre-flight rejected |
| 6.5 | Upload a non-image file as a payment receipt | rejected at magic-byte check |
| 6.6 | Try to log in 6× with wrong OTP | lockout (OTP rate-limit) engages |
| 6.7 | `grep -rnE '(password\|secret\|token).*=.*["'\'']\\w' backend/src` | no hardcoded secrets — only references to `config.*` or env vars |
| 6.8 | `grep -nE 'TODO_PRIMARY_PIN\|TODO_BACKUP_PIN' mobile/lib` | no matches |

---

## 7. Rollback Procedure (if a test fails on prod)

```bash
# On the VPS:
cd /root/wasel
git log --oneline -10                          # find last known good commit
git reset --hard <good-commit>                 # or: git revert <bad-commit>
docker compose build
docker compose up -d
```

If the Postgres schema has advanced (new migration), rollback is **not** safe without a restore from backup — run the documented restore from `deploy.md` § "Backups" before `git reset`.

---

## 8. Frequency

| Section | When to run |
|---------|-------------|
| §0 Gate | before every `git push origin main` |
| §1 Local | on every PR, via CI (`.github/workflows/backend.yml`, `mobile.yml`) |
| §2 VPS smoke | after every deploy |
| §3 R0 resilience | once before first launch; quarterly thereafter (or after any infra change) |
| §4 Device | before every release APK upload |
| §5 Integration | before launch, then after any router / RADIUS / WireGuard code change |
| §6 Security | before launch, then quarterly |
| §7 Rollback | drill once on staging before launch so everyone knows the steps |

---

## References

- `deploy.md` — full VPS build-out
- `RUNBOOKS.md` — secret rotation, incident playbooks
- `TASKS.md` — P1/P2 items not yet tested (load tests, voucher→RADIUS integration)
- Plan file (local): `~/.claude/plans/user-mult-agent-check-parallel-conway.md` — audit history and R0 background
