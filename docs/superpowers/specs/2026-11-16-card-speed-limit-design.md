# Card speed limit — design

**Date:** 2026-11-16 · **Status:** approved, in implementation on `dev`
**Approved plan:** `C:\Users\mubar\.claude\plans\in-the-car-setting-virtual-prism.md`

## Intent

A few heavy customers eat an operator's line and slow everyone else. Today no card has a speed
cap. The legacy "profiles" code can write `Mikrotik-Rate-Limit` into `radgroupreply`, but no card
is linked to a group (`radusergroup` is never inserted) and the app has had no profile screens since
`36fc33a`. One operator (فضل نت5G) asked to "reduce internet speed from the app" in the September
survey; the survey analysis wrongly marks that as existing.

This feature gives each operator one switch: limit the speed of every card created from now on.

## Goals

- A per-operator **speed limit** setting on Settings → Voucher Printing: off by default; when on,
  one speed from a fixed list (256K, 512K, 1M, 2M, 3M, 4M, 5M, 10M) applied to both download and
  upload. First switch-on preselects 2M. The last speed is remembered across off/on.
- **Off:** cards are created exactly as today (no new RADIUS row).
- **On:** every card created after that carries the cap, fixed on the card at creation.
- The **create-card wizard** tells the operator before they confirm that the cap will apply, and
  the **success dialog** shows the speed the server actually applied.
- The **card details** screen shows the card's speed when it has one.

## Non-goals

- Existing cards. Per-router or per-batch speed. Separate upload and download. Custom speeds.
  Changing a card's speed after creation. Admin-panel changes. Speed on printed cards.
- Any change to a router's firewall (see *The router catch*).

## Anti-goals

- A card created without a cap while the operator believes the limit is on. If the server cannot
  read the setting, the batch fails; it does not fall back to unlimited.
- An older app build, a stale phone or a second device switching the limit off by saving templates
  or code length.
- Touching any existing card's RADIUS rows.

## Owner decisions

- One speed for all new cards (the reason is heavy users, not fast/slow products).
- New cards only. Changing or turning off the setting later does not change cards already made.
- Fixed list, one choice for both directions.
- Accepted: the cap is **per device session**. Cards allow 20 simultaneous logins
  (`VOUCHER_SIMULTANEOUS_USE`), and the hotspot creates one queue per login, so a 1M card on three
  phones gives each phone 1M.

## The router catch (FastTrack)

The card carries the speed; the router enforces it. MikroTik's hotspot manual: "A user rate limit
creates a simple queue. Simple queues do not limit FastTracked connections." FastTrack is a
`fasttrack-connection` rule in the forward chain of MikroTik's factory configuration. RouterOS does
not exempt hotspot clients. Field reports from RouterOS 6.30 to 7.x and three hotspot vendors
(Powerlynx, Social WiFi, Spotipo) say the same: with that rule on, the limit is mostly ignored, and
hotspot byte accounting under-counts too.

- Wasel's setup script (`backend/src/services/wireguardConfig.ts`) only adds input-chain accept
  rules; it never touches FastTrack and assumes the factory firewall stays.
- The fleet runs RouterOS 7; every router sampled in the docs, and the staging router, is an L009.
- Nothing measures how many operator routers have the rule enabled.
- **Testing trap:** FastTrack is inactive while Torch, the sniffer or the traffic generator runs.
  A speed test with Torch open falsely shows the limit working.
- Official remedies: disable the rule, or keep it and add `accept` rules for the hotspot traffic
  (both directions) above it. Already-fasttracked connections stay unlimited until they close.

**Handling:** this feature builds the card side, which is needed in every case, and proves the
router side on the staging L009 before anything is offered to operators. What Wasel then does about
operators' routers (apply the fix over the API, or warn and give one command to paste) is a
separate decision made with the test result. It is not part of this build.

## Constraints (verified)

- **No FreeRADIUS change.** `freeradius/dictionary:65` defines `Mikrotik-Rate-Limit` (vendor 14988,
  attribute 8, string). `sql` in `authorize` loads every `radreply` row for the user with the stock
  3.2.8 query (no attribute filter), nothing in `post-auth` strips reply attributes, and
  `rlm_expiration` / `sqlcounter` only rewrite `Session-Timeout`. Per-card `radreply` vendor
  attributes already reach the router today (`Mikrotik-Total-Limit`).
