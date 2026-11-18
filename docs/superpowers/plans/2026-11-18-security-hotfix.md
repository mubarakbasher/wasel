# Security Hotfix (2026-11-18 API attack) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the attacker's leftovers from prod, make SSH key-only (keeping Hostinger's browser terminal), and ship a backend-only hotfix that stops IP spoofing, client-chosen upload extensions, public receipts, upload junk and 500s on malformed requests — released to prod on its own, without dev's unreleased commits.

**Architecture:**
- Tasks 1–2 are prod ops, run over SSH, each after the owner OKs the exact commands.
- Tasks 3–6 are code on `hotfix/security-2026-11-18`, branched from `origin/main` (583f810) in a separate worktree.
- Receipts become private files served by a new `GET /api/v1/receipts/:name` route that requires an HMAC-signed, 1-hour link. The backend mints these links wherever it returns a receipt path; the DB keeps the stored `/uploads/receipts/<name>` path unchanged.
- Tasks 7–10 gate and release: security review, staging, a phone test, then a fast-forward of `main` and a backend-only prod deploy.

**Tech Stack:** Node 20, Express 5, TypeScript, multer 2.1.1, file-type 16, Vitest 4 + Supertest, Postgres 16, Redis 7, UFW/OpenSSH on Ubuntu 24.04, Flutter (debug APK for the phone test).

**Spec:** `docs/superpowers/specs/2026-11-18-security-hotfix-design.md` (approved 2026-11-18)

## Global Constraints

- Every prod action (Tasks 1, 2, 10) needs the owner's explicit OK in the conversation for that step. The auto-mode safety check may block a prod command until the owner confirms it; never work around a block.
- Deploy off-peak: not 17:00–19:00 UTC, not 01:15–01:45 UTC. Take a manual `pg_dump` before the deploy.
- Hotfix code is **backend only**: no migration, no admin or mobile change, no new env var, no new npm dependency. Never regenerate a package-lock on Windows (`npm ci` is fine).
- Reuse existing error codes only (`backend/src/utils/errorCodes.ts`). The mobile parity test requires a translation for every code, so a new code would force a mobile change. Use `VALIDATION_ERROR` (malformed request / bad upload), `TOKEN_INVALID` (bad or expired receipt link), `NOT_FOUND` (missing receipt).
- Signed links:
  - path `/api/v1/receipts/<name>?exp=<unix seconds>&sig=<base64url>`;
  - `sig` = HMAC-SHA256 over `<name>.<exp>`;
  - key = HKDF-SHA256(`Buffer.from(config.ENCRYPTION_KEY,'hex')`, empty salt, info `wasel-receipt-url-v1`, 32 bytes);
  - TTL 3600 s.
