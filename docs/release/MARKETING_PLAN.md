# Wasel — Marketing Plan (v1.0 launch)

**Date:** 2026-07-07 · Built from the codebase/product scan + external competitor research.
**Product one-liner:** *Run your Wi-Fi voucher business from your phone — no public IP, no server, no technician visits.*
**Arabic tagline candidates:** «بيع كروت الواي فاي من موبايلك — بدون سيرفر وبدون IP حقيقي» · «واصل: كروتك في السحابة، مش في الراوتر»

> **Market correction:** external research initially assumed Libya from the domain; the codebase says **Sudan** — platform currency migrated USD→SDG (`019_currency_sdg.sql`), admin timezone `Africa/Khartoum`, manual bank-transfer rail. Competitor/pricing analysis below is market-agnostic; the channel plan is Sudan-first. Sudan-specific channel names should be field-verified before spend — treat them as hypotheses, not facts.

---

## 1. Who we sell to (from TRD §2.3 + product reality)

| Segment | Pain today | What wins them |
|---|---|---|
| **Café / restaurant / shop owners** selling Wi-Fi access | Paper chaos, technician dependency, vouchers die when the router resets | Print-and-sell PDF sheets, phone-only management, vouchers survive resets |
| **Neighborhood hotspot resellers** (incl. reselling Starlink/ISP links — common in Sudan post-conflict) | CGNAT: no public IP, so remote tools don't work; MAC-randomization lockouts anger customers | Zero-port-forwarding WireGuard onboarding; the MAC-randomization fix (mac-cookie + reaper) nobody else has |
| **Multi-site operators / small WISPs** | Per-router silos (Mikhmon per router, User Manager per box) | One cloud pool of vouchers + fleet dashboard + central disable/CoA kick |
| **Technicians / installers** serving the above | Site visits for every voucher batch or config change | Remote everything; they become Wasel resellers (channel, not just users) |

## 2. Positioning — four headline differentiators

1. **No public IP, no port forwarding, no server.** Paste one auto-generated script; the router builds an outbound WireGuard tunnel. Works behind CGNAT. Every serious alternative (Mikhmon, PHPNuxBill, SAS4, DMA RM) makes *you* solve reachability. **Lead every ad with a 60-second "paste one script, router appears online" demo.**
2. **Vouchers live in the cloud, not on a box that can be reset.** RADIUS users, not router-local users: survive resets/reflashes, work across your whole fleet, instant central disable with CoA kick, real time/data/speed caps — and the phone MAC-randomization problem (customers "locked out until you disable/reactivate") is solved (mac-cookie + interim accounting + stale-session reaper). Competing local-user tools architecturally cannot fix this.
3. **Arabic-first, mobile-first.** Full EN/AR + RTL app, Arabic push notifications, bilingual emails, bilingual designer captive portals (clean/dark/warm) with bundled Arabic fonts, pushed to the router from the phone. No global competitor has this; the regional incumbent (SAS4) is Arabic but server-bound and ISP-grade.
4. **Billing that matches the market, flat-fee forever.** Manual bank-transfer with receipt verification — no card rails assumed. Message: **"اشتراك ثابت — لا نأخذ نسبة من مبيعاتك"** (flat subscription, we never touch your voucher revenue) — direct hit on HotspotSystem's 15–25% revenue share and MikroTicket's resented fee.

**Proof points to cite:** live in production with paying users (wa-sel.com); adversarially-verified security audit with all Critical/High findings fixed; AES-256-GCM credential encryption; RADIUS never exposed to the internet; 500+ automated tests across the stack.

**Claims to AVOID until true:** iOS availability (no release track) · certificate-pinning as a guarantee (currently a no-op) · PDF report export (returns 501; CSV works) · "24/7 monitored / SLA" (no monitoring yet) · automated/card payments · non-Mikrotik routers.

## 3. Competitive landscape (condensed)

