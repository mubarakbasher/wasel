# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Wasel** is a Mikrotik Hotspot Voucher Manager — a mobile application (iOS & Android) that enables hotspot operators to remotely manage Mikrotik routers and create Wi-Fi vouchers from their phones. The full PRD is in `project.pdf`.

Target users: internet cafe owners, small hotspot business operators, and network technicians managing multiple Mikrotik deployments.

## System Architecture

Five components communicate through secure channels:

1. **Mobile App (Client)** — Cross-platform (React Native or Flutter), communicates exclusively with the VPS backend via HTTPS. Never connects directly to routers.
2. **VPS Backend (Server)** — RESTful API (Node.js/Express or Python/FastAPI), handles auth, subscriptions, business logic, and orchestrates router/RADIUS operations.
3. **FreeRADIUS Server** — Centralized AAA engine on the VPS. All vouchers are stored as RADIUS users in PostgreSQL (not as local Mikrotik hotspot users). Routers delegate authentication to FreeRADIUS over WireGuard.
4. **WireGuard VPN Layer** — Persistent tunnels between VPS and each router. Private /30 subnets per tunnel (e.g., 10.10.x.0/30). 25-second keepalive for NAT traversal.
5. **RouterOS API** — Used for router config, session monitoring, and health checks over the WireGuard tunnel (TCP 8728/8729). NOT used for voucher storage.

### Key Data Flow (Voucher Creation)
```
Mobile App → HTTPS POST → VPS Backend → validates JWT + checks subscription quota
  → inserts into FreeRADIUS SQL (radcheck, radreply, radusergroup)
  → associates voucher with target router → returns result to app
```
When a customer connects: Router → RADIUS Access-Request → FreeRADIUS validates → Access-Accept with limits → Router sends Accounting packets (Start/Interim/Stop) → stored in radacct.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Mobile App | Flutter (Dart) — Android 8.0+ / iOS 13.0+ |
| Backend API | Node.js + Express.js OR Python + FastAPI |
| Database | PostgreSQL (shared between app and FreeRADIUS via rlm_sql_postgresql) |
| Cache | Redis (session tokens, caching) |
| RADIUS | FreeRADIUS 3.x with rlm_sql module |
| VPN | WireGuard (Curve25519, ChaCha20-Poly1305) |
| RouterOS Lib | routeros-client (Node.js) or librouteros (Python) |
| Push Notifications | FCM (Android), APNs (iOS) |
| Hosting | Ubuntu 22.04 LTS on VPS |
| Auth | JWT (15min access / 7day refresh with rotation), bcrypt (cost 12) |

## Database Schema

### Application Tables
- **Users** — id, name, email, phone, password_hash, business_name, is_verified
- **Subscriptions** — user_id, plan_tier, start/end_date, status, voucher_quota, vouchers_used
- **Routers** — user_id, name, model, ros_version, api_user, api_pass_enc, wg keys, tunnel_ip, radius_secret_enc, nas_identifier, status
- **Voucher_Meta** — user_id, router_id, radius_username, group_profile, comment, status (links to radcheck via radius_username)
- **RADIUS_Profiles** — user_id, group_name, display_name, bandwidth_up/down, session_timeout, total_time, total_data (maps to radgroupcheck/radgroupreply)
- **Payments** — user_id, plan_tier, amount, reference_code, receipt_url, status, reviewed_by
- **Audit_Logs** — admin_id, action, target_entity, target_id, details, timestamp

### FreeRADIUS Standard Tables
- **radcheck** — per-user auth attributes (Cleartext-Password, Expiration, Simultaneous-Use)
- **radreply** — per-user reply attributes on Access-Accept
- **radusergroup** — maps usernames to group profiles
- **radgroupcheck** — group-level limits (Max-All-Session, Max-Total-Octets)
- **radgroupreply** — group-level reply attrs (Mikrotik-Rate-Limit, Session-Timeout)
- **radacct** — session accounting (start/stop times, bytes in/out, duration, terminate cause)
- **nas** — registered RADIUS clients (routers) with shared secrets

## API Structure

All endpoints prefixed with `/api/v1/`, JWT Bearer auth required unless marked public.

| Group | Prefix | Key Operations |
|-------|--------|---------------|
| Auth | `/auth/` | register, login, refresh, forgot-password, reset-password, logout |
| Routers | `/routers/` | CRUD, status, setup-guide |
| Vouchers | `/routers/:id/vouchers/` | create (single + bulk), list, get, enable/disable/extend, delete with CoA disconnect |
| RADIUS Profiles | `/profiles/` | CRUD for group profiles (bandwidth/time/data plans) |
| Sessions | `/routers/:id/sessions/` | list active (via RouterOS API), disconnect (via RADIUS CoA), history (from radacct) |
| Subscriptions | `/subscription/` | status, request, receipt upload, list plans |

## Subscription Tiers

| | Starter ($5/mo) | Professional ($12/mo) | Enterprise ($25/mo) |
|---|---|---|---|
| Max Routers | 1 | 3 | 10 |
| Monthly Vouchers | 500 | 2,000 | Unlimited |
| Session Monitoring | Active only | Active + history | Full + export |
| Dashboard | Basic stats | Advanced analytics | Full analytics + reports |

Payment is manual bank transfer with admin verification (no automated payment gateway).

## Voucher System (Core Feature)

Vouchers are RADIUS users, not Mikrotik local hotspot users. Key implications:
- Vouchers work immediately after creation — router doesn't need to be online at creation time
- Operators select a **RADIUS Group Profile** (service plan) when creating vouchers, which defines bandwidth (Mikrotik-Rate-Limit), session timeout, total time, and data limits
- Per-voucher overrides are stored in radcheck/radreply; group defaults in radgroupcheck/radgroupreply
- Disable = set `Auth-Type := Reject` in radcheck; Delete = remove from radcheck + radreply + radusergroup + optional CoA disconnect
- Bulk creation: up to 100 vouchers per batch, single DB transaction, auto-generated credentials
- Router assignment: single router, multiple routers, or all routers

## Security Constraints

- TLS 1.3 + HSTS for all client-server traffic
- WireGuard for all server-to-router traffic; RouterOS API restricted to tunnel IP only
- AES-256 encryption at rest for router API credentials and personal data
- RADIUS shared secrets unique per router, transmitted only over WireGuard
- Rate limiting: 100 req/min/user general, 10 req/min on auth endpoints
- Account lockout after 5 failed login attempts (15-min cooldown)
- OWASP Top 10 compliance: parameterized queries, input validation, CSRF protection

