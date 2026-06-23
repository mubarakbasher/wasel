# Wasel — Project State

> Living "where are we right now" snapshot. For architecture & conventions see `CLAUDE.md`; this file tracks in-flight work, the active blocker, and gotchas already hit. **Keep it updated as state changes.**

**Last updated:** 2026-06-23

## TL;DR
Security hardening (Critical RCE + 4 High findings) is committed on `dev` and pushed to GitHub. A dedicated **staging VPS** (`wa-sel.cloud`, `185.166.39.70`) is being stood up as the pre-merge gate. The Docker stack is **up and healthy** on staging; the **current blocker is HTTPS — inbound ports 80/443 are blocked by the VPS provider's network firewall**, so no Let's Encrypt cert has issued yet. Production (`wa-sel.com`) is live with paying users and **untouched**.

## Branch / deploy state
- `main` — production. **Untouched** this cycle.
- `dev` — carries the security hardening commit `7aa841f`, pushed to `origin/dev` (`github.com/mubarakbasher/wasel`). This is what the staging VPS pulls.
- `staging-vps-setup` — feature branch, already fast-forward-merged into `dev`; safe to delete.
- Working tree also has **unrelated pre-existing uncommitted edits** (e.g. `backend/src/server.ts`, several mobile screens, deleted logo assets, untracked audit docs) — not part of this work; leave them be.

## Security hardening — DONE (on `dev`)
Closes every Critical/High in `docs/SECURITY_AUDIT_2026-06-12.md`:
- **F1 (Critical RCE)** — shell-injection in the CoA-disconnect paths → replaced with spawn-based `sendDisconnectRequest`; added `isSafeAcctSessionId` guard (`backend/src/utils/radius.ts`).
- **F2** quota TOCTOU → atomic guarded `UPDATE … RETURNING`. **F3** unbounded create/bulk-delete → Zod `.max(500)` + batched inserts + matching mobile cap/i18n. **F4** refresh-token replay → atomic Redis consume (`DEL`-returns-1). **F5/F8** orphaned RADIUS creds on delete → transactional `deleteRouter`/admin `deleteUser` purging `radcheck`/`radreply`/`radusergroup`/`nas`. **F11** wrong-session disconnect → CoA scoped by username.
- Verified: backend `tsc` clean + **192 tests**; mobile `analyze` clean + tests pass. Reviewed by security-auditor + code-reviewer.
- **Deferred** (non-blocking): `radacct` history purge on delete; FK-cascade migration (needs orphan cleanup first); 18 transitive `npm audit` items.

## Mobile UX + Arabic localization — DONE (uncommitted on `dev` working tree)
Done this session (2026-06-23), not yet committed:
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
