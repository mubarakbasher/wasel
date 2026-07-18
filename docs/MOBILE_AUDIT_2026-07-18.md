# Wasel Mobile App — Security & Bug Audit

**Date:** 2026-07-18 · **Scope:** `mobile/` (Flutter app) · **Branch:** `dev`

**Result:** No blocking/critical crash-on-launch issues. 4 High, 26 Medium, 43 Low findings — dominated by a cluster of state-management races (un-keyed global providers), silent error-swallowing, i18n/RTL gaps in the Arabic UI, and clipboard/logging hardening. The app is architecturally sound (secure token storage, server-side voucher generation, screenshot protection on sensitive screens, no committed secrets); the highest-impact items are a certificate-pinning implementation that is effectively a no-op and several data-correctness races operators would actually hit.

## Resolution status (fixed 2026-07-18)

Substantially all findings were fixed across four commits on `dev`:

- `0e223c4` — batch 1: state-management race guards (vouchers/sessions/routers), single-flight token refresh + FormData clone, SPKI certificate pinning via `validateCertificate`, debug-log redaction, logout/session hardening, FCM re-register + tap-through, non-blocking startup.
- `9b5d172` — batch 2: reports contract fix (High #3), error surfacing across ~8 screens, app-scoped clipboard auto-clear + FLAG_SECURE + refcounted SecureWindow, ProGuard package fix.
- `27bf7a7` — backend: keyset cursor pagination + machine-readable error codes + migration 036.
- `470ca5b` — batch 3: mobile cursor consumption, i18n/RTL cluster (Arabic plurals, localized status/units/currency, validator keys, error-code→i18n map), `edit_router` setState fix, route empty-id guards, iOS push scaffolding.

Verification: `flutter analyze` clean, **282 mobile tests pass**; backend `tsc` clean, **718 backend tests pass**.

**Residual (deliberately deferred):**
- **Cert pins must be verified on staging** against the live `api.wa-sel.com` cert before promoting `dev→main` — a wrong pin bricks release builds (pinning is release-only).
- **radacct keyset index** (migration 036) uses plain `CREATE INDEX` (transactional runner) — briefly locks a FreeRADIUS-hot table on deploy; verify table size/window on staging.
- **#5 iOS push:** real Firebase iOS app registration + `GoogleService-Info.plist` + Xcode entitlements reference remain manual (Apple-side).
- **#59 (LOW):** a few `initState` `Future.microtask` bodies still lack a `mounted` guard (unmounted-within-frame is rare).
- **#66 (LOW):** device-token unregister on logout is best-effort; the durable fix is server-side invalidation on `/auth/logout` (backend now receives the refresh token).
- Dependency major-version upgrades (Riverpod 2→3, go_router 14→17, etc.) — currency, not defects.

## Methodology

Three parallel recon agents mapped the app, then a multi-agent workflow ran **10 finder lenses** (network/TLS, auth/session, data-exposure, provider-architecture, pagination, JSON/models, async/lifecycle, error-handling, i18n/RTL, diff/platform). Each lens verified its seeded leads against real code and hunted for new issues. Every unique finding was then **adversarially verified by 3 independent agents** (reproduce / impact / false-positive lenses); a finding is reported only if **≥2 of 3 confirmed** it against the source. A completeness critic then swept for gaps; findings it surfaced were verified by hand and are tagged `critic+manual`.

Raw funnel: **78 raw → 70 unique → 68 auto-confirmed (2 refuted)**, + **5 added** from manual critic follow-up (one of which was reinstated after auto-verifiers split on it).

## Ground truth (toolchain)

| Check | Result |
|---|---|
| `flutter analyze` | **No issues found** — zero static-analysis errors/warnings |
| `flutter test` | **254/254 passing** |
| `flutter pub outdated` | No CVEs flagged; several majors behind (Riverpod 2→3, go_router 14→17, firebase_core 3→4, flutter_secure_storage 9→10, share_plus 10→13); transitive `js` is discontinued |

The static analyzer is clean because these are **logic/architecture/UX defects**, not type errors — they do not show up in `flutter analyze`, which is exactly why the multi-agent semantic audit was run.

## Findings by severity

| # | Severity | Category | Finding | Location |
|---|---|---|---|---|
| 1 | HIGH | data-corruption | deleteAllVouchers re-reads live filters each batch; mid-loop filter change deletes unintended vouchers | `lib/providers/vouchers_provider.dart:257` |
| 2 | HIGH | data-corruption | vouchersProvider is a global singleton not keyed by routerId; racing loads cross-contaminate router views | `lib/providers/vouchers_provider.dart:299` |
| 3 | HIGH | contract-mismatch | Reports screen parses keys the backend never sends - every report silently renders zeros | `lib/screens/reports/reports_screen.dart:418` |
| 4 | HIGH | security | Certificate pinning is a no-op against CA-valid MITM certs (wrong callback) | `lib/services/api_client.dart:90` |
| 5 | MEDIUM | platform-config | iOS push is entirely unconfigured: no GoogleService-Info.plist, entitlements, or background mode | `ios/Runner/Info.plist:4` |
| 6 | MEDIUM | i18n | No plural/dual support in translate(): Arabic count strings grammatically wrong for 2-10 (and 11+ months) | `lib/i18n/app_localizations.dart:49` |
| 7 | MEDIUM | ux-bug | First frame blocked on push-permission dialog and network I/O before runApp | `lib/main.dart:11` |
| 8 | MEDIUM | data-leak | Logout resets only 3 providers; routers/vouchers/dashboard/sessions/reports state leaks to the next account | `lib/providers/auth_provider.dart:106` |
| 9 | MEDIUM | ux-bug | FCM device token is never (re)registered after login — push notifications dead until next cold start | `lib/providers/auth_provider.dart:388` |
| 10 | MEDIUM | data-corruption | routersProvider is the third un-keyed global singleton — router detail/status/setup-guide can show the previous router | `lib/providers/routers_provider.dart:192` |
| 11 | MEDIUM | race-condition | Session history has the same stale-response race across filter changes and router switches | `lib/providers/sessions_provider.dart:133` |
| 12 | MEDIUM | data-corruption | sessionsProvider global singleton shows the previous router's active sessions and history, and silently reuses a stale username filter | `lib/providers/sessions_provider.dart:170` |
| 13 | MEDIUM | race-condition | No cancellation/sequence guard on voucher list loads: stale slow response overwrites newer router/filter selection | `lib/providers/vouchers_provider.dart:111` |
| 14 | MEDIUM | pagination | Bulk delete shifts server offsets: vouchers silently skipped and hasMore stuck true (eternal spinner + endless empty fetches) | `lib/providers/vouchers_provider.dart:234` |
| 15 | MEDIUM | sensitive-data-leak | Setup-guide screens copy WG private key/RADIUS secret/router admin password to clipboard with no auto-clear and no FLAG_SECURE | `lib/screens/routers/setup_guide_screen.dart:65` |
| 16 | MEDIUM | silent-failure | Failed CoA session disconnect is silent — ok==false ignored and error only rendered on empty list | `lib/screens/sessions/active_sessions_screen.dart:64` |
| 17 | MEDIUM | ux-bug | PaymentsScreen shows 'no payments' empty state when loadPayments fails | `lib/screens/settings/payments_screen.dart:120` |
| 18 | MEDIUM | silent-failure | Voucher detail toggle/delete failures give zero feedback; screen never renders vouchersState.error | `lib/screens/vouchers/voucher_detail_screen.dart:133` |
| 19 | MEDIUM | silent-failure | Bulk voucher delete failures produce no feedback in the list screen | `lib/screens/vouchers/voucher_list_screen.dart:216` |
| 20 | MEDIUM | i18n | Voucher status rendered as raw capitalized English in AR UI (card badge, filter chip, detail row, delete-all dialog) | `lib/screens/vouchers/voucher_list_screen.dart:693` |
| 21 | MEDIUM | hardening | Voucher print preview and voucher list show codes without FLAG_SECURE/blur protection | `lib/screens/vouchers/voucher_print_screen.dart:110` |
| 22 | MEDIUM | sensitive-data-leak | Debug HTTP log redaction misses apiPass, newPassword/currentPassword, and setup-guide secrets | `lib/services/api_client.dart:43` |
| 23 | MEDIUM | security | Pin hash computed over full cert DER, but configured pins are SPKI hashes | `lib/services/api_client.dart:92` |
| 24 | MEDIUM | ux-bug | Post-refresh retry re-sends a finalized FormData — receipt upload fails after token expiry | `lib/services/api_client.dart:322` |
| 25 | MEDIUM | crash | 401s arriving after refresh-queue drain are queued forever — request hangs indefinitely | `lib/services/api_client.dart:374` |
| 26 | MEDIUM | security | Logout never revokes the refresh token server-side (missing refreshToken body) | `lib/services/auth_service.dart:88` |
| 27 | MEDIUM | ux-bug | Cold start blocks on push permission dialog and network I/O before runApp | `lib/services/push_notification_service.dart:43` |
| 28 | MEDIUM | ux-bug | FCM device token is never re-registered after login, so push notifications are dead until the next app restart | `lib/services/push_notification_service.dart:46` |
| 29 | MEDIUM | i18n | Backend error messages are preferred over localized keys, so business/validation errors surface in English in AR UI | `lib/utils/error_messages.dart:27` |
| 30 | MEDIUM | i18n | All form-validation messages hardcoded in English; auth flows show English errors in Arabic UI | `lib/utils/validators.dart:7` |
| 31 | LOW | hardening | ProGuard keep rule for jailbreak detection targets a nonexistent package | `android/app/proguard-rules.pro:22` |
| 32 | LOW | i18n | NotificationPreference has no mapping for backend 'support_reply' category | `lib/models/notification_preference.dart:29` |
| 33 | LOW | contract-mismatch | report.dart model factories parse a third, nonexistent response shape (dead-code trap) | `lib/models/report.dart:41` |
| 34 | LOW | i18n | Session duration/uptime formatted with English h/m/s suffixes (and raw RouterOS uptime) inside Arabic UI | `lib/models/session.dart:118` |
| 35 | LOW | robustness | Detail routes fall back to empty-string ids when state.extra is absent (restoration / deep-link) | `lib/navigation/app_router.dart:157` |
| 36 | LOW | ux-bug | Successful password change revokes all sessions server-side but mobile keeps its session, causing an unexplained forced logout ~15 minutes later | `lib/providers/auth_provider.dart:472` |
| 37 | LOW | silent-failure | Notification preference toggle failure reverts silently; double failure leaves unsaved state displayed | `lib/providers/notification_prefs_provider.dart:57` |
| 38 | LOW | robustness | NotificationsNotifier.delete uses firstWhere without orElse — throws StateError on a missing id | `lib/providers/notifications_provider.dart:117` |
| 39 | LOW | silent-failure | Notification delete: optimistic removal never rolled back and error invisible on non-empty list | `lib/providers/notifications_provider.dart:125` |
| 40 | LOW | pagination | Session history duplicates rows when new sessions start between page fetches | `lib/providers/sessions_provider.dart:157` |
| 41 | LOW | pagination | Support chat loadMore duplicates older messages after sends shift server offsets | `lib/providers/support_provider.dart:82` |
| 42 | LOW | ux-bug | Failed pull-to-refresh wipes the already-loaded voucher/session list before fetching | `lib/providers/vouchers_provider.dart:99` |
| 43 | LOW | pagination | createVouchers prepend + local total bump shifts offset pages (latent duplicate source, currently masked by refresh-on-pop) | `lib/providers/vouchers_provider.dart:176` |
| 44 | LOW | latent-trap | fetchAllForPrint is dead code whose catch block re-introduces the exact dialog-open state mutation its own comment forbids | `lib/providers/vouchers_provider.dart:287` |
| 45 | LOW | ux-bug | Subscription load failure indistinguishable from 'no subscription' in quick-create gating | `lib/screens/dashboard_screen.dart:86` |
| 46 | LOW | crash | Notifications loadMore appends without dedup: shifted pages produce duplicate ids -> duplicate Dismissible ValueKeys | `lib/screens/notifications/notifications_screen.dart:101` |
| 47 | LOW | sensitive-data-leak | Report export copies full revenue/voucher CSV to the clipboard with no auto-clear or FLAG_SECURE | `lib/screens/reports/report_export_screen.dart:19` |
| 48 | LOW | lifecycle | EditRouterScreen calls setState() synchronously inside build() — framework assertion in debug, redundant rebuild in release | `lib/screens/routers/edit_router_screen.dart:121` |
| 49 | LOW | info-leak | Raw DioException.toString() rendered in hotspot template error UI | `lib/screens/routers/hotspot_template_screen.dart:54` |
| 50 | LOW | ux-bug | Network failure on detail screens rendered as 'not found' | `lib/screens/routers/router_detail_screen.dart:84` |
| 51 | LOW | rtl | RouterOS setup commands rendered with ambient RTL base direction: leading '/' displaced and text right-aligned in Arabic | `lib/screens/routers/setup_guide_screen.dart:254` |
| 52 | LOW | concurrency | 30s session-refresh Timer.periodic has no overlap guard; stale/error responses overwrite fresh data | `lib/screens/sessions/active_sessions_screen.dart:31` |
| 53 | LOW | i18n | Raw RADIUS terminate-cause strings shown untranslated on session-history badges | `lib/screens/sessions/session_history_screen.dart:322` |
| 54 | LOW | i18n | Language picker rows show hardcoded English labels ('System Default', 'Arabic') in AR UI despite existing key | `lib/screens/settings_screen.dart:322` |
| 55 | LOW | ux-bug | Contact screen conflates load failure with empty conversation; error never surfaced and no retry affordance | `lib/screens/settings/contact_screen.dart:85` |
| 56 | LOW | rtl | Support-chat bubbles use physical Alignment.centerRight/Left and physical corner radii — layout does not mirror in RTL | `lib/screens/settings/contact_screen.dart:207` |
| 57 | LOW | i18n | Payment amounts show raw backend currency code instead of the localized symbol used everywhere else | `lib/screens/settings/payments_screen.dart:215` |
| 58 | LOW | hardening | Popping PaymentScreen clears FLAG_SECURE out from under the still-alive SettingsScreen | `lib/screens/subscription/payment_screen.dart:69` |
| 59 | LOW | concurrency | Payment approval poller: async Timer.periodic callback without re-entrancy guard | `lib/screens/subscription/payment_screen.dart:87` |
| 60 | LOW | hardening | Clipboard auto-clear of payment reference / voucher code is cancelled if the user leaves the screen | `lib/screens/subscription/payment_screen.dart:767` |
| 61 | LOW | ux-bug | Subscription start/end dates formatted from UTC without toLocal(), unlike the payments screen | `lib/screens/subscription/subscription_status_screen.dart:415` |
| 62 | LOW | hardening | Voucher-code clipboard auto-clear is cancelled by leaving the screen | `lib/screens/vouchers/voucher_detail_screen.dart:67` |
| 63 | LOW | lifecycle | initState Future.microtask uses ref without a mounted guard (app-wide pattern) | `lib/screens/vouchers/voucher_list_screen.dart:42` |
| 64 | LOW | ux-bug | Paywall handler's claimed authenticated-route guard is not implemented | `lib/services/api_client.dart:250` |
| 65 | LOW | security | Token-refresh Dio bypasses certificate pinning entirely | `lib/services/api_client.dart:348` |
| 66 | LOW | hardening | Refresh response parsed with unchecked chained casts; malformed 2xx bodies are indefinitely treated as transient with per-request refresh retries | `lib/services/api_client.dart:360` |
| 67 | LOW | hardening | Notifications service embeds full server response body in exception message | `lib/services/notifications_service.dart:37` |
| 68 | LOW | ux-bug | Push notifications have no tap-through: onMessageOpenedApp and getInitialMessage are never handled | `lib/services/push_notification_service.dart:49` |
| 69 | LOW | async-error-handling | onTokenRefresh listener can reject with an unhandled async error from secure storage | `lib/services/push_notification_service.dart:58` |
| 70 | LOW | hardening | Silent FCM unregister failure leaves logged-out device receiving account pushes | `lib/services/push_notification_service.dart:80` |
| 71 | LOW | sensitive-data-leak | Push notification title debugPrinted in release builds | `lib/services/push_notification_service.dart:84` |
| 72 | LOW | ux-bug | Logout and session-expiry clearAll() wipes the saved locale (and all non-auth keys) | `lib/services/secure_storage.dart:87` |
| 73 | LOW | hardening | SecureWindow enable/disable is not reference-counted; popping one secure screen unprotects another | `lib/services/secure_window.dart:13` |

## High severity (4)

### 1. deleteAllVouchers re-reads live filters each batch; mid-loop filter change deletes unintended vouchers

- **File:** `mobile/lib/providers/vouchers_provider.dart:257`
- **Category:** data-corruption · **Origin:** verified (2-of-3) · **Lens:** pagination · **Votes:** reproduce:✓(high) impact:✓(high) false-positive:✓(high)
- **Failure scenario:** Operator filters to status=expired (800 matching vouchers) and confirms Delete All. The loop needs 2+ batches of 500. During the await the voucher list screen stays fully interactive (the only modal scrim is gated on _isPrintLoading, voucher_list_screen.dart:447), and there is no progress indication, so the operator taps the filter chip and selects 'All' (or clears search) while batch 1 is in flight. setFilter() updates provider state; the next loop iteration reads state.filterStatus == null and posts {'all': true} with no status filter, deleting every voucher on the router including active paid ones. Unsold/active customer credit is destroyed with no undo.
- **Evidence:** `while (true) { ⏎   final count = await _service.deleteAllVouchers( ⏎     routerId, ⏎     status: state.filterStatus, ⏎     limitType: state.filterLimitType, ⏎     search: state.searchQuery, ⏎   );`
- **Fix:** Snapshot status/limitType/search into locals before the loop and pass the same values on every iteration. Additionally show a modal progress barrier while the multi-batch delete runs so filters/search cannot be changed mid-operation.

### 2. vouchersProvider is a global singleton not keyed by routerId; racing loads cross-contaminate router views

- **File:** `mobile/lib/providers/vouchers_provider.dart:299`
- **Category:** data-corruption · **Origin:** verified (2-of-3) · **Lens:** provider-arch · **Votes:** reproduce:✓(high) impact:✓(medium) false-positive:✓(high)
- **Failure scenario:** VoucherListScreen auto-selects router A and starts loadVouchers(A) (up to 15s on a slow link). The operator immediately switches the dropdown to router B; loadVouchers(B, refresh:true) clears state and B's fast response renders B's vouchers. A's response then lands and executes `state = state.copyWith(vouchers: result.vouchers, total: result.total, ...)` with no routerId correlation check, so the screen (dropdown still showing B) now permanently displays router A's voucher codes and total. The operator prints/sells codes that will not authenticate on router B's hotspot, or taps a row and gets 404s because voucher.id belongs to router A. Same root cause: an in-flight loadMore(A) (triggered by scrolling, vouchers_provider.dart:134-139) appends A's page-2 vouchers onto B's list, and the isLoading/hasMore guards at line 123 compare global state that spans both routers. The Voucher model carries routerId (models/voucher.dart:4) but the notifier never checks it against the current selection.
- **Evidence:** `final vouchersProvider = ⏎     StateNotifierProvider<VouchersNotifier, VouchersState>( ⏎   (ref) => VouchersNotifier(), ⏎ );  // no .family(routerId), no autoDispose; loadVouchers/loadMore apply responses with no routerId check: ⏎       state = state.copyWith( ⏎         vouchers: [...state.vouchers, ...result.vouchers],`
- **Fix:** Key the provider by router: convert to `StateNotifierProvider.family<VouchersNotifier, VouchersState, String>` (or store `routerId` in VouchersState, capture it when a request starts, and discard any response whose routerId no longer matches the current state). Also drop stale responses by comparing a per-request sequence number captured before the await.

### 3. Reports screen parses keys the backend never sends - every report silently renders zeros

- **File:** `mobile/lib/screens/reports/reports_screen.dart:418`
- **Category:** contract-mismatch · **Origin:** verified (2-of-3) · **Lens:** json-models · **Votes:** reproduce:✓(high) impact:✓(high) false-positive:✓(high)
- **Failure scenario:** A Pro/Enterprise operator opens Reports and runs any report. GET /reports returns { type, startDate, endDate, rows: [...], totals: {...} } (backend/src/services/report.service.ts:194, 272-278, 366-372) and for router-uptime { routers: [{routerId, routerName, status, lastSeen, createdAt}], summary } (report.service.ts:435-446). The mobile parser instead reads data['summary'], data['dailyBreakdown'], data['profileBreakdown'], and for uptime router['name']/['uptimePercent']/['totalOnlineSeconds'] - none of which exist. All null-coalesce to 0/''/[], so voucher-sales, sessions, and revenue reports show all-zero stat cards with no daily breakdown, and router-uptime shows every router as 'Unknown' at 0.0% uptime. No exception is thrown, so the provider's error banner never appears - a paying operator sees confidently wrong business data (e.g. 'zero vouchers sold') on every use of the tier-locked Reports feature.
- **Evidence:** `final summary = data['summary'] as Map<String, dynamic>? ?? {}; ⏎     final created = summary['created'] as int? ?? 0;  // backend sends 'totals', not 'summary' ⏎ ... final dailyBreakdown = (data['dailyBreakdown'] as List<dynamic>?)... ?? [];  // backend sends 'rows' ⏎ ... final name = router['name'] as String? ?? 'Unknown';  // backend sends 'routerName' (line 649)`
- **Fix:** Align the four _build*Report parsers with the actual API contract: read data['totals'] (mapping 'remaining' to the Active card), iterate data['rows'] (per-row keys created/used/expired, totalSessions/avgDurationSeconds/totalInputOctets/totalOutputOctets, vouchersCreated), read totals.profileBreakdown for revenue, and routerName/status/lastSeen for uptime (backend sends no uptimePercent/totalOnlineSeconds - either compute or drop those widgets). Alternatively change the backend serializer, but the backend shape is the deployed contract.

### 4. Certificate pinning is a no-op against CA-valid MITM certs (wrong callback)

- **File:** `mobile/lib/services/api_client.dart:90`
- **Category:** security · **Origin:** verified (2-of-3) · **Lens:** network-tls · **Votes:** reproduce:✓(high) impact:✓(medium) false-positive:✓(high)
- **Failure scenario:** A release-build user is on a network with a TLS-intercepting proxy whose root CA is trusted by the device (MDM/corporate CA, user-installed CA on iOS, or a compromised/misissued public CA). The proxy's certificate passes the platform's default chain validation, so Dart never invokes badCertificateCallback — the pin comparison never runs. The interceptor reads the bearer token, rotated refresh token, login password, and router credentials in transit while the app's comments and pins claim pinning protection. badCertificateCallback only fires for certificates that FAIL default validation, i.e. exactly the certs an MITM with a trusted CA never presents.
- **Evidence:** `client.badCertificateCallback = (cert, host, port) { ⏎   // Compute SPKI SHA-256 for the presented certificate. ⏎   final spkiDer = cert.der; ⏎   final digest = sha256.convert(spkiDer); ⏎   final pin = base64.encode(digest.bytes); ⏎   final allowed = pin == _kPinPrimary || pin == _kPinBackup;`
- **Fix:** Use IOHttpClientAdapter.validateCertificate (available in the locked dio 5.9.2), which runs for every established TLS connection including chain-valid ones, and reject when the computed pin matches neither configured pin. Keep badCertificateCallback returning false (or unset) so invalid chains stay rejected.

## Medium severity (26)

### 5. iOS push is entirely unconfigured: no GoogleService-Info.plist, entitlements, or background mode

- **File:** `mobile/ios/Runner/Info.plist:4`
- **Category:** platform-config · **Origin:** verified (2-of-3) · **Lens:** diff-platform · **Votes:** reproduce:✓(medium) impact:✓(low) false-positive:✓(medium)
- **Failure scenario:** Any iOS build: Firebase.initializeApp() throws (no GoogleService-Info.plist anywhere in mobile/ios and no reference in project.pbxproj), the catch in PushNotificationService.initialize() swallows it with a debugPrint, and the device token is never registered — iOS operators silently never receive router-offline/subscription push notifications. Even with the plist added, Runner has no .entitlements file (no aps-environment) and Info.plist has no UIBackgroundModes/remote-notification, so APNs delivery and background messages still would not work. The Dart code explicitly targets iOS (Platform.isIOS ? 'ios' : 'android' in push_notification_service.dart:61), so this is an intended platform with a dead feature.
- **Evidence:** `<dict> ⏎ 	<key>CADisableMinimumFrameDurationOnPhone</key> ... (no UIBackgroundModes key; grep across mobile/ios finds no aps-environment, no *.entitlements, no GoogleService-Info.plist)`
- **Fix:** When iOS ships: add GoogleService-Info.plist to the Runner target, enable the Push Notifications capability (creates Runner.entitlements with aps-environment) plus Background Modes > Remote notifications (UIBackgroundModes: remote-notification in Info.plist), and upload the APNs key to Firebase. Until then, consider logging a visible warning or gating iOS builds so the silent failure is not mistaken for working push.

### 6. No plural/dual support in translate(): Arabic count strings grammatically wrong for 2-10 (and 11+ months)

- **File:** `mobile/lib/i18n/app_localizations.dart:49`
- **Category:** i18n · **Origin:** verified (2-of-3) · **Lens:** i18n-rtl · **Votes:** reproduce:✓(medium) impact:✓(low) false-positive:✓(medium)
- **Failure scenario:** translate() only does positional {0} replacement, and every AR count template uses the singular noun, so an Arabic user sees 'منذ 5 دقيقة' instead of 'منذ 5 دقائق' on router last-seen, notification and chat timestamps, '3 كرت' instead of '3 كروت' in delete/create/print counts, '12 أشهر' instead of '12 شهرًا' on plan durations, and no dual forms (2 -> دقيقتين/يومان/شهران). Affected count-templated keys confirmed in use: routers.minutesAgo/hoursAgo/daysAgo/monthsAgo (dashboard_screen.dart:47-49, router_list_screen.dart:187-196, router_detail_screen.dart:389-398, notifications_screen.dart:174-179, contact_screen.dart:194-199), dashboard.daysRemaining (:258), settings.daysLeft (settings_screen.dart:143), subscription.daysValue (subscription_status_screen.dart:157), subscription.monthsN/perNMonths (subscription_status_screen.dart:353, plan_card.dart:109,125), vouchers.selected (voucher_list_screen.dart:302), vouchers.deleteBody/deleteAllBody/vouchersDeleted (:205,:219,:229,:242), vouchers.vouchersCreated/createNVouchers (create_voucher_wizard.dart:147,:834), vouchers.readyToPrint (voucher_print_screen.dart:99), vouchers.durationMinutes/Hours/Days (voucher_format.dart:71-76, create_voucher_wizard.dart:664-669, reports_screen.dart:42-48), sessions.activeSessionsCount (active_sessions_screen.dart:120), sessions.recordsCount (session_history_screen.dart:111), notifications.body.router_offline/router_online/subscription_expiring/bulk_creation_complete (notifications_screen.dart:196-215).
- **Evidence:** `String translate(String key, [List<String>? args]) { ⏎   String value = _localizedValues[locale.languageCode]?[key] ?? _en[key] ?? key; ⏎   ... value = value.replaceAll('{$i}', args[i]);  // no plural categories ⏎ 'routers.minutesAgo': 'منذ {0} دقيقة',  (line 1131)`
- **Fix:** Add a plural-aware helper (e.g. trPlural(key, count) selecting zero/one/two/few/many/other variants per Arabic CLDR rules, or adopt intl's Intl.plural) and split the ~20 count-templated keys into per-category AR variants; route the call sites listed above through it.

### 7. First frame blocked on push-permission dialog and network I/O before runApp

- **File:** `mobile/lib/main.dart:11`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** diff-platform · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** Fresh install on Android 13+: _start() awaits PushNotificationService().initialize() before runApp(), and initialize() awaits messaging.requestPermission() (system dialog blocks until the user answers), then messaging.getToken() and an HTTP POST to /notifications/device-token (Dio connectTimeout/receiveTimeout are 15s each in AppConfig). The operator sees only the frozen native splash — with a notification-permission dialog popping over it before any app UI exists — and on a flaky hotspot-site network the blank splash can persist ~15-30s before the first frame renders.
- **Evidence:** `Future<void> _start() async { ⏎   WidgetsFlutterBinding.ensureInitialized(); ⏎   await PushNotificationService().initialize(); ⏎   runApp(const ProviderScope(child: WaselApp())); ⏎ }`
- **Fix:** Call runApp() first and kick off PushNotificationService().initialize() unawaited (or after first frame via WidgetsBinding.instance.addPostFrameCallback / from app.dart), and defer requestPermission until after the user is inside the app. The service already guards re-entry with _initialized and catches its own errors, so fire-and-forget is safe.

### 8. Logout resets only 3 providers; routers/vouchers/dashboard/sessions/reports state leaks to the next account

- **File:** `mobile/lib/providers/auth_provider.dart:106`
- **Category:** data-leak · **Origin:** verified (2-of-3) · **Lens:** auth-session, provider-arch · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** Operator A logs out on a shared shop device; operator B logs in. _resetUserScopedProviders() resets only notificationsProvider, supportProvider and subscriptionProvider. routersProvider, vouchersProvider, dashboardProvider, sessionsProvider, reportsProvider, notification_prefs and hotspotTemplatesProvider (which even defines an uncalled reset() at hotspot_templates_provider.dart:99) are keep-alive StateNotifierProviders that retain A's data. DashboardScreen renders stale non-null data immediately (dashboard_screen.dart:124 shows the skeleton only when data == null), so B sees A's revenue, voucher counts and router inventory while the refetch runs — and indefinitely if the device is offline or the fetch fails.
- **Evidence:** `/// Reset every user-scoped provider so stale data from the previous user ⏎   /// can't leak into the next session. Called before tokens are cleared. ⏎   void _resetUserScopedProviders() { ... notificationsProvider ... supportProvider ... subscriptionProvider ... }`
- **Fix:** Add reset()/initial-state methods to routers, vouchers, dashboard, sessions, reports and notification-prefs notifiers and call them (plus the existing hotspotTemplatesProvider.reset()) from _resetUserScopedProviders; alternatively invalidate these providers via ref.invalidate on logout and session-expiry.

### 9. FCM device token is never (re)registered after login — push notifications dead until next cold start

- **File:** `mobile/lib/providers/auth_provider.dart:388`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** provider-arch · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** Registration happens only in PushNotificationService.initialize(), which main.dart awaits before runApp. On a fresh install the register POST fires pre-auth and 401s (token not cached), and nothing in login()/tryRestoreSession registers it afterwards — the user receives zero push notifications for the entire first session. Worse: logout() calls unregisterCurrentToken() (deletes the server registration and the local cache), so after any logout→login on the same run the device has no registered token until the app is fully restarted while logged in.
- **Evidence:** `await PushNotificationService().unregisterCurrentToken(); ⏎       await _authService.logout(); ⏎ // ...while login() only does: _loadUserScopedProviders(); _syncLocaleToBackend();  — no token re-registration path exists`
- **Fix:** Add a PushNotificationService.registerCurrentToken() (fetch FirebaseMessaging.instance.getToken() and POST it, ignoring the cached-token short-circuit after logout) and call it from login() success and from tryRestoreSession() after the profile validates.

### 10. routersProvider is the third un-keyed global singleton — router detail/status/setup-guide can show the previous router

- **File:** `mobile/lib/providers/routers_provider.dart:192`
- **Category:** data-corruption · **Origin:** critic+manual
- **Failure scenario:** Same defect class as the confirmed vouchers/sessions findings. routersProvider is a plain global StateNotifierProvider (line 192) holding selectedRouter/selectedRouterStatus/setupGuide. loadRouter(id) (line 70) sets isLoading then overwrites selectedRouter without clearing the previous one first, and router_detail_screen renders the retained selectedRouter until the new response lands. Opening router B's detail right after router A briefly shows A's name/model/status; a slow loadRouter(A) that resolves after loadRouter(B) overwrites B with A. loadRouterStatus swallows errors (line 153-155), so a stale status can persist. edit_router_screen also reads selectedRouter to prefill the form.
- **Fix:** Convert to a family keyed by routerId (ideally autoDispose), or store routerId in RoutersState, clearSelectedRouter/clearStatus at the start of loadRouter, and drop responses whose id no longer matches the current selection. This is the same fix as vouchers/sessions and should be done together.

### 11. Session history has the same stale-response race across filter changes and router switches

- **File:** `mobile/lib/providers/sessions_provider.dart:133`
- **Category:** race-condition · **Origin:** verified (2-of-3) · **Lens:** pagination · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** sessionsProvider is a single global StateNotifier keyed by nothing. User opens history for router A (large radacct table, slow), backs out, opens history for router B — or rapidly submits a username search then a terminate-cause filter (session_history_screen.dart:55-67); each fires loadSessionHistory(refresh:true) with no cancellation. If the older request resolves last, its result overwrites the newer one: router A's sessions (or the pre-filter result set) are displayed under router B / the new filter, with a mismatched historyTotal in the records-count header.
- **Evidence:** `state = state.copyWith( ⏎   historySessions: result.sessions, ⏎   historyTotal: result.total, ⏎   historyPage: result.page, ⏎   isLoading: false, ⏎ );`
- **Fix:** Same as vouchers: attach a sequence token or routerId+filter snapshot to each request and drop responses that no longer match, or cancel the previous request via Dio CancelToken before starting a new load.

### 12. sessionsProvider global singleton shows the previous router's active sessions and history, and silently reuses a stale username filter

- **File:** `mobile/lib/providers/sessions_provider.dart:170`
- **Category:** data-corruption · **Origin:** verified (2-of-3) · **Lens:** provider-arch · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** (1) Active sessions: loadActiveSessions (line 89) never clears activeSessions before fetching, and active_sessions_screen.dart:88 renders the retained list whenever it is non-empty — so opening router B's sessions screen shows router A's users (username/MAC/IP) until B's response arrives, and permanently if the request errors; tapping Disconnect on such a row sends a CoA for router B with router A's session id. (2) History: an in-flight loadMoreHistory(routerA) appends A's page into router B's freshly-loaded list (line 156-161) because the isLoading guard is global. (3) Filters: filterUsername persists in the singleton; after searching 'ali' on router A's history and opening router B's history, loadSessionHistory(refresh:true) at line 126 silently passes username:'ali' while the new screen's search box is empty — router B's history is invisibly filtered.
- **Evidence:** `final sessionsProvider = ⏎     StateNotifierProvider<SessionsNotifier, SessionsState>( ⏎   (ref) => SessionsNotifier(), ⏎ );  // loadActiveSessions keeps old list: state = state.copyWith(activeSessions: sessions, ...) with no clear-on-router-change and no routerId in SessionsState`
- **Fix:** Make the provider a family keyed by routerId (ideally autoDispose so filters and lists die with the screen), or store routerId in SessionsState, clear lists and filters when it changes, and drop responses whose originating routerId no longer matches.

### 13. No cancellation/sequence guard on voucher list loads: stale slow response overwrites newer router/filter selection

- **File:** `mobile/lib/providers/vouchers_provider.dart:111`
- **Category:** race-condition · **Origin:** verified (2-of-3) · **Lens:** pagination · **Votes:** reproduce:✓(medium) impact:✓(low) false-positive:✓(medium)
- **Failure scenario:** Operator selects router A (5,000 vouchers, slow query on a weak connection), then switches the dropdown to router B (_onRouterSelected fires a second loadVouchers(refresh:true), voucher_list_screen.dart:86). B's small response lands first; A's response lands second and unconditionally overwrites state — the screen now shows router A's vouchers and total while router B is selected. Select-mode bulk actions then send router A voucher IDs to /routers/B/... endpoints. The same last-write-wins race applies to rapid search submits and status-filter changes (screen lines 98, 105). ApiClient supports CancelToken (api_client.dart:127) but the voucher service never passes one, and the provider stores no routerId/sequence to reject stale results.
- **Evidence:** `state = state.copyWith( ⏎   vouchers: result.vouchers, ⏎   total: result.total, ⏎   page: result.page, ⏎   isLoading: false, ⏎ );`
- **Fix:** Keep a monotonically increasing request token (or the routerId+filters snapshot) captured before the fetch and discard the response if it no longer matches current state; or plumb a CancelToken through VoucherService.getVouchers and cancel the in-flight request whenever router/search/filter changes.

### 14. Bulk delete shifts server offsets: vouchers silently skipped and hasMore stuck true (eternal spinner + endless empty fetches)

- **File:** `mobile/lib/providers/vouchers_provider.dart:234`
- **Category:** pagination · **Origin:** verified (2-of-3) · **Lens:** pagination · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** Router has 250 vouchers; page 1 (limit 100) is loaded. Operator multi-selects 50 and deletes them via _onDeleteSelected (which never refreshes the list). Client now holds 50 rows, total 200, page 1. Server rows shifted up by 50, so loadMore(page 2) returns server rows 100-199 — the 50 vouchers now at server offsets 50-99 are never fetched and stay invisible until a manual refresh. Worse, list length plateaus at 150 while total stays 200, so hasMore (vouchers.length < total, line 32) remains true forever: the footer CircularProgressIndicator never goes away and every scroll near the bottom fires another loadMore that returns an empty page (page 3, 4, 5, ...), burning network requests indefinitely.
- **Evidence:** `final updatedList = state.vouchers.where((v) => !ids.contains(v.id)).toList(); ⏎ state = state.copyWith( ⏎   vouchers: updatedList, ⏎   total: state.total - count,`
- **Fix:** After a bulk delete, re-run loadVouchers(routerId, refresh: true) instead of surgically editing the list, or switch to cursor/keyset pagination. At minimum, treat an empty loadMore result as end-of-list (set a hasMore=false override) so the spinner and request loop stop.

### 15. Setup-guide screens copy WG private key/RADIUS secret/router admin password to clipboard with no auto-clear and no FLAG_SECURE

- **File:** `mobile/lib/screens/routers/setup_guide_screen.dart:65`
- **Category:** sensitive-data-leak · **Origin:** verified (2-of-3) · **Lens:** data-exposure · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** Operator opens the setup guide (or finishes add-router) and taps 'Copy all commands'. The full RouterOS script — containing the router's WireGuard private key, the RADIUS shared secret, and the wasel_auto group=full admin password (backend wireguardConfig.ts:468,492,504) — lands on the system clipboard permanently. Gboard/Samsung clipboard history, cross-device clipboard sync (Windows Phone Link), or any later paste into a chat app exposes full router-takeover credentials. The same screens render these secrets on-screen with no SecureWindow/FLAG_SECURE and no iOS blur, so screen recordings and app-switcher thumbnails capture them, while a single voucher code on voucher_detail gets both FLAG_SECURE and a 30-second clipboard auto-clear. add_router_screen.dart:177 has the identical unguarded Clipboard.setData for the same payload.
- **Evidence:** `void _copyToClipboard(String text) { ⏎     Clipboard.setData(ClipboardData(text: text)); ⏎     AppSnackbar.success(context, context.tr('routers.guideCopied')); ⏎   }`
- **Fix:** Enable SecureWindow (and the iOS blur overlay) on setup_guide_screen and the post-generate state of add_router_screen, and route these copies through a shared copy-with-auto-clear helper (a longer window, e.g. 2-5 minutes, is fine for setup UX). On Android 13+ also pass ClipData with EXTRA_IS_SENSITIVE via a platform channel so the clipboard preview is suppressed.

### 16. Failed CoA session disconnect is silent — ok==false ignored and error only rendered on empty list

- **File:** `mobile/lib/screens/sessions/active_sessions_screen.dart:64`
- **Category:** silent-failure · **Origin:** verified (2-of-3) · **Lens:** error-handling · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(low)
- **Failure scenario:** Operator confirms disconnecting a guest (CoA over the WG tunnel); the request fails because the router is degraded. disconnectSession returns false, _confirmDisconnect only handles `ok == true`, and _buildBody shows state.error solely when activeSessions is empty — so the session stays in the list with no message and the operator assumes the disconnect silently worked or retries blindly.
- **Evidence:** `if (ok && mounted) { ⏎   AppSnackbar.success(context, context.tr('sessions.disconnectedSuccessfully')); ⏎ }`
- **Fix:** Add an else branch showing AppSnackbar.error(context, ref.read(sessionsProvider).error ?? 'error.unknown') when ok is false.

### 17. PaymentsScreen shows 'no payments' empty state when loadPayments fails

- **File:** `mobile/lib/screens/settings/payments_screen.dart:120`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** error-handling · **Votes:** reproduce:✓(medium) impact:✓(low) false-positive:✓(medium)
- **Failure scenario:** Operator opens Payments while offline or the API 500s: loadPayments catches into state.error (subscription_provider.dart:161-166) but the screen never reads state.error — the build falls through to `state.payments.isEmpty ? _buildEmpty()` and renders the 'payments.empty' placeholder. A paying user with pending/rejected payments is told they have none, with no error and no retry affordance beyond a hidden pull-to-refresh.
- **Evidence:** `child: state.payments.isEmpty ⏎     ? _buildEmpty() ⏎     : ListView.separated(`
- **Fix:** Add an `state.error != null && state.payments.isEmpty` branch rendering ErrorState with a retry that calls loadPayments(), mirroring notifications/sessions screens.

### 18. Voucher detail toggle/delete failures give zero feedback; screen never renders vouchersState.error

- **File:** `mobile/lib/screens/vouchers/voucher_detail_screen.dart:133`
- **Category:** silent-failure · **Origin:** verified (2-of-3) · **Lens:** error-handling · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** Operator confirms 'Disable voucher' but the PATCH fails (router tunnel down, network drop): toggleVoucherStatus returns false which _toggleStatus ignores, the follow-up loadVoucher re-renders the unchanged voucher, and the screen has no state.error rendering anywhere — the operator gets no message and may believe a still-active voucher was disabled. _deleteVoucher (line 162) likewise handles only `success == true`; a failed delete leaves the user on the screen with no explanation.
- **Evidence:** `await ref ⏎     .read(vouchersProvider.notifier) ⏎     .toggleVoucherStatus(widget.routerId, voucher); ⏎ // Reload to get fresh data`
- **Fix:** Check the bool result of toggleVoucherStatus/deleteVoucher and show AppSnackbar.error with ref.read(vouchersProvider).error when false, as sessions' disconnect and payments' cancel flows already do for their errors.

### 19. Bulk voucher delete failures produce no feedback in the list screen

- **File:** `mobile/lib/screens/vouchers/voucher_list_screen.dart:216`
- **Category:** silent-failure · **Origin:** verified (2-of-3) · **Lens:** error-handling · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** Operator selects 20 vouchers, confirms the destructive delete dialog, and bulkDeleteVouchers fails (timeout/500): it returns null, the `deleted != null` guard skips the snackbar, and the screen renders vouchersState.error only when `vouchers.isEmpty` (line 439) — with the list still populated nothing at all happens after a confirmed destructive action. _onDeleteAll (line 239) has the identical silent path; a mid-loop failure there also leaves the local list stale relative to the partially-deleted server state.
- **Evidence:** `if (mounted && deleted != null) { ⏎   AppSnackbar.success( ⏎     context, ⏎     context.tr('vouchers.vouchersDeleted', [deleted.toString()]), ⏎   ); ⏎ }`
- **Fix:** On `deleted == null`, show AppSnackbar.error with the provider error; in deleteAllVouchers, also refresh the list in the catch path so a partial bulk delete is reflected.

### 20. Voucher status rendered as raw capitalized English in AR UI (card badge, filter chip, detail row, delete-all dialog)

- **File:** `mobile/lib/screens/vouchers/voucher_list_screen.dart:693`
- **Category:** i18n · **Origin:** verified (2-of-3) · **Lens:** i18n-rtl · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(low)
- **Failure scenario:** Arabic user opens the Vouchers tab -> every voucher card shows an English badge 'Active'/'Unused'/'Expired'/'Disabled' produced by _capitalizeStatus(voucher.status), even though localized keys exist and are used in the adjacent filter menu ('vouchers.active' = 'نشطة', lines 505-510). Same on the detail screen (voucher_detail_screen.dart:272 and :400) and the active filter chip (line 533). Worse, _onDeleteAll (line 225) injects the English status into the Arabic confirm sentence: 'حذف كل 50 Active كرت؟'.
- **Evidence:** `StatusBadge( ⏎   label: _capitalizeStatus(voucher.status), ⏎   color: AppColors.voucherStatus(voucher.status), ⏎ )`
- **Fix:** Replace _capitalizeStatus(status) at all four display sites with a localized lookup, e.g. context.tr(status == 'unused' ? 'common.unused' : 'vouchers.$status') or the existing trStatus helper, and use the same localized label for the delete-all filter interpolation.

### 21. Voucher print preview and voucher list show codes without FLAG_SECURE/blur protection

- **File:** `mobile/lib/screens/vouchers/voucher_print_screen.dart:110`
- **Category:** hardening · **Origin:** verified (2-of-3) · **Lens:** data-exposure · **Votes:** reproduce:✓(medium) impact:✓(low) false-positive:✓(medium)
- **Failure scenario:** Operator selects 'Print all' for hundreds of vouchers; VoucherPrintScreen renders every code in a PdfPreview. Unlike voucher_detail_screen (which enables SecureWindow on Android and blurs on iOS), this screen — and voucher_list_screen, which prints voucher.username in every row (voucher_list_screen.dart:685) — sets no FLAG_SECURE and no lifecycle blur. A screen-recording app, casual screenshot, or the OS app-switcher thumbnail captures the entire sellable voucher inventory at once, exactly the asset the single-code detail screen was hardened against.
- **Evidence:** `child: PdfPreview( ⏎               key: ValueKey('vouchers_$_columnCount'), ⏎               build: _generatePdf,  // renders code: v.username for every voucher; no SecureWindow.enable() anywhere in this file`
- **Fix:** Apply the same protection pattern as voucher_detail_screen to VoucherPrintScreen (SecureWindow.enable in initState / disable in dispose, iOS blur on inactive), and consider it for the voucher list. Extract the pattern into a reusable mixin/wrapper so coverage stays consistent.

### 22. Debug HTTP log redaction misses apiPass, newPassword/currentPassword, and setup-guide secrets

- **File:** `mobile/lib/services/api_client.dart:43`
- **Category:** sensitive-data-leak · **Origin:** verified (2-of-3) · **Lens:** data-exposure · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** Developer or tester runs a debug build and edits a router (PUT /routers/:id with apiPass), changes their password, or opens add-router/setup-guide. The _RedactedLogInterceptor (registered in kDebugMode, api_client.dart:111-113) debugPrints the full request and response bodies to logcat. Because only password/otp/token keys are redacted, the log contains the MikroTik API password cleartext (router_service.dart:202 sends body['apiPass']), the user's new account password (auth_service.dart:80 'newPassword', :138 'currentPassword'), every created voucher code (response 'username' fields), and — worst — the POST /routers and GET /routers/:id/setup-guide responses whose 'command'/'setupGuide' fields embed the decrypted WireGuard private key, RADIUS shared secret, and RouterOS group=full admin password (backend wireguardConfig.ts:468,492,504). Anyone who obtains the logcat capture or an adb bugreport can take over the router's RouterOS API and impersonate its RADIUS client.
- **Evidence:** `const _kRedactedFields = { ⏎   'password', ⏎   'otp', ⏎   'refresh_token', ⏎   'refreshToken', ⏎   'access_token', ⏎   'accessToken', ⏎   'authorization', ⏎   'Authorization', ⏎ };  // router_service.dart:202: if (apiPass != null) body['apiPass'] = apiPass;`
- **Fix:** Add 'apiPass', 'newPassword', 'currentPassword', 'command', 'setupGuide', and 'token' to _kRedactedFields (or switch to an allowlist of loggable keys). Consider also redacting voucher 'username' values in voucher endpoints' responses since the code is the bearer credential.

### 23. Pin hash computed over full cert DER, but configured pins are SPKI hashes

- **File:** `mobile/lib/services/api_client.dart:92`
- **Category:** security · **Origin:** verified (2-of-3) · **Lens:** network-tls, auth-session, provider-arch · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** X509Certificate.der is the full certificate DER, not the SubjectPublicKeyInfo, while _kPinPrimary/_kPinBackup are generated by the documented openssl recipe (lines 27-37) that extracts the public key (`openssl x509 -pubkey ... -outform der`). SHA-256(full cert) can never equal SHA-256(SPKI), so whenever the callback does fire the pin check always fails — today that degenerates to default reject-invalid-cert behavior, but the moment anyone fixes the callback wiring (moves this same computation into validateCertificate), every release-build connection to api.wa-sel.com is rejected and the app is bricked in the field until an app-store update ships. It also silently defeats the stated backup-pin recovery strategy (intermediate-CA pin surviving leaf rotation).
- **Evidence:** `// Compute SPKI SHA-256 for the presented certificate. ⏎ final spkiDer = cert.der; ⏎ final digest = sha256.convert(spkiDer);`
- **Fix:** Parse the certificate and hash only the SubjectPublicKeyInfo DER (e.g. via package:basic_utils or asn1lib) so the computed pin matches the openssl SPKI recipe, or alternatively regenerate the pins over full-cert DER and rewrite the comment recipe — but SPKI pinning is preferred because it survives leaf re-issuance with the same keypair. Add an integration test that validates the live pin against the recipe.

### 24. Post-refresh retry re-sends a finalized FormData — receipt upload fails after token expiry

- **File:** `mobile/lib/services/api_client.dart:322`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** network-tls · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(low)
- **Failure scenario:** User submits a bank-transfer receipt (subscription_service.dart:92 posts FormData via postMultipart) just as the 15-minute access token expires. The 401 triggers a successful refresh, then the retry (`_dio.fetch(failedRequest)` at lines 322/374) re-sends the same FormData instance, which dio has already finalized — dio throws "The FormData has already been finalized", the outer catch treats it as refreshError, isAuthRejection is false, and the caller receives the original 401. The payment receipt upload fails with an auth error despite a valid session, at the exact moment the user is paying.
- **Evidence:** `failedRequest.headers['Authorization'] = 'Bearer $newToken'; ⏎ final retryResponse = await _dio.fetch(failedRequest);`
- **Fix:** Before retrying, detect `failedRequest.data is FormData` and rebuild it (FormData.clone() exists in dio 5.x), or skip transparent retry for multipart requests and surface a retriable error so the caller re-creates the FormData.

### 25. 401s arriving after refresh-queue drain are queued forever — request hangs indefinitely

- **File:** `mobile/lib/services/api_client.dart:374`
- **Category:** crash · **Origin:** verified (2-of-3) · **Lens:** network-tls, auth-session, error-handling · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** Token expires while a screen fires 3+ parallel requests (e.g. dashboard load). Request A triggers the refresh; the queue is drained and cleared (lines 367-370); then A's retry `await _dio.fetch(failedRequest)` runs while _isRefreshing is still true (finally at line 390 hasn't executed). Request C, still in flight with the old token, returns 401 during that window, takes the `_isRefreshing` branch (line 316), adds a Completer to the now-cleared queue, and awaits it forever — nothing ever completes it. C's caller Future never resolves and the screen shows a permanent spinner until app restart. The same never-drained window exists around `await _storage.clearAll()` on the failure paths (lines 341, 385).
- **Evidence:** `_refreshQueue.clear(); ⏎  ⏎ // Retry the original request with the fresh token. ⏎ failedRequest.headers['Authorization'] = 'Bearer $newAccessToken'; ⏎ final retryResponse = await _dio.fetch(failedRequest);`
- **Fix:** Set _isRefreshing = false (and only then drain/clear the queue) before awaiting the original request's retry, or replace the flag+queue with a single shared `Future<String>? _refreshFuture` that late joiners await — eliminating the window where the flag is true but the queue will never be drained. As a safety net, give queued completers a timeout.

### 26. Logout never revokes the refresh token server-side (missing refreshToken body)

- **File:** `mobile/lib/services/auth_service.dart:88`
- **Category:** security · **Origin:** verified (2-of-3) · **Lens:** auth-session · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** User taps Logout. AuthService.logout() posts to /auth/logout with no body. The backend logout controller (backend/src/controllers/auth.controller.ts:244-247) requires a refreshToken from body or cookie for non-admin clients and replies 400 VALIDATION_ERROR; mobile sends neither, and the catch swallows the error. Result: on every mobile logout the 7-day refresh token remains valid in Redis. Any copy of that token exfiltrated earlier (device backup extraction, malware, debug logs on a compromised device) keeps working for up to 7 days after the user believes they logged out — server-side session revocation on logout is dead code for the mobile app, 100% of the time.
- **Evidence:** `Future<void> logout() async { ⏎     try { ⏎       await _api.post('/auth/logout'); ⏎     } catch (_) {`
- **Fix:** Read the refresh token from secure storage before clearing it and send it in the body: await _api.post('/auth/logout', data: {'refreshToken': refreshToken}). In AuthNotifier.logout(), fetch the token before _storage.clearAll() so it is still available.

### 27. Cold start blocks on push permission dialog and network I/O before runApp

- **File:** `mobile/lib/services/push_notification_service.dart:43`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** async-lifecycle · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** main.dart:9-12 runs `await PushNotificationService().initialize()` before `runApp`. initialize() awaits `requestPermission` — on iOS and Android 13+ first launch this Future only completes when the user answers the OS notification-permission dialog — then awaits `getToken()` and an authenticated POST /notifications/device-token (Dio connectTimeout 15s / receiveTimeout 15s in api_client.dart:75-76). A first-launch user on a flaky network stares at the bare native splash (no Flutter UI at all) behind a permission dialog plus up to ~30s of network waits before the app appears.
- **Evidence:** `await messaging.requestPermission(alert: true, badge: true, sound: true); ⏎  ⏎       final token = await messaging.getToken(); ⏎       if (token != null) await _registerToken(token);   // awaited pre-runApp via main.dart:11 `await PushNotificationService().initialize();``
- **Fix:** Call runApp first and kick off PushNotificationService().initialize() unawaited (or after first frame), and defer requestPermission until after the user is authenticated / a sensible in-app moment instead of blocking startup on it.

### 28. FCM device token is never re-registered after login, so push notifications are dead until the next app restart

- **File:** `mobile/lib/services/push_notification_service.dart:46`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** auth-session, async-lifecycle · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** Registration happens only inside initialize() — which runs once per process, before runApp and thus before any login — and on FCM onTokenRefresh. Fresh install: the pre-login POST /notifications/device-token 401s and the token is not cached, then the user registers/logs in and nothing re-registers — the new user receives zero push notifications for their entire first session. Same-run logout→login: logout() calls unregisterCurrentToken() (deleting the server registration and cached token), and login() never registers again — pushes stay dead for the rest of the run, silently.
- **Evidence:** `final token = await messaging.getToken(); ⏎       if (token != null) await _registerToken(token); ⏎       messaging.onTokenRefresh.listen(_registerToken);`
- **Fix:** Expose a registerCurrentToken() method on PushNotificationService (getToken + _registerToken, ignoring the cache guard) and call it from AuthNotifier after successful login and successful session restore.

### 29. Backend error messages are preferred over localized keys, so business/validation errors surface in English in AR UI

- **File:** `mobile/lib/utils/error_messages.dart:27`
- **Category:** i18n · **Origin:** verified (2-of-3) · **Lens:** i18n-rtl · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** Arabic user triggers any 4xx with a message body — e.g. registering an already-used email, exceeding voucher quota, or a Zod validation reject — errorToDisplay returns the backend's English 'error.message' verbatim (rule 1/2 beats the localized error.* keys, which are only used when no body message exists), so snackbars/banners across the app show English sentences in the Arabic UI.
- **Evidence:** `final msg = errorObj['message']; ⏎ if (msg is String && msg.trim().isNotEmpty) return msg;  // backend English wins over i18n keys`
- **Fix:** Have the backend return stable machine-readable error codes and map code->i18n key on the client (falling back to the raw message only for unknown codes), or send Accept-Language and localize messages server-side using the already-synced user language.

### 30. All form-validation messages hardcoded in English; auth flows show English errors in Arabic UI

- **File:** `mobile/lib/utils/validators.dart:7`
- **Category:** i18n · **Origin:** verified (2-of-3) · **Lens:** i18n-rtl · **Votes:** reproduce:✓(medium) impact:✓(medium) false-positive:✓(medium)
- **Failure scenario:** Arabic-locale user on the login/register/reset-password/change-password/edit-profile forms leaves a field empty or types a short password -> inline errors render as English text ('Email is required', 'Password must be at least 8 characters') inside the Arabic UI. Every screen wires these directly (login_screen.dart:115, register_screen.dart:109-164, reset_password_screen.dart:103-138, change_password_screen.dart:133-155, edit_profile_screen.dart:135-165). Localized equivalents already exist unused in the AR map ('validation.required', 'auth.invalidEmail', 'auth.passwordMinLength', 'auth.passwordsDoNotMatch').
- **Evidence:** `return 'Name is required';  ...  return 'Password must be at least 8 characters';  (validators.dart:7-53, all 15 messages English-only)`
- **Fix:** Make Validators methods return i18n keys and resolve them at the call site via context.tr (or pass BuildContext into the validators), reusing the existing validation.* / auth.* keys.

## Low severity (43)

### 31. ProGuard keep rule for jailbreak detection targets a nonexistent package

- **File:** `mobile/android/app/proguard-rules.pro:22`
- **Category:** hardening · **Origin:** verified (2-of-3) · **Lens:** diff-platform · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** Release build with isMinifyEnabled=true: the rule keeps com.chillibits.flutter_jailbreak_detection.**, but flutter_jailbreak_detection 1.10.0's actual Android package is appmire.be.flutterjailbreakdetection (per the plugin's pubspec.yaml platforms block), so the rule matches nothing and the real plugin classes have no explicit keep. Today R8 retains them anyway via the direct GeneratedPluginRegistrant reference, but the protection the comment claims does not exist — a future R8 optimization change or reflective use would strip/rename the unguarded classes and silently disable root detection in release only.
- **Evidence:** `# ---- flutter_jailbreak_detection ---- ⏎ -keep class com.chillibits.flutter_jailbreak_detection.** { *; } ⏎ -dontwarn com.chillibits.flutter_jailbreak_detection.**`
- **Fix:** Replace the package in the keep/dontwarn pair with appmire.be.flutterjailbreakdetection.** (the RootBeer rule on line 25 is already correct).