## Performance Targets

- Single voucher creation: < 2s end-to-end
- Bulk creation (100): < 15s
- RADIUS auth: < 200ms per Access-Request
- API response (p95): < 500ms
- App cold start to dashboard: < 3s on 3G
- Backend uptime: 99.5%

## Router Status Monitoring

- **Online**: WireGuard handshake within 150s + API responds
- **Offline**: No handshake for 150s+ (push notification after 3-min grace period)
- **Degraded**: WireGuard connected but API unresponsive
- Status checks every 60 seconds

## UI/UX

- Bottom tab bar: **Dashboard**, **Routers**, **Vouchers**, **Settings**
- Design principles: speed first (skeleton screens, optimistic updates), clarity over decoration (single primary action per screen), offline tolerance (cached data + queued actions)
- RADIUS profiles managed from Routers or Settings tab; sessions from router detail screen
- Accessibility: 44x44pt touch targets, WCAG AA contrast, system font scaling support

## Admin Web Panel

A separate web-based dashboard for platform operators (not end users). Built for modern browsers (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+). Planned for Phase 2.

### Admin Features
- **User Management** — view, search, edit, suspend, delete user accounts
- **Subscription Management** — activate, extend, downgrade, cancel subscriptions manually
- **Payment Verification** — queue of pending bank transfer receipts with approve/reject actions
- **Platform Statistics** — total users, active subscriptions, total routers, total vouchers, system health
- **Router Overview** — all registered routers across all users with status indicators
- **Audit Logs** — timestamped log of all admin actions

## Release Scope

### Phase 1 — MVP (8 weeks)
Auth, manual Starter subscription, single router connection (WireGuard + RADIUS), RADIUS profiles, voucher creation (single + bulk), active sessions with disconnect, basic dashboard, share voucher.

### Phase 2 — Growth (6 weeks post-MVP)
Advanced reports + export, bulk printing, push notifications, multi-language (French, Portuguese, Swahili, Arabic), admin web panel, Professional/Enterprise tiers, session history, biometric login.

### Out of Scope
Automated payments, non-Mikrotik routers, end-user self-registration app, white-label, third-party accounting integrations, SMS voucher delivery.

## Localization

MVP is English only. Phase 2 adds French, Portuguese, Swahili, Arabic. All user-facing strings must be externalized via i18n resource files from the start.


## Updates

### 1.1 Backend Project Initialization (Completed)

**Tech choices:** Node.js + Express.js + TypeScript

**Project structure created:**
```
backend/
├── src/
│   ├── config/
│   │   ├── index.ts        — Zod-validated env config loader
│   │   ├── logger.ts       — Winston structured logging (JSON in prod, colorized in dev)
│   │   ├── database.ts     — PostgreSQL connection pool (pg)
│   │   └── redis.ts        — Redis client (ioredis) for caching/sessions
│   ├── middleware/
│   │   ├── requestId.ts    — UUID request ID injection (x-request-id header or auto-gen)
│   │   ├── requestLogger.ts — HTTP request/response logging with duration
│   │   ├── rateLimiter.ts  — 100 req/min general, 10 req/min auth (express-rate-limit)
│   │   ├── validate.ts     — Zod schema validation for body/query/params
│   │   └── errorHandler.ts — AppError class, 404 handler, consistent JSON error responses
│   ├── routes/
│   │   └── index.ts        — API v1 router with /health endpoint
│   ├── controllers/        — (empty, ready for endpoint handlers)
│   ├── services/           — (empty, ready for business logic)
│   ├── utils/              — (empty, ready for helpers)
│   ├── types/
│   │   └── index.ts        — AuthenticatedRequest, ApiError, ApiResponse interfaces
│   ├── app.ts              — Express app with full middleware stack (helmet, HSTS, CORS, hpp, rate limiting)
│   └── server.ts           — Server entry point with DB/Redis connection test and graceful shutdown
├── Dockerfile              — Multi-stage build (builder + production)
├── tsconfig.json           — Strict TypeScript config
├── .env.example            — All env vars documented
├── .gitignore
└── package.json            — Scripts: dev (nodemon+ts-node), build, start, lint
```

**docker-compose.yml** (project root): backend, PostgreSQL 16, Redis 7, FreeRADIUS with health checks.

**Key dependencies:** express, cors, helmet, hpp, express-rate-limit, pg, ioredis, winston, zod, uuid, dotenv.

**Verified:** TypeScript compiles cleanly with `tsc --noEmit`.

### 1.2 Database Setup (Completed)

**Migration system** with sequential SQL file execution and `schema_migrations` tracking table.

**Files created:**
```
backend/
├── src/
│   ├── migrations/
│   │   ├── runner.ts          — Migration runner (reads sql/ dir, tracks executed in schema_migrations, per-file transactions)
│   │   └── sql/
│   │       ├── 001_extensions.sql        — uuid-ossp + pgcrypto extensions
│   │       ├── 002_freeradius_tables.sql — FreeRADIUS 3.x standard schema (radcheck, radreply, radgroupcheck, radgroupreply, radusergroup, radacct, nas, radpostauth)
│   │       ├── 003_application_tables.sql — App tables (users, subscriptions, routers, radius_profiles, voucher_meta, payments, audit_logs) + updated_at triggers
│   │       └── 004_seed_data.sql         — Default admin user (admin@wasel.app)
│   └── scripts/
│       └── migrate.ts         — CLI entry point (npm run migrate)
├── init-db/
│   └── 01_create_extensions.sql — Docker entrypoint init (extensions on fresh DB)
```

**docker-compose.yml** updated: postgres service mounts `./backend/init-db` to `/docker-entrypoint-initdb.d` for auto-extension creation.

**package.json** updated: added `"migrate": "ts-node src/scripts/migrate.ts"` script.

**Database schema summary:**
- 8 FreeRADIUS tables (standard rlm_sql_postgresql schema)
- 7 application tables with UUID PKs, proper FK constraints, CHECK constraints, indexes
- `update_updated_at_column()` trigger function on all tables with updated_at
- `schema_migrations` table for tracking executed migrations

**Verified:** TypeScript compiles cleanly with `tsc --noEmit`.

