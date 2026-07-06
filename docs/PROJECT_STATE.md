# Wasel — Project State

> Living "where are we right now" snapshot. For architecture & conventions see `CLAUDE.md`; this file tracks in-flight work, the active blocker, and gotchas already hit. **Keep it updated as state changes.**

**Last updated:** 2026-07-02

## TL;DR
Security hardening (Critical RCE + 4 High findings) plus several follow-on features are committed and pushed on `dev`: mobile UX + Arabic localization, a voucher-code-collision fix, an admin panel polish/responsive pass, CI extended to run on `dev`, and the **operator-selectable hotspot login page** (built end-to-end), a **payment-flow fix** (receipt-less payments no longer reach the admin queue + a new admin payment-detail view with inline receipt preview), an **email-notification system** (admin payment alerts + bilingual editable templates + an email log), and an **admin Dashboard redesign** (data-dense operator console with KPI hero, status-breakdown donuts, a "Needs attention" panel, and real trend lines), and a **hotspot voucher bug-fix batch** (blank captive page on expiry, monthly re-prompt, and the "won't re-login until disable/reactivate" MAC-randomization bug — fixed with locally-bundled fonts, interim accounting + MAC-cookie, a stale-session reaper, `Simultaneous-Use`→20, and a clean reactivation path), and a **mobile payment-recovery fix** (a `pending`, receipt-less payment left the user with no way to upload/cancel — now Settings→Payments surfaces Upload/Cancel for any non-terminal payment, the payment id survives an app restart, and a back-guard stops silent orphaning). **All await the staging gate before promotion.** A dedicated **staging VPS** (`wa-sel.cloud`, `185.166.39.70`) is the pre-merge gate; the Docker stack has been deploying `dev` and reaching healthy. Production (`wa-sel.com`) is live with paying users and **untouched**.

## Branch / deploy state
- `main` — production. **Untouched** this cycle.
- `dev` — pushed to `origin/dev` (`github.com/mubarakbasher/wasel`); this is what the staging VPS pulls. Carries, on top of security hardening `7aa841f`: localized errors/offline session `2700de7`, splash-gate `253cef2`, compose healthcheck fix `840b9e0`, CI-on-dev + Admin CI `b1bb560`, voucher-collision fix `cbb3553`, admin polish/responsive `a02cb54`, the hotspot login page `32253b8`, the voucher provider test-stub alignment `98ef162`, the payment-flow fix `9a9b38a`, the email-notification system `4073289`, the admin Dashboard redesign `f89abb8`, the **hotspot voucher fixes** `999ecaf` (blank login page, MAC-randomization re-login, `Simultaneous-Use`=20, interim accounting + stale-session reaper), the **mobile payment-recovery fix** (Upload/Cancel for pending payments + paymentId rehydration + back-guard), and the **hotspot picker display fix** (RouterModel read the template fields as snake_case while the backend sends camelCase → the selected design was invisible; + apply success snackbar and router-side failure surfacing).
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
- **Picker display fix (2026-07-02, on `dev`):** `RouterModel.fromJson` read the three hotspot fields as `snake_case` while the backend serializes them `camelCase` (`hotspotTemplateId/Status/Error`), so `hotspotTemplateId` was **always null** — the "Selected" badge never showed and the detail row stayed "Not configured", i.e. selecting a design *looked* like a no-op. Fixed the mapping (+ aligned unused `toJson`), added an apply **success snackbar** (`ref.listen`), and made the provider **surface a router-side `failed`** status (backend returns 200 with `status='failed'`) instead of a false "applied". A pre-existing unit test had encoded the buggy snake_case contract (model tested against itself, not the backend) — corrected. Mobile only, no backend/migration. Verified: `flutter analyze` clean + **182 tests**.
- **Security:** audited (no Critical/High). The router pulls files **over the WireGuard tunnel** (`http://10.10.0.1:3000`), not the public WAN — no MITM surface, no router CA dependency.
- Verified: backend `tsc` clean + **246 tests**; mobile `dart analyze` clean. Apply-to-router path is covered only by mocked tests so far.
- **⚠️ Staging prerequisite:** add UFW rule `from 10.10.0.0/16 to any port 3000 proto tcp` on each VPS, or `/tool fetch` can't reach the backend and apply reports `failed` (documented in `STAGING.md` §1.3). **E2E to run:** apply a template → confirm `wasel-hotspot/login.html` on the router (`/file print`) + `html-directory` set → voucher still gets **Access-Accept** through the themed page.

