-- Performance indices to reduce full-table scans on hot query paths.
-- All created with IF NOT EXISTS so re-running is idempotent.

CREATE INDEX IF NOT EXISTS idx_voucher_meta_user_router ON voucher_meta(user_id, router_id);
CREATE INDEX IF NOT EXISTS idx_radcheck_username        ON radcheck(username);
CREATE INDEX IF NOT EXISTS idx_radacct_user_stop        ON radacct(username, acctstoptime);
