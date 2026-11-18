# Security hotfix after the 2026-11-18 API attack — design

**Status:** awaiting owner approval (builder-checked) · **Date:** 2026-11-18 · **Target:** prod (`wa-sel.com`) via a hotfix branch off `main`

## Why

On 2026-11-18 from 18:14 UTC an automated attacker (64.118.148.221, curl + python-requests) spent ~40 minutes probing the API: 16 throwaway accounts, admin-endpoint probing, path traversal, template-injection names, a cross-account isolation test, X-Forwarded-For spoofing through the public backend port, and 114 "receipt" uploads with `.php/.html/.svg/.js/...` names. **Nothing was breached** (no admin access, no real account touched, no paid plan, host clean — full findings in memory `project-prod-api-attack-2026-11-18`). But the probe exposed real holes. The owner wants every one of them closed on prod, **shipped on its own** without the 26 unreleased commits on `dev`.

## Already done (2026-11-18 ~18:58 UTC, owner-confirmed)

- UFW: `deny from 64.118.148.221` (rule 1); `allow 3000/tcp from 10.10.0.0/16` (rule 2); public `3000/tcp` v4+v6 removed. Backups in `/root/incident-2026-11-18/`.
- Verified: `:3000` times out from the internet; api/admin/landing answer 200.

## Goals

1. Remove the attacker's leftovers from prod (accounts, pending payments, sessions, junk files) and keep the evidence.
2. SSH accepts keys only.
3. Close the code holes:
   - a. Nobody can fake their IP to the backend, including WireGuard peers that still reach `10.10.0.1:3000`.
   - b. An upload is stored under its **real** image type, never the uploader's extension.
   - c. Receipts are readable only through a link the backend hands to the receipt's owner or an admin.
   - d. Upload junk from rejected requests does not stay on disk.
   - e. Malformed requests get a 4xx, not a 500.
4. Ship 3 to prod alone; dev features (card speed limit, Analytics, print templates, …) stay off prod.

## Non-goals

