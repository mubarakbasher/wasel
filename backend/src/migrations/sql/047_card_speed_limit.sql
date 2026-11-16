-- 047_card_speed_limit.sql
-- Per-operator speed-limit toggle and default speed, stored on user_print_settings
-- because createVouchers already reads that row for code_length — one query covers both.
-- The allowed option list (256k, 512k, 1M, …, 10M) is intentionally NOT in the CHECK;
-- the application enforces the enum, and the CHECK only rejects obviously malformed values
-- so adding an option needs no migration.
-- voucher_meta.speed_limit is nullable with no CHECK — the column is catalog-only on a
-- multi-million-row table; NULL means "the card has no speed cap" (created with the limit
-- off, or before this feature was deployed — existing cards are never back-filled).
--
-- DEPLOY WINDOW: do NOT deploy between 01:15 and 01:45 UTC (pg_dump window).
-- The ALTER TABLE voucher_meta below takes ACCESS EXCLUSIVE. lock_timeout = 3s means the
-- migration aborts rather than queuing behind a long reader (FR reject lookups, the
-- enforcement jobs, or pg_dump). Re-run after the blocker clears.

-- Fail fast rather than queuing behind a long reader.
SET LOCAL lock_timeout = '3s';

ALTER TABLE user_print_settings ADD COLUMN IF NOT EXISTS speed_limit_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_print_settings ADD COLUMN IF NOT EXISTS speed_limit VARCHAR(8) NOT NULL DEFAULT '2M';

ALTER TABLE user_print_settings DROP CONSTRAINT IF EXISTS user_print_settings_speed_limit_check;
ALTER TABLE user_print_settings ADD CONSTRAINT user_print_settings_speed_limit_check
    CHECK (speed_limit ~ '^[1-9][0-9]{0,3}[kM]$');

-- Nullable, no default, no CHECK: catalog-only on a multi-million-row table.
ALTER TABLE voucher_meta ADD COLUMN IF NOT EXISTS speed_limit VARCHAR(8);
