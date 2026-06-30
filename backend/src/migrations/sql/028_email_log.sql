-- 028_email_log.sql
-- Write-only audit log for every email send attempt (success and failure).
-- Modelled on audit_logs in 003_application_tables.sql: intentionally
-- append-only, no updated_at column, no trigger.
--
-- user_id is nullable (NULL for admin-alert sends or test sends where there is
-- no specific operator in context) and uses ON DELETE SET NULL so the log row
-- survives a user purge and preserves the historical record.
--
-- subject is stored so the log is human-readable without joining to
-- email_templates; full body_html is never stored here (PII / size concern).

CREATE TABLE IF NOT EXISTS email_log (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID         REFERENCES users(id) ON DELETE SET NULL,
    recipient   VARCHAR(255) NOT NULL,
    type        VARCHAR(64)  NOT NULL,
    language    VARCHAR(5)   NOT NULL,
    subject     VARCHAR(255) NOT NULL,
    status      VARCHAR(20)  NOT NULL DEFAULT 'sent',
    error       TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Idempotent status CHECK: drop + re-add so re-runs never error on the
-- constraint already existing (mirrors the pattern in 025_user_language.sql
-- and 026_router_hotspot_template.sql).
ALTER TABLE email_log DROP CONSTRAINT IF EXISTS email_log_status_check;
ALTER TABLE email_log ADD CONSTRAINT email_log_status_check
    CHECK (status IN ('sent', 'failed'));

-- Hot-path indexes ──────────────────────────────────────────────────────────
-- created_at DESC: recent-first log queries (admin monitoring dashboard)
CREATE INDEX IF NOT EXISTS idx_email_log_created   ON email_log(created_at DESC);
-- type: filter by template type (e.g. count verification_otp failures)
CREATE INDEX IF NOT EXISTS idx_email_log_type      ON email_log(type);
-- status: fast "show only failed sends" queries
CREATE INDEX IF NOT EXISTS idx_email_log_status    ON email_log(status);
-- recipient: look up all emails sent to a given address (GDPR export / debug)
CREATE INDEX IF NOT EXISTS idx_email_log_recipient ON email_log(recipient);