### 1.3 FreeRADIUS Setup (Completed)

**Custom FreeRADIUS Docker image** with full PostgreSQL-backed configuration.

**Files created:**
```
freeradius/
├── Dockerfile                    — Custom FreeRADIUS image with PostgreSQL driver + all configs
├── raddb/
│   ├── radiusd.conf              — Main config: stdout logging, module includes, security settings
│   ├── clients.conf              — localhost (radtest) + WireGuard subnet (10.10.0.0/16) clients
│   ├── dictionary                — Mikrotik vendor attributes (Rate-Limit, etc.)
│   ├── mods-enabled/
│   │   ├── sql                   — rlm_sql_postgresql: connects to PostgreSQL, read_clients=yes for dynamic NAS
│   │   └── pap                   — PAP authentication module
│   └── sites-enabled/
│       ├── default               — Auth (radcheck/radusergroup), accounting (radacct), post-auth logging, Simultaneous-Use
│       └── coa                   — CoA/Disconnect server on port 3799 (RFC 5176)
├── seed-test-data.sql            — Test user/group for radtest verification
scripts/
└── test-radius.sh                — radtest script for auth verification
```

**Key configuration:**
- `rlm_sql_postgresql` driver connecting to PostgreSQL (`wasel` database)
- Dynamic NAS clients loaded from `nas` table (`read_clients = yes`)
- Standard FreeRADIUS SQL queries for radcheck/radreply/radusergroup/radgroupcheck/radgroupreply
- Accounting writes to radacct table
- CoA/Disconnect on port 3799 for session termination
- Simultaneous-Use enforcement via sql session tracking
- WireGuard subnet client (10.10.0.0/16) for router access
- Mikrotik vendor dictionary for Rate-Limit attribute
- Docker-compose updated to build from `./freeradius` with healthcheck

**Verified:** docker-compose configuration builds custom FreeRADIUS image with PostgreSQL dependency.

### 1.4 WireGuard VPN Infrastructure (Completed)

**WireGuard VPN utilities and services** for secure router-to-VPS tunneling.

**Files created:**
```
backend/src/
├── utils/
│   ├── wireguard.ts          — X25519 key pair generation, preshared key generation (Node.js crypto)
│   ├── ipAllocation.ts       — /30 subnet allocation from 10.10.0.0/16 pool, sequential assignment
│   └── encryption.ts         — AES-256-GCM encrypt/decrypt for secrets, RADIUS secret generator
├── services/
│   ├── wireguardConfig.ts    — Server wg0.conf generator, Mikrotik RouterOS config/CLI commands generator
│   ├── wireguardPeer.ts      — Dynamic peer add/remove via `wg` CLI, peer status listing
│   └── wireguardMonitor.ts   — 60s polling loop: handshake monitoring, status updates (online/offline/degraded)
```

**Key design decisions:**
- X25519 key generation via Node.js `crypto.generateKeyPairSync` (no external wg binary needed for key gen)
- /30 subnets allocated sequentially from 10.10.0.0/16 (supports ~16,000 routers)
- Server IP = .1, Router IP = .2 within each /30
- Peer management via `wg set` CLI commands for runtime changes + config file sync for persistence
- Handshake timeout: 150s (matches PRD), offline grace period: 3 min before notification placeholder
- Mikrotik config generator outputs copy-paste RouterOS CLI commands including WireGuard, RADIUS, and hotspot setup
- AES-256-GCM encryption with IV:tag:ciphertext format for all sensitive fields
- WireGuard env vars added: WG_SERVER_PRIVATE_KEY, WG_SERVER_PUBLIC_KEY, WG_SERVER_ENDPOINT, WG_SERVER_PORT

**Verified:** TypeScript compiles cleanly with `tsc --noEmit`.

### 1.5 Mobile App Project Initialization (Completed)

**Flutter + Dart** mobile app initialized with full project structure.

**Files created:**
```
mobile/
├── pubspec.yaml               — Flutter project with all dependencies
├── lib/
│   ├── main.dart              — Entry point (ProviderScope + WaselApp)
│   ├── app.dart               — MaterialApp.router with theme + i18n + GoRouter
│   ├── config/
│   │   └── app_config.dart    — API base URL, app constants
│   ├── navigation/
│   │   ├── app_router.dart    — GoRouter with ShellRoute for bottom tabs
│   │   └── scaffold_with_nav_bar.dart — NavigationBar: Dashboard, Routers, Vouchers, Settings
│   ├── screens/
│   │   ├── dashboard_screen.dart
│   │   ├── routers_screen.dart
│   │   ├── vouchers_screen.dart
│   │   └── settings_screen.dart
│   ├── providers/
│   │   ├── auth_provider.dart
│   │   ├── routers_provider.dart
│   │   ├── vouchers_provider.dart
│   │   └── subscription_provider.dart
│   ├── services/
│   │   ├── api_client.dart    — Dio HTTP client with JWT interceptor + token refresh
│   │   └── secure_storage.dart — flutter_secure_storage wrapper
│   ├── i18n/
│   │   └── app_localizations.dart — Custom LocalizationsDelegate with all MVP strings
│   ├── models/
│   │   ├── user.dart, router_model.dart, voucher.dart
│   │   ├── subscription.dart, radius_profile.dart, session.dart
│   ├── theme/
│   │   ├── app_colors.dart, app_typography.dart, app_spacing.dart
│   │   ├── app_theme.dart     — Material 3 light theme
│   │   └── theme.dart         — Barrel export
│   ├── widgets/
│   └── utils/
```

**Key dependencies:** flutter_riverpod, go_router, dio, flutter_secure_storage, flutter_localizations.

**Key design decisions:**
- GoRouter with ShellRoute for bottom tab navigation (Dashboard, Routers, Vouchers, Settings)
- Riverpod (StateNotifier) for state management — auth, routers, vouchers, subscription providers
- Dio interceptor handles 401 → token refresh → retry queue pattern
- flutter_secure_storage for JWT tokens (Keychain on iOS, EncryptedSharedPreferences on Android)
- Custom LocalizationsDelegate with all MVP strings externalized (Phase 2 adds fr, pt, sw, ar)
- Material 3 light theme with iOS-inspired type scale and 44pt touch targets
- Immutable model classes with fromJson/toJson for API serialization

### 2.1 Backend Auth APIs (Completed)

