# Wasel — Project State

> Living "where are we right now" snapshot. For architecture & conventions see `CLAUDE.md`; this file tracks in-flight work, the active blocker, and gotchas already hit. **Keep it updated as state changes.**

**Last updated:** 2026-06-30

## TL;DR
Security hardening (Critical RCE + 4 High findings) plus several follow-on features are committed and pushed on `dev`: mobile UX + Arabic localization, a voucher-code-collision fix, an admin panel polish/responsive pass, CI extended to run on `dev`, and the **operator-selectable hotspot login page** (built end-to-end), a **payment-flow fix** (receipt-less payments no longer reach the admin queue + a new admin payment-detail view with inline receipt preview), and an **email-notification system** (admin payment alerts + bilingual editable templates + an email log). **All await the staging gate before promotion.** A dedicated **staging VPS** (`wa-sel.cloud`, `185.166.39.70`) is the pre-merge gate; the Docker stack has been deploying `dev` and reaching healthy. Production (`wa-sel.com`) is live with paying users and **untouched**.

## Branch / deploy state
- `main` — production. **Untouched** this cycle.
- `dev` — pushed to `origin/dev` (`github.com/mubarakbasher/wasel`); this is what the staging VPS pulls. Carries, on top of security hardening `7aa841f`: localized errors/offline session `2700de7`, splash-gate `253cef2`, compose healthcheck fix `840b9e0`, CI-on-dev + Admin CI `b1bb560`, voucher-collision fix `cbb3553`, admin polish/responsive `a02cb54`, the hotspot login page `32253b8`, the voucher provider test-stub alignment `98ef162`, the payment-flow fix `9a9b38a`, and the email-notification system `4073289`.
- `staging-vps-setup` — feature branch, already fast-forward-merged into `dev`; safe to delete.

## Security hardening — DONE (on `dev`)
Closes every Critical/High in `docs/SECURITY_AUDIT_2026-06-12.md`:
- **F1 (Critical RCE)** — shell-injection in the CoA-disconnect paths → replaced with spawn-based `sendDisconnectRequest`; added `isSafeAcctSessionId` guard (`backend/src/utils/radius.ts`).
- **F2** quota TOCTOU → atomic guarded `UPDATE … RETURNING`. **F3** unbounded create/bulk-delete → Zod `.max(500)` + batched inserts + matching mobile cap/i18n. **F4** refresh-token replay → atomic Redis consume (`DEL`-returns-1). **F5/F8** orphaned RADIUS creds on delete → transactional `deleteRouter`/admin `deleteUser` purging `radcheck`/`radreply`/`radusergroup`/`nas`. **F11** wrong-session disconnect → CoA scoped by username.
- Verified: backend `tsc` clean + **192 tests**; mobile `analyze` clean + tests pass. Reviewed by security-auditor + code-reviewer.
- **Deferred** (non-blocking): `radacct` history purge on delete; FK-cascade migration (needs orphan cleanup first); 18 transitive `npm audit` items.

## Mobile UX + Arabic localization — DONE (committed on `dev`)
Done 2026-06-23, now committed/pushed on `dev`:
- **Splash → logo:** `SplashScreen` shows the wifi-monogram logo (not the "Wasel" wordmark); native launch screens too (Android `mipmap-*/launch_image` + both `launch_background.xml`; iOS `LaunchImage.imageset` + storyboard). iOS unverifiable on this Windows host.
- **Vouchers:** list page size `20 → 100` (`VouchersState.limit`); `deleteAllVouchers` now loops the filter-mode bulk-delete past the backend's 500/req cap so "Delete All" (with the Expired filter) truly clears **all** expired.
- **Arabic localization (6 leaks fixed):** subscription status, router online/offline, voucher limit/usage units, and a few brand/fallback strings now go through `context.tr(...)` (new helpers `lib/i18n/status_format.dart`, `lib/i18n/voucher_format.dart`); setup-guide steps localized client-side by step number; brand words transliterated in `_ar` (Mikrotik→مايكروتيك, WiFi→واي فاي). ~89 new keys in `app_localizations.dart` (`_en`+`_ar`).
- **Notifications localized end-to-end:**
  - In-app inbox re-renders title/body from `category`+`data` in the **live app language** (`notifications_screen.dart`).
  - **NEW backend migration `025_user_language.sql`** → `users.language` (`'en'`/`'ar'`, default `'en'`). `PUT /auth/profile` accepts `language`; `GET /auth/me` returns it. `notification.service.ts` looks up the stored language and builds localized title/body server-side (new `src/i18n/notificationStrings.ts`) so the **OS push-tray** is localized; `data` still carries params for the inbox.
  - Mobile syncs the chosen locale to the backend (`auth_service.updateLanguage`) on language toggle + after login/session-restore (best-effort).