| Competitor | Price anchor | Their weakness = our wedge |
|---|---|---|
| **Mikhmon** (free, self-hosted PHP) | $0 (+VPS/PC + DIY VPN) | Router-local vouchers die on reset; needs LAN PC or DIY public IP/VPN; no mobile app, no Arabic, no multi-router cloud |
| **MikroTik User Manager** (in RouterOS) | $0 | Per-router silo, Winbox/CLI UX, no business layer at all — anchors "free" but unusable as a business |
| **PHPNuxBill** (open source) | $0 (+$5–10/mo VPS + DIY) | Strongest free option; still DIY hosting/security/router reachability; no polished mobile app, Arabic an afterthought |
| **MikroTicket** (Android app) | ~$9.99/mo | Closest mobile rival; router-local vouchers, no Arabic, users publicly revolt over pricing |
| **Easy-Mikhmon** (cloud SaaS) | opaque, ~monthly | Mikhmon model in the cloud — still no RADIUS/CoA, English-only, early polish |
| **MKController** (cloud controller) | ~single-digit $/router/mo | Router-management first, vouchers a bolt-on; no Arabic, card billing |
| **HotspotSystem** | $9.90–29.90/location/mo **+ 15–25% rev share** | Expensive, aging, portal hosted abroad, no Arabic, no fleet management |
| **DMA Radius Manager** | ~$99–149 one-time + your server | Legacy, self-hosted burden, no mobile, widely pirated |
| **SAS4 / Snono (Iraq)** — regional incumbent | few hundred $ license via resellers | Arabic but ISP-grade, self-hosted, 24h license phone-home resented, no mobile-first UX. Position: **"SAS-class RADIUS vouchers, zero servers, from your phone."** |
| **Splynx** (full ISP suite) | $255+/mo | Irrelevantly high — defines the ceiling we stay far below |

**Implication:** we don't out-price free — we out-service it. The paid conversion story is *saved setup time, cloud persistence, no lockout complaints, and multi-router growth*, not a feature list.

## 4. Pricing strategy

**Current state (must fix before launch push):** seeded prices are placeholders — `008_plans_table.sql` seeded 5/12/25 as USD and `019` relabeled the currency to SDG without renumbering. 5 SDG/month is not a price. Real prices are runtime data set in the admin Plans page and documented nowhere.

Recommendations:

1. **Set real SDG prices** anchored to the competitor band ≈ **$5–15 per router/month equivalent**, at or below MikroTicket while delivering RADIUS + Arabic + zero-networking. Given SDG volatility, review monthly and consider stating prices as "SDG, updated monthly" in-app (plans are runtime-editable — this is operationally easy). Document the live prices in `PROJECT_STATE.md` when set.
2. **Add a free or trial tier — near-mandatory.** The audience's reference point is "Mikhmon is free," and today a new operator can do *nothing* until an admin approves a bank transfer (no trial exists; sign-up-to-value is bounded by human approval latency). The `plans` table already supports adding a 0-price row (no tier/price constraint blocks new plan rows) — a 1-router / limited-voucher / 14–30-day trial row is low-effort and removes the single biggest funnel wall.
3. **Keep the tier ladder as the upsell story:** Starter (1 router) → Professional (3 routers, session history + analytics) → Enterprise (10 routers, unlimited vouchers, exports). Reports/CSV are already tier-locked in code — the paywall exists.
4. **Never revenue-share; say so loudly.** It's a structural differentiator vs HotspotSystem and a trust signal in a low-trust market.
5. Later (ROADMAP): annual durations + proration on upgrade (`allowed_durations` JSONB already supports arbitrary month lists).

## 5. Channels (Sudan-first; verify names before spend)

**Digital — where Mikrotik operators actually are:**
- **Facebook** (dominant platform): Arabic Mikrotik groups — «ميكروتك العرب» (~confirmed large group), MikroTik Egypt page, plus Sudan-specific searches: «ميكروتك السودان», «شبكات السودان», «واي فاي السودان». Post *value content* (portal templates, CGNAT workarounds, MAC-randomization explainer), not ads.
- **Telegram**: Arabic Mikrotik channels (e.g. t.me/mikrotik_ARAB) + Sudanese networking/tech channels — this is where the DIY/cracked-tools audience lives; be present with help, not pitches.
- **WhatsApp**: sales in this market close on WhatsApp (MikroWisp literally sells via WhatsApp). Run a Wasel support/community group as the de-facto sales channel; put a WhatsApp CTA on everything.
- **YouTube (Arabic)**: sponsor/get reviewed by Arabic Mikrotik tutorial creators (hotspot-setup videos in Arabic pull 6-figure views). **The single highest-leverage asset: one honest Arabic walkthrough — "إدارة كروت الواي فاي بدون IP حقيقي" — showing script-paste → router online → voucher sold → phone connects.**
- **SEO/lead magnets (Arabic)**: free Mikrotik login-page template packs + voucher-card design packs (huge existing demand for these) carrying a "works best with Wasel" hook; articles targeting «هوت سبوت بدون IP عام», «مشكلة كروت الواي فاي بتفصل» (the MAC-randomization pain in operator language).

