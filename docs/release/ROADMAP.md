# Wasel — Future Development Roadmap

**Date:** 2026-07-07 · Sources: full-repo scan, `docs/IMPLEMENTATION_PLAN.md` §14–15 (P0–P3), `docs/TASKS.md` epics, security/mobile audits (2026-06-12), `PROJECT_STATE.md` deferred lists, and the marketing plan's product gaps.
Effort: **S** ≤ 1 day · **M** = 2–5 days · **L** = 1–3 weeks. Items link to where they came from so priorities can be re-derived when reality changes.

---

## Horizon 0 — Release hardening (this cycle)

The checklist in [RELEASE_READINESS.md](RELEASE_READINESS.md). Nothing below matters until `dev` is promoted — prod is running months-old code including an unfixed Critical RCE path.

## Horizon 1 — Next 30 days (operate safely + open the funnel)

**Ops (the 66-score area — biggest risk-per-effort wins):**
- [ ] **Uptime monitoring + alerting** (S–M): external HTTPS checks on `/api/v1/health` + `/readyz` (both exist; `/health` backs the Docker healthcheck but nothing probes either from outside the VPS), WireGuard handshake age, FreeRADIUS auth probe (`scripts/test-radius.sh` has the logic — wire it into the container healthcheck too), with a paging channel (Telegram bot is fine). Today, if the backend dies at 3am, nobody knows. *(deploy.md defers this; IMPLEMENTATION_PLAN P0-1)*
- [ ] **Error tracking** (S): Sentry (or self-hosted GlitchTip) in backend + admin + Flutter.
- [ ] **Backups become real** (M): convert the crontab snippets in `deploy.md` into versioned `scripts/backup.sh` with off-host push, verify the cron is installed on prod, run one restore drill and record it. *(infra scan: backups exist only as doc prose; RUNBOOKS §2)*
- [ ] **Execute + close the URGENT secret rotation** (S–M): RUNBOOKS §1 (old prod PG/Redis passwords in git history + printed in the doc), regenerate staging keys burned in STAGING.md, git-history purge. *(P0-3)*
- [ ] **CI publishes tagged images to GHCR** (M) so prod pulls prebuilt images and STAGING.md §12's rollback instructions become true; extend CI path filters to `freeradius/**`, `docker-compose*.yml`, `scripts/**`. *(infra scan)*

**Security Mediums (close as one batch, ~M total):** authenticated receipt route + ownership check (F6) · revoke refresh tokens on admin deactivate/password-reset (F7) · `is_active` check in `authenticate` middleware (F9) · audit-log row on bank-settings change (F12). Plus JWT `algorithms:['HS256']` pin and rejection-sampling for code generation (S). *(SECURITY_AUDIT deferred list)*

**Funnel (from the marketing plan — these gate revenue):**
- [x] **Landing page at wa-sel.com** (M) — built 2026-07-07 (`landing/`, bilingual AR-first Vite/React SPA, compose service on loopback :8080 + host-nginx vhost per `deploy.md` §3.1). **Remaining before go-live:** real WhatsApp/APK links in `landing/src/config.ts`, DNS A records, certbot.
- [ ] **Trial/free tier** (S code + product decision): 0-price plan row + expiry handling; removes the "can do nothing until a human approves a transfer" wall.
- [ ] **Fix the dead grace-period code** (S): `requireSubscription.ts` checks `status === 'expired'` but `getActiveSubscription` never returns expired rows → hard 403 instead of the advertised 7-day read-only window. Fix or delete; a real grace window is a retention lever.
- [ ] **Play Store pipeline** (M): adaptive + monochrome icons, fastlane metadata EN+AR, privacy policy, real pubspec description, versioning discipline, CI release/AAB job with keystore + `google-services.json` from secrets. *(mobile scan; mobile CI currently debug-only)*

**Small fixes batch (S total):** admin login-error UX + session-expired toast + Header titles for the 5 new routes · "View full size" receipt opens instead of force-downloading · parameterize the hardcoded `api.wa-sel.com` in `admin/nginx.conf` CSP · align `scripts/wasel.service` WorkingDirectory with `/opt/wasel` · `npm ci` + digest-pin admin Dockerfile bases · fix `wasel-freeradius:3.2.4` tag label.

## Horizon 2 — 60–90 days (trust + scale the operation)