**Full auth system** with JWT tokens, OTP email verification, and account lockout protection.

**Files created:**
```
backend/src/
├── validators/
│   └── auth.validators.ts       — Zod schemas for all 7 auth endpoints
├── services/
│   ├── token.service.ts         — JWT sign/verify, refresh token rotation via Redis, OTP generation/validation
│   ├── email.service.ts         — Nodemailer SMTP transport, verification + password reset email templates
│   └── auth.service.ts          — Core auth logic: register, login, refresh, verify, forgot/reset password, logout
├── middleware/
│   └── authenticate.ts          — JWT Bearer token validation, populates req.user
├── controllers/
│   └── auth.controller.ts       — Express handlers for all 7 auth endpoints
├── routes/
│   └── auth.routes.ts           — Route definitions with Zod validation + authLimiter
├── jobs/
│   └── purgeUnverified.ts       — node-cron hourly job: DELETE unverified accounts > 72h
├── tests/
│   ├── setup.ts                 — Vitest setup: mocks for pg, ioredis, nodemailer
│   └── auth.test.ts             — 29 unit tests covering all auth endpoints
├── vitest.config.ts             — Vitest configuration
```

**Files modified:**
- `config/index.ts` — Added SMTP env vars (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM)
- `types/index.ts` — Extended AuthenticatedRequest.user with `name` field
- `routes/index.ts` — Wired auth routes at `/auth`
- `server.ts` — Starts purge cron job on boot
- `middleware/rateLimiter.ts` — Added `skip` for test environment

**New dependencies:** bcrypt, jsonwebtoken, nodemailer, node-cron (+ @types), vitest, supertest

**Auth endpoints (all under /api/v1/auth/):**
- `POST /register` — Validate inputs, bcrypt(12) hash, create user, send 6-digit verification OTP via email, return JWT pair
- `POST /login` — Credential check, lockout enforcement (5 attempts / 15min cooldown), email verification check, JWT pair issuance
- `POST /refresh` — Validate + rotate refresh token, issue new JWT pair
- `POST /verify-email` — Validate 6-digit OTP (24h TTL), mark user as verified
- `POST /forgot-password` — Send 15-minute OTP to email (no enumeration leakage)
- `POST /reset-password` — Validate OTP, update password, invalidate all sessions
- `POST /logout` — Revoke refresh token from Redis

**Key design decisions:**
- Access token (JWT_ACCESS_SECRET, 15min) + Refresh token (JWT_REFRESH_SECRET, 7d) with unique jti stored in Redis
- Refresh token rotation: old token revoked on refresh, new pair issued
- OTPs stored in Redis with TTL (24h for verification, 15min for password reset)
- Account lockout tracked in PostgreSQL (failed_login_attempts + locked_until columns)
- Password reset invalidates ALL refresh tokens for the user
- Rate limiting: 10 req/min on all auth endpoints via authLimiter

**Verified:** TypeScript compiles cleanly. 29/29 tests pass.

### 2.2 Mobile App — Auth Screens (Completed)

**5 auth screens** with full form validation, loading states, and error handling.

**Files created:**
```
mobile/lib/
├── screens/auth/
│   ├── login_screen.dart          — Email + password, forgot password link, register link
│   ├── register_screen.dart       — Name, email, phone, password, confirm, business name
│   ├── verify_email_screen.dart   — 6-digit OTP input with 60s resend cooldown timer
│   ├── forgot_password_screen.dart — Email input, sends reset code
│   └── reset_password_screen.dart — OTP + new password + confirm password
├── services/
│   └── auth_service.dart          — API calls: register, login, verifyEmail, forgotPassword, resetPassword, logout, getProfile
├── utils/
│   └── validators.dart            — Form validators: name, email, phone (E.164), password, confirmPassword, OTP
```

**Files updated:**
- `providers/auth_provider.dart` — Full async auth flow: login, register, verifyEmail, forgotPassword, resetPassword, logout, tryRestoreSession, error extraction from DioException
- `navigation/app_router.dart` — Auth routes (login, register, verify-email, forgot-password, reset-password) + main tab ShellRoute, appRouterProvider
- `app.dart` — Changed to ConsumerWidget, uses appRouterProvider

**Key features:**
- Form validation matching backend rules (name 2-100, email RFC 5322, phone E.164, password 8+ with uppercase + number)
- JWT stored in secure storage on login, auto-restored on app start via tryRestoreSession
- Automatic token refresh on 401 (Dio interceptor with Completer-based queue)
- Auto-clear errors when user types, inline error display on all screens
- OTP resend with 60-second cooldown timer
- Session expired callback wired from ApiClient to AuthNotifier

**Verified:** `dart analyze` — no issues found.

### 3.1 Backend — Subscription APIs (Completed)

**Subscription management system** with plan definitions, payment tracking, and quota enforcement.

**Files created:**
```
backend/src/
├── services/
│   └── subscription.service.ts    — Plan definitions (Starter/Pro/Enterprise), subscription CRUD, quota checks, expiry management
├── controllers/
│   └── subscription.controller.ts — GET plans, GET current subscription, POST request, POST receipt
├── validators/
│   └── subscription.validators.ts — Zod schemas for request/receipt endpoints
├── routes/
│   └── subscription.routes.ts     — /subscription/* routes with auth middleware
├── middleware/
│   ├── requireSubscription.ts     — Enforce active subscription (read-only grace for expired)
│   └── checkQuota.ts              — Voucher quota enforcement middleware factory
```

**Files updated:**
- `routes/index.ts` — Wired subscription routes at `/subscription`

**Subscription endpoints (all under /api/v1/subscription/):**
- `GET /plans` — Return all plan definitions with pricing and limits
- `GET /` — Current subscription status, quota usage, days remaining
- `POST /request` — Create subscription request + pending payment with reference code
- `POST /receipt` — Attach receipt URL to pending payment

**Subscription lifecycle:** Pending → Active (admin approves) → Expiring (7/3/1 day warnings) → Expired (7-day read-only grace) → Suspended

**Key design decisions:**
- Plan definitions as constants (Starter $5/500v/1r, Professional $12/2000v/3r, Enterprise $25/unlimited/10r)
- Payment reference codes: "WAS-" + 8 random alphanumeric chars
- requireSubscription middleware: blocks mutations when expired, allows reads during 7-day grace
- checkQuota middleware factory: configurable count extraction for single/bulk voucher creation
- Background job function updateExpiredSubscriptions() for status transitions