### 32. NotificationPreference has no mapping for backend 'support_reply' category

- **File:** `mobile/lib/models/notification_preference.dart:29`
- **Category:** i18n · **Origin:** verified (2-of-3) · **Lens:** json-models · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** The backend preferences endpoint always returns all categories including 'support_reply' (backend/src/controllers/notification.controller.ts:36-45). The model's displayName switch has no case for it, so the default returns the raw category string, and context.tr('support_reply') falls back to the key - the preferences screen shows a toggle literally labeled 'support_reply' (in both English and Arabic UIs). sectionName also buckets it under the Vouchers section because it matches neither the subscription nor router prefixes.
- **Evidence:** `case 'bulk_creation_complete': return 'notifications.category.bulkCreationComplete'; ⏎       default: return category;`
- **Fix:** Add a 'support_reply' case returning a proper i18n key (e.g. notifications.category.supportReply) with EN/AR strings, and extend sectionName to place support categories in an appropriate section.

### 33. report.dart model factories parse a third, nonexistent response shape (dead-code trap)

- **File:** `mobile/lib/models/report.dart:41`
- **Category:** contract-mismatch · **Origin:** verified (2-of-3) · **Lens:** json-models · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** VoucherSalesReport/SessionReport/RevenueReport/RouterUptimeReport.fromJson read totalCreated/totalUsed/dailyStats/byProfile/uptimePercentage - keys the backend never emits (it sends rows/totals, report.service.ts:194). These factories are currently unused (the screen parses the raw map itself), but any future developer wiring them up would get a compiling, exception-free parser that yields all-zero reports, reproducing the same silent-wrong-data bug a third way.
- **Evidence:** `totalCreated: json['totalCreated'] as int? ?? 0, ⏎       totalUsed: json['totalUsed'] as int? ?? 0, ⏎ ... dailyStats: (json['dailyStats'] as List?)`
- **Fix:** Either delete these unused model classes or rewrite them to the real rows/totals contract and make the reports screen consume them (single source of truth for report parsing), so the screen and models cannot drift independently of the API.