- [ ] **Real SPKI certificate pinning or drop the claim** (M): verify the pin on the *trusted* path (SecurityContext/validating adapter), pin-rotation runbook tied to 90-day renewals. Current implementation can never match and never fires on the real threat. *(mobile + security scans)*
- [ ] **Admin token hardening** (M, cross-stack): HttpOnly+Secure+SameSite cookie refresh flow, in-memory access token. *(auth.ts TODO; P0-2)*
- [ ] **Admin test suite** (M): Vitest+RTL for PaymentsPage approve/reject + auth interceptor, Playwright login→dashboard smoke, wired into CI. Zero tests today on a surface that approves payments and deletes users.
- [ ] **Fleet reprovision** (M): `POST /routers/:id/reprovision` + admin fleet-wide variant — doubly needed since hotspot fixes require per-router template re-apply; evolve `reprovisionBroken.ts` into automated remediation. *(P1-1)*
- [ ] **Integration + load tests** (L): live voucher→RADIUS→accounting path against the dev FreeRADIUS container (the F1 fix and all CoA/mac-cookie logic are mock-only today); 200+ concurrent RADIUS auths, 500+ concurrent API users. *(P1-4, Epic 9)*
- [ ] **Backend test-coverage catch-up** (M): the untested services list from the scan (freeradius, radclient, report, support, audit, wireguardPeer/Monitor, half the jobs).
- [ ] **Dependency majors** (M): firebase-admin/file-type (clears remaining npm-audit highs, FCM regression-tested), Riverpod 3 / go_router 17 / FlutterFire 4 on mobile; add Dependabot/renovate + `npm audit` gate to CI.
- [ ] **Locale gap** (S): sync effective system locale on first launch so system-Arabic users get an Arabic push tray without touching the toggle. *(PROJECT_STATE known gap)*
- [ ] **Log aggregation** (M): Loki or equivalent — currently a lost VPS = lost logs; decision explicitly deferred in deploy.md.
- [ ] **Runbook expansion** (S–M): FreeRADIUS outage, WG fleet outage, Redis loss, disk-full, cert expiry, failed-migration rollback, payment disputes, post-deploy template re-apply. RUNBOOKS covers only 2 procedures.

## Horizon 3 — 3–6 months (product depth)

- [ ] **Sudan payment rails** (L): local wallet/bank-app integrations (e.g. Bankak-style) to supplement manual receipts — schema already carries per-payment currency + reference codes. Biggest funnel-friction removal after the trial tier. *(marketing plan)*
- [ ] **PDF report export** (M): endpoint currently returns 501; the mobile PDF stack (printing/pdf packages) already proves the competence. *(P2-2)*
- [ ] **Full session history** (M–L): 90-day radacct retention with archival, termination-cause filters, CSV/PDF export. *(Epic 16 / P2-1)*
- [ ] **Annual billing + proration** (M): `allowed_durations` JSONB already supports arbitrary month lists; proration on mid-cycle upgrade removes a real complaint. *(product scan)*
- [ ] **More captive-portal designs** (S each): the DesignSync pipeline is established; portal designs are cheap differentiation and marketing lead magnets.
- [ ] **Arabic linguistic polish** (M): plural categories, intl number/date formatting, the ~167 dead i18n keys. *(MOBILE_AUDIT §E)*
- [ ] **Accessibility pass** (M): zero Semantics usage today. **Dark mode** (M): token system ready. *(P3-1)*
- [ ] **iOS track** (L, needs hardware/macOS lane): Firebase plist, signing, TestFlight. *(P2-3)* **Biometric login** (S–M). *(Epic 17)*
- [ ] **Data-integrity debt before it bites:** radacct purge/archival on delete (cross-tenant bleed via /30 reuse), FK-cascade migration after orphan cleanup, **namespace RADIUS group names per-tenant BEFORE any voucher-to-group linkage ships** (F10 becomes Critical at that moment). *(security scan)*

## Horizon 4 — 6–12 months (strategic bets, gated on traction)

- **Multi-market expansion** (Libya/Egypt/Yemen): per-market currency/bank rails; product already bilingual — this is config + go-to-market, not rebuild. *(marketing plan Phase 3)*
- **Reseller / white-label layer**: technician-as-reseller commissions, branded portals; converts the SAS4 reseller ecosystem from threat to channel. *(PRD out-of-scope list)*
- **End-user self-service purchase** (customer buys a voucher from the captive portal): the largest possible product jump — turns Wasel from operator tool into a payments platform; requires the payment-rails work first.
- **RouterOS REST-API migration path** (hedge against 8728 legacy-API deprecation — MikroTik platform risk).
- **Horizontal scaling readiness**: distributed cron locks (Redis), stateless jobs — currently single-container-safe by design; needed before any multi-replica story. Fleet design target is 16,384 routers/VPS, so this is genuinely later.
- **Prometheus/Grafana metrics** if the Horizon-1 uptime/alerting proves insufficient at scale. *(PRD §2.2.2)*
- **Localization growth** (French/Portuguese/Swahili + backend Accept-Language) if expansion goes beyond Arabic markets. *(P2-5)*
- **SMS voucher delivery / thermal-printer direct pairing** — recurring operator asks, deferred from Epic 12.

---

## Standing priorities (apply to every horizon)

1. **The staging gate stays sacred** — no promotion without §11 passing on real hardware; keep folding new features' E2E addenda into STAGING.md *at feature time*, not at release time.
2. **Never hardcode env-specifics** (the CSP/nginx and service-unit items above are cleanup of past violations).
3. **Update `PROJECT_STATE.md` + this roadmap at each promotion** — this file decays fast; the scan that produced it can be re-run cheaply.