- Nginx rate limits. Operators sit behind shared carrier IPs (many in the same 153.67.x / 98.97.x pools), so per-IP limits at Nginx risk locking out real users. With 3a done, the backend's existing per-IP limiters see real IPs again.
- Blocking disposable-email domains / CAPTCHA on register.
- Deleting the previous file when a customer re-uploads a receipt (kept as dispute evidence).
- Per-request `is_active` check in the auth middleware (a disabled account's access token lives ≤ 15 min; refresh already refuses inactive users).
- The hotspot-template endpoint returning router name/accent for a known router UUID.
- SSH hardening on staging (worth doing, separate step).
- Alerting/monitoring.

## Anti-goals (failure even if "it works")

- Routers can no longer fetch hotspot pages (`http://10.10.0.1:3000/api/v1/public/hotspot-templates/...`).
- Any existing customer receipt becomes unviewable in the admin panel.
- The released mobile app (1.0.4+5) needs an update or breaks in the payment flow.
- Any dev-only feature reaches prod.
- We lock ourselves out of the prod VPS.
- The attack evidence is lost. The local copy is already taken, and the server copy is written during the clean-up, before any deploy recreates the backend container.

## Constraints

- Every prod action needs the owner's explicit OK in the conversation; the auto-mode safety check may also ask the owner to confirm the exact command.
- Deploy off-peak: not 17:00–19:00 UTC; not 01:15–01:45 UTC. Manual `pg_dump` before deploy.
- No new env var on prod if avoidable (no compose.env edit). Secrets come from `config`.
- Never regenerate package-locks on Windows. No new dependency is expected.
- Owner prefers few, larger commits.
- Reuse existing error codes only. `mobile/test/i18n/backend_error_codes_test.dart` requires a mobile translation for every entry in `errorCodes.ts`, so a new code would drag a mobile change into this backend-only fix. Use `VALIDATION_ERROR`, `TOKEN_INVALID` and `NOT_FOUND`.
- Pre-merge gate: `wasel-security` audit of the diff, then the orchestrator's architecture review.

## Approaches

**Release path** (owner picked **A**)
- **A. Hotfix branch off `main`, released alone, then merged into dev.** Prod gets only the fixes. Main stays an ancestor of dev, so the next normal `dev → main --ff-only` still works.
- B. Ride the next full release. Less work, but receipts stay public and uploads keep attacker-chosen types for weeks, until the speed limit and Analytics are cleared.

**Receipt privacy** (my call: **signed links**)
- **Signed, short-lived links.** The backend turns the stored path into `/api/v1/receipts/<name>?exp=…&sig=…` whenever it returns a payment. `<img src>` keeps working with no Bearer header, so the admin panel and mobile app need no change. A leaked link dies in 1 hour.
- Authenticated endpoint plus the admin fetching blobs with a Bearer token. This rewrites the admin receipt view, and "View full size" on a blob URL would open attacker content inside the admin origin — a new XSS path.
- Unguessable random filenames, still public. The smallest change, but a link works forever and anyone holding it can read it. It doesn't meet goal 3c.

**IP trust** (my call: **`trust proxy 'loopback'`**)
- **`'loopback'`.** Trust `X-Forwarded-For` only when the socket peer is 127.0.0.1/::1, i.e. Nginx on the same host. A tunnel peer's `req.ip` becomes its real 10.10.x.x address.
- Firewall only (already done). This doesn't cover WireGuard peers, which still reach the whole API on 10.10.0.1:3000 and can still spoof.

## Design

### 1. Prod clean-up (ops, now — independent of the code)

One SQL transaction plus a Redis and file step, run after the owner OKs the exact script.

**Accounts.** The 16 attacker users, listed explicitly by id. Each was created ≥ 2026-11-18 18:19 UTC with a mailinator.com / euploading.com / example.com address. Re-check for any later registrations from the same pattern before running.
- `users.is_active = false`.
- Pending `payments` → `status='rejected'`, `reviewed_by` = admin@wa-sel.com's id, `reviewed_at=now()`, `rejection_reason='Abuse — security incident 2026-11-18'`. This includes `eaf481c3`, which has no receipt and so can't be rejected from the admin UI. Direct SQL sends no email; that is intended.
- Their `pending` / `pending_change` `subscriptions` → the same "cancelled" status the app uses when a user cancels a payment (builder checks the exact value in `subscription.service.ts`).
- One `audit_logs` row: action `incident.cleanup`, admin = admin@wa-sel.com, details = the user ids.

**Sessions.** Delete the Redis keys `refresh:<userId>:*` for each of the 16.

**Files.** Move every receipt file whose name starts with one of those ids into `/root/incident-2026-11-18/receipts/`. Do not delete them.

**Evidence.** The backend's docker logs are capped at 3 × 10 MB (`json-file`), which is about 24 hours of traffic. On 2026-11-18 the earliest retained line was 2026-11-17 18:58. A local copy was taken at ~19:05 UTC that day, into the session scratchpad `incident-2026-11-18/`:
- backend logs since 17:30 UTC: 2,462 attacker lines, first 18:18:42, last 18:58:54;
- the day's Nginx access log: 2,478 attacker lines;
- the current `auth.log`.

As part of the clean-up, also write the same evidence on the server into `/root/incident-2026-11-18/` (root-only) so it outlives the scratchpad.

### 2. SSH key-only (ops, now)

- Root cause: `/etc/ssh/sshd_config.d/50-cloud-init.conf` sets `PasswordAuthentication yes`. sshd takes the first value it reads, so it beats `60-cloudimg-settings.conf`'s `no`.
- **The fallback must survive.** Hostinger's hPanel browser terminal logs in **over SSH with the root password**. The owner's past browser-terminal sessions appear in `wtmp` as root on `pts/0` from `169.254.0.1`, Hostinger's link-local address, which can't be routed from the internet. A plain "keys only" config would shut that door and leave root access resting on one key file on the owner's laptop.
- Add `/etc/ssh/sshd_config.d/00-wasel-hardening.conf`. It is read first, so it wins, and it survives cloud-init rewriting `50-`:
  ```
  PasswordAuthentication no
  KbdInteractiveAuthentication no
  PermitRootLogin prohibit-password
  Match Address 169.254.0.1
      PasswordAuthentication yes
      PermitRootLogin yes
  ```
  The builder checks the effective result with `sshd -T -C addr=203.0.113.9,user=root,host=x` (expect password **no**) and `sshd -T -C addr=169.254.0.1,user=root,host=x` (expect password **yes**).
- Steps:
  1. `sshd -t`.
  2. Reload `ssh`, keeping the current session open.
  3. Confirm a **new** key login works.
  4. Confirm a password-only attempt from the internet gets `Permission denied (publickey)`.
  5. The owner opens the hPanel browser terminal once and confirms it still logs in. If it doesn't, revert by removing the file and reloading.
- Fallback if all else fails: Hostinger recovery mode. It reboots the VPS, which drops voucher logins for a few minutes.

### 3. Code (hotfix branch `hotfix/security-2026-11-18` off `origin/main` 583f810)

All backend. No migration, no admin or mobile change expected.

**3a. IP trust.** `app.set('trust proxy', 'loopback')` in `backend/src/app.ts`. Update `backend/src/tests/trustProxy.test.ts`, which currently asserts `1`:
- the real app's setting is `'loopback'`;
- a non-loopback peer sending `X-Forwarded-For` gets its own socket IP as `req.ip`;
- a loopback peer (Nginx) still yields the client IP;
- a spoofed left-hand XFF entry behind Nginx is ignored.

**3b. Upload naming and limits** (`backend/src/middleware/upload.ts`)
- Multer writes a neutral temp name: `<userId>-<ms>-<8 hex random>.upload`. The client's `originalname` and extension are never used.
- `verifyUploadMagicBytes` renames the file to the detected type's extension (`.jpg` / `.png` / `.webp`) and updates `req.file.path` / `filename` before the controller stores `receipt_url`.
- Add multer limits `files: 1`, `fields: 5` (the route expects `paymentId` + `receipt`).

**3c. Clean-up of rejected uploads.** Right after multer on the receipt route, add a small middleware. When the response finishes with status ≥ 400 and `req.file` exists, it unlinks the file. This covers Zod validation failures, `PAYMENT_NOT_FOUND`, `PAYMENT_FORBIDDEN`, `PAYMENT_NOT_RESUBMITTABLE` and DB errors, none of which clean up today. Replaced receipts on a successful re-upload are not deleted (non-goal).

**3d. Private receipts via signed links**

- **Remove** the public `app.use('/uploads', express.static(...))` from `app.ts`.

- **New helper `signReceiptUrl(storedPath)`.**
  - Input: the stored `/uploads/receipts/<name>`.
  - Output: `/api/v1/receipts/<name>?exp=<unix s>&sig=<base64url>`.
  - `sig` = HMAC-SHA256(`key`, `<name>.<exp>`).
  - `key` = HKDF-SHA256 from `config.ENCRYPTION_KEY`, info `wasel-receipt-url-v1`, 32 bytes. No new env var.
  - TTL: 1 hour.
  - Null in → null out.

- **Apply it at every place that returns a receipt path:**
  - `getUserPayments` (`subscription.service.ts`, field `receiptUrl`);
  - the `POST /subscription/receipt` response (`subscription.controller.ts`);
  - admin `GET /admin/payments` rows and the `PUT /admin/payments/:id` returned row (`admin.service.ts`).

  The DB keeps the stored path unchanged. The builder greps for any other place that emits `receipt_url` / `receiptUrl`.

- **New route `GET /api/v1/receipts/:name`.** No Bearer token, because `<img>` can't send one. Instead:
  - `name` must match `^[0-9a-f-]{36}-\d{13}(-[0-9a-f]{8})?\.(jpg|jpeg|png|webp)$`, otherwise 404. This covers both the old and new naming and makes path traversal impossible.
  - `exp` must be in the future, and `sig` must be valid under a timing-safe compare; otherwise 403 `TOKEN_INVALID`.
  - The file's magic bytes are sniffed. Only JPEG, PNG or WebP is served, with:
    - `Content-Type` taken from the sniff;
    - `Content-Disposition: inline`;
    - `X-Content-Type-Options: nosniff`;
    - `Content-Security-Policy: default-src 'none'`;
    - `Cross-Origin-Resource-Policy: same-site`;
    - `Cache-Control: private, max-age=3600`.

    Anything else, or a missing file, gets 404 `NOT_FOUND`.
  - Why `same-site`: helmet's default `same-origin`, which receipts get today, blocks the admin at `admin.wa-sel.com` from embedding an image from `api.wa-sel.com`. Prod's admin build uses `VITE_API_URL=https://api.wa-sel.com/api/v1`, so today's inline `<img>` preview is likely blocked.
  - It sits under `/api/`, so `generalLimiter` applies.

- **Clients.**
  - Admin: `resolveAssetUrl` prefixes the API origin to a relative path and keeps the query string, so `<img src>` and "View full size" keep working. The builder confirms this in the admin panel on staging.
  - Mobile: it only checks `receiptUrl != null`, so it is unaffected.
  - Legacy data: all 557 receipt paths created before the attack match the standard shape (checked on prod 2026-11-18). The only 4 odd ones belong to the attacker.

**3e. 4xx for malformed requests** (`backend/src/middleware/errorHandler.ts`)
- Before the generic 500 branch, an error carrying a numeric `status` / `statusCode` in 400–499 (body-parser `entity.parse.failed` 400, `entity.too.large` 413) returns that status with a generic message and code `VALIDATION_ERROR`.
- On the receipt route, wrap the multer call so that any error it raises (MulterError, busboy "Malformed part header" / "Unexpected end of form") becomes 400 `VALIDATION_ERROR`, or 413 for `LIMIT_FILE_SIZE`.
- These are logged at warn, not as "Unhandled error".

**Tests** (Vitest/Supertest, in the hotfix):
- a real PNG uploaded as `x.html` is stored as `.png`;
- a rejected upload (another user's paymentId) leaves no file behind;
- signed link: valid → 200 with an image content-type; expired → 403; tampered → 403; bad name / traversal → 404; non-image content → 404;
- `/uploads/...` → 404;
- malformed JSON → 400; malformed multipart → 400;
- trust proxy as in 3a.

### 4. Release flow

1. Branch from `origin/main`, implement, one commit (plus tests) per the owner's commit style.
2. `wasel-security` audit of the diff, then the architecture review.
3. `git checkout dev && git merge --no-ff hotfix/security-2026-11-18`, push `dev`, deploy staging (`/opt/wasel`).
4. Staging checks (below).
5. **With the owner's explicit OK:**
   1. Save the evidence (§1) if not yet saved.
   2. Take a `pg_dump`.
   3. `git checkout main && git merge --ff-only hotfix/security-2026-11-18 && git push origin main`.
   4. On prod: `git pull origin main && docker compose up -d --build backend`, off-peak.
6. Main is again an ancestor of dev, so the next normal promotion stays fast-forward.
7. Update `docs/PROJECT_STATE.md` and memory.

### 5. Verification

**Staging**
- A real JPEG uploaded as `x.html` is stored as `.jpg`, and the response holds a signed `/api/v1/receipts/…` link.
- Admin panel → Payments → detail shows the receipt, and "View full size" opens it.
- An old `/uploads/receipts/<file>` URL → 404; a tampered or expired link → 403.
- A rejected upload leaves no file in the volume.
- Malformed JSON / multipart → 400.
- The backend log shows real client IPs for requests through Nginx.
- A router on staging (`test`, if online) can still apply a hotspot template.
- **App upload check (owner picked "copy + real phone").**
  1. **Copied request.** Send the exact receipt upload the app sends (`mobile/lib/services/subscription_service.dart`: multipart, fields `paymentId` + `receipt`) from a staging test account. Expect 200, and a non-null `receiptUrl` in `GET /subscription/payments`.
  2. **Real phone.**
     - Build a debug APK from the **released app's code**, i.e. the `mobile/` tree at `origin/main`, using a git worktree, not `dev`, whose app has unreleased changes. Point it at staging: `flutter build apk --debug --dart-define=API_BASE_URL=https://api.wa-sel.cloud/api/v1`, and confirm the APK contains `arm64-v8a/libflutter.so`.
     - On the owner's phone or an emulator, sign in with a staging account the owner provides or registers in the app. Pick a plan, upload a receipt photo, and confirm the payment shows "receipt uploaded".
     - The receipt then opens in the staging admin panel.
     - Afterwards, reject that staging payment from the admin panel.

**Prod after deploy**
- `/api/v1/health` 200.
- No 5xx spike in Nginx.
- The owner opens one real receipt in the admin panel.
- The next router hotspot-template fetch over the tunnel succeeds (backend log shows `RouterOS` user-agent 200s).
- The first real customer receipt upload after the release succeeds: Nginx `POST /api/v1/subscription/receipt 200` from a `Dart/` user-agent, and the file is stored with an image extension.

## Left to the builder

- Helper/module names and file layout.
- 403 vs 404 for a bad signature (either is fine; don't leak which part failed).
- How the trust-proxy test simulates a non-loopback peer.
- The exact "cancelled" subscription status value.
- Whether the multer wrapper lives in `upload.ts` or the route file.

## Calls made without the owner (check these)

- Signed 1-hour receipt links rather than a login-protected download.
- Signing key derived from the existing `ENCRYPTION_KEY` (no new env var).
- Nginx rate limits dropped (shared carrier IPs).
- Replaced receipts kept on disk.
- Attacker files moved to `/root/incident-2026-11-18/`, not deleted.
- Direct SQL clean-up (no emails to the attacker), with one `audit_logs` row for traceability.
- `00-wasel-hardening.conf` for SSH rather than editing cloud-init's file, with a password exception only for Hostinger's browser terminal (`169.254.0.1`).
