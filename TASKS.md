# TASKS.md — Wasel Project Task Breakdown

This file breaks down the full implementation into phases, epics, and granular tasks.
Each task is marked with a status: `[ ]` todo, `[~]` in progress, `[x]` done.

---

## Phase 1 — MVP (8 weeks)

---

### Epic 1: Project Setup & Infrastructure

#### 1.1 Backend Project Initialization
- [x] Initialize Node.js/Express (or Python/FastAPI) project with folder structure
- [x] Configure TypeScript (if Node.js) or type hints (if Python)
- [x] Set up environment variable management (.env, config loader)
- [x] Set up PostgreSQL connection with connection pooling
- [x] Set up Redis connection for caching and session tokens
- [x] Configure structured logging (request IDs, timestamps, levels)
- [x] Set up API versioning structure (`/api/v1/`)
- [x] Configure CORS, Helmet/security headers, HSTS
- [x] Set up rate limiting middleware (100 req/min/user, 10 req/min on auth)
- [x] Set up input validation/sanitization middleware
- [x] Create error handling middleware with consistent JSON error responses
- [x] Write Dockerfile for backend service
- [x] Write docker-compose.yml (backend, PostgreSQL, Redis, FreeRADIUS)

#### 1.2 Database Setup
- [x] Create PostgreSQL database and initial migration system
- [x] Create `users` table migration (id, name, email, phone, password_hash, business_name, is_verified, created_at, updated_at)
- [x] Create `subscriptions` table migration (id, user_id, plan_tier, start_date, end_date, status, voucher_quota, vouchers_used)
- [x] Create `routers` table migration (id, user_id, name, model, ros_version, api_user, api_pass_enc, wg_public_key, wg_private_key_enc, tunnel_ip, radius_secret_enc, nas_identifier, status, last_seen)
- [x] Create `voucher_meta` table migration (id, user_id, router_id, radius_username, group_profile, comment, status, created_at)
- [x] Create `radius_profiles` table migration (id, user_id, group_name, display_name, bandwidth_up, bandwidth_down, session_timeout, total_time, total_data, description)
- [x] Create `payments` table migration (id, user_id, plan_tier, amount, reference_code, receipt_url, status, reviewed_by, created_at)
- [x] Set up FreeRADIUS standard schema tables (radcheck, radreply, radusergroup, radgroupcheck, radgroupreply, radacct, nas)
- [x] Create database indexes for common queries (username lookups, user_id foreign keys, radacct queries)
- [x] Seed initial data (subscription plans, default admin user)

#### 1.3 FreeRADIUS Setup
- [x] Install and configure FreeRADIUS 3.x
- [x] Configure `rlm_sql` module with `rlm_sql_postgresql` driver
- [x] Configure FreeRADIUS to use radcheck/radreply/radusergroup tables for auth
- [x] Configure FreeRADIUS to use radgroupcheck/radgroupreply for group profiles
- [x] Configure RADIUS accounting to write to radacct table
- [x] Configure CoA/Disconnect support (port 3799, RFC 5176)
- [x] Configure Simultaneous-Use enforcement
- [x] Configure FreeRADIUS to listen on WireGuard interface only (not public)
- [x] Configure NAS client table (dynamic clients from `nas` table)
- [x] Test RADIUS auth flow with a simulated NAS client (radtest)
- [x] Write FreeRADIUS Dockerfile or provisioning script

#### 1.4 WireGuard VPN Infrastructure
- [x] Set up WireGuard server on VPS
- [x] Create IP address allocation logic for /30 subnets (e.g., 10.10.x.0/30)
- [x] Build WireGuard key pair generation utility
- [x] Build WireGuard server-side config generator (add peer dynamically)
- [x] Build Mikrotik-side WireGuard config generator (downloadable config)
- [x] Implement persistent keepalive (25 seconds)
- [x] Implement WireGuard handshake monitoring (detect online/offline)
- [x] Build script to apply/remove WireGuard peers dynamically

#### 1.5 Mobile App Project Initialization
- [x] Initialize Flutter project
- [x] Configure project for iOS and Android targets
- [x] Set up navigation library (React Navigation or Flutter Navigator)
- [x] Set up state management (Redux Toolkit / Provider)
- [x] Set up HTTP client with base URL, JWT interceptor, and refresh token logic
- [x] Set up secure storage (Keychain / EncryptedSharedPreferences) for tokens
- [x] Set up i18n framework with externalized strings (English only for MVP)
- [x] Configure app theming (colors, typography, spacing)
- [x] Set up bottom tab bar navigation: Dashboard, Routers, Vouchers, Settings