### 34. Session duration/uptime formatted with English h/m/s suffixes (and raw RouterOS uptime) inside Arabic UI

- **File:** `mobile/lib/models/session.dart:118`
- **Category:** i18n · **Origin:** verified (2-of-3) · **Lens:** i18n-rtl · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** Arabic user opens Session History -> duration chips render '2h 15m 30s' / '0s' (session_history_screen.dart:393 uses sessionTimeDisplay); Active Sessions shows the raw RouterOS uptime string like '1h2m3s' (active_sessions_screen.dart:232 renders session.uptime as-is). English unit letters appear untranslated even though AR unit words exist (vouchers.unitMinShort = 'دقيقة' etc.). Note the byte units (B/KB/MB/GB) in the same models and dashboard_screen.dart:31-38 match the AR table's own Latin MB/GB convention, so the defect is specifically the duration suffixes; the model bytes also lack the space used elsewhere ('1.5KB' vs '1.5 KB').
- **Evidence:** `if (h > 0) return '${h}h ${m}m ${s}s'; ⏎ if (m > 0) return '${m}m ${s}s'; ⏎ return '${s}s';`
- **Fix:** Move duration formatting out of the model into a context-aware helper (like i18n/voucher_format.dart) that uses localized unit keys, and parse/re-format the RouterOS uptime string before display.