## Landing page — BUILT (on `dev`, 2026-07-07)
Public marketing site for `wa-sel.com` at `landing/` (the apex previously served nothing; closes the ROADMAP launch-gate item). Bilingual **Arabic-first** (default `ar`/RTL, EN toggle persisted in localStorage) Vite + React 19 + Tailwind 4 SPA mirroring `admin/` conventions; brand tokens transcribed from `docs/UIUX_DESIGN_BRIEF.md`; self-hosted Cairo woff2 + portal `preview.png`s reused from `backend/src/hotspot-templates/`. Sections: hero (CSS app-card mock), trust strip, 4-differentiator bento with terminal mock, how-it-works, 6-feature grid, portal-design showcase, dark security band, FAQ (`<details>`), CTA band + footer. Copy respects the MARKETING_PLAN "claims to avoid" list (no iOS/PDF-export/SLA claims).
- **Deploy:** own nginx container (strict self-only CSP), compose service `landing` on `127.0.0.1:8080`; host-nginx vhost + certbot runbook added at `docs/deploy.md` §3.1. New `Landing CI` workflow (lint+build+docker on `landing/**`).
- Verified: lint + `tsc -b && vite build` clean (71 KB gz JS); Playwright pass AR+EN at 1440/375 — RTL mirrors, no h-scroll, zero console errors; images sized 500×920 (no CLS). Local `docker build` blocked by a machine-level Docker Hub 403 pulling `node:20-alpine` (same base as admin) — CI/VPS build will verify.
- **⚠️ Before go-live:** replace placeholder WhatsApp/APK links in `landing/src/config.ts`; DNS A records `wa-sel.com`+`www` → VPS; `certbot --nginx -d wa-sel.com -d www.wa-sel.com`.

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

## Payment recovery fix (mobile) — DONE (on `dev`, pending staging)
Follow-up to `9a9b38a` above. That change (correctly) hid receipt-less `pending` payments from the admin, but it removed the *accidental* safety net — the admin used to see and reject the orphan, which handed the user a `rejected` payment that had Cancel/Resubmit buttons. Operators then hit a trap: a user who backed out of the payment stepper before uploading was left with a `pending`, receipt-less payment that had **no** recovery buttons in the app (they rendered only for `rejected`), couldn't be uploaded to after an app restart (the `paymentId` lived only in in-memory `lastRequest`), and was invisible to the admin. **Mobile-only fix — the backend already permits cancel + (re)upload from `pending`** (`subscription.service.ts:326-328,373-375`); no backend change, no migration.
- `mobile/lib/screens/settings/payments_screen.dart` — the Cancel + Resubmit action row is no longer gated on `isRejected`; **any non-terminal payment** (pending or rejected) shows recovery actions: pending-no-receipt → "Upload receipt" + "Cancel", pending-with-receipt → "Replace receipt" + "Cancel" (+ an "awaiting review" note), rejected → unchanged. Reuses the existing `cancelPayment`/`resubmitReceipt` provider methods (they key off `PaymentRecord.id`, not `lastRequest`).
- `mobile/lib/screens/subscription/payment_screen.dart` — `initState` also `loadPayments()`; `_handleUpload` falls back to the current pending payment's id when `lastRequest` is null (survives an app restart); a **`PopScope` back-guard** intercepts leaving the stepper with a pending, receipt-less payment → "Upload later / Cancel payment / Stay".
- `mobile/lib/models/payment_record.dart` — new `hasReceipt` getter.
- i18n: new EN+AR keys in `app_localizations.dart` (`payments.uploadReceipt/replaceReceipt/pendingUploadHint/awaitingReviewNote`, `payment.leaveTitle/leaveBody/uploadLater/cancelPayment/stay`).
- Verified: mobile `flutter analyze` clean + **180 tests** (new `test/widgets/payments_screen_test.dart` asserts the pending recovery actions render).
- **Test artifact:** a **debug APK pointed at staging**, built via `flutter build apk --debug --dart-define=API_BASE_URL=https://api.wa-sel.cloud/api/v1` (debug because release cert-pinning trusts only `api.wa-sel.com`).
- **E2E to run:** pick a plan → payment screen → back before uploading → back-guard dialog → "Upload later" → Settings→Payments shows Upload+Cancel → upload → appears in admin queue; or Cancel → can pick a new plan; kill + relaunch mid-flow → upload still works (id rehydrated).

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