---

### Epic 2: Authentication & User Management

#### 2.1 Backend — Auth APIs
- [x] `POST /auth/register` — validate inputs (name 2-100 chars, email RFC 5322, phone E.164, password min 8 chars + 1 uppercase + 1 number), hash password with bcrypt cost 12, create user, send verification email with 6-digit OTP
- [x] `POST /auth/login` — validate credentials, check email verified, check lockout (5 attempts / 15min cooldown), issue JWT access token (15min) + refresh token (7 days)
- [x] `POST /auth/refresh` — validate refresh token, rotate and issue new pair
- [x] `POST /auth/forgot-password` — send 15-minute OTP to registered email
- [x] `POST /auth/reset-password` — validate OTP, set new password, invalidate all sessions
- [x] `POST /auth/logout` — invalidate current session/refresh token
- [x] Email verification endpoint — validate 6-digit OTP within 24 hours
- [x] Background job: purge unverified accounts after 72 hours
- [x] JWT middleware — extract and validate Bearer token on protected routes
- [x] Write unit tests for all auth endpoints

#### 2.2 Mobile App — Auth Screens
- [x] **Login Screen** — email + password fields, "Forgot Password" link, "Create Account" link
- [x] **Register Screen** — full name, email, phone (E.164), password, business name (optional), country/region dropdown
- [x] **Email Verification Screen** — 6-digit OTP input after registration
- [x] **Forgot Password Screen** — email input, sends OTP
- [x] **Reset Password Screen** — OTP input + new password fields
- [x] Implement JWT storage in secure storage on login
- [x] Implement automatic token refresh on 401 responses
- [x] Implement session management (one active session per device)
- [x] Form validation with inline error messages matching backend rules
- [x] Loading states and error handling for all auth flows

---

### Epic 3: Subscription Management (Starter Tier Only for MVP)

#### 3.1 Backend — Subscription APIs
- [x] `GET /subscription/plans` — return available plans with pricing and limits
- [x] `GET /subscription` — return current subscription status, quota, days remaining
- [x] `POST /subscription/request` — submit subscription request (Starter tier, 1 month)
- [x] `POST /subscription/receipt` — upload payment receipt image (store URL)
- [x] Notify admin of pending payment (via internal mechanism)
- [x] Subscription status logic: Active → Expiring (7/3/1 day warnings) → Expired (7-day read-only grace) → Suspended (data retained 90 days)
- [x] Middleware to check subscription status on voucher/router operations
- [x] Quota enforcement: check vouchers_used < voucher_quota before voucher creation

#### 3.2 Mobile App — Subscription Screens
- [x] **Subscription Screen** — show current plan, status, quota usage (used/total), days remaining
- [x] **Plan Selection** — display all tiers with pricing, features, "Most Popular" badge, confirmation dialog
- [x] **Payment Instructions** — show bank transfer details (reference code with copy-to-clipboard, amount, currency)
- [x] **Receipt Upload** — receipt URL input with validation and submission
- [x] **Pending Confirmation** — success state after receipt submission with "pending review" message
- [x] Handle subscription states in UI (active, pending, expired with status badges and color coding)
- [x] **Settings Screen** — replaced placeholder with real settings: user profile header, subscription section with status/days badge, plan links, account section, logout
- [x] **Subscription Provider** — full async state management with loadPlans, loadSubscription, requestSubscription, uploadReceipt, error handling
- [x] **Subscription Service** — API client for all subscription endpoints
- [x] **Plan Model** — tier, name, price, currency, features, maxRouters, monthlyVouchers
- [x] **Routes** — /subscription, /subscription/plans, /subscription/payment wired in GoRouter

---

### Epic 4: Router Management

#### 4.1 Backend — Router APIs
- [x] `POST /routers` — validate subscription router limit, generate WireGuard key pair, allocate tunnel IP (/30), generate RADIUS shared secret, generate NAS identifier, insert into routers table + nas table, return WireGuard config + RADIUS setup instructions
- [x] `GET /routers` — list all routers for authenticated user with status
- [x] `GET /routers/:id` — get single router details (verify ownership)
- [x] `PUT /routers/:id` — update router name or API credentials (re-encrypt)
- [x] `DELETE /routers/:id` — remove WireGuard peer, delete from nas table, delete associated voucher_meta, confirm before deletion
- [x] `GET /routers/:id/status` — query RouterOS API via WireGuard tunnel for system info (uptime, CPU, memory, firmware)
- [x] `GET /routers/:id/setup-guide` — return step-by-step WireGuard + RADIUS config instructions for this specific router
- [x] Router status monitoring background job (every 60 seconds): check WireGuard handshake + RouterOS API ping, update status (Online/Offline/Degraded)
- [x] Push notification on router offline (after 3-minute grace period)
- [x] Push notification on router back online
- [x] AES-256 encryption/decryption utility for api_pass_enc, wg_private_key_enc, radius_secret_enc
- [x] RouterOS API client: connect via WireGuard tunnel IP, authenticate, execute commands