- Verified: backend `tsc` clean + **221 tests** (was 192; +29 for auth-language & notification-strings); mobile `flutter analyze` clean.
- **Deploy note:** backend + migration `025` must clear the **staging gate** before prod; migration auto-runs on backend boot (staging currently shows "24 migrations ran" — next `dev` pull applies `025`).
- **Known gap (deferred):** a user on system-Arabic who never opens the in-app language toggle has no persisted locale → push tray stays English until they pick a language once (inbox still localizes). Closing it means syncing the effective system locale.

## Hotspot login page — BUILT (on `dev` `32253b8`), pending staging
Operators pick a captive-portal login page (clean / dark / warm) in the mobile app; Wasel applies it to the Mikrotik.
- **DB:** migration `026_router_hotspot_template.sql` → `routers.hotspot_template_{id,status,applied_at,error}`.
- **Templates:** `backend/src/hotspot-templates/{clean,dark,warm}/` — each a Mikrotik-valid `login.html` (CHAP via standard `md5.js`, `action=$(link-login-only)`, hidden password = voucher code, `$(if error)`), bilingual EN/AR, + `status/logout/alogin/rlogin/error.html` + a rendered `preview.png`. Source designs live in a Claude Design project (pull via the `DesignSync` MCP).
- **Backend:** public traversal-safe file route `GET /public/hotspot-templates/:key/:file`; `GET /routers/hotspot-templates`; `PUT /routers/:id/hotspot-template`; `applyHotspotTemplate()` has the router `/tool fetch` each file then sets the hotspot profile `html-directory=wasel-hotspot`. Apply failures → `status='failed'` (not 500) so the app shows Retry.
- **Mobile:** RouterModel fields, service+provider, card picker with previews + applied/failed state, router-detail entry, EN+AR keys.
- **Security:** audited (no Critical/High). The router pulls files **over the WireGuard tunnel** (`http://10.10.0.1:3000`), not the public WAN — no MITM surface, no router CA dependency.
- Verified: backend `tsc` clean + **246 tests**; mobile `dart analyze` clean. Apply-to-router path is covered only by mocked tests so far.
- **⚠️ Staging prerequisite:** add UFW rule `from 10.10.0.0/16 to any port 3000 proto tcp` on each VPS, or `/tool fetch` can't reach the backend and apply reports `failed` (documented in `STAGING.md` §1.3). **E2E to run:** apply a template → confirm `wasel-hotspot/login.html` on the router (`/file print`) + `html-directory` set → voucher still gets **Access-Accept** through the themed page.

## Other `dev` work landed this cycle (pending staging)
- **Voucher-code collision fix `cbb3553`** — creation now regenerates colliding 8-digit codes instead of aborting with "already on the system"; rare SELECT-vs-INSERT race → clean 409 not 500. +unit tests.
- **Admin polish + responsive `a02cb54`** — shared `Button`/`Modal`/`ConfirmDialog` primitives, a11y (status dots, `scope`, focus-trap, reduced-motion), a slide-in mobile sidebar drawer, accent normalized to blue. Lint+build clean.
- **CI on `dev` `b1bb560`** — backend/mobile CI now run on `dev` + manual dispatch; new Admin CI (lint+build+docker). Backend healthcheck fix `840b9e0` (probe `127.0.0.1`, IPv4 bind).

## Payment flow fix — DONE (on `dev` `9a9b38a`, pending staging)
Two defects in the manual bank-transfer flow, fixed backend + admin. **No migration** — `payments.receipt_url` was already nullable; this is a query/visibility + UI change.
- **Receipt-less payments no longer reach the admin.** The `payments` row is created up front at `POST /subscription/request` (so the bank `reference_code` can be shown) with `receipt_url=NULL`; receipt upload is a separate later call (`POST /subscription/receipt`). A user who viewed the bank details and backed out left a `pending`, receipt-less row the admin could see — and approve, activating a subscription with no proof of payment. Fixes:
  - `getPayments()` always filters `p.receipt_url IS NOT NULL` (every tab).
  - `reviewPayment()` carries the **same guard on its `UPDATE … WHERE`**, so approve/reject are refused at the action site too, not just hidden in the list (defense-in-depth vs direct API calls — security-auditor finding; list-hide alone was bypassable).
  - `getStats()` pending-payments tile now matches the actionable queue.
  - Also fixes the **"all" tab**, which showed only pending because the service defaulted `status || 'pending'`; the status predicate is now applied only when a status is provided.