### 3.2 Mobile App — Subscription Screens (Completed)

**3 subscription screens** + updated Settings screen with full API integration, loading/error states, and provider-driven state management.

**Files created:**
```
mobile/lib/
├── models/
│   └── plan.dart                  — Plan model (tier, name, price, currency, features, maxRouters, monthlyVouchers)
├── services/
│   └── subscription_service.dart  — API calls: getPlans, getSubscription, requestSubscription, uploadReceipt
├── screens/subscription/
│   ├── plans_screen.dart              — Plan cards with pricing, features, "Most Popular" badge, confirmation dialog
│   ├── subscription_status_screen.dart — Current subscription details, status badge, voucher usage progress bar, pull-to-refresh
│   └── payment_screen.dart            — Bank transfer instructions, copyable reference code, receipt URL upload with validation
```

**Files updated:**
- `models/subscription.dart` — Extended with `planName`, `daysRemaining`, `maxRouters` fields; camelCase keys matching backend API; computed getters (`isActive`, `isPending`, `vouchersRemaining`)
- `providers/subscription_provider.dart` — Full async state management: `loadPlans()`, `loadSubscription()`, `requestSubscription()`, `uploadReceipt()`, DioException error extraction, `lastRequest` for payment flow
- `screens/settings_screen.dart` — Replaced placeholder with real settings: user profile header (avatar + name + email), subscription section with status/days badge, plan links, account section, logout button
- `navigation/app_router.dart` — Added 3 subscription routes: `/subscription`, `/subscription/plans`, `/subscription/payment`

**Key features:**
- Plan selection with confirmation dialog before requesting subscription
- Voucher quota progress bar with color coding (green → orange → red at 70%/90% thresholds)
- Payment flow: select plan → view reference code (tap to copy) → paste receipt URL → submit
- Receipt upload with URL validation; success state after submission
- Settings screen shows subscription status with days-remaining badge
- Pull-to-refresh on subscription status screen
- Error states with retry on plans screen

**Verified:** `dart analyze` — no issues on changed files.

### 4.1 Backend — Router APIs (Completed)

**Full Router CRUD system** with WireGuard key generation, tunnel IP allocation, NAS registration, and Mikrotik setup guide generation.

**Files created:**
```
backend/src/
├── validators/
│   └── router.validators.ts       — Zod schemas for create (name, model, rosVersion, apiUser, apiPass), update (partial with refine), routerIdParam (UUID)
├── services/
│   └── router.service.ts          — Full router CRUD: create, list, get, update, delete, status, setup-guide
├── controllers/
│   └── router.controller.ts       — Express handlers for all 7 router endpoints
├── routes/
│   └── router.routes.ts           — /routers/* routes with authenticate + requireSubscription + validate middleware
```

**Files updated:**
- `routes/index.ts` — Wired router routes at `/routers`

**Router endpoints (all under /api/v1/routers/, require JWT + active subscription):**
- `POST /` — Create router: check subscription router limit, generate WireGuard key pair + preshared key, allocate /30 tunnel IP, generate RADIUS secret, encrypt sensitive fields (AES-256-GCM), insert into routers + nas tables, add WireGuard peer
- `GET /` — List all routers for authenticated user (sanitized, no encrypted fields)
- `GET /:id` — Get single router with ownership verification
- `PUT /:id` — Update router fields (dynamic query, re-encrypts apiPass if changed, syncs NAS shortname on name change)
- `DELETE /:id` — Delete router + cleanup NAS entry + remove WireGuard peer
- `GET /:id/status` — Return router status (id, name, status, lastSeen, tunnelIp)
- `GET /:id/setup-guide` — Decrypt WireGuard private key + RADIUS secret, generate full Mikrotik CLI setup guide

**Key design decisions:**
- Router count enforced against subscription plan limits (Starter: 1, Professional: 3, Enterprise: 10)
- WireGuard keys auto-generated per router via Node.js crypto X25519
- Tunnel IP auto-allocated from 10.10.0.0/16 pool (/30 subnets, ~16,000 routers)
- RADIUS secret generated (32-char alphanumeric) and registered in FreeRADIUS NAS table
- Sensitive fields (api_pass, wg_private_key, radius_secret) encrypted at rest with AES-256-GCM
- WireGuard peer operations wrapped in try/catch (non-fatal in dev environments)
- Setup guide uses parseTunnelSubnet() for proper server IP derivation
- RouterInfo interface sanitizes DB rows — never exposes encrypted fields to API consumers
- All routes require both JWT authentication and active subscription via middleware chain

**New dependency:** routeros-client (v1.1.1) — RouterOS API client for Mikrotik routers

**Additional files created (completing remaining 4.1 tasks):**
```
backend/src/
├── services/
│   ├── routerOs.service.ts        — RouterOS API client: connect, getSystemInfo, getActiveHotspotUsers, disconnectHotspotUser, testConnection
│   └── notification.service.ts    — Placeholder notification functions for router offline/online events (Phase 2: FCM/APNs)
```

**Additional files updated:**
- `services/router.service.ts` — Enhanced `getRouterStatus()` to query live system info (uptime, CPU, memory, firmware) from RouterOS API when router is online; falls back to DB-only data with `liveDataAvailable: false` on failure
- `services/wireguardMonitor.ts` — Added `user_id` and `name` to RouterRow; wired `notifyRouterOffline()` and `notifyRouterOnline()` as fire-and-forget calls in the monitoring loop

**RouterOS API client features:**
- `connectToRouter()` — DB lookup, credential decryption, RouterOS API connection on port 8728 via WireGuard tunnel IP
- `getSystemInfo()` — Parallel queries to /system/resource, /system/identity, /system/routerboard; graceful handling of non-routerboard devices
- `getActiveHotspotUsers()` — Lists active hotspot sessions with username, IP, MAC, uptime, bytes in/out
- `disconnectHotspotUser()` — Removes active hotspot session by .id with existence verification
- `testConnection()` — Boolean connection test for router reachability
- All functions use `finally` blocks for client disconnection to prevent connection leaks

**Verified:** TypeScript compiles cleanly with `tsc --noEmit`.

### 4.2 Mobile App — Router Screens (Completed)