### 35. Detail routes fall back to empty-string ids when state.extra is absent (restoration / deep-link)

- **File:** `mobile/lib/navigation/app_router.dart:157`
- **Category:** robustness · **Origin:** critic+manual
- **Failure scenario:** Multiple detail routes read ids from state.extra with an empty-string fallback (e.g. app_router.dart:157/165/204/212-215/248-249/301/309). All normal in-app navigation passes extra, so this is latent — but after OS process-death restoration or an external deep-link that reconstructs the route without extra, the screen loads with id="" and fires API calls like GET /routers/ (empty id), producing a 404/validation error the detail screens render as "not found" (compounding the not-found-vs-error findings).
- **Fix:** Encode required ids as path parameters (/routers/:id/edit) instead of state.extra so they survive restoration and deep-links, or redirect to the parent list when a required id is missing rather than issuing an empty-id request.

### 36. Successful password change revokes all sessions server-side but mobile keeps its session, causing an unexplained forced logout ~15 minutes later

- **File:** `mobile/lib/providers/auth_provider.dart:472`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** auth-session · **Votes:** reproduce:✓(medium) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** User changes their password in Settings. Backend changePassword revokes ALL refresh tokens including this device's (backend/src/services/auth.service.ts:422) and returns no new token pair. The mobile shows a success snackbar and pops back, keeping the now-doomed session. When the 15-minute access token expires mid-work, the next request 401s, refresh gets 401 REFRESH_TOKEN_REVOKED, the interceptor clears storage and _handleSessionExpired dumps the user to /login with a generic 'error.unauthorized' — an abrupt, unexplained logout minutes after a successful action.
- **Evidence:** `await _authService.changePassword( ⏎         currentPassword: currentPassword, ⏎         newPassword: newPassword, ⏎       ); ⏎       state = state.copyWith(isLoading: false);`
- **Fix:** After a successful change, either silently re-login with the new password to obtain a fresh token pair, or immediately log out locally with a clear 'password changed — please sign in again' message. (Alternatively the backend could exempt/reissue the current session's tokens.)

### 37. Notification preference toggle failure reverts silently; double failure leaves unsaved state displayed

- **File:** `mobile/lib/providers/notification_prefs_provider.dart:57`
- **Category:** silent-failure · **Origin:** verified (2-of-3) · **Lens:** error-handling · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** User turns off 'router_offline' alerts while offline: updatePreferences throws, the catch reloads preferences with no message — if the reload succeeds the switch flips back with zero explanation; if the reload also fails, the optimistic (never-persisted) toggle position remains on screen, so the user believes the alert preference changed when the server never received it.
- **Evidence:** `} catch (e) { ⏎   // Revert on failure ⏎   await loadPreferences(); ⏎ }`
- **Fix:** Also revert the in-memory list to the captured pre-toggle state (not only via reload) and set state.error / surface a snackbar so the user knows the change did not save.

### 38. NotificationsNotifier.delete uses firstWhere without orElse — throws StateError on a missing id

- **File:** `mobile/lib/providers/notifications_provider.dart:117`
- **Category:** robustness · **Origin:** verified (2-of-3) · **Lens:** provider-arch, error-handling · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** If delete(id) is ever invoked for an id no longer present in state.items (e.g. a retry after the optimistic removal already ran, or a stale callback firing after refresh() replaced the list), firstWhere throws 'Bad state: No element' inside an async handler — an unhandled exception surfaced to the zone/Sentry instead of a graceful no-op.
- **Evidence:** `final removed = state.items.firstWhere((n) => n.id == id);`
- **Fix:** Use `final removed = state.items.where((n) => n.id == id).firstOrNull; if (removed == null) return;` before performing the optimistic removal.

### 39. Notification delete: optimistic removal never rolled back and error invisible on non-empty list

- **File:** `mobile/lib/providers/notifications_provider.dart:125`
- **Category:** silent-failure · **Origin:** verified (2-of-3) · **Lens:** error-handling · **Votes:** reproduce:✓(medium) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** User swipe-deletes a notification while offline or the DELETE 500s: the item and unread count were already removed at line 121, the catch only sets state.error, and notifications_screen.dart:70 renders the error solely when `state.items.isEmpty` — so with any items left the failure is completely invisible; the notification silently reappears on the next refresh. markRead (line 100) and markAllRead (line 112) have the same invisible-error path (optimistic read state never reverted, error never shown).
- **Evidence:** `state = state.copyWith(items: filtered, unreadCount: newUnread); ⏎ try { ⏎   final serverUnread = await _service.delete(id); ⏎   state = state.copyWith(unreadCount: serverUnread); ⏎ } catch (e) { ⏎   state = state.copyWith(error: _extractError(e)); ⏎ }`
- **Fix:** In the catch, restore the pre-mutation items/unreadCount (capture them before the optimistic update), and surface mutation errors on the screen even when the list is non-empty (e.g. ref.listen on the error field showing an AppSnackbar.error).

### 40. Session history duplicates rows when new sessions start between page fetches

- **File:** `mobile/lib/providers/sessions_provider.dart:157`
- **Category:** pagination · **Origin:** verified (2-of-3) · **Lens:** pagination · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** History is offset-paginated 20 rows at a time, newest first, and on a busy hotspot new radacct sessions start continuously. Operator scrolls through history: between the page-1 and page-2 fetches, 3 new sessions start, shifting every offset by 3 — page 2's first 3 rows are the last 3 rows of page 1, and loadMoreHistory appends them without any dedup, so the operator sees the same sessions listed twice (and 3 real rows get pushed out of view until refresh). The busier the router, the more duplicated/skipped rows accumulate as the user scrolls.
- **Evidence:** `historySessions: [...state.historySessions, ...result.sessions],`
- **Fix:** Dedup appended pages by acct session id (skip rows whose id is already present), or move the endpoint to keyset pagination anchored on acctstarttime/radacctid so concurrent session churn cannot shift page boundaries.

### 41. Support chat loadMore duplicates older messages after sends shift server offsets

- **File:** `mobile/lib/providers/support_provider.dart:82`
- **Category:** pagination · **Origin:** verified (2-of-3) · **Lens:** pagination · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** Conversation has >30 messages (page size 30, newest first). User has page 1 loaded, sends 2 messages — send() prepends them locally (line 99) and the server inserts them at offset 0, shifting history down by 2. User then scrolls up to read older messages; loadMore fetches page 2 under the shifted numbering, whose first 2 rows are the tail of page 1 — those 2 messages render twice in the thread. Admin replies arriving between fetches cause the same duplication. No keys are used so there is no crash, just a confusing doubled conversation until refresh.
- **Evidence:** `messages: [...state.messages, ...next.items],`
- **Fix:** Dedup by message id when appending in loadMore, or paginate with a before=<oldest-loaded-id/createdAt> cursor instead of page numbers so local/remote inserts at the head cannot shift page boundaries.

### 42. Failed pull-to-refresh wipes the already-loaded voucher/session list before fetching

- **File:** `mobile/lib/providers/vouchers_provider.dart:99`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** pagination · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** User has 100 vouchers loaded and pulls to refresh while briefly offline. loadVouchers(refresh:true) clears vouchers/total synchronously before the request, so the list blanks (scroll position lost, RefreshIndicator subtree replaced by the full-screen spinner branch), and when the request fails the state is empty+error — all previously loaded data is gone and the ErrorState screen replaces a perfectly good cached list. sessions_provider.dart:117-123 has the identical pattern; notifications/support providers correctly keep old items until the new page arrives.
- **Evidence:** `state = state.copyWith(page: 1, vouchers: [], total: 0);`
- **Fix:** Do not clear the list at refresh start; keep current items visible during the fetch and replace them only in the success branch (as notifications_provider.refresh already does). On failure, keep the stale list and surface the error via snackbar.

### 43. createVouchers prepend + local total bump shifts offset pages (latent duplicate source, currently masked by refresh-on-pop)

- **File:** `mobile/lib/providers/vouchers_provider.dart:176`
- **Category:** pagination · **Origin:** verified (2-of-3) · **Lens:** pagination · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** createVouchers prepends the new batch and bumps total, shifting every server offset by count; a subsequent loadMore would refetch count already-listed rows (no keys on _VoucherCard so no crash, but duplicate cards, and _onPrintSelected's where-by-id would print duplicated vouchers twice). Today every path back to the list re-runs loadVouchers(refresh:true) — wizard pop (voucher_list_screen.dart:143-145), detail pop (624-626), and tab switches re-mount the plain ShellRoute screen — so the corrupt state is always overwritten before loadMore can fire. Any future caller that skips the pop-refresh (e.g., an in-place quick-create) immediately exposes duplicates plus an undercounted tail.
- **Evidence:** `vouchers: [...vouchers, ...state.vouchers], ⏎ total: state.total + vouchers.length,`
- **Fix:** Have createVouchers trigger a full refresh of page 1 (as callers already rely on) instead of prepending into paginated state, or dedup by id in loadMore so shifted pages cannot introduce duplicates.

### 44. fetchAllForPrint is dead code whose catch block re-introduces the exact dialog-open state mutation its own comment forbids

- **File:** `mobile/lib/providers/vouchers_provider.dart:287`
- **Category:** latent-trap · **Origin:** verified (2-of-3) · **Lens:** provider-arch · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** No call site exists anywhere in mobile/ (voucher_list_screen._onPrintAll bypasses it and calls VoucherService directly with a local _isPrintLoading flag). The method's comment explains that mutating state while the caller's print dialog is open causes a '_dependents.isEmpty' assertion crash — yet the catch block does exactly that (`state = state.copyWith(error: ...)`) on the failure path, where VoucherListScreen underneath the dialog watches vouchersProvider. Today it cannot crash because nothing calls it; the first developer who reuses this helper (as its API invites) gets the documented crash on the network-error path.
- **Evidence:** `// Modifying state here would trigger a rebuild while the dialog is open, ⏎     // causing a '_dependents.isEmpty' assertion error. ⏎     ... ⏎     } catch (e) { ⏎       state = state.copyWith(error: _extractError(e));`
- **Fix:** Delete the unused method (preferred), or make the catch rethrow / return null without touching state so it honors its own contract.

### 45. Subscription load failure indistinguishable from 'no subscription' in quick-create gating

- **File:** `mobile/lib/screens/dashboard_screen.dart:86`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** error-handling · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** loadSubscription is fired once, fire-and-forget, at login (auth_provider._loadUserScopedProviders). If it fails transiently, subscription stays null and `subState.subscription?.isActive ?? false` treats the paying operator as unsubscribed: tapping the quick-create FAB pops the 'subscription required' paywall dialog. The dashboard never retries the subscription load (pull-to-refresh reloads only dashboardProvider) and the underlying error is never displayed.
- **Evidence:** `final isActive = subState.subscription?.isActive ?? false; ⏎ if (!isActive) { ⏎   _showSubscriptionGate(); ⏎   return; ⏎ }`
- **Fix:** Distinguish 'unknown' (load failed / not yet loaded) from 'inactive' in SubscriptionState; on unknown, retry loadSubscription (e.g. in dashboard's onRefresh and before gating) instead of showing the paywall.

### 46. Notifications loadMore appends without dedup: shifted pages produce duplicate ids -> duplicate Dismissible ValueKeys

- **File:** `mobile/lib/screens/notifications/notifications_screen.dart:101`
- **Category:** crash · **Origin:** verified (2-of-3) · **Lens:** pagination · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(medium)
- **Failure scenario:** User has >20 notifications and opens the inbox (page 1 = 20 items). A new notification arrives server-side (router_offline alerts fire routinely) shifting every row down one. User scrolls; loadMore fetches page 2 whose first row is the old row 19, already in state.items — the provider appends blindly (notifications_provider.dart:78) so the same notification id appears twice. Both copies render as sibling Dismissibles with identical ValueKey(item.id): in debug builds Flutter throws 'Duplicate keys found' (red error screen); in release the list shows the notification twice and swiping either copy deletes both rows at once (delete() filters by id, notifications_provider.dart:118) while issuing one server delete. The same duplication arises from pull-to-refresh racing an in-flight loadMore, since refresh() does not check isLoadingMore (notifications_provider.dart:56).
- **Evidence:** `key: ValueKey(item.id),`
- **Fix:** Dedup by id when appending in loadMore (e.g., skip items whose id already exists in state.items), and make refresh() await/ignore results while isLoadingMore is true (or version the requests). This removes both the duplicate-key hazard and the double-row display.

### 47. Report export copies full revenue/voucher CSV to the clipboard with no auto-clear or FLAG_SECURE

- **File:** `mobile/lib/screens/reports/report_export_screen.dart:19`
- **Category:** sensitive-data-leak · **Origin:** critic+manual
- **Failure scenario:** _copyToClipboard (lines 19-22) writes the entire exportData CSV — revenue figures, voucher sales, session data — to the system clipboard permanently, with none of the 30s auto-clear used on voucher-code/payment-reference copies and no SecureWindow protection on the screen. On Android the clipboard is readable by other apps and shown in the clipboard-history UI. Same screen shares via Share.share with no restriction (expected for share, but the clipboard path is the leak).
- **Fix:** Route this copy through the shared copy-with-auto-clear helper (see findings on clipboard hardening) and consider SecureWindow on the export screen; prefer share/file-export over raw clipboard for bulk financial data.

### 48. EditRouterScreen calls setState() synchronously inside build() — framework assertion in debug, redundant rebuild in release

- **File:** `mobile/lib/screens/routers/edit_router_screen.dart:121`
- **Category:** lifecycle · **Origin:** reinstated (verifiers split, manually confirmed)
- **Failure scenario:** When selectedRouter is not already cached (cold start / deep-link straight into edit, or after the routers singleton was reset), initState fires loadRouter via microtask (line 42) and build later runs the prefill branch: `if (!_initialized && state.selectedRouter != null) { _prefill(...); setState(() {}); }` (lines 119-122). _prefill sets _initialized=true so there is no infinite loop, but setState() during build() throws "setState() or markNeedsBuild() called during build" in DEBUG builds (red-screen on the edit form). In release the assert is stripped so it is only a redundant extra rebuild. The setState is unnecessary regardless — build already re-reads the watched state and _prefill only mutates controllers. NOTE: two of three auto-verifiers rejected this (reasoning it is benign in release); it is reinstated as LOW because it is a genuine debug-time crash on a reachable path.
- **Fix:** Remove the setState(() {}) entirely (controllers updated in build take effect this frame), or move the prefill into a ref.listen(routersProvider) side-effect / didChangeDependencies guard instead of the build method.

### 49. Raw DioException.toString() rendered in hotspot template error UI

- **File:** `mobile/lib/screens/routers/hotspot_template_screen.dart:54`
- **Category:** info-leak · **Origin:** verified (2-of-3) · **Lens:** error-handling · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** hotspotTemplatesProvider is a FutureProvider that rethrows the raw DioException from getHotspotTemplates(). On any fetch failure (500, timeout, offline) the error branch calls context.trOrRaw(e.toString()); since a DioException string is not an i18n key, trOrRaw returns it verbatim — the operator sees untranslated internals like "DioException [bad response]: ... uri: https://api.wa-sel.com/api/v1/..." including the full API URL, violating the errorToDisplay contract that raw toString() never reaches the UI, and breaking the AR localization on this screen.
- **Evidence:** `error: (e, _) => _ErrorBody( ⏎   message: context.trOrRaw(e.toString()), ⏎   onRetry: () => ref.invalidate(hotspotTemplatesProvider), ⏎ ),`
- **Fix:** Replace `e.toString()` with `errorToDisplay(e)` from utils/error_messages.dart (then trOrRaw resolves the returned i18n key), matching every other screen.

### 50. Network failure on detail screens rendered as 'not found'

- **File:** `mobile/lib/screens/routers/router_detail_screen.dart:84`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** error-handling · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** loadRouter times out on a flaky connection: state.error is set, selectedRouter stays null, and the body renders the static 'routers.notFound' text with no retry — a field operator can conclude their router was deleted when the request merely failed. voucher_detail_screen.dart:225 has the identical pattern ('vouchers.voucherNotFound' for any load failure).
- **Evidence:** `: router == null ⏎     ? Center( ⏎         child: Text(context.tr('routers.notFound'),`
- **Fix:** When state.error != null and the entity is null, render ErrorState with the actual error and a retry callback; reserve the 'not found' copy for a confirmed 404.

### 51. RouterOS setup commands rendered with ambient RTL base direction: leading '/' displaced and text right-aligned in Arabic

- **File:** `mobile/lib/screens/routers/setup_guide_screen.dart:254`
- **Category:** rtl · **Origin:** verified (2-of-3) · **Lens:** i18n-rtl · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** Arabic user opens the setup guide or the add-router script screen -> each command box (SelectableText(step.command) with no textDirection override; same in add_router_screen.dart:455) inherits RTL paragraph direction, so '/interface wireguard add ...' displays right-aligned with the leading '/' resolved to the RTL base and shown at the trailing (right) edge — the command reads 'interface ... name=wg-wasel/' on screen. Copy still yields the correct string, but an operator retyping from the screen gets a visually wrong command.
- **Evidence:** `child: SelectableText( ⏎   step.command, ⏎   style: AppTypography.monoSmall.copyWith(height: 1.5), ⏎ )`
- **Fix:** Wrap the command SelectableText widgets (setup_guide_screen.dart and add_router_screen.dart _StepCommand) in Directionality(textDirection: TextDirection.ltr) or pass textDirection: TextDirection.ltr so code always renders LTR and left-aligned.

### 52. 30s session-refresh Timer.periodic has no overlap guard; stale/error responses overwrite fresh data

- **File:** `mobile/lib/screens/sessions/active_sessions_screen.dart:31`
- **Category:** concurrency · **Origin:** verified (2-of-3) · **Lens:** async-lifecycle · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** loadActiveSessions goes backend → WireGuard tunnel → RouterOS, which on a degraded router routinely takes 15-45s (Dio allows connect 15s + receive 15s). The periodic tick fires regardless of an in-flight call and sessions_provider.loadActiveSessions (sessions_provider.dart:89-97) has no in-flight/out-of-order protection: tick A (slow, started t=0) can complete after tick B (t=30, fast), overwriting B's fresh session list with 30s-stale data, or stamping a timeout error over B's success so an operator on a struggling router sees sessions that already disconnected or a spurious error/empty state, plus piled-up concurrent requests over the already-degraded tunnel.
- **Evidence:** `_autoRefreshTimer = Timer.periodic(const Duration(seconds: 30), (_) { ⏎       ref.read(sessionsProvider.notifier).loadActiveSessions(widget.routerId); ⏎     });`
- **Fix:** Skip the tick while a load is in flight (bool guard in the screen or an in-flight flag / request sequence number in SessionsNotifier that discards responses older than the latest issued request).

### 53. Raw RADIUS terminate-cause strings shown untranslated on session-history badges

- **File:** `mobile/lib/screens/sessions/session_history_screen.dart:322`
- **Category:** i18n · **Origin:** verified (2-of-3) · **Lens:** i18n-rtl · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** Arabic user opens Session History -> every record's badge shows the raw protocol value 'User-Request' / 'Session-Timeout' / 'Idle-Timeout' / 'NAS-Reboot', while the filter dropdown on the same screen shows the localized labels (sessions.userRequest = 'طلب المستخدم', lines 240-255), so the list and its own filter disagree and the badges are English protocol jargon.
- **Evidence:** `StatusBadge( ⏎   label: session.terminateCause, ⏎   color: _causeColor(session.terminateCause), ⏎ )`
- **Fix:** Map terminate causes to the existing sessions.* keys (User-Request -> sessions.userRequest, etc.) for the badge label, falling back to the raw string for unknown causes.

### 54. Language picker rows show hardcoded English labels ('System Default', 'Arabic') in AR UI despite existing key

- **File:** `mobile/lib/screens/settings_screen.dart:322`
- **Category:** i18n · **Origin:** verified (2-of-3) · **Lens:** i18n-rtl · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** Arabic user opens Settings -> Language -> the bottom sheet's first radio row reads 'System Default' in English (static _languages list, line 261) even though 'settings.systemDefault' = 'افتراضي النظام' exists and is used for the tile subtitle (line 270); the 'Arabic' row title is also the English exonym with the endonym demoted to the subtitle.
- **Evidence:** `title: Text(lang.label, style: AppTypography.body),  // labels from: (code: null, label: 'System Default', ...)`
- **Fix:** Localize the sheet: use context.tr('settings.systemDefault') for the null-code row and show endonyms ('English' / 'العربية') as the primary label for the language rows.

### 55. Contact screen conflates load failure with empty conversation; error never surfaced and no retry affordance

- **File:** `mobile/lib/screens/settings/contact_screen.dart:85`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** pagination, error-handling · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** User opens Contact Support with a flaky connection; supportProvider.refresh() fails, leaving messages empty and state.error set. _buildBody never checks state.error (unlike voucher/session/notification screens) and returns _buildEmpty(), which shows 'no messages yet' — a user with an existing support thread believes their history vanished. The empty view is also not wrapped in RefreshIndicator, so there is no pull-to-retry; the only recovery is leaving and reopening the screen.
- **Evidence:** `if (state.messages.isEmpty) { ⏎   return _buildEmpty(); ⏎ }`
- **Fix:** Add an error branch (state.error != null && state.messages.isEmpty -> ErrorState with retry calling refresh()) before the empty check, and wrap the empty ListView in the same RefreshIndicator used for the populated list.

### 56. Support-chat bubbles use physical Alignment.centerRight/Left and physical corner radii — layout does not mirror in RTL

- **File:** `mobile/lib/screens/settings/contact_screen.dart:207`
- **Category:** rtl · **Origin:** verified (2-of-3) · **Lens:** i18n-rtl · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** Arabic user opens Contact Support -> outgoing bubbles stay pinned to the physical right and support replies to the physical left with hardcoded bottomLeft/bottomRight tail radii (lines 208-213), so the chat does not mirror like native RTL messaging apps; the visual convention (own messages at the start side) is inverted for RTL readers.
- **Evidence:** `final align = isUser ? Alignment.centerRight : Alignment.centerLeft;`
- **Fix:** Use AlignmentDirectional.centerEnd/centerStart and BorderRadiusDirectional (bottomStart/bottomEnd) so bubble side and tail flip with text direction.

### 57. Payment amounts show raw backend currency code instead of the localized symbol used everywhere else

- **File:** `mobile/lib/screens/settings/payments_screen.dart:215`
- **Category:** i18n · **Origin:** verified (2-of-3) · **Lens:** i18n-rtl · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** Arabic user views payment history or the bank-transfer payment screen -> amounts render as 'SDG 15000.00' (also payment_screen.dart:476 '${request.currency} ${request.amount.toStringAsFixed(2)}'), while plan cards and totals on the plan-selection flow render 'ج.س 15000' via common.currencySymbol — inconsistent currency presentation across the same purchase flow, with a Latin code inside Arabic text.
- **Evidence:** `'${payment.currency} ${payment.amount.toStringAsFixed(2)}',`
- **Fix:** Map the currency code to the localized symbol (use common.currencySymbol when currency == 'SDG', falling back to the code otherwise) on payments_screen.dart and payment_screen.dart.

### 58. Popping PaymentScreen clears FLAG_SECURE out from under the still-alive SettingsScreen

- **File:** `mobile/lib/screens/subscription/payment_screen.dart:69`
- **Category:** hardening · **Origin:** verified (2-of-3) · **Lens:** async-lifecycle · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** SecureWindow.enable()/disable() toggles a single global Android window flag with no refcounting. Route path Settings tab (enables FLAG_SECURE, settings_screen.dart:35) → push /subscription → push /subscription/payment (enables again) → pop PaymentScreen: its dispose calls SecureWindow.disable(). SettingsScreen is still alive beneath the shell and never re-enables, so after returning to Settings the screenshot/recording protection it intended is silently gone until the tab is rebuilt.
- **Evidence:** `if (Platform.isAndroid) { ⏎       SecureWindow.disable(); ⏎     }`
- **Fix:** Refcount enable/disable in SecureWindow (disable only when the count reaches zero), or re-enable in the underlying secure screen via a RouteAware/visibility callback when it becomes current again.

### 59. Payment approval poller: async Timer.periodic callback without re-entrancy guard

- **File:** `mobile/lib/screens/subscription/payment_screen.dart:87`
- **Category:** concurrency · **Origin:** verified (2-of-3) · **Lens:** async-lifecycle · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** The 15s tick starts a new loadSubscription() even if the previous one is still in flight (a stalled request can run ~30-45s under the Dio 15s connect + 15s receive timeouts), so on a flaky connection 2-3 identical GETs run concurrently and a slow older response can overwrite a newer subscription state last-write-wins. Double navigation/snackbar is prevented by _stopPoller + mounted + _snackBarShown, so the impact is duplicate requests and transient state churn while the user waits on the success step.
- **Evidence:** `_pollTimer = Timer.periodic(_kPollInterval, (_) async { ⏎       if (!mounted) return; ⏎       await ref.read(subscriptionProvider.notifier).loadSubscription();`
- **Fix:** Add a `_pollInFlight` bool set before the await and cleared in a finally, returning early when a poll is already running.

### 60. Clipboard auto-clear of payment reference / voucher code is cancelled if the user leaves the screen

- **File:** `mobile/lib/screens/subscription/payment_screen.dart:767`
- **Category:** hardening · **Origin:** verified (2-of-3) · **Lens:** async-lifecycle · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** _CopyableRow copies the bank reference code and schedules a 30s clipboard auto-clear, but dispose cancels the timer — so copy-then-navigate-away (the normal flow: copy the reference, switch to the banking app) leaves the sensitive value on the clipboard indefinitely, defeating the stated auto-clear design. Same pattern in voucher_detail_screen.dart:67 for voucher codes.
- **Evidence:** `@override ⏎   void dispose() { ⏎     _clearTimer?.cancel(); ⏎     super.dispose(); ⏎   }`
- **Fix:** Let the auto-clear run detached from the widget lifecycle (a top-level/service-owned timer that only touches Clipboard and compares against the copied value), since the callback deliberately does not use BuildContext.

### 61. Subscription start/end dates formatted from UTC without toLocal(), unlike the payments screen

- **File:** `mobile/lib/screens/subscription/subscription_status_screen.dart:415`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** i18n-rtl · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** Subscription boundaries stored as UTC instants near local midnight (Sudan is UTC+2) -> the status screen prints the UTC calendar date, showing a start/end date one day earlier than the user's local date; payments_screen.dart:376 converts with d.toLocal() first, so the two screens can disagree about the same event's date.
- **Evidence:** `String _formatDate(DateTime date) { ⏎   return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';`
- **Fix:** Call date.toLocal() before extracting year/month/day, matching the payments screen helper.

### 62. Voucher-code clipboard auto-clear is cancelled by leaving the screen

- **File:** `mobile/lib/screens/vouchers/voucher_detail_screen.dart:67`
- **Category:** hardening · **Origin:** verified (2-of-3) · **Lens:** data-exposure · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** Operator taps copy on a voucher code and immediately navigates back to the list (the normal flow — copy, then go paste it somewhere). dispose() cancels _clipboardClearTimer, so the 30-second auto-clear never fires and the code stays on the clipboard indefinitely, defeating the feature's purpose. Additionally, when the user switches to another app to paste (the other common flow), Android 10+ denies background clipboard reads, so Clipboard.getData returns null at the 30s mark, the equality check fails, and the wipe silently no-ops. Note the seeded data-loss concern does not hold: the timer compares clipboard content to _lastCopiedValue before wiping, so unrelated user content is never destroyed.
- **Evidence:** `_clipboardClearTimer?.cancel();  // in dispose(); timer body: if (!mounted) return; ... if (current?.text == _lastCopiedValue) { await Clipboard.setData(const ClipboardData(text: '')); }`
- **Fix:** Move the auto-clear timer out of the widget State into an app-scoped service (or remove the `if (!mounted) return;` guard and keep the timer alive past dispose) so the wipe still runs after navigation. Acknowledge the Android 10+ background limitation in a comment, or use EXTRA_IS_SENSITIVE + clipboard timeout on the platform side instead.

### 63. initState Future.microtask uses ref without a mounted guard (app-wide pattern)

- **File:** `mobile/lib/screens/vouchers/voucher_list_screen.dart:42`
- **Category:** lifecycle · **Origin:** verified (2-of-3) · **Lens:** async-lifecycle · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** If the element is unmounted within the same frame that built it (e.g., a GoRouter redirect immediately replacing the page), the queued microtask still runs and `ref.read` on the disposed ConsumerState throws StateError('Cannot use "ref" after the widget was disposed') as an unhandled async error (flutter_riverpod 2.6.1 enforces this). The second microtask in this file checks `if (!mounted) return;` but the first does not; the same unguarded pattern repeats in dashboard_screen.dart:25, reports_screen.dart:21, router_list_screen.dart:25, settings_screen.dart:37, payments_screen.dart:27, notification_preferences_screen.dart:23, session_history_screen.dart:27, active_sessions_screen.dart:28, setup_guide_screen.dart:41, and others.
- **Evidence:** `Future.microtask(() { ⏎       ref.read(routersProvider.notifier).loadRouters(); ⏎     });`
- **Fix:** Prefix every initState microtask body with `if (!mounted) return;` (or standardize on a small extension/helper that does the guarded read) as already done in the second microtask here.

### 64. Paywall handler's claimed authenticated-route guard is not implemented

- **File:** `mobile/lib/services/api_client.dart:250`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** network-tls · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** The comment says "Skip redirect if the user is not on an authenticated route" but the code only checks navigatorState nullability and a /subscription prefix. A stale in-flight request resolving with a paywall-coded 403 after logout (or any 403 forged by an MITM, viable while pinning is ineffective) calls push('/subscription') from the login screen; only GoRouter's global redirect (app_router.dart:77) incidentally bounces it to /login. Additionally, several parallel requests failing 403 in the same event-loop turn each pass the `currentRoute.startsWith('/subscription')` check before the first push lands, stacking duplicate /subscription pages the user must pop repeatedly.
- **Evidence:** `// Skip redirect if the user is not on an authenticated route or is ⏎ // already on /subscription (avoids redirect loops). ⏎ final navigatorState = appNavigatorKey.currentState; ⏎ if (navigatorState == null) return;`
- **Fix:** Actually check auth state (or at least that the current route is not /login, /splash, or another unauthenticated route) before pushing, and debounce the push (e.g. a bool guard reset when /subscription pops) so concurrent 403s produce a single navigation.

### 65. Token-refresh Dio bypasses certificate pinning entirely

- **File:** `mobile/lib/services/api_client.dart:348`
- **Category:** security · **Origin:** verified (2-of-3) · **Lens:** network-tls · **Votes:** reproduce:✓(medium) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** The /auth/refresh call — which transmits the long-lived refresh token and receives the rotated token pair — goes through a freshly constructed Dio with the default adapter and no pinning. Even after the main adapter's pinning is fixed, an MITM positioned during any token refresh (happens roughly every 15 minutes of active use) captures a valid refresh token and can mint sessions for 7 days. The most sensitive credential in the app travels over the least protected channel.
- **Evidence:** `final refreshDio = Dio(BaseOptions( ⏎   baseUrl: _dio.options.baseUrl, ⏎   connectTimeout: const Duration(seconds: 10), ⏎   receiveTimeout: const Duration(seconds: 10), ⏎   headers: {'Content-Type': 'application/json'}, ⏎ ));`
- **Fix:** Extract the pinned-adapter construction into a helper and set refreshDio.httpClientAdapter to the same pinned IOHttpClientAdapter (release-gated identically to the main client).

### 66. Refresh response parsed with unchecked chained casts; malformed 2xx bodies are indefinitely treated as transient with per-request refresh retries

- **File:** `mobile/lib/services/api_client.dart:360`
- **Category:** hardening · **Origin:** verified (2-of-3) · **Lens:** auth-session · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** If /auth/refresh returns 2xx with an unexpected body (captive portal injecting 200 HTML, proxy, or a backend contract regression), response.data['data']['accessToken'] throws (NoSuchMethodError/TypeError), which is caught as refreshError; isAuthRejection() (utils/error_messages.dart:60-61) is false for non-DioExceptions so tokens are kept — safe for the captive-portal case, but if the condition persists every single API call triggers a fresh refresh POST with no backoff (hammering /auth/refresh), and the caller is shown the original 401's 'unauthorized' message while remaining logged in, with no path out other than manual logout.
- **Evidence:** `final newAccessToken = response.data['data']['accessToken'] as String; ⏎       final newRefreshToken = response.data['data']['refreshToken'] as String;`
- **Fix:** Validate the response shape explicitly (data is Map, both fields are non-empty Strings) and treat a malformed 2xx distinctly: keep tokens but back off (e.g. short cooldown flag before the next refresh attempt) and surface a network-style error instead of the raw 401 unauthorized message.

### 67. Notifications service embeds full server response body in exception message

- **File:** `mobile/lib/services/notifications_service.dart:37`
- **Category:** hardening · **Origin:** verified (2-of-3) · **Lens:** data-exposure · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** If the backend ever returns an unexpected shape for GET /notifications/, the thrown StateError message contains the entire response body ($body) — notification titles/bodies with router names and payment events. Today the provider catches it and errorToDisplay maps it to 'error.unknown', so nothing leaks; but any future rethrow, Sentry captureException of provider errors, or logging of state.error would ship the full inbox content into crash reports. This is the one place in the codebase that stuffs a whole response body into an exception message.
- **Evidence:** `throw StateError( ⏎           'Unexpected notifications response shape (data is ${rawData.runtimeType}): $body');`
- **Fix:** Drop $body from the message — the runtimeType and perhaps the top-level keys are enough for diagnostics: e.g. 'Unexpected notifications response shape (data is ${rawData.runtimeType})'.

### 68. Push notifications have no tap-through: onMessageOpenedApp and getInitialMessage are never handled

- **File:** `mobile/lib/services/push_notification_service.dart:49`
- **Category:** ux-bug · **Origin:** critic+manual
- **Failure scenario:** initialize() wires only onMessage (foreground, line 49), onBackgroundMessage (line 40) and onTokenRefresh (line 47). There is no FirebaseMessaging.onMessageOpenedApp (tap while backgrounded) and no getInitialMessage() (tap while terminated). Tapping a "Router X offline" or "Payment approved" push therefore just opens the app to wherever it was — it never navigates to the relevant router/payment screen, defeating the core value of the notification. The foreground handler also only refreshes the inbox badge; it does not surface an in-app banner.
- **Fix:** Add onMessageOpenedApp.listen(...) and a getInitialMessage() check during startup that route (via appNavigatorKey/GoRouter) to the screen named in message.data (e.g. routerId/paymentId), once the user is authenticated.

### 69. onTokenRefresh listener can reject with an unhandled async error from secure storage

- **File:** `mobile/lib/services/push_notification_service.dart:58`
- **Category:** async-error-handling · **Origin:** verified (2-of-3) · **Lens:** async-lifecycle · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** `_storage.getFcmToken()` is awaited before the try block in _registerToken, and the method is wired directly as `messaging.onTokenRefresh.listen(_registerToken)` (line 47) with no onError. flutter_secure_storage reads can throw PlatformException (e.g., Android keystore corruption after a device backup restore); when FCM rotates the token, the rejected future surfaces as an unhandled async error (Sentry noise, token registration silently skipped).
- **Evidence:** `Future<void> _registerToken(String token) async { ⏎     final cachedToken = await _storage.getFcmToken(); ⏎     if (cachedToken == token) return; ⏎     try {`
- **Fix:** Move the getFcmToken() read inside the existing try/catch (treat a failed cache read as cache-miss and proceed to register), or add an onError handler to the listen call.

### 70. Silent FCM unregister failure leaves logged-out device receiving account pushes

- **File:** `mobile/lib/services/push_notification_service.dart:80`
- **Category:** hardening · **Origin:** verified (2-of-3) · **Lens:** error-handling · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** User logs out while offline: the DELETE /notifications/device-token throws, `catch (_) {}` swallows it, and logout proceeds to clearAll() which wipes only the local token cache. The server-side device-token row survives, so the device keeps receiving push notifications (payment confirmations, router alerts) for the logged-out account — visible to whoever holds the device next.
- **Evidence:** `await _api.dio ⏎     .delete('/notifications/device-token', data: {'token': token}); ⏎   await _storage.deleteFcmToken(); ⏎ } ⏎ } catch (_) {}`
- **Fix:** Persist a 'pending unregister' marker when the DELETE fails and retry on next app start, and/or have the backend logout endpoint invalidate the user's device tokens server-side so an offline client cannot leave a live registration.

### 71. Push notification title debugPrinted in release builds

- **File:** `mobile/lib/services/push_notification_service.dart:84`
- **Category:** sensitive-data-leak · **Origin:** verified (2-of-3) · **Lens:** data-exposure · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** debugPrint is not compiled out of release builds (unlike the HTTP interceptor, which is gated behind kDebugMode) — it is a throttled print that still writes to logcat/NSLog in production. Every foreground push writes its title ('Payment approved', 'Router <name> offline', etc.) to the device system log, where it persists in adb bugreports and OEM diagnostic uploads users may share with third parties.
- **Evidence:** `debugPrint('Foreground message: ${message.notification?.title}');`
- **Fix:** Wrap this (and the other service debugPrints at lines 53 and 68) in `if (kDebugMode)` or replace with a logger that is a no-op in release mode.

### 72. Logout and session-expiry clearAll() wipes the saved locale (and all non-auth keys)

- **File:** `mobile/lib/services/secure_storage.dart:87`
- **Category:** ux-bug · **Origin:** verified (2-of-3) · **Lens:** auth-session · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** An Arabic-device user who chose English (or vice versa — AR-first product) logs out, or their session expires (auth_provider.dart:392/511, api_client.dart:341/385 all call clearAll → deleteAll). wasel_locale is deleted along with the tokens. The in-memory locale survives that run, but on the next cold start loadSavedLocale() finds nothing and the app reverts to the device default language — the user's language choice is silently lost on every logout/expiry.
- **Evidence:** `Future<void> clearAll() => _storage.deleteAll();`
- **Fix:** Replace clearAll() usage with a clearSession() that deletes only the auth keys (access/refresh/user-data/fcm), or re-read and re-write the locale around deleteAll. Keep device-scoped preferences out of the session wipe.

### 73. SecureWindow enable/disable is not reference-counted; popping one secure screen unprotects another

- **File:** `mobile/lib/services/secure_window.dart:13`
- **Category:** hardening · **Origin:** verified (2-of-3) · **Lens:** data-exposure · **Votes:** reproduce:✓(low) impact:✓(low) false-positive:✓(low)
- **Failure scenario:** Settings (SecureWindow.enable in initState, settings_screen.dart:35) stays mounted in the tab shell while the user pushes Subscription then Payment (payment_screen.dart:53 enables again). When Payment pops, its dispose calls SecureWindow.disable(), clearing the single Activity-level FLAG_SECURE. The user returns to the still-mounted Settings screen (name/email/subscription visible) with screenshot protection silently off — Settings never re-enables because enable only runs in initState.
- **Evidence:** `static Future<void> disable() async { ⏎     if (!Platform.isAndroid) return; ⏎     await _channel.invokeMethod<void>('disable'); ⏎   }  // MainActivity.kt just clearFlags(FLAG_SECURE) — one global flag, three screens toggling it`
- **Fix:** Make SecureWindow reference-counted in Dart (enable increments, disable decrements, clearFlags only at zero), or re-enable in didChangeDependencies/on-resume of secure screens when they return to the top of the stack.

## Confirmed sound (checked, no defect)

The audit positively verified these — they are **not** problems:

- [network-tls] Release API base URL defaults to https://api.wa-sel.com/api/v1 via compile-time dart-define (mobile/lib/config/app_config.dart:10-13); no runtime-injectable override and no hardcoded http:// endpoints anywhere in mobile/lib.
- [network-tls] Cleartext traffic is enabled only in the debug manifest overlay (mobile/android/app/src/debug/AndroidManifest.xml); the release manifest has no usesCleartextTraffic flag, so an accidental http release build fails closed on Android (and iOS ATS).
- [network-tls] Release-only pinning gate (!kDebugMode, api_client.dart:86) is a reasonable dev convenience: debug builds still get default platform chain validation, and the gate itself introduces no release weakness — the defects are in the callback wiring, not the gating.
- [network-tls] Refresh-loop protection is sound: /auth/refresh failures are never re-refreshed (path.endsWith check, line 311), the refresh Dio carries no interceptors so no recursion, and only an authoritative HTTP 401 (isAuthRejection) clears tokens — transport failures preserve the session for recovery.
- [network-tls] Timeouts are bounded everywhere: 15s connect/receive/send on the main client, 10s connect/receive on the refresh client, single refresh attempt with no unbounded retry loop.
- [network-tls] The debug-only log interceptor redacts Authorization headers (both casings) and password/otp/access/refresh token fields in request and response bodies, recursing into nested maps, lists, and JSON-encoded strings; it is only installed under kDebugMode so release builds log no request/response bodies.
- [network-tls] Bearer tokens are only attached by the singleton Dio whose traffic is confined to the API origin — no caller passes absolute third-party URLs through ApiClient, so no cross-host Authorization leak path exists in current code.
- [network-tls] errorToDisplay (mobile/lib/utils/error_messages.dart) never surfaces raw exception/DioException strings to the UI and maps badCertificate to a dedicated error.security key, so a pin rejection would be user-visible rather than silent.
- [network-tls] GoRouter's global redirect (mobile/lib/navigation/app_router.dart:77) sends unauthenticated navigations to /login, which neutralizes the worst outcome of the paywall handler's missing auth check.
- [auth-session] Secure storage configuration is sound: AndroidOptions(encryptedSharedPreferences: true) and iOS KeychainAccessibility.first_unlock_this_device; tokens never touch plain SharedPreferences.
- [auth-session] Debug log redaction is thorough: Authorization headers stripped and password/otp/access_token/refresh_token redacted recursively through nested maps, lists and JSON-encoded strings (_RedactedLogInterceptor).
- [auth-session] isAuthRejection's 401-only classification matches the backend contract exactly — all genuine refresh rejections (invalid, revoked, user inactive) are 401 AppErrors, so transport failures correctly keep tokens and offline sessions survive.
- [auth-session] Seed refuted — null onSessionExpired window: the only requests that can 401 before AuthNotifier is constructed are PushNotificationService.initialize() calls pre-runApp; in that window the interceptor still clears storage, tryRestoreSession then finds no tokens and shows /login — no dangling authenticated UI. AuthNotifier (and the callback) is constructed during the first build via appRouterProvider's ref.listen, before any UI-originated request.
- [auth-session] Seed refuted as a security issue — cached-user offline restore: the cached user JSON drives only display fields and the isAuthenticated flag; tier, quota and verification enforcement is entirely server-side (403 paywall codes, EMAIL_NOT_VERIFIED on login), so a stale or tampered cache cannot escalate privileges, and corrupt JSON falls through to server validation.
- [auth-session] Splash/redirect race is handled: tryRestoreSession runs in a post-build microtask (router and its authProvider listener already attached), the isInitializing flag gates the redirect to /splash, and the finally clause guarantees the flag clears on every exit path (no tokens, corrupt cache, network error).
- [auth-session] Refresh-token rotation persistence ordering is acceptable: the server consumes the old jti atomically before responding; a crash between server rotation and setTokens persistence only causes a clean forced re-login on the next 401 (REFRESH_TOKEN_REVOKED -> clearAll -> login), no corruption or half-authenticated state.
- [auth-session] Concurrent 401s during an in-flight refresh are handled correctly in the normal window: waiters enqueued before the drain are completed on success and completeError'd on failure, and the retried waiter re-reads the newly persisted token via _onRequest.
- [auth-session] The /auth/refresh endpoint is excluded from the refresh flow via path.endsWith check, and the refresh call itself uses a bare Dio instance with no interceptors — no recursion through the refresh request.
- [auth-session] Login persists tokens and user JSON to secure storage before flipping isAuthenticated, and the router redirect matrix (isInitializing/splash/auth-routes/authenticated) is consistent with no redirect loops; EMAIL_NOT_VERIFIED login failures correctly stash pendingVerificationEmail for the verify screen.
- [data-exposure] Redacted log interceptor architecture is sound: registered only under kDebugMode (api_client.dart:111-113), strips Authorization headers both cases, redacts recursively through nested maps/lists and JSON-encoded strings; refresh-token request/response keys are covered.
- [data-exposure] Sentry configuration is minimal and safe: DSN-gated (no-op in dev), sendDefaultPii=false, tracesSampleRate=0, no SentryNavigatorObserver in MaterialApp.router (app.dart), no SentryHttpClient/Dio integration on the Dio instance, no SentryWidget/screenshot attachment — so no HTTP bodies, navigation breadcrumbs, or screenshots reach Sentry; API errors are caught in providers before they could become unhandled events.
- [data-exposure] errorToDisplay (mobile/lib/utils/error_messages.dart) never returns raw exception toString or DioException.message to the UI — only backend-provided human messages or i18n keys.
- [data-exposure] FLAG_SECURE native implementation is correct where used: MainActivity.kt add/clearFlags on the UI thread via method channel; voucher_detail, settings, and payment pair it with an iOS lifecycle blur overlay for app-switcher thumbnails.
- [data-exposure] Clipboard auto-clear ownership check is correct — it compares current clipboard text to the value it set before wiping, so it never destroys unrelated user clipboard content (seeded data-loss lead refuted); payment _CopyableRow uses the same safe pattern.
- [data-exposure] print_service.dart is clean: PDF generated purely in memory from caller-resolved strings, no logging of voucher codes, no file writes of its own; PdfPreview has canDebug:false and sharing/printing is explicit user action.
- [data-exposure] Voucher sharing (_shareVoucher) exposes a single code via the system share sheet only on explicit user tap — intended product behavior, not a leak.
- [data-exposure] Push notification service does not log the FCM token value (only exception summaries); token is sent over the authenticated API and cached in flutter_secure_storage.
- [data-exposure] Payment receipt flow keeps the image local until explicit upload; no receipt path/content is logged; bank details rendered are the platform's own receiving account (not user secrets).
- [data-exposure] No print()/dart:developer log calls anywhere in mobile/lib; the only debugPrint sites are the four in api_client (debug-gated interceptor + release-safe cert-pin rejection line that logs only a public certificate hash), three in push_notification_service, and one exception-only line in auth_provider.
- [provider-arch] app.dart didChangeDependencies once-guard (_pushAttached) is correct; ProviderScope.containerOf attach for the push service runs exactly once and the container outlives the service's use.
- [provider-arch] appRouterProvider (navigation/app_router.dart:43-62) correctly bridges auth changes into a ValueNotifier used as refreshListenable, so GoRouter is created once and the navigation stack is never reset by auth state churn; the listener and notifier are disposed via ref.onDispose.
- [provider-arch] Seeded hotspot_templates lead refuted: the FutureProvider (template list) and NotifierProvider (apply state) hold disjoint data — no duplicate fetch or cross-stale cache; fetch errors are recoverable via ref.invalidate retry, and router_detail_screen.dart:443 resets the apply notifier before every navigation into the picker, so no stale applied/failed state crosses routers.
- [provider-arch] No provider state mutation during widget build found: every initState-triggered load across all screens is deferred via Future.microtask, and filter/set mutations run only from event handlers.
- [provider-arch] listenManual in voucher_list_screen is stored, mounted-guarded, and closed in dispose — no leaked subscription; the loadRouters-then-listen microtask ordering still delivers the auto-select notification.
- [provider-arch] ApiClient 401 refresh flow is sound: single-flight via _isRefreshing with a completer queue that is drained on success, no-refresh-token, and failure paths; _isRefreshing reset in finally; refresh endpoint excluded from re-entry; transport failures preserve tokens while auth rejections clear them.
- [provider-arch] The 403 paywall handler is best-effort (wrapped in try/catch), guards against redirect loops on /subscription, and always forwards the error to the caller's provider.
- [provider-arch] copyWith implementations across all 12 providers use explicit clear* boolean flags rather than nullable-overwrite, so no accidental field-clearing bugs; loadMore/loadMoreHistory guards prevent duplicate pagination requests within a single router context.
- [provider-arch] Debug HTTP logging is gated on kDebugMode and redacts Authorization headers and sensitive body fields (passwords, OTPs, tokens), including nested and JSON-string bodies.
- [provider-arch] auth logout() clears secure storage and resets its (partial) provider list in a finally block so failures in the server logout call cannot leave tokens behind; tryRestoreSession's isInitializing safety-net in finally prevents a stuck splash on every exit path.
- [pagination] Seeded fling double-fire lead REFUTED: all four providers set their in-flight flag synchronously before the first await (vouchers_provider.dart:123-124, sessions_provider.dart:145-147, notifications_provider.dart:73-74, support_provider.dart:77-78), and scroll listeners run synchronously, so a fast fling cannot start two concurrent loadMore requests.
- [pagination] deleteAllVouchers loop termination is sound under the documented contract: it exits whenever a batch returns fewer than the 500-row backend cap, and a final loadVouchers(refresh:true) resyncs the view; the cap coupling is explicitly documented in the code comment (vouchers_provider.dart:247-250).
- [pagination] Single-voucher delete keeps hasMore consistent: the local total-1 matches the server-side change and the detail-screen pop always triggers a full refresh (voucher_list_screen.dart:624-626), so no stuck spinner on that path.
- [pagination] Footer-spinner itemCount arithmetic (length + (hasMore ? 1 : 0)) and index guards (== / >= length) are correct in all four lists — no off-by-one RangeError is possible.
- [pagination] Notifications and support hasMore come from server math (page * limit < total in the service page objects) rather than locally-diverging counters, and loadMore correctly guards on hasMore, isLoading, and isLoadingMore.
- [pagination] Contact screen reverse:true pagination direction is correct: maxScrollExtent is the oldest end, so the top-scroll trigger loads older pages, and send() prepends at index 0 which renders at the bottom (newest) as expected.
- [pagination] Voucher select-mode state is a Set of ids, so selection counts and select-all stay correct even if duplicate rows appear; markRead/markAllRead/delete unread-count math in notifications clamps at 0 and reconciles with the server's returned count.
- [pagination] loadMoreHistory captures nextPage before the await (sessions_provider.dart:146) so a mid-flight state change cannot mis-number the stored page; vouchers' equivalent reads state at completion but its interleavings with refresh resolve to a consistent list in both completion orders.
- [pagination] Loading/error/empty branch ordering on voucher list, session history, and notifications screens is correct (spinner only when loading AND empty, error only when empty, stale data kept visible during background loads).
- [json-models] Seeded lead refuted: SessionHistory.fromJson id `as int` (mobile/lib/models/session.dart:92) is safe - backend toSessionHistoryEntry parseInt()s radacctid to a JSON number (backend/src/services/session.service.ts:68); sessionTime/inputOctets/outputOctets likewise parseInt'd server-side.
- [json-models] Seeded lead refuted: voucher.dart int.parse/double.parse sites cannot receive decimal strings today - voucher_meta.limit_value is BIGINT (migration 010) and assembleVoucherInfo serializes limitValue/usedValue/simultaneousUse/price as JSON numbers via Number()/parseInt()/parseFloat() (backend/src/services/voucher.service.ts:315-335); double.parse handles both int and fractional price. Left unreported as a latent hardening gap only, and the voucher provider surfaces parse exceptions in an error banner (not a silent brick).
- [json-models] Seeded lead refuted: subscription_service data['payment'][...] chain is safe - requestSubscription/changeSubscription always include a payment object on every 2xx path (backend/src/services/subscription.service.ts:286-295, 558) and errors surface as thrown AppErrors, never a payment-less success body.
- [json-models] All unguarded DateTime.parse call sites (voucher.dart:151-152, subscription.dart:42-43, payment_record.dart:42/44, router_model.dart:58-61, app_notification.dart:29/31, router_service.dart:76, session.dart:98/101) are fed exclusively by backend new Date(...).toISOString() values with null-guards matching the nullable columns - no malformed-date path from today's backend.
- [json-models] Plan.fromJson non-null casts verified safe: plans.features/allowed_durations are JSONB NOT NULL with defaults (migration 008) and the admin write path enforces z.array(z.string()) / z.array(z.coerce.number().int()) (backend/src/validators/admin.validators.ts:131-132,170-171).
- [json-models] User.fromJson snake_case keys (business_name/is_verified) match the backend, which serializes user rows in snake_case for register/login/me/profile/verify-email-change; name/email are NOT NULL columns so the non-null String casts hold.
- [json-models] Pagination meta parsing (voucher_service, session_service, notifications_service, support_service) verified against controllers - meta keys always present, and mobile uses int.parse(x.toString()) or `as num` so string-typed query echoes (req.query pass-through in session history) parse correctly.
- [json-models] Dashboard raw-map parsing (dashboard_provider.dart getters and dashboard_screen.dart) is fully defensive (`as int?`/`as num?` with defaults, try/catch around DateTime.parse) and every key matches backend dashboard.service.ts serialization.
- [json-models] AppNotification/SupportMessage/NotificationPreference/BankInfo/PaymentRecord field contracts match backend inbox.service.ts, support.service.ts, notification.controller.ts, and getUserPayments serializers; SupportMessage.fromJson is additionally fully null-tolerant with DateTime.tryParse fallbacks.
- [json-models] ActiveSession.fromJson is fully defensive (`as int? ?? 0`, `as String? ?? ''`); backend HotspotUser always serializes bytesIn/bytesOut as numbers via parseInt with '0' fallback so the int casts cannot see strings.
- [json-models] RouterModel/RouterStatusInfo/SetupStep/RouterSetupGuide contracts match backend RouterInfo/RouterStatusResult/SetupGuideResult serializers (router.service.ts:45-97, 443-508, 510-552) including the null-guarded lastSeen and the create-router {router, vpnIp, steps} envelope.
- [json-models] Hotspot template parsing matches the static backend manifest (nameEn/nameAr/descriptionEn/descriptionAr/defaultAccent/accentPresets all present); previewUrl is overridden client-side before fromJson so its non-null cast is safe.
- [json-models] ApiClient refresh-flow parsing (data.accessToken/refreshToken hard casts) matches the mobile (non-admin, body-token) branch of /auth/refresh which always returns both tokens; login/register envelopes likewise match.
- [json-models] Report CSV export path (`response.data as String` for text/csv responses) is correct for Dio's content-type handling; the PDF branch is backend-gated with a clean 501.
- [async-lifecycle] app.dart _checkDeviceIntegrity (seeded lead dropped): appNavigatorKey context is resolved synchronously inside _trySecurityWarning with a null check and a single post-frame retry; no BuildContext crosses the async gap, and a still-null context only skips a warn-only dialog.
- [async-lifecycle] create_voucher_wizard (seeded lead confirmed sound): the single PageController created at line 26 is the one disposed at line 49; all five TextEditingControllers are disposed; no timers, subscriptions, or FocusNodes leak, and _submit re-checks mounted after the await.
- [async-lifecycle] verify_email_screen resend cooldown (seeded lead confirmed sound): _timer is cancelled in dispose (line 128) and the tick self-cancels when unmounted or when the countdown reaches zero.
- [async-lifecycle] voucher_detail_screen timer-recreate lead refuted: didChangeAppLifecycleState always cancels _refreshTimer (line 90) before creating a new one on resume, and dispose cancels both the refresh and clipboard timers — no timer leak.
- [async-lifecycle] voucher_list_screen listenManual dispose-race lead refuted: both initState microtasks flush in the same microtask drain before any dispose event can run, the listener body re-checks mounted, and _routersSub is closed in dispose before the observer/controllers are torn down.
- [async-lifecycle] locale_provider unawaited(updateLanguage) lead refuted: auth_service.updateLanguage (auth_service.dart:122-129) wraps the PUT in try/catch and swallows all errors, so the fire-and-forget future cannot reject.
- [async-lifecycle] All four WidgetsBindingObserver screens (settings, payment, voucher_detail, voucher_list) call removeObserver in dispose, so no lifecycle callbacks can reach a disposed State.
- [async-lifecycle] BuildContext-after-await discipline is consistently good across dialog flows: delete/disconnect/logout/leave-payment/plan-select paths all re-check mounted after awaits (voucher_detail, active_sessions, settings, payment, payments, router_detail, subscription_status, add_router PopScope).
- [async-lifecycle] Controller hygiene across the sweep is sound: every screen disposes its TextEditingControllers and ScrollControllers (login, register, forgot/reset password, change_password, edit_profile, edit_router, add_router, contact, session_history, notifications, voucher_list); no FocusNode allocations exist in screens.
- [async-lifecycle] login_screen's ref.listen(authProvider) is correctly placed in build (auto-managed subscription), and hotspot_template_screen's ref.listen likewise; neither leaks a manual subscription.
- [async-lifecycle] PushNotificationService.initialize is invoked exactly once (main.dart:11) with the _initialized flag, so onMessage/onTokenRefresh listeners cannot double-register; the background handler correctly re-initializes Firebase in its own isolate.
- [async-lifecycle] payment_screen poll success path is protected against double navigation/snackbar: _stopPoller runs before the delay, _snackBarShown gates the snackbar, and mounted is re-checked before context.go; PopScope leave flow re-checks mounted after each await.
- [async-lifecycle] Periodic timers never outlive their screens: active_sessions, voucher_detail, payment (both poll timers), and verify_email all cancel in dispose, so no ref-after-dispose is reachable from a timer callback.
- [error-handling] errorToDisplay (mobile/lib/utils/error_messages.dart) never returns DioException.toString() or raw error objects: it passes through only string messages from structured backend bodies, otherwise maps DioExceptionType/status codes to i18n keys — the seeded raw-leak lead does not hold for this function itself.
- [error-handling] All seeded auth-screen silent catches (login 46/53, verify_email 101/123, forgot_password 44, reset_password 55, register 60, change_password 58, edit_profile 71/92) are safe: AuthNotifier sets state.error AND rethrows on every action, and each of those screens renders authState.error via InlineErrorBanner — the failures are visible, so these leads were dropped.
- [error-handling] dashboard_screen.dart:50 catch(_) is a DateTime.parse fallback returning 'common.notAvailable' — sound.
- [error-handling] api_client.dart catches at 280 (paywall redirect best-effort, error still forwarded via handler.next), 324 (queued-retry failure falls back to propagating the original 401), and 465 (JSON redaction parse fallback) all preserve error propagation — dropped as leads; only the post-drain queue race (reported separately) is defective.
- [error-handling] Token-refresh session handling is sound: refresh rejected with 401 clears tokens and fires onSessionExpired; transport failures keep tokens so the session survives offline; the refresh endpoint itself is excluded from re-refresh loops.
- [error-handling] Sentry wiring (main.dart) installs FlutterError.onError and zone guards via SentryFlutter.init when a DSN is supplied, so unhandled async errors are captured; no-DSN builds start unchanged.
- [error-handling] tryRestoreSession has a finally that always clears isInitializing — no path leaves the app stuck on the splash screen, and network failure during restore correctly keeps the cached session.
- [error-handling] All StateNotifier load paths (dashboard, routers, vouchers, sessions, reports, subscription, support, notifications, notification prefs) catch service errors into state.error via errorToDisplay — no unhandled provider-future rejections on loads.
- [error-handling] Screens with correct full error rendering + retry on failed initial load: dashboard, router list, notifications list, active sessions, session history, voucher list, reports, subscription status, notification preferences, setup guide, edit/add router, create-voucher wizard, payment screen.
- [error-handling] No FutureBuilder/StreamBuilder without error branches exist in lib/ (none are used), and no throw/rethrow statements inside screen build methods.
- [error-handling] Send/upload flows that correctly surface failures via snackbar: support send (restores composer text), payment receipt resubmit/cancel, payment-screen leave flow, print-all voucher fetch.
- [error-handling] The debug log interceptor strips Authorization headers and redacts password/otp/token fields recursively, including JSON-encoded string bodies.
- [error-handling] AppSnackbar.error, ErrorState, and InlineErrorBanner all run messages through trOrRaw, so i18n error keys stored in provider state are resolved before display.
- [i18n-rtl] Missing-key behavior verified: translate() falls back AR->EN->raw key (app_localizations.dart:49-52); automated diff of the maps found EN 681 vs AR 680 keys with only the unused 'payment.uploadReceipt' absent on the AR side, and all 451 distinct keys referenced via tr()/trOrRaw() in code exist in the EN map — no raw-key rendering path is reachable.
- [i18n-rtl] Non-mirroring-icon lead refuted: every direction-sensitive Material icon used (chevron_right, arrow_back, send, list, help_outline) is declared matchTextDirection:true in the Flutter SDK's icons.dart, so they auto-mirror under RTL.
- [i18n-rtl] Locale wiring is sound: MaterialApp.router registers AppLocalizations plus GlobalMaterial/Widgets/Cupertino delegates with en+ar supportedLocales (app.dart:99-112); the chosen locale is persisted and best-effort synced to the backend for localized push notifications (locale_provider.dart:30-36).
- [i18n-rtl] Voucher.limitDisplayText/usageDisplayText English getters are dead code — no screen references them; all rendered voucher limit/validity/usage strings go through the localized helpers in i18n/voucher_format.dart.
- [i18n-rtl] PDF voucher printing is Arabic-correct: Cairo fonts embedded, per-string Arabic detection drives pw.TextDirection.rtl for glyph shaping/joining, and print items receive pre-localized limit/validity strings (print_service.dart:29-52, 178-247).
- [i18n-rtl] Plan display is dynamically localized: pickPlanName prefers backend nameAr under the ar locale and buildPlanFeatures generates feature bullets from structured plan fields via i18n keys (plan_format.dart), consistent with the project's dynamic-derivation preference.
- [i18n-rtl] Dynamically-built status keys resolve in both locales: router status via tr('routers.${status}') (router_list_screen.dart:166), subscription statuses via trStatus with all six status keys present in EN and AR, payment statuses via explicit localized switch (payments_screen.dart:175-189); trStatus title-cases unknown statuses so raw keys never render.
- [i18n-rtl] RTL layout hygiene is otherwise good: widgets use EdgeInsetsDirectional/start-end insets (voucher card checkbox, list tiles, stat chips), no Positioned(left/right), TextAlign.left/right, or Alignment.centerLeft/Right hardcodes outside the chat bubble case; the few EdgeInsets.fromLTRB uses are horizontally symmetric or differ by <=4px.
- [i18n-rtl] Hotspot template picker is fully bilingual including RTL-aware Semantics labels for accent swatches (hotspot_template_screen.dart:347-350) and template name/description localized per locale.
- [i18n-rtl] Dates elsewhere use locale-neutral numeric formats (yyyy-mm-dd, dd/MM HH:mm) with Western digits, matching regional app convention; byte units (MB/GB/KB) are intentionally kept Latin in the AR translation table itself, so their appearance in AR UI is consistent with the product's own convention.
- [diff-platform] Sentry bootstrap (uncommitted mobile/lib/main.dart) matches the sentry_flutter 9.x documented appRunner pattern: on mobile the SDK uses PlatformDispatcher.onError (no zone mismatch possible), init ensures the binding before running appRunner so the extra WidgetsFlutterBinding.ensureInitialized() in _start is a safe no-op, no duplicate error handlers are installed, and the empty-DSN path cleanly bypasses Sentry.
- [diff-platform] Seeded 'bricks app launch' lead refuted: PushNotificationService.initialize() wraps all Firebase/FCM work in try/catch (push_notification_service.dart:38-54), so missing google-services config or no network degrades to a debugPrint, never a launch failure.
- [diff-platform] pubspec.lock churn fully explained and benign: sentry_flutter 9.24.0 pins jni 0.14.2 exactly, which conflicts with path_provider_android 2.3.1's jni ^1.0.0, so the solver downgraded path_provider_android to 2.2.23 (pre-jnigen line, still maintained) and dropped jni_flutter; package_info_plus 9.0.1 arrived as a sentry_flutter dependency; no other consequential transitive shifts.
- [diff-platform] PopupMenu sweep complete: only voucher_list_screen.dart and session_history_screen.dart contain PopupMenuButtons; both 'all' sentinel fixes are correct and no null-valued PopupMenuItem remains anywhere in mobile/lib (the suspected create_voucher_wizard.dart uses DropdownButtonFormField with non-null values only).
- [diff-platform] reports_screen.dart's DropdownMenuItem<String?>(value: null) is not the same trap: DropdownButton wraps selections in _DropdownRouteResult, so selecting the null-valued 'All routers' item does fire onChanged(null) — verified against the installed Flutter 3.41.2 SDK source.
- [diff-platform] create_voucher_wizard unit dropdown has no stale-value assert: _limitUnit is reset when _limitType flips (lines 443-445), and Flutter 3.41.2's DropdownButtonFormField.didUpdateWidget calls setValue(widget.initialValue) on change, keeping the FormField's internal value in sync with the swapped item list.
- [diff-platform] Android release build config sound: minify+shrinkResources with proguard-rules.pro covering flutter engine, flutter_secure_storage, okhttp/okio, and firebase; sentry-android and firebase AARs ship consumer ProGuard rules so no manual sentry keeps are needed; POST_NOTIFICATIONS is merged from firebase_messaging 15.2.10's plugin manifest; INTERNET is declared in the main (release) manifest; cleartext-traffic override is debug-manifest-only.
- [diff-platform] Android secrets hygiene verified: wasel-release.jks, key.properties, app/google-services.json, and local.properties are all untracked and matched by gitignore rules (git check-ignore confirmed); tracked gradle.properties contains no secrets.
- [diff-platform] Desktop registrant regeneration (windows/linux/macos) is consistent and degrades safely: sentry_flutter added to all three; firebase_core absent on Linux and firebase_messaging absent on Windows both throw inside PushNotificationService.initialize()'s try/catch; package_info_plus correctly appears only in the macOS registrant (Dart FFI implementation on Windows/Linux); SecureWindow's MethodChannel is Platform.isAndroid-guarded with a matching handler implemented in MainActivity.kt.

## Refuted findings (reported by a finder, rejected on verification)

Kept for transparency — these were investigated and found **not** to be real bugs:

- **setState called synchronously during build in EditRouterScreen prefill** — `mobile/lib/screens/routers/edit_router_screen.dart:121`. Rejected by 2/3 verifiers.
- **int.parse of server-provided accent hex inside build can throw FormatException** — `mobile/lib/screens/routers/hotspot_template_screen.dart:196`. Rejected by 2/3 verifiers.

> Note: one of the two auto-refuted items (`edit_router_screen` setState-in-build) was **reinstated as LOW** above after manual re-verification — the auto-verifiers judged it benign in release, but it is a genuine debug-build assertion on a reachable path.

## Completeness-critic gaps (beyond the 5 added findings)

The critic also noted these lower-confidence areas worth a follow-up look:

- MISSED DEFECT CLUSTER - routersProvider stale-singleton: no lens issued a finding OR sound note on C:/Users/mubar/Desktop/Wasel/mobile/lib/providers/routers_provider.dart despite it being the third global-singleton provider with per-router selected state, the exact defect class of the two confirmed vouchers/sessions findings. Concretely: router_detail_screen.dart:59-61 renders state.selectedRouter with no id==widget.routerId check and no clearSelection on entry, so detail B shows router A's name/status/system-info while loading; loadRouterStatus (routers_provider.dart:149-156) has no sequence guard and swallows all errors silently, so a failed/slow status fetch leaves the PREVIOUS router's online/offline badge and system info displayed under the new router; and the edit/delete buttons read the stale object (router_detail_screen.dart:71 passes router.id from selectedRouter, not widget.routerId), so a user can edit/delete the wrong router.
- MISSED DEFECT - edit_router_screen prefill: C:/Users/mubar/Desktop/Wasel/mobile/lib/screens/routers/edit_router_screen.dart:119-122 calls _prefill + setState() synchronously inside build() (framework assert in debug builds), and unlike initState (line 39) this path never checks selectedRouter.id == widget.routerId - a stale different-router selectedRouter prefills the previous router's name/apiUser into a form that submits against widget.routerId (updateRouter cross-router data corruption). async-lifecycle/error-handling only checked this screen for controller disposal and error-banner rendering.
- UNINSPECTED SCREEN - report_export_screen: C:/Users/mubar/Desktop/Wasel/mobile/lib/screens/reports/report_export_screen.dart appears in zero findings and zero sound notes. Revenue/voucher-sales CSV is copied to clipboard with NO auto-clear (lines 19-22; the equivalent voucher-code and payment-reference clipboard flows each got findings) and passed to Share.share; the screen also has no FLAG_SECURE, and exportData rides through route extra (app_router.dart:289-293).
- UNINSPECTED BEHAVIOR - push notification tap-through: no FirebaseMessaging.onMessageOpenedApp or getInitialMessage handler exists anywhere (push_notification_service.dart handles only onMessage/onTokenRefresh), so tapping any push never navigates; and with no flutter_local_notifications/channel setup, Android foreground pushes display nothing (silent inbox refresh only). No lens declared this surface inspected either way.
- DATA-EXPOSURE NOTE INCOMPLETE - receipt image cache retention: image_picker copies bank-transfer receipt photos into the app cache dir (payment_screen.dart:127-135, payments_screen.dart:36-45) and nothing deletes them after upload; the sound note stops at 'image kept local until explicit upload' without covering post-upload persistence.
- FOLLOW-ON UNVERIFIED - jailbreak detection in release: the confirmed ProGuard finding says the keep rule targets a nonexistent package, but no lens verified whether the real flutter_jailbreak_detection plugin (app.dart:47) survives R8 minification without that rule - i.e., whether release-build root/jailbreak detection silently no-ops (throws into the warn-only catch). Needs a release-build smoke check.
- OVERBROAD SOUND NOTE - network-tls 'no cross-host Authorization leak path exists' reasons only from call sites (no absolute third-party URLs) and never examined Dio/dart:io HttpClient redirect-following: a server- or MITM-controlled 3xx can re-send the Bearer header cross-host with default followRedirects. Marginal on its own but compounding with the confirmed pinning no-op.
- UNINSPECTED SEMANTICS - route extra loss: every detail route falls back to empty-string ids when state.extra is absent (app_router.dart:157, 165, 204, 212-215, 248-249, 301, 309), producing API calls like GET /routers/'' after any restoration/deep-link path that drops extras; no lens assessed restoration or the ''-id request behavior.
- TEST BLIND SPOT: mobile/test has zero tests for api_client.dart (the file carrying 8 confirmed findings including both pinning highs), secure_storage.dart, push_notification_service.dart, print_service.dart, and the notifications/support/reports/notification_prefs/locale providers; screen coverage is only hotspot_template_screen + payments_screen. None of the confirmed high/medium defects has a pinning regression test.
- LOW-RISK UNINSPECTED FILES (spot-checked clean by me, but no lens touched them): lib/theme/* (7 files), lib/widgets/app_card|confirm_dialog|empty_state|section_header|stat_card|status_badge|status_dot|skeleton_loader.dart (Skeleton's AnimationController is disposed), lib/navigation/scaffold_with_nav_bar.dart, lib/screens/splash_screen.dart, lib/screens/vouchers_screen.dart (re-export shim), lib/screens/subscription/widgets/plan_card.dart, lib/services/notification_service.dart (NotificationApiService - unchecked response casts, plausibly subsumed by the json-models prefs note).

## Suggested fix order

1. **Certificate pinning (High #, security):** switch to `IOHttpClientAdapter.validateCertificate`, hash SPKI not full-cert DER, and pin the refresh Dio too — or remove the misleading pinning code entirely so it is not relied upon.
2. **Un-keyed provider races (High + Medium):** key vouchers / sessions / routers providers by routerId (family or routerId-in-state + response-drop guard). One refactor fixes ~6 findings (cross-router contamination, stale-response overwrite, delete-all filter re-read).
3. **Reports render zeros (High, contract-mismatch):** align the reports screen parser with the real `rows`/`totals` API contract.
4. **Silent error-swallowing (Medium cluster):** surface `state.error` on non-empty lists and check bool results of toggle/delete/disconnect so failed destructive actions are visible.
5. **i18n/RTL (Medium/Low cluster):** localize voucher status, terminate-cause, units, plurals, and validator messages; add Arabic plural handling.
6. **Clipboard & logging hardening (Low cluster):** detach auto-clear from widget lifecycle, redact apiPass/newPassword/setup secrets in debug logs, gate service debugPrints behind kDebugMode, refcount SecureWindow.

_No code was changed by this audit. Fixes are a follow-up task._
