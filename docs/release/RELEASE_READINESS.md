# Release Readiness — v1.0 promotion cycle

**Date:** 2026-07-07 · **Scope:** everything on `dev` (`518e024`) not yet on `main` (`92878e2`, 2026-04-26 — ~27 commits, migrations 025–031)
**Method:** 7 parallel deep scans (backend / mobile / admin / infra / docs / security / product) over the full repo + docs, cross-checked against `docs/PROJECT_STATE.md`.

---

## Verdict: 76 / 100 — **code-ready, gate-blocked**

The software itself is in very good shape: every API group exists with zero stubs or TODO markers, 331 backend + 182 mobile tests pass, `tsc`/`analyze`/lint are clean everywhere, and every Critical/High security-audit finding is verifiably fixed in code. What blocks the release is **not code — it is the un-run release gate and a short list of ops prerequisites.** The staging E2E checklist (`docs/STAGING.md` §11) — the project's own hard precondition for `dev → main` — has never executed because the staging VPS provider's network firewall drops inbound TCP 80/443, so staging has no HTTPS.

**This gate blockage is itself the biggest live risk:** production has been running the *vulnerable* CoA-disconnect code (Critical RCE, F1 in `docs/SECURITY_AUDIT_2026-06-12.md`) since April, while the fix sits on `dev`. Promoting this batch makes prod **safer**, not riskier. Treat unblocking staging as urgent.

**Time to release once the provider firewall opens: roughly 2–4 focused days** (staging bring-up completion ~½ day, gate run with a physical router ~1 day, small code fixes ~½ day, promotion + prod rollout ops ~½–1 day).

## Scorecard

| Area | Score | One-line assessment |
|---|---:|---|
| Backend | 82 | 95 endpoints across 12 groups, 331 tests green, disciplined config; all RADIUS/RouterOS paths are mock-tested only — staging must prove them. |
| Admin panel | 82 | Complete owner console, CI green; zero automated tests on a payment-approval surface; minor login-error UX bug. |
| Security | 82 | All Critical/High findings closed with regression tests; 5 Mediums deferred; npm audit has 6–7 high findings (2 first-order, fixable); seed admin credential must be confirmed rotated. |
| Mobile | 80 | Feature-complete, 182 tests, real release signing; cert "pinning" is a no-op, release-signed build never tested live, 1 missing AR key, store distribution not ready. |
| Docs | 72 | Excellent references and runbooks; STAGING §11 checklist is stale vs this batch; real secrets printed in tracked docs. |
| Product / business | 70 | Payment funnel hardened this batch; no trial tier, placeholder prices in seed, no landing page, sideload-only distribution. |
| Infra / ops | 66 | Solid single-VPS compose stack; **zero monitoring/alerting**, backups exist only as doc snippets, no real rollback artifact. |

---

## Critical path (do these in order)

1. **Unblock staging** — open inbound TCP 80/443 in the *provider's* firewall console for `185.166.39.70`; add A records `api.wa-sel.cloud` + `admin.wa-sel.cloud`; issue certs (`certbot --nginx`). (`PROJECT_STATE.md` "Current blocker")
2. **Push `dev`** — local `dev` is **2 commits ahead of `origin/dev`** (`518e024` hotspot picker fix, `a0bd240` payment recovery). Staging pulls `origin/dev`; deploying now would gate an incomplete batch. *(verified 2026-07-07)*
3. **Fold the per-feature E2E addenda from `PROJECT_STATE.md` into `STAGING.md` §11** before running the gate — otherwise the checklist passes while the riskiest changes (hotspot/mac-cookie/payments/email) go unverified.
4. **Land the small pre-gate code fixes** (section B below) so the gate tests final code.
5. **Deploy staging & run the full gate** (section C) — including a **release-signed APK**, not the debug one.
6. **Promote** `dev → main --ff-only` and execute the prod rollout prerequisites + post-deploy ops (sections D & E).

---

## A. Unblock the gate (external/ops — nothing else matters until these are done)

