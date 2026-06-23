# Wasel Mobile — Error-Handling, Language & Bug Audit

| | |
|---|---|
| **Date** | 2026-06-12 |
| **Scope** | `mobile/` Flutter app — error handling, i18n/language (must be **Arabic + English only**), and general bugs. Backend, admin SPA, and visual/design-system issues were out of scope. |
| **Method** | Mechanical i18n key cross-reference (main thread) + 3 parallel finder agents (i18n, parsing/crash, lifecycle/async) → dedup → 1 adversarial verifier per Medium+ finding (re-read each path to refute) → completeness critic. |
| **Status** | Findings report — **no code changed**. Pick what to fix in a follow-up. |
| **⚠️ Handling** | **Untracked / not committed.** Decide whether to keep, move to a tracker, or delete after triage. |

## Headline

There are **no crashes on normal paths** (Critical tier is empty — every `fromJson` runs behind a provider `try/catch`, and `flutter analyze` is clean). The real issues are: **two resource-leak bugs** (High) on the voucher screens, and a **broad set of hardcoded English strings** that leak into the Arabic UI. The i18n foundation is solid — **EN/AR maps are at perfect 566/566 parity** and only `en`+`ar` are registered (no stray third language). The verifier **refuted 17 of 32 findings** (mostly "parse will crash" claims that the backend's strict typing makes unreachable), so the confirmed list below is the real signal.

## Summary

| Severity | Error-handling | Language (i18n) | Bug | Total |
|---|---|---|---|---|
| Critical | 0 | 0 | 0 | **0** |
| High | 0 | 0 | 2 | **2** |
| Medium | 0 | 9 | 1 | **10** |
| Low | 1 | 5 | 7 | **13** |

**Mechanical signals:** `flutter analyze` → **No issues found**. i18n key cross-reference → **EN 566 / AR 566, zero diff**; exactly **2 used-but-undefined keys**; 167 dead (defined-but-unused) keys.

---

## A. Language / i18n

### A.0 Foundation (verified clean)
- **Exactly two locales** registered (`Locale('en')`, `Locale('ar')`) in `app.dart` + `providers/locale_provider.dart`. No reference to any other language anywhere in `lib/`.
- **EN/AR parity is perfect: 566 keys each, zero difference.**
- The lookup `translate(key,[args])` (`i18n/app_localizations.dart:45`) **returns the raw key string** when a key is missing — so any missing/hardcoded gap shows the user a literal like `settings.logoutTitle` rather than failing loudly.

### A.1 — Two used-but-undefined keys (confirmed, complete list)
`settings.logoutTitle` and `settings.logoutConfirm` are called at `screens/settings_screen.dart:63-64` but defined in **neither** map. On logout the dialog shows the raw key strings. This is the **entire** missing-key list (mechanically verified against all 401 literal `tr()` keys; the 3 dynamic `tr(var)` sites in `voucher_detail_screen.dart:121-123` resolve to keys that exist).
**Fix:** add the two keys to both maps (e.g. "Log Out?" / "تسجيل الخروج؟", "Are you sure you want to log out?" / "هل أنت متأكد من تسجيل الخروج؟"). **Size: XS.**

### A.2 — Hardcoded English strings leaking into the Arabic UI (Medium ×8)
Each renders English to an Arabic user on a primary screen.

| Finding | File:line | Note |
|---|---|---|
| Jailbreak/root **security dialog** fully hardcoded (`'Security Warning'`, body, `'I understand, continue'`) | `app.dart:44-59` | ⚠️ **Fix carefully:** this dialog is shown from `initState` of the widget that *owns* `MaterialApp.router`, so its context is **above** the `Localizations` ancestor — naively calling `context.tr()` there throws a null-deref. Defer the dialog until after `MaterialApp` mounts (post-frame via the router's `navigatorKey`), then translate. |
| `_formatDuration` returns `'2 hours'`/`'1 day'`/`'30 minutes'` in English, **injected as `{0}` into the Arabic sentence frame** → broken hybrid like "الصلاحية: 2 hours" | `create_voucher_wizard.dart:656-663` (used 618, 633, 674) | Keys `vouchers.minutes/hours/days` already exist in both maps but are never used. Same hybrid pattern also in `session.dart` / `report.dart` duration formatters. |
| Hint text `'e.g. 2'` / `'e.g. 5'` | `create_voucher_wizard.dart:361, 564` | |
| Data-unit dropdown `Text('MB')` / `Text('GB')` | `create_voucher_wizard.dart:387-388` | |
| Subscription duration label `Text('$d mo')` | `subscription/widgets/plan_card.dart:117` | `subscription.month1`/`monthsN` exist (used one line above) — drop-in fix. |
| Date-range separator `'  to  '` | `reports/reports_screen.dart:319` | |
| Section headers `'Subscription'`/`'Routers'`/`'Vouchers'` shown verbatim (`.toUpperCase()`) | `notification_preferences_screen.dart:82, 100` | Root cause is deeper — see A.3. |
| Daily revenue prefixed with hardcoded `'$'` instead of `common.currencySymbol` | `dashboard_screen.dart:290-291` | Platform currency is SDG, not USD — the `$` is also factually wrong. |

### A.3 — `NotificationPreference` model returns English (Medium, critic-promoted)
`models/notification_preference.dart:20-37` — `displayName` ("Subscription Expiring", "Router Offline", …) and `sectionName` ("Subscription"/"Routers"/"Vouchers") are **hardcoded English getters** rendered directly as every toggle label and section header on the notification-preferences screen (`:112`, `:82`). Every Arabic user sees an all-English preferences screen. More pervasive than A.2's section-header symptom — the model layer is the root cause.
**Fix:** map preference categories to i18n keys at the render site (or store category codes and translate in the widget). **Size: S.**

### A.4 — RTL: one alignment that won't mirror (Medium)
`screens/auth/login_screen.dart:139` uses `Alignment.centerRight` for the "Forgot Password" link, which stays physically right in Arabic instead of snapping to the leading edge.
**Fix:** `AlignmentDirectional.centerEnd`. **Size: XS.**
*(Note: the finders' other RTL claims — `Icons.arrow_back`/`chevron_right` "don't flip", chat-bubble alignment — were **refuted**: those Material icons carry `matchTextDirection: true` and flip automatically. RTL is in good shape overall; this is the lone real offender found.)*

### A.5 — i18n Lows (unverified, batch cleanup)
Validity preset chip labels hardcoded (`create_voucher_wizard.dart:479-486`); `' in'` suffix in sessions breakdown breaks Arabic grammar (`reports_screen.dart:537`); reports `_formatDuration` English (`reports_screen.dart:39-45`); `'N/A'` fallback (`dashboard_screen.dart:39,49`); raw date interpolation, not locale-aware (`voucher_detail_screen.dart:481-483`).

---

## B. Bugs

### B1 — Timer leak: periodic refresh recreated on every resume without cancelling (High)
`screens/vouchers/voucher_detail_screen.dart:87-94`. The `AppLifecycleState.resumed` branch assigns a new `Timer.periodic(30s)` to `_refreshTimer` **without cancelling the existing one first**. The `paused` branch cancels, but on iOS many interruptions (incoming call, notification shade, Face ID, Siri) go `inactive → resumed` and **never fire `paused`** — so each interruption stacks another live 30-second timer, each making its own `loadVoucher` network call. Over a session, N timers accumulate.
**Fix:** `_refreshTimer?.cancel();` before reassigning. **Size: XS.**

### B2 — `ref.listenManual` subscription never closed in VoucherListScreen (High)
`screens/vouchers/voucher_list_screen.dart:44-49`. The `ProviderSubscription` from `ref.listenManual(routersProvider, …)` is not stored, `dispose()` never closes it, and the callback has no `mounted` guard before calling `_onRouterSelected` (which calls `setState`). On a slow connection (this app's target environment): open Vouchers tab → `loadRouters()` in flight → switch tabs before it lands → `dispose()` runs → response arrives → callback fires `setState` on a disposed widget.
**Fix:** store the subscription and `.close()` it in `dispose()`, and add `if (!mounted) return;` as the callback's first line.
**Caveat to confirm during the fix:** whether `flutter_riverpod` 2.6.1 auto-closes a `listenManual` subscription on widget dispose is version-dependent; if it does, the crash window is closed and this drops to a defensive Low. The `mounted` guard is correct and harmless either way — apply it regardless. **Size: XS.**

### B3 — Model parse-safety: trusts the backend contract completely (Medium, representative)
`models/voucher.dart:151-152` does `DateTime.parse(json['createdAt'])` with no guard; a malformed/absent timestamp throws `FormatException`.

**Important honest framing:** the finders raised this parse-crash pattern across **many** models (Router, Subscription, Session, Plan, Notification, Payment) as High/Medium, and the verifier **refuted almost all of them** — the backend declares those columns `NOT NULL` and `parseInt(...)`/serializes them before sending, so the throw is **not reachable with real backend data**. The app is the only consumer and trusts the backend's typing entirely. So treat this as **defense-in-depth / fragile coupling**, not an active crash: a backend schema change, a proxy mangling a field, or a future third-party data source would surface an uncaught `FormatException` (these run inside provider `try/catch`, so the user sees a generic error, not a red screen).
**Fix (optional hardening):** one reusable helper — `DateTime tryDate(v) => DateTime.tryParse(v?.toString() ?? '') ?? DateTime.now();` and `int? tryInt(v) => int.tryParse(v?.toString() ?? '')` — applied across all `fromJson`. **Size: S** (mechanical sweep).

### B4 — Bug Lows (unverified, batch cleanup)
- Clipboard-clear `Timer` callback runs after dispose without `mounted` guard (`voucher_detail_screen.dart:102-107`) — harmless today (no widget-tree access) but inconsistent.
- `PopScope` calls `context.pop()` after an async `await` without a `mounted` guard (`add_router_screen.dart:111-118`).
- `_submit()` `int.parse`/`double.parse` on form fields without `try/catch` if validation is bypassed (`create_voucher_wizard.dart:88-90`).
- `SupportMessage.fromJson` bare `as String` + unguarded `DateTime.parse` (`support_message.dart:20-26`).
- `ForgotPasswordScreen` controller listener holds a ref after dispose (`forgot_password_screen.dart:26-35`).
- `ContactScreen.initState` microtask `ref.read` after potential dispose, no `mounted` guard (`contact_screen.dart:26-29`).
- `SetupGuideScreen` calls `addPostFrameCallback` on every `build()` without a lifecycle guard (`setup_guide_screen.dart:107-109`).
- `verify_email_screen` cooldown `Timer` callback `setState` on a possibly-disposed widget (`verify_email_screen.dart:51-59`).

---

## C. Error handling

The error-handling layer is **mostly solid** and the verifier killed several "swallowed error" claims:
- **JWT refresh interceptor** (`services/api_client.dart`) — single-flight queue, no infinite-loop/deadlock risk. Clean.
- Providers expose an `error` field via `try/catch`; the auth error-mapper (`auth_provider.dart:445-482`) distinguishes timeout vs connection vs backend-code errors.
- The `catch (_) {}` blocks in `verify_email_screen.dart:72,81` and `forgot_password_screen` were **refuted as bugs** — the notifier methods set the error into state *before* rethrowing, so the user does see feedback; the empty catch only prevents a duplicate.

### C1 — Fire-and-forget `loadSubscription()` loses errors (Low)
`providers/auth_provider.dart:120-128` calls `loadSubscription()` without `await` on login/restore ("so auth latency is unaffected"). Intentional, but if it fails the error is silently lost until the user navigates to a subscription-dependent screen, and there's a mild race with screens that eagerly read subscription state.
**Fix:** keep it unawaited but surface failures into a state field the dependent screens can react to. **Size: S.**

---

## D. Refuted findings (17 — investigated, not real)

The verifier refuted these; recorded so they're not re-flagged:
- **Parse-crash class (8):** `Voucher.int.parse`, `Subscription` casts, `SessionHistory.id`, `RouterModel.DateTime`, `Plan.maxRouters`/`features`, `PaymentRecord` precedence, `AppNotification` casts, `VoucherService/SessionService` `deletedCount`/meta casts — all **unreachable** because the backend sends `NOT NULL`, pre-parsed, well-typed data (e.g. `session.service.ts:67` does `parseInt(row.radacctid)` before serializing).
- **RTL (3):** `Icons.arrow_back`/`chevron_right` flip automatically (`matchTextDirection: true`); chat-bubble alignment was self-admittedly already correct.
- **Lifecycle/async (6):** payment-screen clipboard timer (no widget-tree access in callback); payment poller `context.go`/snackbar (a `mounted` check already guards it at `:560`/`:91`); the verify/resend/forgot-password "swallowed error" claims (error is surfaced via state before rethrow).

---

## E. Not covered (critic — recommend follow-up)

Real surfaces this audit did **not** examine that matter for a bilingual operator app:
- **Push-notification payloads are always English.** `AppNotification` title/body come straight from the backend as English strings (`models/app_notification.dart:22-32`), rendered raw in the inbox (`notifications_screen.dart:212,226`). No locale is sent to the backend, no client remapping. Every Arabic operator gets English push + inbox text. **(Critic rates this Medium.)**
- **Arabic pluralization.** The `{0}`-only system can't express Arabic's number categories — strings like `routers.minutesAgo` ("منذ {0} دقيقة") are grammatically correct only for 1. ~6+ high-traffic keys affected. May be acceptable for a Sudanese operator tool — a product call.
- **Arabic-Indic digits & locale-aware dates.** Numbers/dates use raw interpolation / hand-rolled `YYYY-MM-DD`, no `intl.NumberFormat`/`DateFormat`. Whether Western digits are intended (often fine in Sudanese business contexts) was not confirmed.
- **Accessibility/semantics — entirely absent.** Zero `Semantics`/`semanticLabel` usage in `lib/`. Icon+count composites (notification badge, StatCard, StatusBadge) and the icon-only swipe-to-delete give screen readers no context; preference toggles announce English.
- **Receipt-URL keyboard type** (`payment_screen.dart`) — likely default `TextInputType.text` instead of `.url`.

---

*Generated by a multi-agent audit (mechanical cross-ref + find → adversarially verify → critique). 36 agents; 32 raw findings → 15 confirmed (17 refuted on verification). Critical tier is empty by evidence: all parsing sits behind provider `try/catch` and `flutter analyze` is clean. Every Medium+ finding carries verifier-confirmed `file:line` evidence.*
