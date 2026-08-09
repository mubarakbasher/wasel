# Voucher batch re-print — design

**Date:** 2026-08-10 · **Status:** approved, in implementation

## Problem

Operators create voucher batches up to 3000. If the create-success dialog is dismissed without printing, the batch can't be reliably re-printed: "Print all" returned ~500 per batch (1000 with two batches) and the list/select mode never loaded past ~100 per batch.

## Root causes (both in `backend/src/services/voucher.service.ts`, `getVouchersByRouter`)

1. **Keyset-cursor microsecond truncation.** A batch is one multi-row INSERT, so every row shares one microsecond-precision `created_at`. The pagination cursor was built with `new Date(created_at).toISOString()` — JS `Date` truncates to milliseconds — so the keyset predicate `created_at < $cur OR (created_at = $cur AND id < $id)` matched none of the remaining same-timestamp rows. Every traversal returned at most one page per creation batch.
2. **Cursor-mode COUNT included the cursor predicate**, so `meta.total` shrank page by page; the mobile app overwrites its total from every page, which hid the Print-All button (gated on `total > 0`).

## Design

- **Wire format** for both cursors and batch keys: µs-precision UTC text produced in SQL by `to_char(vm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, bound back via `::timestamptz` (round-trips exactly). Cursor payload shape `{createdAt, id}` unchanged; legacy millisecond cursors still decode (no 422) with a one-time within-batch skip for in-flight sessions.
- **A batch is its `created_at`** — no schema change, no batch_id column. Byte-identical within a batch, distinct across batches, and retroactive for all existing vouchers. Served by the existing `idx_voucher_meta_router_keyset (router_id, created_at DESC, id DESC)` index (migration 036).
- **New endpoint** `GET /routers/:id/vouchers/batches?limit=1..200` → creation groups newest-first: `batchKey`, `createdAt`, `count`, batch-uniform `limitType/limitValue/limitUnit/validitySeconds/price`. No per-status breakdown (derived status runs correlated radcheck/radacct subqueries per voucher — too expensive over all router vouchers; status detail is one tap away via the batch filter + status chips).
- **List endpoint** gains optional `batch=<batchKey>` (exact `created_at` equality), composing with status/limitType/search and both pagination modes; the bulk-delete filter accepts it too.
- **Mobile:** a Batch filter chip on the voucher list (bottom-sheet picker; Print All / select / delete-all then scope to the batch) and a Creation-history screen (app-bar history icon) listing batches with a per-row Print that fetches the full batch and opens the existing print preview.
- **Robustness:** the paged print-all fetch gets a 60 s per-page receive timeout (global Dio default of 15 s aborted large enriched pages); PDF document build moves off the UI isolate via `compute()` with font bytes loaded on the main isolate (3000 vouchers ≈ 84 A4 pages).