#### 4.2 Mobile App — Router Screens
- [x] **Router List Screen** — list all routers with name, model, status indicator (green/red/yellow), last seen timestamp
- [x] **Add Router Screen** — form for router name + API username + API password
- [x] **Router Setup Guide Screen** — display generated WireGuard config (copyable), RADIUS server config steps, with "Test Connection" button
- [x] **Router Detail Screen** — show name, model, RouterOS version, uptime, CPU, memory, firmware, tunnel IP, status; actions: edit, regenerate WireGuard keys, remove
- [x] **Edit Router Screen** — update name, API credentials
- [x] Pull-to-refresh on router list
- [x] Status color coding: green (online), red (offline), yellow (degraded)
- [x] Confirmation dialog on router deletion

---

### Epic 5: RADIUS Group Profiles

#### 5.1 Backend — Profile APIs
- [x] `POST /profiles` — create group profile: validate inputs, insert into radius_profiles table, insert corresponding rows into radgroupcheck (Max-All-Session, Max-Total-Octets) and radgroupreply (Mikrotik-Rate-Limit, Session-Timeout)
- [x] `GET /profiles` — list all profiles for authenticated user
- [x] `GET /profiles/:pid` — get profile details with RADIUS attributes
- [x] `PUT /profiles/:pid` — update profile attributes (only affects new vouchers, not existing)
- [x] `DELETE /profiles/:pid` — delete profile (fail if vouchers still assigned via radusergroup)
- [x] Validate Mikrotik-Rate-Limit format (e.g., "2M/2M", "5M/5M", "10M/10M")
- [x] Validate time values in seconds, data values in bytes

#### 5.2 Mobile App — Profile Screens
- [x] **Profiles List Screen** — list all group profiles with name, bandwidth, time limit, data limit summary
- [x] **Create Profile Screen** — form: display name, upload/download bandwidth (with unit selector M/K), session timeout, total time limit, total data limit (with MB/GB selector), description
- [x] **Edit Profile Screen** — same as create, pre-populated
- [x] **Profile Detail Screen** — show all attributes, RADIUS attributes display, delete button (with confirmation dialog)
- [x] Human-readable display of limits (e.g., "2M Up / 5M Down", "1h", "1.0 GB")
- [x] Wire profile routes into GoRouter (list, create, detail, edit)

---

### Epic 6: Voucher Management (Core Feature)

#### 6.1 Backend — Voucher APIs
- [x] `POST /routers/:id/vouchers` — create single voucher: validate subscription quota, generate or accept custom username/password (6-8 chars), insert into radcheck (Cleartext-Password, Expiration, Simultaneous-Use), insert into radusergroup (group profile), insert into voucher_meta, increment vouchers_used, return voucher details
- [x] `POST /routers/:id/vouchers/bulk` — bulk create up to 100 vouchers: validate quota for entire batch, auto-generate all credentials, single DB transaction, insert all radcheck + radusergroup + voucher_meta rows atomically
- [x] `GET /routers/:id/vouchers` — list vouchers for a router with pagination, filters (status, profile, search)
- [x] `GET /routers/:id/vouchers/:vid` — get voucher detail with password, expiration, profile display name
- [x] `PUT /routers/:id/vouchers/:vid` — enable (remove Auth-Type := Reject), disable (set Auth-Type := Reject), extend (modify Expiration), update comment
- [x] `DELETE /routers/:id/vouchers/:vid` — delete from radcheck + radreply + radusergroup + voucher_meta; if active session exists, send RADIUS CoA Disconnect-Request to router
- [x] Random credential generator (alphanumeric, configurable length, avoid ambiguous chars like 0/O/l/1)
- [x] RADIUS CoA client utility — send Disconnect-Request (RFC 5176) via radclient to router's WireGuard IP on port 3799
- [ ] Write unit tests for voucher creation, quota enforcement, bulk creation atomicity