## Admin Dashboard redesign — DONE (on `dev` `f89abb8`, pending staging)
Replaced the flat 7-card dashboard with a data-dense operator console + real trend lines. Backend + admin; **no mobile change**.
- **New table** (migration `029_metrics_daily.sql`): a once-per-day snapshot keyed by `snapshot_date` (upsert).
- **`GET /admin/stats/timeseries?days=30`** (admin-only, `days` bounded 7–365): derives **real** daily history for revenue (approved `payments` by `reviewed_at`), new users (`users.created_at`), and vouchers (`voucher_meta.created_at`) over a `generate_series` date spine; active-subscriptions / routers-online come from `metrics_daily` snapshots (forward-only). Dates returned `YYYY-MM-DD` via `TO_CHAR` (pg DATE→JS Date gotcha).
- **`jobs/snapshotMetrics.ts`** daily cron (00:05 **UTC**-pinned) reuses `getStats()` and upserts today's row — single source of truth, no drift from the live stats.
- **Admin UI** (no new dependency — charts are hand-built SVG): KPI hero, a "Needs attention" panel (pending payments → `/payments`, offline/degraded routers → `/routers`, calm "all clear" otherwise), status-breakdown **donuts** surfacing ALL statuses, and a **Revenue|Users|Vouchers** trend chart (`TrendChart`); Users is the total-users trajectory (baselined to end on the KPI). Auto-refresh + "updated Xm ago"; responsive 375/768/1024/1440; a11y + reduced-motion.
- Verified: backend `tsc` clean + **314 tests**; admin build clean. Reviewed by security-auditor (no blockers) + code-reviewer (the pg-DATE-type blocker, cron/getStats duplication, and Users-trend framing all fixed in the same commit).
- **Trend population:** revenue/new-users/vouchers are real from day one (derived from base tables); active-subs/routers-online series start filling once the daily snapshot cron runs. **E2E to run on staging:** dashboard loads with KPIs + donuts (all statuses) + needs-attention links; `GET /admin/stats/timeseries?days=30` returns a populated series; the metric toggle works; run the snapshot job once → a `metrics_daily` row for today.