**Physical / channel partners:**
- **Mikrotik hardware sellers** in Khartoum/Omdurman/Port Sudan and wherever routers are sold now: bundle a Wasel onboarding QR/script with every hAP/RB sold; pay shops a recurring referral cut.
- **Technicians/installers as resellers**: they influence every purchase; a referral commission turns the SAS4-style reseller threat into a channel.
- **ISP/Starlink resale ecosystems**: operators sharing satellite/ISP links via hotspot are a fast-growing segment — target the communities where that equipment is traded.
- **Mikrotik forum + r/mikrotik** (English long tail): answer the perennial "hotspot without public IP" threads.

## 6. Launch plan

**Phase 0 — prerequisites (gates the campaign, ~parallel with release):**
- [ ] Ship the release (see RELEASE_READINESS.md) — marketing an unpromoted batch means demoing bugs already fixed on `dev`.
- [ ] **Landing page at wa-sel.com** (nothing exists today): Arabic-first, one screen = the 4 differentiators, demo video, pricing, WhatsApp CTA, APK download. Without it every channel dead-ends.
- [ ] **Play Store listing** (currently sideload-only, `pubspec` description still boilerplate): store assets, EN+AR listing, privacy policy, adaptive icon. Until then the APK download link is the CTA — acceptable in this market, but the store listing is a trust signal worth fast-tracking.
- [ ] Set real prices + bank details in prod admin; create the trial tier if adopted.
- [ ] Demo video (60–90s, Arabic, phone-screen recording): script-paste → online → voucher → customer connects → revenue dashboard.

**Phase 1 — soft launch (weeks 1–4):** recruit 10–20 pilot operators via WhatsApp/personal network; free/discounted period in exchange for feedback + testimonials + WhatsApp screenshots; instrument the funnel (register → router online → first voucher sold → paid). Fix onboarding friction found here before spending on reach.

**Phase 2 — public launch (weeks 4–8):** YouTube creator video(s) + Facebook/Telegram value posts + landing page live; "founding operator" offer (e.g. 2 months for 1) to force urgency; publish the template-pack lead magnets.

**Phase 3 — growth (months 2–6):** hardware-shop bundles + technician referral program; case study of the best pilot (numbers: vouchers/month, time saved, zero site visits); expand to neighboring Arabic markets (Libya/Egypt/Yemen) once Sudan playbook repeats — product is already fully bilingual, only currency/bank rails change (per-payment currency already in schema).

## 7. KPIs (PRD §1.4/§10 targets + funnel)

| Metric | Target |
|---|---|
| Active paying subscribers | 100 within 3 months of launch |
| Register → router-online conversion | >60% (measures the onboarding promise) |
| Router-online → first-voucher-sold | >80% same day |
| Trial → paid conversion (if trial ships) | >25% |
| Monthly churn | <5% |
| Voucher creation success | >99% · creation time <1 min |
| App rating | 4.0+ (once on Play Store) |
| Support load | <2 WhatsApp threads per operator per month (watch the support-cost trap) |

## 8. Risks & honest mitigations

- **Free-and-good-enough gravity** (Mikhmon/PHPNuxBill/User Manager + cracked-license culture): sell saved labor and no-lockout reliability, not features; generous entry tier.
- **MikroTik platform risk**: RouterOS v7 User Manager improves; legacy API (TCP 8728) could be deprecated for REST; MikroTik cloud moves could commoditize the tunnel advantage. Mitigation: REST-API migration on the roadmap radar; deepen the business layer (billing, fleet, Arabic) that MikroTik will never build.
- **Cloud dependency in a fragile-infrastructure market**: a VPS outage or national internet disruption takes every customer's hotspot logins down at once — DIY local tools degrade more gracefully. Mitigation: public status page + honest comms; investigate an offline-grace story; keep the monitoring/alerting roadmap item honest before selling reliability.
- **Payment collection friction**: manual verification scales badly; SDG volatility; banking disruptions. Mitigation: keep approval latency <12h as an internal SLO (email alerts now exist); local wallet rails (Bankak-style) on the roadmap.
- **Regional incumbent (SAS4)** and its reseller network: don't fight the resellers — recruit them with commissions.
- **Regulatory gray zone** for voucher resale: monitor; avoid marketing language that promises regulatory cover.
- **Single-market concentration** (Sudan: conflict, currency, infrastructure): the Phase-3 multi-market expansion is the hedge; the product is already architected for it.
