# Voucher code length setting + printable card templates — design

**Date:** 2026-11-08 · **Status:** approved, in implementation on `dev`
**Mockups reviewed:** https://claude.ai/artifact/1QKJQ1tYfbv5iG1SmuRhTg (ten cards; operators chose B. Detailed and J. Strips)

## Intent

Operators print prepaid Wi‑Fi vouchers from the mobile app. Today every code is a fixed 8 digits
(backend default, the app never sends a length) and there is a single card design drawn by
`_buildCard` in `mobile/lib/services/print_service.dart`. The column slider on the print screen is
the only layout control and its value is forgotten when the screen closes.

Some operators want longer or shorter codes. Different operators want different-looking cards
(shop counters, cheap printers). This feature gives each operator a saved code length and a choice
of three card templates with a few knobs.

## Goals

- One saved **code length** per operator account: default 8, range 6–12, digits only. Every batch
  created after a change uses the new length. Existing vouchers are untouched. Stored on the backend
  so it follows the account to any phone.
- Three **card templates**, one chosen per operator account: **Classic** (today's card, default),
  **Detailed**, **Strips**. The choice applies to every print, including reprints of old batches,
  because cards are drawn at print time from voucher data.
- Per-template **knobs** (header text, show price, footer line, QR, batch number, strips per page)
  and a saved **default column count**, stored with the template on the backend.
- Classic with no saved settings prints exactly as today.

## Non-goals

- Per-router templates. Per-batch code length. Logo upload. Non-digit codes. Admin-panel changes.

## Anti-goals

- Changing any existing voucher's code or RADIUS rows.
- Breaking the "code is the password" rule the captive portal relies on.
- A settings document the backend cannot validate (unknown keys must be rejected).

## Constraints (verified)

- `radcheck`/`radacct`/`voucher_meta` username columns are `VARCHAR(64)`; FreeRADIUS only gates
  the charset. Lengths 6–12 need no RADIUS or DB change. Only backend tests assume 8.
- The generator `allocateVoucherUsernames` already takes a `length` option; its sole caller passes
  none. Collision check (radcheck ∪ radacct) stays global and untouched.
- The app does not know a router's hotspot DNS name, so the QR needs an operator-entered address.
- Mobile PDF generation runs in a `compute` isolate: everything crossing into it is plain data.

## Settings document (backend Zod ↔ mobile model)

```jsonc
{
  "codeLength": 8,            // int 6..12
  "templateId": "classic",    // classic | detailed | strips
  "defaultColumns": 4,        // int 2..9 (Classic, Detailed)
  "knobs": {
    "headerText": "",         // '' = router name           (all)
    "footerText": "",         // Detailed how-to; '' = localized default
    "hotspotAddress": "",     // QR content; '' hides QR     (Detailed)
    "showPrice": false,       // all; off by default = Classic parity
    "showQr": false,          // Detailed
    "showBatch": true,        // Detailed band, Strips row
    "stripsPerPage": 8        // Strips: 4..12
  }
}
```

One flat knobs object so switching templates never loses typed text. `PUT` replaces the whole
document. `.strict()` on both objects. Absent row ⇒ defaults ⇒ today's output.

## Templates

- **Classic** — header = router name (or header text), rule, code, `limit | validity`. Unchanged.
  Optional price line when `showPrice`.
- **Detailed** — black header band (header text at the start, batch label at the end), code,
  `limit | validity`, price pill, dashed-rule footer with the how-to line, QR at the end side when
  `showQr` and `hotspotAddress` is set. QR encodes
  `http://<hotspotAddress>/login?username=<code>&password=<code>`.
- **Strips** — one voucher per full-width row, `stripsPerPage` rows per A4 page instead of columns:
  header + small `limit · validity` | large code | price (+ small batch label).

Batch label is derived on the phone from `Voucher.createdAt` (`yyMMdd-HHmm`), which is uniform
within a batch, so no new API field is needed.

## Decided "how"

- **Storage:** new table `user_print_settings` (1:1 with `users`, typed `code_length` with a CHECK,
  `knobs JSONB`). Not a JSONB column on `users`: the length is read on the voucher-creation hot
  path and `users` is selected by auth on every request.
- **API:** `GET/PUT /api/v1/settings/print` — a new `/settings/` group for operator-level app
  preferences. `authenticate` only.
- **Generator:** `createVouchers` reads the operator's `code_length` (one PK lookup) and passes it
  to `allocateVoucherUsernames`. The app never sends a length.
- **Mobile PDF:** `_buildCard` becomes a template strategy under `mobile/lib/services/print/`;
  Classic's body moves verbatim. Gallery thumbnails render the real template (one-card PDF →
  raster), behind an injectable renderer for tests.
- **Mobile state:** backend-synced `PrintSettings` provider with a local cache so printing works
  offline; optimistic save with rollback. New Settings page "Voucher printing"; the create-voucher
  wizard shows "codes will be N digits" read-only.

## Left to the builder

Exact font sizes for the Detailed band and Strips row (derive from the Classic ramp), the dashed
footer rule implementation in the `pdf` package, debounce timing for saves, thumbnail DPI, and the
wording of the under-8 warning.