**5 router screens** + router service + updated provider + navigation routes.

**Files created:**
```
mobile/lib/
├── services/
│   └── router_service.dart              — API calls: getRouters, getRouter, createRouter, updateRouter, deleteRouter, getRouterStatus, getSetupGuide + RouterSystemInfo, RouterStatusInfo, RouterSetupGuide models
├── screens/routers/
│   ├── router_list_screen.dart          — Router list with pull-to-refresh, status dots (green/red/yellow), last seen, empty state, error state
│   ├── add_router_screen.dart           — Form: name*, model, rosVersion, apiUser, apiPass with validation; navigates to setup guide on success
│   ├── router_detail_screen.dart        — Status card, system info card (CPU/memory progress bars), router details card, actions (setup guide, edit), delete with confirmation dialog
│   ├── edit_router_screen.dart          — Pre-filled form, only sends changed fields, password "leave blank to keep current"
│   └── setup_guide_screen.dart          — Monospace setup guide text, copy to clipboard, tunnel IP + server endpoint chips
```

**Files updated:**
- `providers/routers_provider.dart` — Full async state: loadRouters, loadRouter, createRouter, updateRouter, deleteRouter, loadRouterStatus, loadSetupGuide, clearSelection, error extraction from DioException
- `navigation/app_router.dart` — Added 4 router routes: /routers/add, /routers/detail, /routers/edit, /routers/setup-guide; replaced RoutersScreen with RouterListScreen in tab

**Key features:**
- Router list with status color coding (green=online, red=offline, yellow=degraded)
- Pull-to-refresh on router list
- Relative time display for last seen ("2m ago", "1h ago", "3d ago")
- Router detail shows live system info when online (CPU load + memory with progress bars, uptime, board, architecture, firmware)
- Add router navigates to setup guide after creation
- Edit router only sends changed fields, password field shows "Leave blank to keep current"
- Setup guide with monospace text and copy-to-clipboard
- Delete confirmation dialog with warning text
- All screens use ConsumerStatefulWidget with Riverpod state management

**Verified:** `dart analyze` — no issues found.

### 5.1 Backend — Profile APIs (Completed)

**Full RADIUS Group Profile CRUD** with synchronized radgroupcheck/radgroupreply management.

**Files created:**
```
backend/src/
├── validators/
│   └── profile.validators.ts      — Zod schemas: createProfile (groupName, displayName, bandwidthUp/Down, sessionTimeout, totalTime, totalData), updateProfile (partial), profileIdParam (UUID)
├── services/
│   └── profile.service.ts         — Full CRUD: create, list, get, update, delete with RADIUS table sync
├── controllers/
│   └── profile.controller.ts      — Express handlers for all 5 profile endpoints
├── routes/
│   └── profile.routes.ts          — /profiles/* routes with authenticate + requireSubscription + validate
```

**Files updated:**
- `routes/index.ts` — Wired profile routes at `/profiles`

**Profile endpoints (all under /api/v1/profiles/, require JWT + active subscription):**
- `POST /` — Create profile: validate inputs, insert into radius_profiles + radgroupcheck (Max-All-Session, Max-Total-Octets) + radgroupreply (Mikrotik-Rate-Limit, Session-Timeout), all in single transaction
- `GET /` — List all profiles for user with RADIUS attributes
- `GET /:pid` — Get profile with ownership check + RADIUS attributes
- `PUT /:pid` — Update profile: dynamic field update + delete/re-insert RADIUS attributes (only affects new vouchers)
- `DELETE /:pid` — Delete profile: checks radusergroup for assigned vouchers, fails with 409 PROFILE_IN_USE if any exist, cleans up radgroupcheck + radgroupreply

**Key design decisions:**
- Group name validated: alphanumeric + hyphens + underscores only, unique per user
- Mikrotik-Rate-Limit format validated via regex (e.g., "2M/5M", "512K/1M")
- Bandwidth stored as separate up/down fields, combined to Rate-Limit format for RADIUS
- RADIUS attributes fully rebuilt on update (delete + re-insert) to ensure consistency
- ProfileInfo includes `radiusAttributes` array showing all check + reply entries
- Delete blocked if vouchers still assigned via radusergroup count check
- All mutations wrapped in PostgreSQL transactions

**Verified:** TypeScript compiles cleanly with `tsc --noEmit`.

### 5.2 Mobile App — Profile Screens (Completed)

**4 profile screens** + model/service/provider + GoRouter navigation for full RADIUS profile management.

**Files created:**
```
mobile/lib/
├── models/
│   └── radius_profile.dart            — RadiusProfile + RadiusAttribute models, computed getters (bandwidthDisplay, sessionTimeoutDisplay, totalTimeDisplay, totalDataDisplay), _formatDuration/_formatBytes helpers
├── services/
│   └── profile_service.dart           — API calls: getProfiles, getProfile, createProfile, updateProfile, deleteProfile
├── providers/
│   └── profiles_provider.dart         — ProfilesState + ProfilesNotifier: loadProfiles, loadProfile, createProfile, updateProfile, deleteProfile, clearSelection
├── screens/profiles/
│   ├── profile_list_screen.dart       — List all profiles with name, group, bandwidth/time/data limit chips, pull-to-refresh, empty state
│   ├── create_profile_screen.dart     — Form: groupName, displayName, bandwidth up/down (M/K unit selector), session timeout, total time (sec/min/hr/day), total data (KB/MB/GB)
│   ├── edit_profile_screen.dart       — Same form pre-populated, group name read-only, parses existing values back to best unit
│   └── profile_detail_screen.dart     — Info card, limits card, RADIUS attributes card (check/reply badges), edit/delete actions
```

**Files updated:**
- `navigation/app_router.dart` — Added 4 profile routes: `/profiles`, `/profiles/create`, `/profiles/detail` (extra: profileId), `/profiles/edit` (extra: profileId)

**Key features:**
- Unit selectors: bandwidth (K/M), time (seconds/minutes/hours/days), data (KB/MB/GB)
- Create/edit forms convert user-friendly units to backend values (seconds for time, bytes for data, "2M" format for bandwidth)
- Edit screen parses existing values back to best human-readable unit (e.g., 3600 seconds → 1 hour)
- Profile detail shows RADIUS attributes with check/reply type badges in monospace format
- Delete confirmation dialog warns about RADIUS attribute removal; backend rejects if vouchers assigned
- _LimitChip widget for compact display of profile limits on list cards