- **Admin payment-detail view.** Backend `LEFT JOIN plans` for the display name (`plan_name`). Clicking a row opens a detail modal: payer, plan, amount, reference code, status/rejection reason, dates, and an **inline receipt-image preview** (via the host-allowlisted `resolveAssetUrl` — confirmed no XSS/phishing surface); Approve/Reject available from the modal.
- Verified: backend `tsc` clean + **254 tests** (new `backend/src/tests/adminPayments.test.ts` covers the `getPayments` WHERE-clause + the `reviewPayment` receipt guard); admin `tsc -b && vite build` clean. Reviewed by security-auditor + code-reviewer — both blocking findings fixed in the same commit.
- **E2E to run on staging:** a receipt-less pending payment is **absent** from the admin Payments tab → upload a receipt (`POST /subscription/receipt`) → it **appears** → click the row → detail modal shows the receipt image inline → Approve activates the subscription → the "all" tab lists every receipt-bearing payment across statuses.

## Email-notification system — DONE (on `dev` `4073289`, pending staging)
Closes "I didn't get notified when a user paid" + adds bilingual editable emails and an email log. Backend + admin only — **no mobile change** (recipient language comes from `users.language`, already synced from the app).
- **Two new tables** (migrations `027_email_templates.sql`, `028_email_log.sql`): `email_templates` (admin-editable, `UNIQUE(type,language)`, seeded 10 rows = 5 types × en/ar) and `email_log` (write-only send record, `user_id ON DELETE SET NULL`, subject-only).
- **5 email types**, each en+ar: `verification_otp`, `password_reset_otp`, `payment_submitted_admin` (admin alert), `payment_approved`, `payment_rejected`. The OTP emails were English-only before; now templated + localized + logged.
- **Admin payment alert:** on **receipt upload** (`subscription.service.uploadReceipt`), every active admin is emailed in their own language, **deduped per payment via Redis (5 min)** so re-uploads can't fan-out mail. User approve/reject emails fire after `reviewPayment` commits.
- **`email.service.ts`** refactored to a templated core: resolves `(type,lang) → (type,'en') → hard-coded DEFAULT_TEMPLATES` so a send never breaks on a missing/disabled row; user `{tokens}` HTML-escaped into the (admin-trusted) body; **subject is control-char-stripped + 255-capped, not HTML-escaped**. All sends are best-effort (can't break register / reset / receipt upload / payment review).
- **Admin panel:** new **Email Log** page (`/email-log`, clone of Audit Logs — type/status/recipient/date filters) and **Email Templates** editor (`/email-templates` — pick type + en/ar, edit subject + HTML body, placeholder reference, "send test to me"). Test-send goes only to the requesting admin; test-send + template-update are rate-limited (10/min/admin).
- **Retention:** `jobs/purgeEmailLog.ts` daily-deletes `email_log` rows older than **90 days**.
- Verified: backend `tsc` clean + **302 tests**; admin build clean. Reviewed by security-auditor + code-reviewer (no blockers; all should-fix items landed in the same commit).
- **Config note:** uses existing `SMTP_*` config — no new env. On staging/prod confirm `SMTP_HOST/PORT/USER/PASS/FROM` are set (dev uses MailHog at :8025; a misconfigured relay just logs `email_log.status='failed'`, never breaks the flow).
- **E2E to run on staging:** register (verify email logged + localized when user lang=ar) · forgot-password · request sub + upload receipt → each active admin gets a localized "please approve" email + an `email_log` row · approve/reject → user gets the localized email · edit a template + Save → next send uses it · "Send test to me" → arrives in admin inbox · Email Log filters work. **Add to `docs/STAGING.md`:** "send a test of each type in each language; verify the subject renders without HTML entities."
- **Ops notes:** migrations are idempotent (`ON CONFLICT DO NOTHING`) — **disabling/editing a seeded template in prod is a manual op and re-running migrations does NOT revert it**. `email_log` is pruned at 90 days (adjust the interval in `jobs/purgeEmailLog.ts` if a longer audit window is needed).

## Updating a deployed VPS (pull → rebuild)
Full runbooks: `docs/deploy.md` (§2 deploy, §7 useful commands) and `docs/STAGING.md`. Migrations **auto-run on backend boot** (idempotent), so a code pull is usually all that's needed. Quick reference:

**Staging** (`wa-sel.cloud` · `185.166.39.70` · repo `/opt/wasel`, branch `dev`):
```bash
cd /opt/wasel
git pull origin dev
# rebuild only what changed; the payment fix touches backend + admin:
docker compose --env-file /etc/wasel/compose.env build backend admin
docker compose --env-file /etc/wasel/compose.env up -d backend admin
docker compose --env-file /etc/wasel/compose.env ps            # all healthy?
curl http://localhost:3000/api/v1/health                       # {"status":"ok"}
docker compose --env-file /etc/wasel/compose.env logs -f backend   # confirm "migrations ran"
```
- This change adds **no migration**, so no DB step is needed (backend boot still runs the runner — a no-op here).
- **Admin gotcha (see Gotchas below):** the admin image bakes `VITE_API_URL` at build time. On staging it must be the staging API origin (same-origin `/api/v1`, or `https://api.wa-sel.cloud/api/v1`), **never** the prod default `api.wa-sel.com`. Verify the built bundle contains no `api.wa-sel.com` before exposing `admin.wa-sel.cloud`.
- A backend-only change can skip the admin rebuild: `… build backend && … up -d backend`. An admin-only change skips the backend.

**Production** (`wa-sel.com`, branch `main`) — **only** after staging passes and a `dev → main` fast-forward:
```bash
cd /opt/wasel               # prod path; uses the prod docker-compose.yml, never the dev one
git pull origin main
docker compose --env-file /etc/wasel/compose.env up -d --build
docker compose --env-file /etc/wasel/compose.env ps
curl http://localhost:3000/api/v1/health
```
**Never push directly to `main`. Prod is live with paying users** — promote `dev → main` fast-forward only, after the staging E2E checklist (`docs/STAGING.md` §11).

## Staging VPS bring-up — IN PROGRESS
Runbook: `docs/STAGING.md`. Host `185.166.39.70`, Ubuntu, repo at `/opt/wasel` on branch `dev`.
- **Docker stack:** ✅ up + healthy (postgres, redis, wireguard, freeradius, backend, admin). 24 migrations ran. Backend health `200` on `localhost:3000`.
- **Secrets:** `/etc/wasel/compose.env` (also copied to `/opt/wasel/.env` so `docker compose` runs without `--env-file`); `backend/.env` filled in. `CORS_ORIGIN=https://api.wa-sel.cloud`.
- **DNS:** apex `wa-sel.cloud` → VPS ✅. `api.wa-sel.cloud` / `admin.wa-sel.cloud` → **no A records yet**.
- **HTTPS:** ❌ **BLOCKED.** UFW allows 80/443 and nginx listens on `:80`, but external connect to `:80` times out → the **provider's network firewall** is dropping inbound 80/443 (SSH/22 works). No certs issued.

### ⚠️ Current blocker → next action
Open inbound **TCP 80 + 443** in the **VPS provider's** firewall/security-group console (provider TBD; UFW already allows them). Then:
1. `sudo certbot --nginx -d wa-sel.cloud` (apex already resolves) to confirm port 80 is reachable.
2. Add A records `api.wa-sel.cloud` + `admin.wa-sel.cloud` → `185.166.39.70`; cert each (`api` vhost already configured).
3. Continue: systemd autostart (`STAGING.md` §6) → point the physical Mikrotik at staging (§7) → run the E2E checklist (§11) → promote `dev` → `main` → prod.

## Gotchas already hit (don't re-debug these)
- **Postgres password ↔ volume:** `POSTGRES_PASSWORD` only takes effect on the **first** init of the `postgres_data` volume. If it ever differs from `backend/.env` `DB_PASSWORD`, the backend dies with PG error `28P01`. Fix: make the two identical, then `docker compose down -v` to drop & re-init the volume.
- **Compose env-file:** every `docker compose` command needs `--env-file /etc/wasel/compose.env`, OR rely on the `/opt/wasel/.env` copy (gitignored) which Compose auto-loads.
- **Admin baked prod URL:** `admin/.env.production` hardcodes `VITE_API_URL=https://api.wa-sel.com/api/v1`. Before exposing `admin.wa-sel.cloud`, rebuild the admin with `admin/.env.production.local` (`VITE_API_URL=/api/v1`, served same-origin) or it will talk to **prod**. Verify the built bundle contains no `api.wa-sel.com`.
- **Terminal paste:** multi-line pastes can inject a `^[[200~` bracketed-paste marker that corrupts the first command (`docker: command not found`) — run those commands one line at a time.

## Key references
- `docs/STAGING.md` — staging VPS runbook (provision → E2E checklist → dev→staging→main promotion gate)
- `docs/SECURITY_AUDIT_2026-06-12.md` — the findings (local/untracked)
- `docs/deploy.md` — prod deploy · `docs/RUNBOOKS.md` — incident runbooks · `docs/test.md` — test plan
- `CLAUDE.md` — architecture, conventions, sub-agent routing
