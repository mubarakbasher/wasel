-- 029_metrics_daily.sql
-- Once-per-day platform-wide snapshot table that backs the admin-dashboard
-- trends feature.  Keyed by date so the daily cron can UPSERT idempotently
-- via INSERT … ON CONFLICT (snapshot_date) DO UPDATE.
-- Modelled on audit_log / email_log: append-only, no updated_at, no trigger.

CREATE TABLE IF NOT EXISTS metrics_daily (
    snapshot_date        DATE          PRIMARY KEY,
    total_users          INTEGER       NOT NULL DEFAULT 0,
    active_subscriptions INTEGER       NOT NULL DEFAULT 0,
    total_vouchers       INTEGER       NOT NULL DEFAULT 0,
    total_revenue        NUMERIC(12,2) NOT NULL DEFAULT 0,
    routers_online       INTEGER       NOT NULL DEFAULT 0,
    routers_offline      INTEGER       NOT NULL DEFAULT 0,
    routers_degraded     INTEGER       NOT NULL DEFAULT 0,
    pending_payments     INTEGER       NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