#### 6.2 Mobile App — Voucher Screens
- [x] **Voucher List Screen** — list vouchers with username, profile name, status (active/used/expired/disabled), creation date; filters by status and profile; search by username; router selector dropdown
- [x] **Create Voucher Screen** — form: auto/custom username, auto/custom password, RADIUS group profile dropdown, validity period, simultaneous-use (1-10, default 1), comment
- [x] **Bulk Create Screen** — quantity (1-100), RADIUS group profile, username prefix, username/password length selectors, validity period, comment
- [x] **Voucher Detail Screen** — show username, password, profile, status, creation date, expiration; actions: share, enable/disable toggle, delete
- [x] **Share Voucher** — use device share sheet (WhatsApp, SMS, etc.) with formatted voucher credentials text
- [ ] **Print Voucher** — generate printable card layout (thermal receipt or A4 multi-voucher) — deferred to Phase 2
- [x] Confirmation dialog on voucher deletion and enable/disable toggle
- [x] Pull-to-refresh on voucher list

---

### Epic 7: Session Monitoring

#### 7.1 Backend — Session APIs
- [x] `GET /routers/:id/sessions` — query RouterOS API via WireGuard for active hotspot sessions; return username, IP, MAC, uptime, data used (up/down), idle time, login time
- [x] `DELETE /routers/:id/sessions/:sid` — disconnect session via RouterOS API + send RADIUS CoA Disconnect-Request via radclient (fire-and-forget)
- [x] `GET /routers/:id/sessions/history` — query radacct table; paginated, filterable by username, date range, termination cause; return start/stop times, duration, data in/out, terminate cause, MAC, IP

#### 7.2 Mobile App — Session Screens
- [x] **Active Sessions Screen** — list connected users with username, IP, MAC, uptime, data used; auto-refresh every 30 seconds; manual refresh button; "Disconnect" button per session
- [x] **Session History Screen** (basic for MVP, full in Phase 2) — list past sessions with search and filters
- [x] Confirmation dialog on session disconnect
- [x] Loading skeleton while fetching sessions

---

### Epic 8: Dashboard

#### 8.1 Backend — Dashboard APIs
- [x] `GET /dashboard` — aggregated endpoint returning: active session count per router, vouchers created today, total data usage (24h from radacct), router statuses, subscription status + quota usage

#### 8.2 Mobile App — Dashboard Screen
- [x] **Dashboard Screen** — active sessions widget (30s refresh), vouchers created today (real-time), router status indicators (60s refresh), subscription status + quota usage bar
- [x] Quick-create voucher FAB or shortcut from dashboard
- [x] Skeleton loading states for all widgets
- [x] Pull-to-refresh to reload all widgets

---

### Epic 9: Testing & Deployment (MVP)