- [ ] Provider firewall: allow inbound TCP 80 + 443 to the staging VPS (UFW already allows them; the drop is upstream).
- [ ] DNS: A records for `api.wa-sel.cloud` and `admin.wa-sel.cloud` → `185.166.39.70`.
- [ ] TLS: `certbot --nginx` for apex + api + admin vhosts.
- [ ] `git push origin dev` (2 unpushed commits — see critical path #2).
- [ ] Staging UFW: `allow from 10.10.0.0/16 to any port 3000 proto tcp` (hotspot template `/tool fetch` path, `STAGING.md` §1.3).
- [ ] **Rebuild the staging admin with a same-origin `VITE_API_URL`** and verify the bundle contains no `api.wa-sel.com` — otherwise the staging panel mutates **prod** data during the gate itself (`PROJECT_STATE.md` gotcha). Note `admin/nginx.conf` CSP also hardcodes `api.wa-sel.com` and will block a non-same-origin staging API.

## B. Pre-gate code fixes (small, do before the gate run)

- [ ] **Missing Arabic key `payment.uploadReceipt`** (`mobile/lib/i18n/app_localizations.dart`: EN 665 vs AR 664 keys) — the primary CTA of the new payment-recovery flow renders English for Arabic users. One line.
- [ ] **npm audit first-order highs:** `multer` (DoS, reachable via receipt upload) and `nodemailer` — both report `fixAvailable=true`. Run `npm audit fix`, re-run the 331-test suite. (Defer the `firebase-admin`/`file-type` major bumps — FCM-path only.)
- [ ] **Decide on mobile cert pinning before shipping a release APK:** the current implementation is a no-op — `badCertificateCallback` only fires for *already-invalid* certs, and it compares a full-cert-DER hash against SPKI pins, which can never match (`mobile/lib/services/api_client.dart:86-104` vs its own comments at lines 27–40). Net behavior today = standard TLS (safe), but a release build has **never** been run against a live backend. Minimum bar: build a release-signed APK against staging and confirm login works; then either fix pinning properly or remove the claim (tracked in ROADMAP).
- [ ] (Recommended, 5-line fix) Admin login UX: exempt `/auth/login` from the 401-refresh interceptor so a wrong password shows "Invalid credentials" instead of "No refresh token available" (`admin/src/lib/api.ts:104`, `LoginPage.tsx:29`).
- [ ] Verify the Mobile CI `build-apk` job is actually green on GitHub — `google-services.json` is gitignored and no workflow step provisions it, which should fail the Google Services Gradle plugin on a clean checkout.

## C. The gate itself — staging E2E (updated §11)

Base checklist (`STAGING.md` §11: register/OTP → subscription → router onboarding script → WG handshake → RouterOS API → voucher create → phone Access-Accept → disable → Access-Reject → delete → CoA kick), **plus this batch's addenda** from `PROJECT_STATE.md`:

- [ ] **Hotspot templates:** apply a design → `wasel-hotspot/login.html` present on router (`/file print`), `html-directory` set, page **renders** (no white screen); router profile shows `radius-accounting`/`radius-interim-update`/`login-by`/`add-mac-cookie`.
- [ ] **Mac-cookie still enforces RADIUS:** disable a voucher, reconnect without retyping → fresh Access-Request → **Access-Reject** in `/log print where topics~"radius"`. (If it auto-resumes, drop `mac-cookie-timeout` ≤ idle-timeout.)
- [ ] **MAC-randomization re-login:** drop a session, reconnect with a different MAC → succeeds (no Simultaneous-Use reject).
- [ ] **Stale-session reaper:** a stale open `radacct` row closes within ~17 min; a live interim-updating session is untouched.
- [ ] **Voucher recovery:** latch a capped voucher to `expired`, set active → Reject cleared, or honest `409 VOUCHER_LIMIT_REACHED`.
- [ ] **Payments (admin):** receipt-less pending payment absent from Payments tab → upload receipt → appears → detail modal shows inline receipt → Approve activates subscription → "all" tab shows every receipt-bearing payment.
- [ ] **Payment recovery (mobile):** back out of the stepper pre-upload → back-guard dialog → Settings→Payments shows Upload/Cancel → upload works after app kill+relaunch (id rehydrated).
- [ ] **Email system:** each of the 5 types sends in **both** languages; subjects render without HTML entities; template edit takes effect; "send test to me" arrives; Email Log filters work; `email_log` rows written.
- [ ] **Dashboard:** KPIs + donuts + needs-attention render; `GET /admin/stats/timeseries?days=30` populated; snapshot job run once → `metrics_daily` row exists.
- [ ] **Release-signed APK** (not debug) completes login + a full voucher flow against staging over HTTPS.
- [ ] Migrations 025–031 applied cleanly on staging boot (log shows "migrations ran").
- [ ] Record pass/fail + timestamp in `PROJECT_STATE.md`.

## D. Prod promotion prerequisites (before/at `main` deploy)

- [ ] **Pre-promote encrypted DB backup** — and first confirm `/etc/wasel/backup.key` actually exists on the prod VPS (`deploy.md` "Step 0"; nothing confirms this one-time step was done).
- [ ] **Rollback plan is currently fictional:** `STAGING.md` §12 references GHCR image tags no workflow produces. Before this 7-migration batch, write down the real rollback (git checkout previous `main` + rebuild + restore backup) and keep the backup at hand.
- [ ] **Prod UFW:** `allow from 10.10.0.0/16 to any port 3000 proto tcp` — without it every template apply on prod reports `failed`.
- [ ] **Prod env:** `SMTP_HOST/PORT/USER/PASS/FROM` verified (a bad relay silently logs `email_log.status='failed'` — admins would silently miss "user paid" alerts); `PUBLIC_BASE_URL` explicitly set (defaults to `http://localhost:3000` and is embedded in router setup scripts).
- [ ] **Bank details non-empty** in prod `system_settings` — with this batch, receipt upload is the *only* path into the admin queue; empty bank details stall every new subscription.
- [ ] **Seed admin credential:** confirm `admin@wa-sel.com` (seeded with password `admin123` by migration `004_seed_data.sql`) was rotated/disabled on prod, and rotate on staging before exposing `admin.wa-sel.cloud`. If still default anywhere internet-facing, that is full platform compromise.

## E. Post-deploy rollout ops (prod, same day)

- [ ] **Re-apply the hotspot template on every onboarded router** (`PUT /routers/:id/hotspot-template`) — the interim-accounting/mac-cookie/white-page fixes only reach a router on re-apply. Until done, the MAC-randomization lockout bug persists for that router.
- [ ] Smoke: `/api/v1/health`, admin login, one voucher auth on a prod router, one test email.
- [ ] Update `PROJECT_STATE.md` (promotion done, date, gate evidence).

## F. Hygiene to close in the same window (not gating, but this cycle)

- [ ] **Secrets printed in tracked docs:** `RUNBOOKS.md` §1 prints the two old prod PG/Redis passwords verbatim; `STAGING.md` §3.3 contains real staging DB/Redis/JWT/ENCRYPTION_KEY values **and a real WireGuard private key**. Treat staging keys as burned → regenerate; confirm (or finally execute) the RUNBOOKS §1 rotation + history purge for prod.
- [ ] Both audit docs claim "intentionally untracked" yet are tracked and pushed to `origin/dev` — including file:line exploit detail for the still-open Mediums. Remove from repo or relabel as accepted.
- [ ] Reconcile stale docs: `PROJECT_SUMMARY.md` vs `PROJECT_STATE.md` staging status contradiction; migration/test/screen counts; `deploy.md` Message-Authenticator section contradicts shipped `radiusd.conf`; `scripts/wasel.service` hardcodes `/root/wasel` vs documented `/opt/wasel`.

---

## Explicitly accepted as non-blocking for this release

No monitoring/alerting beyond healthchecks (top of ROADMAP "Next 30 days"); admin panel has zero automated tests; refresh token in localStorage (F-deferred, TODO'd); Mediums F6/F7/F9/F10/F12 (pre-existing, bounded impact — see ROADMAP); `radacct` purge-on-delete + FK-cascade migration; expired-subscription grace period is dead code (hard 403 — also a product decision); Arabic pluralization polish; iOS entirely; Play Store distribution; `email_log` retention hardcoded at 90 days in the purge job (works, just not configurable); `wasel-freeradius:3.2.4` image tag mislabel (builds 3.2.8).

## What is genuinely strong (don't second-guess these)

- Voucher lifecycle automation: 30s usage/validity enforcement, CoA disconnect, stale-session reaper, validity-from-first-use — all with rationale-commented jobs and tests.
- Security fixes are real, not claimed: spawn-based CoA (no shell), atomic quota guard, atomic refresh-token consume, transactional RADIUS-credential purge — each verified in code by this scan with regression tests.
- Config discipline: Zod-validated env, fail-fast boot, wildcard-CORS rejected, dev/prod split honored (one deliberate, documented exception: radclient's localhost NAS).
- The compose stack: healthchecks, mem/cpu limits, log rotation, digest-pinned images, localhost-bound datastores, fail-fast missing secrets.
- Bilingual depth competitors don't have: 665-key EN/AR app, server-side localized push, bilingual editable emails, bilingual captive portals with bundled Arabic fonts.