- **Value format:** `rx-rate/tx-rate` from the router's side (rx = client upload). Units are
  lowercase `k` and uppercase `M` only. The feature writes symmetric values: `256k/256k`, `1M/1M`.
- **A malformed row breaks login.** An unknown attribute name or operator makes `rlm_sql` fail the
  request. The attribute name is written exactly `Mikrotik-Rate-Limit`, operator `:=`, and the
  value is validated in the backend; FreeRADIUS does not check the speed text.
- `createVouchers` reads the operator's settings with one `pool.query` before `BEGIN`
  (`voucher.service.ts:598`). Existing tests index the mocked query queue, so it must stay exactly
  one query.
- The `radreply` batch is one unchunked multi-row INSERT. With the new row the worst case is
  4 rows × 4 params × 3000 cards = 48,000 parameters, under PostgreSQL's 65,535. One more per-card
  row would still fit (60,000); a sixth would not.
- `voucher_meta` has millions of rows on prod. A nullable column with no default and no CHECK is a
  catalog-only change.
- Nothing else reads `radreply`: no job, report, analytics recorder or script. Every card-deleting
  path removes the card's `radreply` rows by username.
- `printSettingsSchema` is `.strict()` and the print-settings PUT is a full-document replace, which
  is why the speed setting does not live in that document (see below).

## Design

### Storage — migration `047_card_speed_limit.sql`

- `user_print_settings.speed_limit_enabled BOOLEAN NOT NULL DEFAULT false`
- `user_print_settings.speed_limit VARCHAR(8) NOT NULL DEFAULT '2M'`, named CHECK
  `speed_limit ~ '^[1-9][0-9]{0,3}[kM]$'`
- `voucher_meta.speed_limit VARCHAR(8)` nullable: the speed stamped on the card, alongside
  `limit_type` / `limit_value` / `validity_seconds`, which already mirror what RADIUS enforces.

The setting sits on the existing per-operator row so creation still needs one query. The option
list is not in the CHECK; the CHECK guards format only, so adding or removing an option needs no
migration.

The migration runs under `SET LOCAL lock_timeout = '3s'` (the convention migration 042 set):
`ALTER TABLE voucher_meta` takes ACCESS EXCLUSIVE, FreeRADIUS reads `voucher_meta` on rejected
logins while the backend boots, and failing fast is better than queuing every reader behind the
DDL. If it times out the backend exits and the migration is retried on the next start. Do not
deploy between 01:15 and 01:45 UTC (backup window).

### API — its own resource

`GET /api/v1/settings/card-speed` → `{ enabled, speed, options }`
`PUT /api/v1/settings/card-speed` ← `{ enabled, speed }` (both required, strict) → same shape as GET

- `speed` must match the format regex. When `enabled` is true it must also be in the option list.
  When `enabled` is false any format-valid speed is accepted, so an operator whose stored speed is
  no longer an option can still switch the limit off.
- A failed read answers `503 CARD_SETTINGS_UNAVAILABLE`.

`authenticate` only, like `/settings/print`. The upsert writes only the two speed columns;
`upsertPrintSettings` is not changed and never names them. This is what makes the anti-goal hold
without optional-key or merge semantics. The app draws the chips from `options`, so there is no
mirrored list in the app.

### Card creation

- `getCodeLength` is replaced by `getCardCreationSettings(userId) → { codeLength, speedLimit }`
  (`speedLimit` is `'1M'` or `null`), still one query.
  - No row → defaults, limit off.
  - Query error, a row whose enabled flag is not a boolean, or an enabled row whose stored speed
    fails the format regex →
    `AppError(503, 'CARD_SETTINGS_UNAVAILABLE')`. Thrown before `BEGIN`: no quota consumed, no rows
    written. This deliberately replaces the fail-open of 2026-11-10; a silently unlimited batch
    cannot be repaired, because existing cards are never touched.
- When `speedLimit` is set, each card gets:
  - `voucher_meta.speed_limit = '<s>'`
  - one `radreply` row `(username, 'Mikrotik-Rate-Limit', ':=', '<s>/<s>')`, pushed last per card.
- The dead single-row template `insertRadiusEntriesV2` gets the same row (it is kept in sync on
  purpose). The "Vouchers created" log line gains the speed.
- The request body is unchanged. `createVouchersSchema` is not strict, so a client-sent speed is
  stripped before the service.