## Hotspot voucher fixes — DONE (on `dev`, pending staging)
Three operator-reported Mikrotik bugs, root-caused (3 Explore agents + official MikroTik/FreeRADIUS docs) and fixed across FreeRADIUS-table data, backend services/jobs, and the pushed captive-portal pages. **No mobile change.**
- **Blank/white login page on expiry** → the pushed pages loaded a render-blocking **external Google Fonts** stylesheet, unreachable before login (no walled-garden). Fonts are now **bundled locally** (per-design Latin woff2 + shared `cairo.woff2` for Arabic) with a hardened `system-ui` fallback so a missing file can never blank the page. `manifest.ts` ships them; `publicRouter.routes.ts` serves `.woff2`.
- **Monthly vouchers re-prompt / "won't work until disable+reactivate"** → root cause is **phone MAC-randomization**: the reconnecting (new-MAC) session is rejected because the old session is still open in `radacct` under `Simultaneous-Use := 1`, while no interim accounting + no stale-session cleanup let the dead row linger; plus a latched `Auth-Type := Reject` that only cleared from status `disabled`, not `expired`. Fixes:
  - **Interim accounting + MAC-cookie** pushed to the router profile (`routerOs.service.ensureHotspotRadiusSettings`: server profile `radius-accounting=yes radius-interim-update=00:05:00 login-by=mac-cookie,http-chap,http-pap,https`; user profile `add-mac-cookie=yes mac-cookie-timeout=30d`). Folded into **template re-apply** + **health remediation** (now targets the *failing* profile, not always `default`) + the onboarding script. A mac-cookie relogin still sends a fresh RADIUS Access-Request, so disable/expiry stay enforced.
  - **Stale-session reaper** (`jobs/staleSessionReaper.ts`, every 2 min): closes open `radacct` rows whose last interim is >15 min old (`acctstoptime = COALESCE(acctupdatetime, acctstarttime)`, no CoA, `acctsessiontime` untouched) → frees the `Simultaneous-Use` slot. Migration `030` adds the partial index for the sweep.
  - **`Simultaneous-Use` 1 → 20** (operator chose ">10"; tunable `VOUCHER_SIMULTANEOUS_USE` constant) so MAC-rotation overlap never rejects a reconnect; migration `031` backfills existing vouchers (UPDATE `value='1'` + INSERT for any missing the attribute). Trade-off: up to 20 devices per voucher — operator-accepted.
  - **Recovery path:** `updateVoucher` now clears the latched Reject from `expired` too (no more disable→reactivate dance); a genuinely usage-exhausted voucher returns a clear **409 `VOUCHER_LIMIT_REACHED`** instead of silently re-latching in 30 s. **Disable now also CoA-kicks the live session** (mirrors delete).
- Verified: backend `tsc` clean + **331 tests** (+ reaper / recovery / `ensureHotspotRadiusSettings` / updated wireguardConfig). Reviewed by radius-networking (ship-it, no correctness defects), security-auditor, and code-reviewer — all should-fix items landed in the same commit.
- **⚠️ Rollout (existing routers):** the interim/mac-cookie/login-page fixes only reach a router when its **template is re-applied** (`PUT /routers/:id/hotspot-template`) or it hits health remediation. **Re-apply the design on every onboarded router after deploy** (also clears the white page on already-pushed routers).
- **⚠️ Must-verify-before-prod (staging E2E):**
  1. Re-apply a design → router has `radius-accounting`/`radius-interim-update`/`login-by`/`add-mac-cookie` (check `/ip hotspot profile` + `/ip hotspot user profile`) and the captive page **renders** (no white screen).
  2. **Prove mac-cookie still enforces RADIUS** — disable a voucher, reconnect **without** retyping, confirm a fresh Access-Request → **Access-Reject** in `/log print where topics~"radius"`. (If it auto-resumes instead, drop `mac-cookie-timeout` to ≤ idle-timeout.) Belt-and-suspenders: disable now also fires CoA.
  3. Drop a session, reconnect with a **different MAC** → re-login **succeeds** (no Simultaneous-Use reject).
  4. Leave a stale open `radacct` row → reaper closes it within ~17 min; a live (interim-updating) session is untouched.
  5. Latch a capped voucher to `expired`, set it active → Reject cleared (false latch) **or** honest `409 VOUCHER_LIMIT_REACHED` (true exhaustion).

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
- `docs/release/` — release pack (2026-07-07): readiness scorecard + blocker checklist, marketing plan, roadmap
- `docs/STAGING.md` — staging VPS runbook (provision → E2E checklist → dev→staging→main promotion gate)
- `docs/SECURITY_AUDIT_2026-06-12.md` — the findings (local/untracked)
- `docs/deploy.md` — prod deploy · `docs/RUNBOOKS.md` — incident runbooks · `docs/test.md` — test plan
- `CLAUDE.md` — architecture, conventions, sub-agent routing
