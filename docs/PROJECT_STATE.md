# Wasel — Project State

> Living "where are we right now" snapshot. For architecture & conventions see `CLAUDE.md`; this file tracks in-flight work, the active blocker, and gotchas already hit. **Keep it updated as state changes.**

**Last updated:** 2026-06-25

## TL;DR
Security hardening (Critical RCE + 4 High findings) plus several follow-on features are committed and pushed on `dev`: mobile UX + Arabic localization, a voucher-code-collision fix, an admin panel polish/responsive pass, CI extended to run on `dev`, and the **operator-selectable hotspot login page** (built end-to-end). **All await the staging gate before promotion.** A dedicated **staging VPS** (`wa-sel.cloud`, `185.166.39.70`) is the pre-merge gate; the Docker stack has been deploying `dev` and reaching healthy. Production (`wa-sel.com`) is live with paying users and **untouched**.

## Branch / deploy state
- `main` — production. **Untouched** this cycle.
- `dev` — pushed to `origin/dev` (`github.com/mubarakbasher/wasel`); this is what the staging VPS pulls. Carries, on top of security hardening `7aa841f`: localized errors/offline session `2700de7`, splash-gate `253cef2`, compose healthcheck fix `840b9e0`, CI-on-dev + Admin CI `b1bb560`, voucher-collision fix `cbb3553`, admin polish/responsive `a02cb54`, and the hotspot login page `32253b8`.
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