- `VOUCHER_CODE_TAKEN_SQL` also checks `radreply`, so a re-issued code can never inherit a leftover
  reply row.

### Responses

`assembleVoucherInfo` maps `voucher_meta.speed_limit` → `speedLimit` (`'1M'` or `null`) in the
shared card DTO. Create, list, detail, update and admin responses all carry it, with no extra query.

### App

- **Own model, service and provider** for the speed setting, separate from print settings. The
  provider fetches on every open, waits for saves already in flight before it fetches, discards a
  fetch that a save overtook, serialises saves and rolls back to the last server-confirmed value.
  A failed save leaves an error that survives a reload, so the operator still sees it after
  leaving the screen. `reset()` (logout) invalidates anything still in flight. A 404 (backend
  without the feature) hides the section.
- **Voucher Printing screen:** a "Card speed" section after Code Length: switch with a "new cards
  only" hint, then chips from `options` and the caption "Download and upload: 1M each". Switching
  on with a remembered speed that is no longer an option sends 2M (or the first option) instead.
  Text fields on this screen are no longer overwritten while they have focus.
- **Wizard:** loads the setting when it opens. With the limit on, step 3 shows a Speed summary row
  and a strip fixed directly above the Create button: "Speed limit 1M is on for these cards." with
  a **Change** link to Voucher Printing. The speed comes early in the sentence so the two-line
  ellipsis can never cut it off. The strip lives in the fixed bottom bar because a box in the
  scroll list is off screen on small phones and whenever the keyboard is open. It is shown only
  when at least 340 logical px of height remain (screen height minus keyboard minus status bar);
  on a small phone it hides while the keyboard is open and returns when it closes. It is always
  visible on arrival at step 3, because the keyboard is closed then. With the limit off, or when
  the last fetch failed, there is no strip.
- **Success dialog:** states the speed from the create response: "Speed: 1M", or "Speed: No limit"
  when the cards carry none and the backend offers the feature. This is the authoritative value.
- **Card details:** a Speed row after validity when `speedLimit` is set.
- **Labels** are derived from the wire value at render time: `1M` → "1M" / "1 ميجا", `256k` →
  "256K" / "256 كيلو". An unexpected value is shown unchanged.
- **Logout:** `printSettingsProvider` and the new provider are added to
  `_resetUserScopedProviders`. Today the next account on the same phone sees the previous account's
  settings and could save them as its own.

## Rollout

- `dev` → staging only. Nothing goes to `main` or prod without an explicit instruction.
- Backend before any app build that uses the new endpoint.
- Router proof on the staging L009 (FastTrack rule present or not; 1M card speed test with Torch
  closed; the accept-rule remedy; router CPU), recorded in `docs/PROJECT_STATE.md`.
- No release to operators until the router-side handling is decided.

## Left to the builder

- File layout for the new backend service functions and the exact Flutter widget structure.
- Arabic copy. Drafts: "تحديد سرعة الكروت", "يُطبَّق على الكروت الجديدة فقط",
  "تحديد السرعة مفعّل: هذه الكروت ستكون محدودة بسرعة {0}". The owner reviews them on staging.

## Decided during review, deferred

- A warning in the wizard when the last speed save failed. Covered for now by the save-error banner
  on the settings screen and by the success dialog always stating the applied speed; a persistent
  warning needs a dismissal design.
- The real-PostgreSQL test for "a print-settings save never changes the speed columns" runs a copy
  of the print upsert statement. The mocked SQL-text assertion is the primary guard; exporting the
  statement would mean editing a function this design says not to touch.
- The create-card and update-card request schemas stay non-strict (unknown keys are stripped, not
  rejected). Making them strict was tried in review and reverted: it changes two existing
  endpoints for every client, including released app builds.

## Noticed, not included

- The router health check's firewall probe reads `dst-port` where the client returns `dstPort`, so
  it fails on every real router, and the app no longer shows health results. Both matter for any
  later FastTrack check.
- FastTrack probably also under-counts data usage on the same routers. Unmeasured.
- `purgeUnverified` and `deleteAdmin` delete a user by cascade without removing RADIUS rows.
- The card details screen can briefly show the previously opened card (`selectedVoucher` is never
  cleared).
- The comment at `freeradius/dictionary:61` states the rate-limit direction backwards.
