# Prod deploy runbook — 2026-07-19 promotion (`dev` → `main`)

> **This deploy MUST be sequenced — do NOT use the one-shot `docker compose up -d --build`.**
> The rebuilt FreeRADIUS image no longer registers the `Max-Total-Octets` attribute; until migration `038` purges the leftover `radcheck`/`radgroupcheck` rows, a live rebuilt FR rejects **every data-limited voucher** (`sql: Failed to create the pair: Unknown name "Max-Total-Octets"`). Recreating **backend first** (migrations through `038` committed), **then** FreeRADIUS, closes the window. This was the one confirmed blocker (3/3 adversarial verification) of the 2026-07-19 merge-readiness review.

Scope of this promotion: ~50 commits, 14 new migrations (`025`→`038`), FreeRADIUS config changes baked into the image (Post-Auth-Type REJECT `Reply-Message` block; `max_total_octets` sqlcounter removed), backend + admin + landing rebuilds.

Target: `wa-sel.com`, repo `/opt/wasel`, branch `main`, env `/etc/wasel/compose.env`. Every compose command needs `--env-file /etc/wasel/compose.env` (or rely on the `/opt/wasel/.env` copy).

---

## Phase 0 — Pre-deploy safety gates (do NOT skip)

**0.1** Announce a short low-traffic window. Migrations `030`+`036` touch `radacct` indexes; admin users get one forced re-login (HttpOnly-cookie change — expected).

**0.2 Verified DB backup** — the ONLY schema rollback (runner has no down-migrations; `038` DELETEs rows):
```bash
ls -l /etc/wasel/backup.key || echo "NO KEY — use the plaintext fallback"
sudo mkdir -p /opt/wasel-backups
# Encrypted (preferred):
docker compose -f /opt/wasel/docker-compose.yml --env-file /etc/wasel/compose.env exec -T postgres \
  pg_dump -U wasel wasel | gzip \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass file:/etc/wasel/backup.key \
  > /opt/wasel-backups/pre-promote-$(date +%F-%H%M).sql.gz.enc
# Fallback (no key): ... exec -T postgres pg_dump -U wasel wasel | gzip > /opt/wasel-backups/pre-promote-$(date +%F-%H%M).sql.gz
ls -lh /opt/wasel-backups/pre-promote-*   # VERIFY non-trivial size before proceeding
```

**0.3** Record the current prod commit for code rollback (no retained image tags exist — see Phase 5):
```bash
git -C /opt/wasel rev-parse HEAD   # write this SHA down
```