- [ ] Write integration tests for full voucher creation → RADIUS auth → accounting flow
- [ ] Write integration tests for router add → WireGuard tunnel → status monitoring flow
- [ ] Load test RADIUS authentication (target: 200+ concurrent auth requests)
- [ ] Load test API (target: 500+ concurrent users)
- [ ] Set up CI/CD pipeline
- [ ] Deploy backend + FreeRADIUS + PostgreSQL + Redis to VPS
- [ ] Configure TLS certificates (Let's Encrypt)
- [ ] Configure automated PostgreSQL backups (every 6 hours, retain 30 days)
- [ ] Set up Prometheus metrics + Grafana dashboards for monitoring
- [ ] Build and test mobile app on Android and iOS devices
- [ ] Submit to App Store and Google Play (or TestFlight/internal testing)

---

## Phase 2 — Growth (6 weeks post-MVP)

---

### Epic 10: Advanced Reports & Export

- [ ] `GET /reports/vouchers` — voucher sales report: created, used, expired, remaining by date range
- [ ] `GET /reports/sessions` — session report: total sessions, avg duration, total data consumed
- [ ] `GET /reports/revenue` — revenue estimate based on operator-set voucher pricing
- [ ] `GET /reports/uptime` — router uptime history, average uptime percentage
- [ ] PDF generation for reports
- [ ] CSV export for reports
- [ ] Mobile app: Reports screen with date range picker, report type selector, export buttons
- [ ] Gate reports behind Professional/Enterprise tier subscription check

---

### Epic 11: Push Notifications

- [ ] Integrate FCM (Android) and APNs (iOS) in mobile app
- [ ] Backend notification service: send push via FCM/APNs
- [ ] Trigger: Subscription expiring (7, 3, 1 day before)
- [ ] Trigger: Subscription expired
- [ ] Trigger: Payment confirmed (admin activates subscription)
- [ ] Trigger: Router offline (after 3-min grace) / Router back online
- [ ] Trigger: Voucher quota low (below 10%)
- [ ] Trigger: Bulk creation complete
- [ ] Mobile app: Notification preferences screen (enable/disable per category)
- [ ] Store FCM/APNs device tokens on backend, handle token refresh

---

### Epic 12: Bulk Voucher Printing

- [ ] Design thermal receipt printer voucher card layout (58mm/80mm width)
- [ ] Design A4 multi-voucher layout (8-12 vouchers per page)
- [ ] Generate printable PDF from voucher list
- [ ] Mobile app: Select multiple vouchers → Print action
- [ ] Mobile app: Connect to Bluetooth/USB thermal printer (if applicable)

---

### Epic 13: Multi-Language Support

- [ ] Extract all hardcoded strings to i18n resource files (should already be done from MVP setup)
- [ ] Translate all strings to French
- [ ] Translate all strings to Portuguese
- [ ] Translate all strings to Swahili
- [ ] Translate all strings to Arabic (including RTL layout support)
- [ ] Mobile app: Language selector in Settings
- [ ] Backend: Accept `Accept-Language` header, return localized error messages

---

### Epic 14: Admin Web Panel

#### 14.1 Admin Backend APIs
- [ ] Admin authentication (separate admin JWT or role-based)
- [ ] `GET /admin/users` — list, search, paginate all users
- [ ] `PUT /admin/users/:id` — edit, suspend, unsuspend user
- [ ] `DELETE /admin/users/:id` — delete user account
- [ ] `GET /admin/subscriptions` — list all subscriptions with status
- [ ] `PUT /admin/subscriptions/:id` — activate, extend, downgrade, cancel subscription
- [ ] `GET /admin/payments` — queue of pending payment receipts
- [ ] `PUT /admin/payments/:id` — approve or reject payment, activate subscription on approval
- [ ] `GET /admin/stats` — platform statistics (total users, active subs, total routers, total vouchers, system health)
- [ ] `GET /admin/routers` — all routers across all users with status
- [ ] `GET /admin/audit-logs` — timestamped admin action logs with filters
- [ ] Write to audit_logs on every admin mutation

#### 14.2 Admin Web Frontend
- [ ] Initialize web project (React/Next.js or similar)
- [ ] Admin login page
- [ ] Dashboard page: platform statistics cards, charts
- [ ] Users page: table with search, status filters, suspend/edit/delete actions
- [ ] Subscriptions page: table with activate/extend/cancel actions
- [ ] Payment verification page: queue of pending receipts with approve/reject
- [ ] Routers page: all routers with status, owner, last seen
- [ ] Audit logs page: filterable log table
- [ ] Responsive layout for desktop browsers

---

### Epic 15: Professional & Enterprise Tiers

- [ ] Update subscription plans with Professional ($12/mo) and Enterprise ($25/mo) options
- [ ] Enforce tier-specific router limits (1 / 3 / 10)
- [ ] Enforce tier-specific voucher quotas (500 / 2,000 / Unlimited)
- [ ] Enforce tier-specific feature access (session history, reports, export)
- [ ] Support multi-month subscription durations (Pro: 1-2 months, Enterprise: 1, 2, 6 months)
- [ ] Mobile app: Updated plan selection screen with all three tiers
- [ ] Mobile app: Upgrade/downgrade flow

---

### Epic 16: Session History (Full)

- [ ] Full session history with 90-day retention
- [ ] Advanced filters: username, date range, router, termination cause (timeout, manual disconnect, data limit, user logout, NAS reboot)
- [ ] Session detail view: all radacct fields
- [ ] CSV/PDF export of session history
- [ ] Gate full history + export behind Professional/Enterprise tier

---

### Epic 17: Biometric Login

- [ ] Implement fingerprint / Face ID authentication on mobile app
- [ ] Enable biometric only after initial email/password authentication
- [ ] Store auth token in biometric-protected secure storage
- [ ] Settings toggle to enable/disable biometric login

---

## Notes

- All backend API responses use consistent JSON format with proper HTTP status codes
- All database mutations that involve FreeRADIUS tables (radcheck, radreply, radusergroup, etc.) must be wrapped in transactions
- Router API credentials and WireGuard private keys are always encrypted at rest with AES-256
- Voucher usernames must be unique across the entire RADIUS database
- The `voucher_meta` table is the bridge between the application layer and FreeRADIUS tables — it links vouchers to users and routers for ownership/access control