**Verified:** `dart analyze` — no issues found.

### 6.1 Backend — Voucher APIs (Completed)

**Full Voucher CRUD system** with single + bulk creation, RADIUS user management, enable/disable, expiration extension, and CoA disconnect on delete.

**Files created:**
```
backend/src/
├── validators/
│   └── voucher.validators.ts      — Zod schemas: createVoucher, bulkCreateVoucher, updateVoucher, listVouchersQuery, routerIdParam, voucherIdParam
├── services/
│   └── voucher.service.ts         — Full voucher CRUD: create, bulkCreate, list (paginated), get, update (enable/disable/extend), delete with CoA disconnect
├── controllers/
│   └── voucher.controller.ts      — Express handlers for all 6 voucher endpoints
├── routes/
│   └── voucher.routes.ts          — /routers/:id/vouchers/* routes with authenticate + requireSubscription + checkQuota + validate
```

**Files updated:**
- `routes/index.ts` — Wired voucher routes at `/routers/:id/vouchers`

**Voucher endpoints (all under /api/v1/routers/:id/vouchers/, require JWT + active subscription):**
- `POST /` — Create single voucher: auto-gen username/password if not provided, insert into radcheck + radusergroup + voucher_meta, increment vouchers_used, quota check for 1
- `POST /bulk` — Bulk create up to 100 vouchers: configurable prefix/length, single DB transaction, ambiguous chars excluded, quota check for count
- `GET /` — List vouchers with pagination, filter by status/profileId/search, total count in meta
- `GET /:vid` — Get single voucher with password, expiration, profile display name
- `PUT /:vid` — Update voucher: disable (Auth-Type := Reject in radcheck), enable (remove Auth-Type), extend expiration, update comment
- `DELETE /:vid` — Delete voucher: remove from radcheck + radreply + radusergroup + voucher_meta, CoA Disconnect-Request via radclient (fire-and-forget)

**Key design decisions:**
- Vouchers are RADIUS users stored in radcheck/radusergroup, not Mikrotik local hotspot users
- Disable sets `Auth-Type := Reject` in radcheck; enable removes it
- Bulk creation generates unique credentials with configurable prefix/length, ambiguous characters (0, O, l, 1, I) excluded from charset
- Expiration formatted in FreeRADIUS format (`"January 01 2026 00:00:00"`)
- `vouchers_used` counter incremented on active subscription for quota tracking
- CoA Disconnect-Request sent via `radclient` CLI on delete to terminate active sessions (non-fatal if unavailable)
- Router and profile ownership verified on every operation
- Username uniqueness checked against radcheck before insertion
- All create/update/delete operations wrapped in PostgreSQL transactions

**Verified:** TypeScript compiles cleanly with `tsc --noEmit`.

### 6.2 Mobile App — Voucher Screens (Completed)

**4 voucher screens** + service + provider + updated navigation for full voucher management.

**Files created:**
```
mobile/lib/
├── services/
│   └── voucher_service.dart           — API calls: getVouchers (paginated), getVoucher, createVoucher, createVouchersBulk, updateVoucher, deleteVoucher + VoucherListResult model
├── screens/vouchers/
│   ├── voucher_list_screen.dart       — Router selector dropdown, status filter chip, search by username, voucher cards with status badges, pull-to-refresh, empty/error states
│   ├── create_voucher_screen.dart     — Profile dropdown, optional username/password, comment, simultaneous use stepper (1-10), expiration date picker
│   ├── bulk_create_screen.dart        — Profile dropdown, quantity (1-100), username prefix, username/password length selectors, comment, simultaneous use, expiration
│   └── voucher_detail_screen.dart     — Credentials card (username/password with copy buttons), details card, enable/disable toggle, share via device share sheet, delete with confirmation
```

**Files updated:**
- `models/voucher.dart` — Extended with userId, routerId, username, password, profileName, groupProfile, expiration, simultaneousUse; camelCase keys matching backend API; computed getters (isActive, isDisabled, isExpired, isUsed)
- `providers/vouchers_provider.dart` — Full async state: loadVouchers (paginated), loadVoucher, createVoucher, createVouchersBulk, toggleVoucherStatus, deleteVoucher, setFilter, setSearch, clearSelection, DioException error extraction
- `screens/vouchers_screen.dart` — Re-exports VoucherListScreen for tab navigation
- `navigation/app_router.dart` — Added 3 voucher routes: /vouchers/create (extra: routerId), /vouchers/bulk-create (extra: routerId), /vouchers/detail (extra: {routerId, voucherId}); updated tab to use VoucherListScreen
- `pubspec.yaml` — Added share_plus dependency

**Key features:**
- Router selector dropdown with status dots (green/red/yellow) on voucher list
- Status filter (All/Active/Disabled/Expired/Used) with visual chip indicator
- Username search with submit-on-enter
- Voucher cards show username (monospace), profile name, status badge, date, comment preview
- Create form: auto-generates credentials if left blank, profile dropdown, simultaneous use stepper, optional expiration date picker
- Bulk create: configurable quantity (1-100), username prefix, username/password length selectors (4-16)
- Detail screen: large monospace credentials with individual copy buttons + "Copy All", enable/disable toggle with confirmation, share via native share sheet, delete with confirmation
- Pull-to-refresh on voucher list
- All screens use ConsumerStatefulWidget with Riverpod state management

**New dependency:** share_plus (^10.1.4) — Native share sheet for sharing voucher credentials

**Verified:** `dart analyze` — no issues found.

### 7.1 Backend — Session APIs (Completed)

**Session management system** with active session listing via RouterOS API, session disconnect with CoA, and session history from radacct.

**Files created:**
```
backend/src/
├── validators/
│   └── session.validators.ts      — Zod schemas: routerIdParam, sessionIdParam (string, not UUID), sessionHistoryQuery (username, page, limit, startDate, endDate, terminateCause)
├── services/
│   └── session.service.ts         — Active sessions via RouterOS API, disconnect with CoA Disconnect-Request, history from radacct with pagination/filters
├── controllers/
│   └── session.controller.ts      — Express handlers for all 3 session endpoints
├── routes/
│   └── session.routes.ts          — /routers/:id/sessions/* routes with authenticate + requireSubscription + validate
```