- Receipt name pattern (old and new): `^[0-9a-f-]{36}-\d{13}(-[0-9a-f]{8})?\.(jpg|jpeg|png|webp)$`.
- Receipt response headers:
  - `Content-Type` from the magic-byte sniff;
  - `Content-Disposition: inline`;
  - `X-Content-Type-Options: nosniff`;
  - `Content-Security-Policy: default-src 'none'`;
  - `Cross-Origin-Resource-Policy: same-site` (the admin at `admin.wa-sel.com` embeds images from `api.wa-sel.com`; helmet's default `same-origin` blocks that);
  - `Cache-Control: private, max-age=3600`.
- `app.set('trust proxy', 'loopback')`.
- Attacker user ids (16) and admin id are fixed in Task 1. Do not widen the clean-up without the owner.
- Owner prefers few, larger commits: per-task commits on the hotfix branch are squashed into one before merge (Task 7).

## Review Focus

1. **The admin panel's inline `<img>` receipt preview across subdomains.** The image must render, so receipt responses carry `Cross-Origin-Resource-Policy: same-site`. Pinned by a header assertion in Task 5.
2. **Garbage in the link** (`sig` of the wrong length, non-numeric or huge `exp`, missing params). Expect 403 `TOKEN_INVALID`, never a 500 (`timingSafeEqual` throws on a length mismatch). Pinned in Task 5.
3. **A receipt file missing from the volume, or a valid link to non-image content.** Expect 404, never 500. Pinned in Task 5.
4. **A phone photo over 5 MB.** Expect 413 `VALIDATION_ERROR` and nothing left on disk (it is 500 today). Pinned in Task 4.
5. **A legacy receipt named `<uuid>-<13 digits>.jpeg`**, the old naming. It must still be served, with its type taken from the sniff. Pinned in Task 5.

---

### Task 1: Prod clean-up and evidence (ops — owner OK required)

**Files:** none in the repo. Prod only: `/root/incident-2026-11-18/` (exists, root-only).

**Interfaces:**
- Produces: the evidence copy on the server (Task 10 must not run before this), disabled attacker accounts, and the quarantined files.
- Constants:
  - Admin id (admin@wa-sel.com): `e45dd474-8c3f-4329-9a6c-e99d8c614b77`.
  - Attacker ids: `5d0d109f-881b-4609-841c-9ed0ce7b6aef`, `5d9ed399-9dec-40e5-a88b-c8403e3ef720`, `a02e2c48-a109-44b9-9024-5bc32eb3541f`, `d240dfd2-e326-4768-b57e-5e482b9a53ce`, `150e249c-c6a9-402f-946e-982207216499`, `549dd5f2-1d69-4a73-8d6a-5976da652d3d`, `cd4043d6-4afe-4733-a8cf-aaa23bbe205f`, `e8874e99-50d3-4c9f-bb59-588dabd80432`, `e9938556-b6ec-4803-aa96-46b152673b04`, `c2585f1a-e65b-4518-a088-c0f64fc71000`, `a99c208f-2145-4eec-a938-30ff5113c35a`, `e7e791d9-a0b1-4a75-b30c-dbc58f110413`, `595e65cf-fbf8-4bdc-9ae8-85e5ebe8bb29`, `a9a90535-2a6c-4831-bec3-163774da65fb`, `4b8f7171-6b74-4a6e-a526-bcf697c3a108`, `6de979fe-e81e-447e-bdbc-ba0979049e4a`.

- [ ] **Step 1: Re-check the account list (read-only)**

Run (prod psql, `default_transaction_read_only=on`):
```sql
select id, email, created_at from users where created_at >= '2026-11-18 18:00' order by created_at;
```
Expected: exactly the 16 ids above. If any other row with a disposable domain (mailinator / euploading / example.com) appears, show it to the owner and add it only if they agree.

- [ ] **Step 2: Save the evidence on the server**

Run: `docker logs --since 2026-11-18T17:30:00Z wasel-backend-1 > /root/incident-2026-11-18/backend.log 2>&1`, then copy `/var/log/nginx/access.log*` covering 2026-11-18 and `/var/log/auth.log` into the same folder, then `chmod -R go-rwx /root/incident-2026-11-18`.

Expected: `grep -c 64.118.148.221 backend.log` ≥ 2462.

- [ ] **Step 3: DB clean-up in one transaction (show the script to the owner first)**

```sql
BEGIN;
UPDATE users SET is_active = false, updated_at = NOW() WHERE id IN (<16 ids>);                       -- expect 16
UPDATE payments SET status='rejected', reviewed_by='e45dd474-8c3f-4329-9a6c-e99d8c614b77',
       reviewed_at=NOW(), rejection_reason='Abuse — security incident 2026-11-18'
 WHERE user_id IN (<16 ids>) AND status='pending';                                                    -- expect 3
UPDATE subscriptions SET status='cancelled', updated_at=NOW()
 WHERE user_id IN (<16 ids>) AND status IN ('pending','pending_change');                              -- expect 6
INSERT INTO audit_logs (admin_id, action, target_entity, target_id, details, ip_address)
VALUES ('e45dd474-8c3f-4329-9a6c-e99d8c614b77','incident.cleanup','user',NULL,
        jsonb_build_object('incident','2026-11-18','user_ids', ARRAY[<16 ids>]), NULL);
COMMIT;
```
Expected: the row counts in the comments. If any count differs, `ROLLBACK` and report to the owner.

- [ ] **Step 4: Delete their refresh sessions in Redis**

For each id, inside `wasel-redis-1`, scan `refresh:<id>:*` and delete the keys. Authenticate with the container's own `$REDIS_PASSWORD`; check it exists first with `docker exec wasel-redis-1 sh -c 'test -n "$REDIS_PASSWORD" && echo ok'`.

Expected: a second scan returns nothing for any of the 16.

- [ ] **Step 5: Quarantine their receipt files**

Move every file in `/var/lib/docker/volumes/wasel_backend_uploads/_data/receipts/` whose name starts with one of the 16 ids into `/root/incident-2026-11-18/receipts/`.

Expected: ≥ 114 files moved. `find … -newermt '2026-11-18 18:00'` in `receipts/` now lists only non-attacker files, if any.

- [ ] **Step 6: Verify**

Expected:
- the 16 users have `is_active=false`;
- `SELECT count(*) FROM payments WHERE status='pending' AND user_id IN (<16>)` returns 0;
- the admin panel's pending queue no longer shows them (the owner glances at it).

Record the counts in the memory file `project_prod_api_attack_2026_11_18.md`.

---

### Task 2: SSH key-only, keeping Hostinger's browser terminal (ops — owner OK required)

**Files:** prod `/etc/ssh/sshd_config.d/00-wasel-hardening.conf` (new).

- [ ] **Step 1: Write the file** with exactly:
```
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
Match Address 169.254.0.1
    PasswordAuthentication yes
    PermitRootLogin yes
```

- [ ] **Step 2: Validate before reloading**

Run: `sshd -t && sshd -T -C addr=203.0.113.9,user=root,host=x | grep -E '^(passwordauthentication|permitrootlogin) ' && sshd -T -C addr=169.254.0.1,user=root,host=x | grep -E '^(passwordauthentication|permitrootlogin) '`

Expected:
- for `203.0.113.9`: `passwordauthentication no`, `permitrootlogin without-password` (OpenSSH prints `prohibit-password` as `without-password`);
- for `169.254.0.1`: `passwordauthentication yes`, `permitrootlogin yes`.

- [ ] **Step 3: Reload with the current session kept open**

Run: `systemctl reload ssh`. Keep the session that made the change open until Step 5 passes.

- [ ] **Step 4: Prove a new key login works and passwords are refused**

Run from the laptop:
- `ssh -i ~/.ssh/wasel_ops -o BatchMode=yes root@wa-sel.com true` → exit 0;
- `ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password -o BatchMode=yes root@wa-sel.com true` → `Permission denied (publickey)`.

- [ ] **Step 5: The owner opens the hPanel browser terminal once**

Expected: it logs in as root. If it doesn't, remove the file, `systemctl reload ssh`, and report.

---

### Task 3: Hotfix worktree + `trust proxy 'loopback'`

**Files:**
- Modify: `backend/src/app.ts:15-23` (setting + comment)
- Test: `backend/src/tests/trustProxy.test.ts`

**Interfaces:**
- Produces: the branch `hotfix/security-2026-11-18` and the worktree `../Wasel-hotfix`, which Tasks 4–7 use.

- [ ] **Step 1: Create the worktree and record the baseline**

Run:
```
git fetch origin
git worktree add -b hotfix/security-2026-11-18 ../Wasel-hotfix origin/main
cd ../Wasel-hotfix/backend
npm ci
npx vitest run
```
Expected: the branch is at 583f810 and the suite is green. Record the pass count.

- [ ] **Step 2: Write the failing tests** in `trustProxy.test.ts`:
  - replace the `toBe(1)` assertion with `expect(app.get('trust proxy')).toBe('loopback')`;
  - add `it('trusts only loopback peers')`:
    ```ts
    const trust = app.get('trust proxy fn') as (addr: string, i: number) => boolean;
    expect(trust('127.0.0.1', 0)).toBe(true);
    expect(trust('::1', 0)).toBe(true);
    expect(trust('10.10.0.238', 0)).toBe(false);
    expect(trust('64.118.148.221', 0)).toBe(false);
    ```
  - keep the two existing loopback-peer XFF tests (single entry → `203.0.113.9`; `'6.6.6.6, 203.0.113.9'` → `203.0.113.9`). Supertest connects from loopback, so they still describe Nginx.

- [ ] **Step 3: Run** `npx vitest run src/tests/trustProxy.test.ts`. Expected: FAIL (`1` ≠ `'loopback'`).

- [ ] **Step 4: Implement** `app.set('trust proxy', 'loopback')`. Rewrite the comment above it: Nginx on the same host is the only trusted hop, and WireGuard peers on `10.10.0.1:3000` get their socket IP.

- [ ] **Step 5: Run** the same file. Expected: PASS.

- [ ] **Step 6: Commit** `fix(security): trust X-Forwarded-For only from loopback (Nginx)`.

---

### Task 4: Upload hardening — real extension, limits, error mapping, clean-up of rejected uploads

**Files:**
- Modify: `backend/src/middleware/upload.ts`
- Modify: `backend/src/routes/subscription.routes.ts:39-46`
- Modify: `backend/src/tests/subscription.test.ts:8-21` (module mock)
- Create: `backend/src/tests/receiptUpload.test.ts`

**Interfaces:**
- Produces (exports of `upload.ts`):
  - `RECEIPTS_DIR: string`, which Task 5 uses;
  - `uploadReceiptSingle(req, res, next): void`;
  - `cleanupUploadOnError(req, res, next): void`;
  - `verifyUploadMagicBytes`, which now renames the file to its detected extension;
  - the existing `RECEIPTS_PUBLIC_PREFIX = '/uploads/receipts'` (unchanged; the stored path).
- Stored filename after a successful upload: `<userId>-<13-digit ms>-<8 hex>.<jpg|png|webp>`.

- [ ] **Step 1: Write the failing tests** in `receiptUpload.test.ts`. They run against the real middleware (no upload mock) with `UPLOAD_DIR` set to a fresh `mkdtemp` dir inside `vi.hoisted`, before `app` is imported.
  - The DB is mocked through `globalThis.__mockPoolQuery`, as in `subscription.test.ts`.
  - Stub `../services/email.service` (`sendPaymentSubmittedAdminAlert` resolves) so the fire-and-forget alert doesn't consume mocks.
  - PNG fixture: base64 `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==`.
  - Tests:
    - `stores a real PNG uploaded as "x.html" under a .png name`: owned pending payment → 200. `RECEIPTS_DIR` holds exactly one file, matching `^<TEST_USER.userId>-\d{13}-[0-9a-f]{8}\.png$`, and the UPDATE's first param equals `/uploads/receipts/<that name>`.
    - `removes the file when the payment belongs to someone else`: 403 `PAYMENT_FORBIDDEN`, then `await vi.waitFor(() => expect(readdirSync(dir)).toEqual([]))`.
    - `removes the file when paymentId fails validation` (`paymentId: 'nope'`): 400 `VALIDATION_ERROR`, dir empty.
    - `rejects text posing as image/png`: 400 `INVALID_FILE_CONTENT`, dir empty (regression).
    - `returns 413 VALIDATION_ERROR for a file over 5 MB` (PNG header + padding to 5 MB + 1): 413, `error.code === 'VALIDATION_ERROR'`, dir empty. *(Review Focus 4)*
    - `returns 400 VALIDATION_ERROR for a truncated multipart body`: `Content-Type: multipart/form-data; boundary=x` with an unterminated part → 400 `VALIDATION_ERROR`.
    - `returns 400 VALIDATION_ERROR for two files in one request`: 400 `VALIDATION_ERROR`, dir empty.

- [ ] **Step 2: Run** `npx vitest run src/tests/receiptUpload.test.ts`. Expected: FAIL (wrong extension, 500s, leftover files).

- [ ] **Step 3: Implement in `upload.ts`:**
  - Export `RECEIPTS_DIR`.
  - The multer `filename` is `${userId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.upload`. Never read `file.originalname`.
  - Add `limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 }`.
  - `verifyUploadMagicBytes`: after an allowed detection, `fs.promises.rename` the file to the same base with `.jpg` / `.png` / `.webp` (keyed by `image/jpeg` / `image/png` / `image/webp`), then update `file.path` and `file.filename`.
  - `uploadReceiptSingle`: calls `uploadReceipt.single('receipt')` and maps its error:
    - `AppError` → unchanged;
    - `MulterError` with `code === 'LIMIT_FILE_SIZE'` → `new AppError(413, 'Receipt image is too large (max 5 MB)', 'VALIDATION_ERROR')`;
    - anything else → `new AppError(400, 'Malformed upload', 'VALIDATION_ERROR')`;
    - log at `warn`.
  - `cleanupUploadOnError`: registers `res.on('finish')`. If `res.statusCode >= 400` and `req.file?.path` is set, it `unlink`s that path (read at finish time, after any rename) and ignores ENOENT. Then calls `next()`.

- [ ] **Step 4: Change the route chain** to `authenticate, uploadReceiptSingle, cleanupUploadOnError, verifyUploadMagicBytes, validate({ body: uploadReceiptSchema }), subscriptionController.uploadReceipt`.

- [ ] **Step 5: Update the `vi.mock('../middleware/upload')` in `subscription.test.ts`:**
  - `uploadReceiptSingle` sets `req.file` (the filename becomes a valid new-style name: `${TEST_USER.userId}-1795000000000-abcdef12.jpg`);
  - `cleanupUploadOnError` is pass-through;
  - keep `verifyUploadMagicBytes` and `RECEIPTS_PUBLIC_PREFIX`;
  - add `RECEIPTS_DIR: '/tmp'`.

- [ ] **Step 6: Run** `npx vitest run src/tests/receiptUpload.test.ts src/tests/subscription.test.ts`. Expected: PASS.

- [ ] **Step 7: Commit** `fix(security): store uploads under their detected type; 4xx for bad uploads; drop rejected files`.

---

### Task 5: Private receipts — signed links + receipt route; remove public `/uploads`

**Files:**
- Create: `backend/src/utils/receiptLinks.ts`
- Create: `backend/src/controllers/receipt.controller.ts`
- Create: `backend/src/routes/receipt.routes.ts`
- Modify: `backend/src/routes/index.ts:97-108` (add `router.use('/receipts', receiptRoutes)`)
- Modify: `backend/src/app.ts:61-77` (delete the `/uploads` static block and `INLINE_IMAGE_EXTENSIONS`)
- Modify: `backend/src/services/subscription.service.ts:624` (`getUserPayments`)
- Modify: `backend/src/controllers/subscription.controller.ts:67-71` (`uploadReceipt` response)
- Modify: `backend/src/services/admin.service.ts` (`getPayments` returned rows; `reviewPayment` returned row)
- Test: create `backend/src/tests/receiptLinks.test.ts` and `backend/src/tests/receiptRoute.test.ts`; modify `subscription.test.ts` and `adminPayments.test.ts`

**Interfaces:**
- Consumes: `RECEIPTS_DIR` from `middleware/upload.ts` (Task 4).
- Produces:
  - `RECEIPT_LINK_TTL_SECONDS = 3600`;
  - `RECEIPT_NAME_RE` (the pattern in Global Constraints);
  - `signReceiptUrl(storedPath: string | null | undefined, nowMs?: number): string | null`, which returns null unless the input is exactly `/uploads/receipts/<name>` with `name` matching `RECEIPT_NAME_RE`;
  - `verifyReceiptLink(name: string, exp: unknown, sig: unknown, nowMs?: number): boolean`, which never throws;
  - `serveReceipt(req, res, next): Promise<void>`.

- [ ] **Step 1: Write the failing unit tests** in `receiptLinks.test.ts`:
  - `signs a stored path into a relative receipts link`: for `/uploads/receipts/<uuid>-1795000000000-abcdef12.png` at `nowMs = 1_800_000_000_000`, the result matches `^/api/v1/receipts/<name>\?exp=1800003600&sig=[A-Za-z0-9_-]{43}$`.
  - `returns null for anything that is not a standard stored receipt path`: `null`, `'https://cdn.wa-sel.com/receipts/r1.jpg'`, `'/uploads/receipts/x.html'`, `'/uploads/receipts/../../etc/passwd'`, `'/uploads/other/<valid name>'`.
  - `verifies its own link until expiry`: true at `nowMs`, false at `nowMs + 3600_001`.
  - `rejects tampering and garbage without throwing`: false for a tampered name; a tampered exp; a sig one char short; a sig of 200 chars; `exp='abc'`; `exp='99999999999999999999'`; `exp`/`sig` `undefined`; `exp` as an array. *(Review Focus 2)*

- [ ] **Step 2: Write the failing route tests** in `receiptRoute.test.ts`. Use a temp `UPLOAD_DIR` via `vi.hoisted` holding:
  - `A` = new-style `.png` containing the PNG fixture;
  - `B` = legacy `<uuid>-1700000000000.jpeg` containing JPEG bytes (`FF D8 FF E0` + padding);
  - `C` = a valid-named `.png` containing text.

  Links are built with `signReceiptUrl`. Tests:
  - `serves a valid link with locked-down headers`: 200; `content-type` `image/png`; `content-disposition` `inline`; `x-content-type-options` `nosniff`; `content-security-policy` `default-src 'none'`; `cross-origin-resource-policy` `same-site`; `cache-control` `private, max-age=3600`. *(Review Focus 1)*
  - `serves a legacy .jpeg receipt by its sniffed type`: 200, `image/jpeg`. *(Review Focus 5)*
  - `refuses an expired, tampered or malformed link`: 403, `error.code === 'TOKEN_INVALID'` for expired, flipped-sig, short-sig and missing-params links. *(Review Focus 2)*
  - `404 for a name outside the pattern`: `x.html`, `..%2F..%2Fetc%2Fpasswd`, `a.png`.
  - `404 when the signed file is missing or not an image`: a valid link to a deleted file; a valid link to `C`. *(Review Focus 3)*
  - `the old public path is gone`: `GET /uploads/receipts/<A>` → 404.

- [ ] **Step 3: Run** both files. Expected: FAIL (module and route missing).

- [ ] **Step 4: Implement `receiptLinks.ts`.**
  - The key is computed once (lazily) with `crypto.hkdfSync` per Global Constraints.
  - `sig` = `createHmac('sha256', key).update(`${name}.${exp}`).digest('base64url')`.
  - `verifyReceiptLink` checks, in order:
    1. `typeof exp === 'string' && /^\d{1,12}$/.test(exp)`;
    2. `Number(exp) * 1000 > nowMs`;
    3. `typeof sig === 'string'` with the expected length;
    4. `timingSafeEqual`.

- [ ] **Step 5: Implement the route and controller.**
  - `serveReceipt` checks in this order:
    1. `req.params.name` matches `RECEIPT_NAME_RE`, else `AppError(404, 'Receipt not found', 'NOT_FOUND')`;
    2. `verifyReceiptLink(name, req.query.exp, req.query.sig)`, else `AppError(403, 'Receipt link is invalid or expired', 'TOKEN_INVALID')`;
    3. `FileType.fromFile(path.join(RECEIPTS_DIR, name))`; ENOENT or a non-allowed mime → 404 `NOT_FOUND`.
  - Then set the six headers from Global Constraints and stream the file (`res.sendFile` with `Content-Type` set first, or `fs.createReadStream`).
  - `receipt.routes.ts` is `router.get('/:name', serveReceipt)`, mounted at `/receipts` in `routes/index.ts`.
  - Delete the static block from `app.ts`.

- [ ] **Step 6: Sign at every emitter:**
  - `getUserPayments` → `receiptUrl: signReceiptUrl(row.receipt_url)`.
  - The `uploadReceipt` controller stores `${RECEIPTS_PUBLIC_PREFIX}/${file.filename}` (unchanged) and responds with `receiptUrl: signReceiptUrl(storedPath)`.
  - `admin.service getPayments` maps `payments` to `{ ...row, receipt_url: signReceiptUrl(row.receipt_url) }`.
  - `reviewPayment` returns `{ ...payment, receipt_url: signReceiptUrl(payment.receipt_url) }`.
  - Afterwards run `git grep -n -E "receipt_url|receiptUrl" -- backend/src ':!backend/src/tests' ':!backend/src/migrations'`. No other emitter should remain.

- [ ] **Step 7: Update the existing tests:**
  - In `subscription.test.ts`, the upload success test asserts `res.body.data.receiptUrl` matches `^/api/v1/receipts/` and the UPDATE param is `/uploads/receipts/<mock filename>`. Add a `GET /subscription/payments` assertion: a stored standard path comes back signed, and `null` stays `null`.
  - In `adminPayments.test.ts`, change the fixture `receipt_url` to a standard `/uploads/receipts/<valid name>`, and assert the GET returns a signed link and the PUT's returned row is signed.

- [ ] **Step 8: Run** `npx vitest run src/tests/receiptLinks.test.ts src/tests/receiptRoute.test.ts src/tests/subscription.test.ts src/tests/adminPayments.test.ts src/tests/errorCodes.contract.test.ts`. Expected: PASS.

- [ ] **Step 9: Commit** `fix(security): receipts only via signed 1-hour links; close public /uploads`.

---

### Task 6: 4xx for malformed request bodies

**Files:**
- Modify: `backend/src/middleware/errorHandler.ts:44-59`
- Test: create `backend/src/tests/errorHandler.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `truncated JSON gets 400 VALIDATION_ERROR`: `POST /api/v1/auth/login` with `Content-Type: application/json`, body `{"email":` → 400, `error.code === 'VALIDATION_ERROR'`.
  - `JSON over the 10mb limit gets 413 VALIDATION_ERROR`.
  - `client errors log at warn, not as "Unhandled error"`: spy on `logger.warn` / `logger.error` for the truncated-JSON case.
  - `a plain thrown Error is still a 500 INTERNAL_ERROR`: call `errorHandler(new Error('boom'), req, res, next)` with stub req/res and assert `status(500)` and `code: 'INTERNAL_ERROR'`.

- [ ] **Step 2: Run** `npx vitest run src/tests/errorHandler.test.ts`. Expected: FAIL (500s).

- [ ] **Step 3: Implement.**
  - Before the generic branch, read `status = err.status ?? err.statusCode` (typed loosely).
  - If it is a number in 400–499:
    - `logger.warn('Client request error', { status, type: err.type, method, url })`;
    - respond `status` with `{ success: false, error: { message: status === 413 ? 'Request body too large' : 'Malformed request', code: 'VALIDATION_ERROR' } }`;
    - skip Sentry.
  - `AppError` handling stays first and is unchanged.

- [ ] **Step 4: Run** the file. Expected: PASS.

- [ ] **Step 5: Commit** `fix(security): malformed request bodies get 4xx, not 500`.

---

### Task 7: Branch gate — full suite, security audit, architecture review, squash

- [ ] **Step 1:** In `../Wasel-hotfix/backend` run `npx tsc --noEmit && npx vitest run`. Expected: clean typecheck, all green, pass count ≥ the baseline plus the new tests.
- [ ] **Step 2:** Dispatch the `security-auditor` agent on `git diff origin/main...hotfix/security-2026-11-18`, with the spec path. Fix Critical/High findings in a follow-up commit and re-run Step 1. Report Medium/Low findings to the owner.
- [ ] **Step 3:** Dispatch the `code-reviewer` agent for the cross-cutting review (CLAUDE.md adherence; nothing outside `backend/`; no new codes/env/deps). Fix and re-run Step 1.
- [ ] **Step 4: Squash** to one commit:
  ```
  git reset --soft origin/main
  git commit -m "fix(security): hotfix after 2026-11-18 API attack" -m "<one line per Task 3–6 change>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
  Expected: `git log --oneline origin/main..HEAD` shows 1 commit, and `git diff --stat origin/main` touches only `backend/`.

---

### Task 8: Merge to dev, deploy staging, staging checks

- [ ] **Step 1:** In the main checkout, `git checkout dev && git merge --no-ff hotfix/security-2026-11-18`. Leave the existing uncommitted lockfile changes alone; don't stage them. Then `git push origin dev`.
- [ ] **Step 2:** Deploy staging per `docs/STAGING.md`: `/opt/wasel`, branch `dev`, rebuild `backend`. Leave the untracked `docker-compose.override.yml` alone. Expected: the backend is healthy and `https://api.wa-sel.cloud/api/v1/health` returns 200.
- [ ] **Step 3: Copied-app request.** Use the staging account the owner provides (ask now; Task 9 needs it too). Log in → create a starter payment (`POST /subscription/request`, body per `subscription.validators.ts`) → upload a real JPEG as multipart `paymentId` + `receipt` with filename `x.html`. Expected:
  - 200;
  - `GET /subscription/payments` shows a `receiptUrl` starting `/api/v1/receipts/`;
  - the file in the staging volume ends `.jpg`;
  - the link returns 200 `image/jpeg` with the six headers;
  - the same link with one `sig` char changed returns 403;
  - `/uploads/receipts/<file>` returns 404;
  - truncated JSON to `/auth/login` returns 400.
- [ ] **Step 4: Admin.** On `admin.wa-sel.cloud`, open that payment's detail. Expected: the receipt renders inline and "View full size" opens it. Then reject the payment.
- [ ] **Step 5: Router.** If staging router `test` is `online` in `routers`, apply a hotspot template from the app or API. Expected: backend log lines `RouterOS … /public/hotspot-templates/… 200` from its 10.10.x IP. If it's offline, note it and rely on the prod check in Task 10.

---

### Task 9: Real phone test on staging (owner's device)

- [ ] **Step 1:** `git worktree add --detach ../Wasel-mainapp origin/main`, then check that `mobile/pubspec.yaml` shows `version: 1.0.4+5`. If it doesn't, stop and ask the owner which commit the released app came from.
- [ ] **Step 2:** In `../Wasel-mainapp/mobile`, run `flutter build apk --debug --dart-define=API_BASE_URL=https://api.wa-sel.cloud/api/v1`. Expected: `unzip -l build/app/outputs/flutter-apk/app-debug.apk | grep arm64-v8a/libflutter.so` lists the file.
- [ ] **Step 3:** The owner installs it, signs in with the staging account, picks a plan and uploads a receipt photo. Expected:
  - the app shows "receipt uploaded";
  - staging Nginx logs `POST /api/v1/subscription/receipt 200` with a `Dart/` user-agent;
  - the stored file has an image extension;
  - the receipt renders in the staging admin panel.

  Then reject that payment.
- [ ] **Step 4:** `git worktree remove ../Wasel-mainapp`.

---

### Task 10: Prod release (owner OK required) and follow-through

- [ ] **Step 1: Preconditions.** Task 1 Step 2 (evidence) is done. The time is outside 17:00–19:00 and 01:15–01:45 UTC. The owner says go.
- [ ] **Step 2: Backup.** Take the manual `pg_dump` per `docs/RUNBOOKS.md` / `docs/deploy.md` into `/root/backups/pre-hotfix-<date>.sql.gz`. Expected: the file is non-empty and `gzip -t` passes.
- [ ] **Step 3: Promote.** Run `git checkout main && git merge --ff-only hotfix/security-2026-11-18 && git push origin main`. If a hook blocks the push to `main`, show the owner the command to run. Expected: `origin/main` equals the squashed commit, and `git merge-base --is-ancestor origin/main dev` is true.
- [ ] **Step 4: Deploy.** On prod: `cd /root/wasel && git pull origin main && docker compose up -d --build backend`. Expected: `wasel-backend-1` is healthy and `https://api.wa-sel.com/api/v1/health` returns 200.
- [ ] **Step 5: Prod checks.**
  - The Nginx 5xx count for the 15 minutes after the deploy is no higher than before.
  - The owner opens one real receipt in the admin panel; it renders inline.
  - The next router template fetch over the tunnel returns 200 (`RouterOS` user-agent).
  - The first real customer upload logs `POST /api/v1/subscription/receipt 200` with a `Dart/` user-agent, and the file is stored as `.jpg`/`.png`/`.webp`.
- [ ] **Step 6: Rollback, only if Step 4 or 5 fails.** On prod, `git checkout 583f810 && docker compose up -d --build backend` (rollback images are pruned daily, so it rebuilds from source). Tell the owner.
- [ ] **Step 7: Records.**
  - Update `docs/PROJECT_STATE.md` (prod at the new main and what shipped) and commit it on `dev`.
  - Update memory `project_prod_api_attack_2026_11_18.md` (fixes live; open backlog: staging SSH hardening, disposable-email signups, per-request `is_active` check).
  - `git worktree remove ../Wasel-hotfix` and delete the branch locally.
