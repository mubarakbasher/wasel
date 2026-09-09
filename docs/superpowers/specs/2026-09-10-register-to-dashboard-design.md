# Register → Dashboard: sign in on email verification

**Date:** 2026-09-10 · **Scope:** backend `auth` + mobile auth flow · **Target:** `dev` → staging (`wa-sel.cloud`)

## Problem

A new operator went **Register → enter 6-digit email code → "Please log in" → Login → Dashboard**. The extra login is friction with no purpose: the code already proves ownership of the email, and the app has just collected the password.

Root cause: `POST /auth/verify-email` returned only a message, so the app had no session to store. Meanwhile `POST /auth/register` issued a full JWT pair to a still-unverified account, which the app discarded — wasted work and a latent gap (an API-direct client got full access without verifying, while `login` refuses unverified users).

## Decision

**Keep the email-code step. Make verification the sign-in event.**

- `POST /auth/verify-email` returns the same body as a non-admin login: `{ user: {id,name,email,role}, accessToken, refreshToken }`. Suspended accounts (`is_active = false`) are refused with 403 `ACCOUNT_SUSPENDED` before any token is issued; `OTP_INVALID` / `OTP_LOCKED` / `ALREADY_VERIFIED` / `USER_NOT_FOUND` behave as before.
- `POST /auth/register` no longer issues tokens: 201 `{ user }`.
- Mobile `AuthNotifier.verifyEmail()` persists the pair and flips `isAuthenticated` through the same `_completeSignIn()` helper `login()` uses; the verify screen shows a welcome snackbar and `context.go('/dashboard')`.

Resulting flows:

| Path | Flow |
|---|---|
| New user | Register → verify screen → code accepted → Dashboard (signed in, survives relaunch) |
| Returning unverified user | Login → 403 `EMAIL_NOT_VERIFIED` → OTP resent → verify screen → code accepted → Dashboard |
| Verified user | Login → Dashboard (unchanged) |

## Alternatives rejected

- **Mobile-only: hold the register tokens until the code is accepted.** Breaks the login-path variant (login refuses unverified users, so there are no tokens) and keeps the unverified-token gap.
- **Silently re-call `login` with the remembered password.** Carries the password across screens; fragile.
- **Skip the code entirely.** Would require reworking the unverified-login refusal and the 72 h purge job, and would drop the proof of email ownership that password reset and payment emails rely on. Explicitly declined by the owner.

## Security

`verify-email` becomes credential-issuing: inbox + live OTP → session without the password. The pre-merge security audit showed the existing OTP protections were not enough once a guess buys a session: the 5-wrong-codes lock reset its own counter, and the unauthenticated `resend-verification` handed out a fresh code with a fresh budget, so an attacker rotating IPs past the per-IP `authLimiter` could brute-force a 6-digit code at roughly 1.3 % per day per IP. Hardening shipped with this change:

- **Durable lock** — the 5th wrong code burns the OTP and sets a 15-minute `otp-lock` key; verification and resends both return 429 `OTP_LOCKED` until it expires. Applies to all three OTP flows (verify, password reset, email change).
- **Atomic validation** — lock check, code read, compare and attempt count run in one Redis Lua script, so a burst of concurrent guesses cannot all be compared against the live code before the count arms the lock. Guesses against a flow with no live code are not counted, so an attacker cannot pre-lock someone's verification or password reset.
- **Per-email resend cap** — 5 resends per fixed one-hour window per email, enforced before any DB lookup so unknown and known emails behave identically (429 `EMAIL_RATE_LIMIT_EXCEEDED`). Keyed on the email on purpose: keying on IP would let IP rotation turn resends into mail bombing. Accepted trade-off: someone who knows an email can exhaust its resend budget for the rest of that hour; the first code from `register` is unaffected.
- **Atomic issuance predicate** — the verify UPDATE requires `is_verified = FALSE AND is_active = TRUE AND role = 'user'`, so a mid-request suspension or an admin-role row can never receive a pair.
- Constant-time OTP comparison; resend logging by user id rather than raw email.

Worst case after hardening: 4 codes per hour × 5 guesses = 20 guesses per hour per account, about 0.16 % over the 72 h life of an unverified account, at the cost of roughly 1,400 requests and 360 emails to the victim. The same send cap guards `forgot-password` and `change-email`. Removing tokens from `register` narrows the overall surface. Deploy invariant: standalone Redis only (the validate script uses three un-tagged keys). Follow-ups not in this change: a "new sign-in" notification email, request id / IP in auth service logs, and the pre-existing 404-on-unknown-email enumeration of `verify-email`.

## Out of scope

Skipping the OTP, a "verify later" banner, first-run onboarding for an empty Dashboard, the enumeration gap, production promotion.

## Verification

- Backend: `npm run lint && npm test` (new verify-email happy-path, suspended, wrong-code, already-verified, unknown-email cases; register asserts no tokens).
- Mobile: `flutter analyze && flutter test` (new `AuthNotifier.verifyEmail` sign-in tests + a `login()` persistence test guarding the shared helper).
- Staging E2E: `docs/STAGING.md` §11.1.