**Files updated:**
- `routes/index.ts` — Wired session routes at `/routers/:id/sessions`

**Session endpoints (all under /api/v1/routers/:id/sessions/, require JWT + active subscription):**
- `GET /` — List active hotspot sessions: queries RouterOS API via WireGuard tunnel for connected users (username, IP, MAC, uptime, bytes in/out, idle time)
- `GET /history` — Session history from radacct: paginated, filterable by username (ILIKE), date range (startDate/endDate), terminate cause; scoped to router's tunnel IP (nasipaddress)
- `DELETE /:sid` — Disconnect session: removes active hotspot entry via RouterOS API + sends CoA Disconnect-Request via radclient (fire-and-forget, non-fatal)

**Key design decisions:**
- Active sessions fetched from RouterOS API in real-time (not cached) — reflects actual connected users
- Session history queries radacct table filtered by router's tunnel_ip as nasipaddress — ensures data isolation per router
- Session IDs from RouterOS are strings like "*1A" (not UUIDs), validated as non-empty string
- CoA Disconnect-Request sent via `radclient` CLI as fire-and-forget after RouterOS disconnect — handles case where RADIUS session persists after hotspot removal
- History supports flexible filtering: username search (ILIKE), date range, terminate cause (e.g., User-Request, Session-Timeout, NAS-Reboot)
- Pagination with total count in meta for history endpoint
- Router ownership verified on every operation

**Verified:** TypeScript compiles cleanly with `tsc --noEmit`.

### 7.2 Mobile App — Session Screens (Completed)

**2 session screens** + model/service/provider + GoRouter navigation for session monitoring.

**Files created:**
```
mobile/lib/
├── models/
│   └── session.dart                       — ActiveSession + SessionHistory models with computed getters (bytesInDisplay, bytesOutDisplay, sessionTimeDisplay, inputDisplay, outputDisplay), _formatBytes/_formatDuration helpers
├── services/
│   └── session_service.dart               — API calls: getActiveSessions, disconnectSession, getSessionHistory (paginated with filters) + SessionHistoryResult model
├── providers/
│   └── sessions_provider.dart             — SessionsState + SessionsNotifier: loadActiveSessions, disconnectSession, loadSessionHistory, loadMoreHistory (infinite scroll), setUsernameFilter, setTerminateCauseFilter
├── screens/sessions/
│   ├── active_sessions_screen.dart        — Active sessions list with 30s auto-refresh timer, disconnect confirmation dialog, session cards (username, uptime, bytes in/out, IP, MAC), empty/error/loading states
│   └── session_history_screen.dart        — Paginated history with username search, terminate cause filter (PopupMenuButton), infinite scroll, history cards with start/stop times, duration, data stats, terminate cause badges (color-coded)
```

**Files updated:**
- `navigation/app_router.dart` — Added 2 session routes: `/sessions/active` (extra: routerId), `/sessions/history` (extra: routerId); added imports for ActiveSessionsScreen and SessionHistoryScreen

**Key features:**
- Active sessions auto-refresh every 30 seconds via Timer.periodic, with manual refresh button
- Disconnect confirmation dialog with username and MAC address display
- Session cards show: username (monospace), active badge, uptime/bytes-in/bytes-out chips, IP address, MAC address
- Session history with username search (submit on enter) and terminate cause filter dropdown
- Terminate cause badges color-coded: User-Request (blue), Session-Timeout (orange), Idle-Timeout (amber), Admin-Reset (red), NAS-Reboot (purple), Lost-Carrier (grey)
- Infinite scroll pagination for history (loads more when scrolled within 200px of bottom)
- History cards show: username, start/stop times, session duration, data in/out, IP, MAC, terminate cause
- All screens use ConsumerStatefulWidget with Riverpod state management

**Verified:** `dart analyze` — no issues found.

### 8.1 Backend — Dashboard APIs (Completed)

**Aggregated dashboard endpoint** returning all key stats in a single API call.

**Files created:**
```
backend/src/
├── services/
│   └── dashboard.service.ts       — getDashboardData(): 6 parallel queries (routers, subscription, vouchers today/total, 24h data usage, active sessions by router)
├── controllers/
│   └── dashboard.controller.ts    — Single getDashboard handler
├── routes/
│   └── dashboard.routes.ts        — GET / with authenticate only (no subscription required)
```

**Files updated:**
- `routes/index.ts` — Wired dashboard routes at `/dashboard`

**Dashboard endpoint (GET /api/v1/dashboard/, requires JWT):**
- Returns: routers summary (id, name, status, lastSeen), subscription status (plan, quota, dates), vouchersCreatedToday, totalVouchers, dataUsage24h (totalInput/totalOutput from radacct), activeSessionsByRouter (routerId, routerName, count)
- All 6 queries run in parallel via Promise.all for performance
- No subscription requirement — dashboard works for all authenticated users

**Verified:** TypeScript compiles cleanly with `tsc --noEmit`.

### 8.2 Mobile App — Dashboard Screen (Completed)

**Full dashboard screen** replacing placeholder, with service/provider and multiple data widgets.

**Files created:**
```
mobile/lib/
├── services/
│   └── dashboard_service.dart         — API call: getDashboard
├── providers/
│   └── dashboard_provider.dart        — DashboardState + DashboardNotifier with convenience getters (routers, subscription, vouchersCreatedToday, totalVouchers, dataUsage24h, activeSessionsByRouter, totalActiveSessions)
```

**Files updated:**
- `screens/dashboard_screen.dart` — Full ConsumerStatefulWidget replacing placeholder

**Dashboard widgets:**
1. Subscription Status Card — plan name, colored status badge, voucher usage progress bar with color thresholds, days remaining, "View Plans" button if no subscription
2. Quick Stats Row — two cards: Active Sessions count, Vouchers Created Today count
3. Data Usage (24h) Card — total download/upload formatted as KB/MB/GB
4. Routers Status Card — router list with status dots (green/red/yellow), name, relative last seen, tappable rows → router detail
5. Sessions by Router Card — router names with active session count badges
6. FAB — Quick Create Voucher, navigates to `/vouchers/create` with first router's ID

**Key features:**
- Pull-to-refresh to reload all widgets
- Skeleton loading placeholders (grey containers) while data loads
- Error state with retry button
- Helper methods: _formatBytes, _statusColor, _relativeTime

**Verified:** `dart analyze` — no issues found.