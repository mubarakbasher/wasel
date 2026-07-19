# Wasel — Uptodown upload kit

Uptodown is the interim distribution channel for the signed release APK while the Google Play Console account is pending approval.

---

## Prerequisites — do these in order

1. **Prod deploy complete.** The 2026-07-20 01:00 deployment (runbook `docs/DEPLOY_RUNBOOK_2026-07-19.md`) must be done and healthy before uploading. The release APK calls backend endpoints introduced in this cycle; uploading earlier ships a broken app to anyone who installs it.
2. **Signed universal APK built from `main`.** After `dev → main` is promoted, build with:
   ```
   flutter build apk --release \
     --dart-define=API_BASE_URL=https://api.wa-sel.com/api/v1
   ```
   Output: `build/app/outputs/flutter-apk/app-release.apk`. Confirm it is signed with `android/wasel-release.jks` (`jarsigner -verify -verbose -certs app-release.apk`).
3. **Operator smoke test on a real device.** Install the APK side-load, log in, open the Routers list, open the Voucher list. Confirm the app talks to `api.wa-sel.com` (not staging) and all three screens load without errors.

---

## App identity

| Field | Value |
|---|---|
| Package name | `com.wasel.wasel` |
| App name | Wasel / واصل |
| Version name | 1.0.0 |
| Version code | 1 |
| APK type | Universal (all ABIs) |
| Minimum Android | 8.0 (API 26) |
| Signing keystore | `android/wasel-release.jks` |

---

## Upload checklist

- [ ] Create a developer account at <https://developer.uptodown.com> (free).
- [ ] Click **"Submit an app"** → enter package name `com.wasel.wasel` → select category **Productivity** or **Tools**.
- [ ] Upload `app-release.apk`.
- [ ] Fill in the listing (see drafts below).
- [ ] Upload screenshots (see shot-list below).
- [ ] Submit for Uptodown's review (typically 1–3 business days).
- [ ] Once approved, share the Uptodown listing URL; replace the `#` placeholder in `landing/src/config.ts` with the real URL and redeploy the landing page.

**Every future update:** increment the `version:` line in `mobile/pubspec.yaml` (`x.y.z+N` — `x.y.z` is the versionName, `N` the versionCode; Gradle derives both from it), build a new signed APK with the **same `android/wasel-release.jks`**, upload to Uptodown as a new version. A different keystore signature is treated as a different app by Android — installed users cannot update to it. There is no override for this.

---

## Listing copy drafts

> Arabic is first throughout — this is an Arabic-primary market. Use both blocks; Uptodown supports separate EN/AR descriptions.

### Arabic listing (primary)

**Short description (≤80 characters)**
```
أدِر كروت الواي فاي للزبائن من موبايلك — بدون سيرفر وبدون IP حقيقي
```

**Long description**
```
واصل — منصة إدارة كروت الواي فاي لأصحاب الشبكات والهوت سبوت

أضف جهاز Mikrotik الخاص بك بلصق سكريبت واحد تلقائي يُنشئ نفقًا آمنًا (WireGuard) بين الجهاز والسحابة — بدون IP عام وبدون بورت فورواردينغ. يعمل خلف CGNAT وشبكات المشاركة بالكامل.

الميزات الرئيسية:
• إنشاء كروت دقيقة وأسبوعية وشهرية مع تحديد السرعة والبيانات والوقت
• طباعة الكروت من التطبيق مباشرةً بتنسيق جاهز للبيع
• متابعة الجلسات الحية ومعرفة من متصل الآن
• تصاميم صفحة تسجيل الدخول (نهار / ليل / سوق) مع اسم الجهاز ولون مخصص — تُرسل للراوتر من التطبيق
• إدارة أسطول من أجهزة Mikrotik من شاشة واحدة
• واجهة عربية كاملة مع إشعارات ورسائل بالعربي
• خطط اشتراك ثابتة — لا نسبة من مبيعاتك

مشكلة MAC Randomization (انقطاع الكروت الشهرية وإعادة التفعيل اليدوية) محلولة بالكامل في النظام.

الكروت مخزنة في السحابة وليس على الجهاز — تبقى سليمة حتى بعد إعادة تشغيل الراوتر أو ريسته.
```