**0.4 Pre-create the new indexes CONCURRENTLY** (belt-and-suspenders vs the 30s `statement_timeout` on the migration runner; all five are `IF NOT EXISTS`, so migrations `030`/`036` then no-op instantly). Each must run as its own `psql -c` (CONCURRENTLY can't run in a txn):
```bash
docker compose --env-file /etc/wasel/compose.env exec -T postgres psql -U wasel -d wasel -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radacct_open_acctupdatetime ON radacct (acctupdatetime) WHERE acctstoptime IS NULL;"
docker compose --env-file /etc/wasel/compose.env exec -T postgres psql -U wasel -d wasel -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radacct_nasip_keyset ON radacct (nasipaddress, acctstarttime DESC, radacctid DESC);"
docker compose --env-file /etc/wasel/compose.env exec -T postgres psql -U wasel -d wasel -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_voucher_meta_router_keyset ON voucher_meta (router_id, created_at DESC, id DESC);"
docker compose --env-file /etc/wasel/compose.env exec -T postgres psql -U wasel -d wasel -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_keyset ON notifications (user_id, created_at DESC, id DESC);"
docker compose --env-file /etc/wasel/compose.env exec -T postgres psql -U wasel -d wasel -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_messages_user_keyset ON support_messages (user_id, created_at DESC, id DESC);"
# If any index shows INVALID afterwards (interrupted build): DROP INDEX CONCURRENTLY and retry before deploying.
```

**0.5 Env checks** (`backend/.env` — none newly boot-mandatory, all operational):
- `SMTP_*` → the REAL relay (Resend), never MailHog/`127.0.0.1` (misconfig silently logs `email_log.status='failed'`).
- `PUBLIC_BASE_URL=https://api.wa-sel.com` (new this cycle; default is localhost).
- `API_ORIGIN`: leave unset — compose default is `https://api.wa-sel.com` (correct for prod).
- `VITE_ADMIN_TIMEZONE`: only if operator TZ ≠ Africa/Khartoum.
- Cloudflare: confirm `api.wa-sel.com` is **DNS-only (grey cloud)**. `trust proxy` is now pinned to 1 hop (`42a00fa`); if the API origin is orange-cloud proxied, `req.ip` becomes the CF edge IP — not spoofable, but rate-limit buckets coarsen. If you ever proxy it, adjust the hop count / key on `CF-Connecting-IP` deliberately.
- Firebase push (optional): JSON at `/opt/wasel/backend/secrets/`, `chown 101:102 backend/secrets && chmod 700 backend/secrets && chmod 400 backend/secrets/*.json`, set `FIREBASE_SERVICE_ACCOUNT_PATH=/app/secrets/firebase-service-account.json`. Root-owned dir ⇒ misleading `MODULE_NOT_FOUND` (non-fatal, push stays off).

**0.6 UFW rule for hotspot-template fetch** (NEW requirement this cycle; without it the Phase-4b re-apply reports `failed`):
```bash
sudo ufw status | grep 3000 || sudo ufw allow from 10.10.0.0/16 to any port 3000 proto tcp comment 'Hotspot template fetch over WG'
```

## Phase 1 — Promote (local machine)

```bash
git push origin dev
git checkout main && git merge dev --ff-only && git push origin main && git checkout dev
```
If `--ff-only` fails: branches diverged — stop, resolve on `dev`, re-run staging, retry.

## Phase 2 — Pull + build (build only, recreate NOTHING yet)

```bash
cd /opt/wasel
git pull origin main
docker compose --env-file /etc/wasel/compose.env build backend admin freeradius landing
```

**2.1 Validate the freshly-built FreeRADIUS config BEFORE it replaces the running FR** (entrypoint execs `freeradius -f` with no validation; a syntax error in the new REJECT unlang = crash-looping FR = total auth outage). Throwaway check — does not touch the live container:
```bash
docker compose --env-file /etc/wasel/compose.env run --rm --no-deps --entrypoint sh freeradius -c \
  'envsubst "$RADIUS_DB_HOST $RADIUS_DB_PORT $RADIUS_DB_USER $RADIUS_DB_PASS $RADIUS_DB_NAME" < /etc/freeradius/sql.template > /etc/freeradius/mods-enabled/sql && freeradius -XC'
```
**REQUIRE** the tail to print `Configuration appears to be OK`. If it errors: **ABORT — do not recreate FR.**

## Phase 3 — Recreate, ORDERED (backend FIRST — this is the blocker fix)

```bash
# 3.1 Backend first — runs migrations 025→038 on boot, incl. 038 purging the dead Max-Total-Octets rows:
docker compose --env-file /etc/wasel/compose.env up -d backend
docker compose --env-file /etc/wasel/compose.env logs -f backend
# WATCH FOR: "Migration executed successfully: 025_..." … "038_...", "All 14 migration(s) completed successfully",
#            then "Server running on port 3000".
# If it exits/loops on a migration: STOP — see Phase 5. Do NOT proceed to FR.

# 3.2 Only after backend is healthy + migrations done:
docker compose --env-file /etc/wasel/compose.env up -d freeradius admin landing
docker compose --env-file /etc/wasel/compose.env ps    # all healthy?
```

Belt-and-suspenders (optional, closes the window even if the backend stalls mid-migrations): run migration `038`'s purge manually right before 3.2 — it is idempotent, so `038` re-running later is a no-op:
```bash
docker compose --env-file /etc/wasel/compose.env exec -T postgres psql -U wasel -d wasel -c "DELETE FROM radcheck WHERE attribute IN ('Max-Total-Octets','Max-Total-Octets-Gigawords'); DELETE FROM radgroupcheck WHERE attribute IN ('Max-Total-Octets','Max-Total-Octets-Gigawords');"
```

## Phase 4 — Post-deploy verification

1. `curl -fsS http://localhost:3000/api/v1/health` → `{"status":"ok"}`
2. Migrations applied: `... exec -T postgres psql -U wasel -d wasel -c "SELECT filename FROM schema_migrations WHERE filename >= '025' ORDER BY filename;"` (expect all 14)
3. FR up, no instantiation errors: `docker compose logs freeradius | tail -30`; then a real voucher login E2E on a prod router (device → voucher → internet), confirm `access-accept` in FR logs + fresh open `radacct` row.
4. **Data-voucher regression check:** a DATA-limited voucher authenticates (the `038` failure mode was `Login incorrect / Unknown name "Max-Total-Octets"`). If any data voucher rejects: confirm `038` ran (step 2) and FR was recreated AFTER it.
5. Time-voucher regression: still disconnects at `Session-Timeout`.

## Phase 4b — Post-deploy manual ops

- **Re-apply the hotspot design on EVERY onboarded prod router** (`PUT /routers/:id/hotspot-template` or admin "reprovision"). Required — interim-accounting/mac-cookie/stale-session, white-page fix, and real reject-reason pages only reach a router on re-apply. Verify per router: `/ip hotspot profile` shows `radius-accounting`/`radius-interim-update`/`login-by`, and the captive page renders.
- **One-time API resave of any DATA-capped group profiles** (migration `038` note) so they regain the `Mikrotik-Total-Limit` reply — `038` does not backfill profiles.
- Admin users: one forced re-login — expected, not a defect.
- Landing (only if going live tonight): replace placeholder WhatsApp/APK links in `landing/src/config.ts` (still `wa.me/2499XXXXXXX` / `#`), DNS A records `wa-sel.com`+`www`, `sudo certbot --nginx -d wa-sel.com -d www.wa-sel.com`.

## Phase 5 — Rollback reality (git + DB-restore only; NO image-tag rollback exists)

Compose builds locally and FR overwrites the fixed tag `wasel-freeradius:3.2.4` on every build; CI pushes nothing. So:
- **Backend crash-loops on a migration:** each migration is atomic — the failing one rolled back, earlier ones committed (DB partially migrated). Read the failing filename from the logs. Fix-forward if trivial (e.g. finish the 0.4 concurrent index, restart backend); otherwise restore the 0.2 backup AND `git checkout <0.3 SHA>` + rebuild.
- **FR fails to start:** `git checkout <0.3 SHA> -- freeradius/` then rebuild+up freeradius. (Should not happen if 2.1 passed.)
- **Full code rollback:** prod `git checkout <0.3 SHA> && docker compose ... up -d --build`. Applied migrations are NOT undone — schema rollback = restore the 0.2 backup.

---

## Deferred (post-deploy follow-up batches, from the 2026-07-19 readiness review)

- **Batch 1 — correctness:** CODE-1/2 (RouterOS camelCase keys → zeroed metrics/false-degraded), CODE-3 (sales report `used`), SQL-2 (quota decrement by real rowCount, incl. new single-delete path), INPUT-3, PAY-1 (status-guarded payment UPDATE).
- **Batch 2 — DoS/robustness:** ASYNC-1 (`noOverlap` on validity/usage cron jobs — the new data-usage job already has a guard), PAY-3, CODE-4, INPUT-2/6/7/8, INPUT-4; check the new CSV exports against INPUT-5.
- **Batch 3 — privacy/tenancy/auth:** IDOR-2 (authenticated receipt route), IDOR-1, AUTH-3 (email case), remaining Lows.
- **Optional hardening:** `depends_on: backend: {condition: service_healthy}` on the freeradius compose service would make the Phase-3 ordering structural — trade-off: after a host reboot FR won't start until backend is healthy, coupling AAA availability to the backend. Decide deliberately, not tonight.
- **Small code follow-ups from review:** `ORDER BY ra.acctstarttime` before `LIMIT 200` in `dataUsageCoaDisconnect`; staging E2E case for an exact-4 GB voucher (low word = 0 — verify RouterOS doesn't treat 0 as unlimited); consider a `radgroupreply` backfill migration for data-capped group profiles; systemd unit `WorkingDirectory` (`/root/wasel` vs `/opt/wasel`) on prod; add `RUN freeradius -XC` to `freeradius/Dockerfile` so a future config error fails the build instead of the fleet; drop the `AT TIME ZONE 'UTC'` from the reject-reason SQL (no-op under the UTC session, over-corrects under a non-UTC one — cosmetic either way).