---

### English listing

**Short description (≤80 characters)**
```
Manage Wi-Fi vouchers for your Mikrotik hotspot — from your phone, no public IP needed
```

**Long description**
```
Wasel — Mikrotik Hotspot Voucher Manager

Add a Mikrotik router with one auto-generated script that builds a secure WireGuard tunnel to the cloud — no public IP, no port forwarding, works fully behind CGNAT.

Key features:
• Create time, data, and speed-capped vouchers (daily / weekly / monthly)
• Print voucher sheets from the app, ready to hand to customers
• Live session monitoring — see who is connected right now
• Captive-portal login-page designs (Daylight / Midnight / Souq) with your router name and a custom accent color, pushed to the router from the app
• Manage a fleet of Mikrotik devices from a single dashboard
• Full Arabic UI with Arabic push notifications and emails
• Fixed subscription plans — we never take a share of your voucher sales

The MAC-randomization problem (monthly vouchers cutting off and requiring manual disable/reactivate) is solved at the system level with interim accounting, mac-cookie, and automatic stale-session cleanup.

Vouchers are RADIUS users stored in the cloud, not on the router — they survive resets and reflashes.
```

> **Claims to avoid** (per `docs/release/MARKETING_PLAN.md`): do not mention iOS availability, PDF report export, SLA/uptime guarantees, automated/card payments, or non-Mikrotik router support. None of these are live.

---

## Screenshot shot-list

Capture on a real Android device running the Arabic UI (`ar` locale). Portrait orientation, PNG or JPG. Uptodown recommends at least **1080 × 1920 px** (standard portrait phone). No device frame required but a clean frame looks better in the listing.

| # | Screen | What to show |
|---|---|---|
| 1 | **Dashboard** | KPI cards + router status ring; make sure at least one router shows "online" |
| 2 | **Routers list** | Two or more routers; at least one with a green "online" badge |
| 3 | **Voucher list** | A mix of active, used, and expired vouchers with Arabic names/dates |
| 4 | **Voucher print sheet** | The printable card layout with voucher code, duration, and QR |
| 5 | **Captive-portal picker** | The design picker open on a router — Daylight / Midnight / Souq previews visible + one marked "applied" |
| 6 | **Settings / Subscription** | Current plan, renewal date — shows the business model |

Aim for clean, realistic data (not placeholder "test 1 / test 2" names). Arabic numerals and RTL layout should be visible in at least screenshots 1, 3, and 5.

---

## Safekeeping — CRITICAL

The following files are the only way to publish future updates to this app. If the keystore is lost, the app on Uptodown (and later Play Store) is permanently orphaned — every installed user is stranded on 1.0.0 with no update path.

Back all three up off this machine (encrypted cloud storage, a password manager's secure-note attachment, or an offline encrypted drive):

| File | Purpose |
|---|---|
| `android/wasel-release.jks` | The signing keystore — **cannot be regenerated** |
| `android/key.properties` | Key alias + passwords for the keystore |
| `android/wasel-backup-tls.key` | Offline reserve key for TLS pin rotation |

Treat these like the master password to the whole app distribution. Store at least two independent copies.

---

## Later: Google Play

When the Play Console account is approved, the same process applies with the same keystore. Additional steps before Play submission:

- Enroll in **Play App Signing** (Google holds a derived signing key; you upload an upload key — the `wasel-release.jks` becomes the upload key). This is the recommended path and protects you if the upload key is lost later.
- Adaptive icon: **already in place** at `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` (foreground + background + monochrome). Optional polish for Play: a dedicated single-color monochrome asset instead of reusing the color foreground.
- Write a privacy policy (required for any app that connects to a network) and host it at a stable URL; add the URL to the Play listing and the `data-safety` form.
- Fill out the data-safety form: the app collects account credentials (email/password) and device identifiers (for session management); no data is sold; data is transmitted over encrypted HTTPS with TLS certificate pinning.

The Play listing copy above (EN + AR) is a good starting point for the Play Store description; Play allows up to 4 000 characters for the long description.
