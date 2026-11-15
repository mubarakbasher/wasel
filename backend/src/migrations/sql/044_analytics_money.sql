-- 044_analytics_money.sql
-- Income ledger: immutable record of approved payments, survives operator deletion.
-- operator_activity: last-seen timestamp for operator logins (token refresh granularity ~15 min).
-- No foreign keys — history must outlive the rows it references.

CREATE TABLE IF NOT EXISTS income_ledger (
  payment_id             UUID          PRIMARY KEY,
  user_id                UUID          NOT NULL,
  operator_name          VARCHAR(100),
  operator_email         VARCHAR(255),
  subscription_id        UUID,
  replaces_subscription_id UUID,
  plan_tier              VARCHAR(50)   NOT NULL,
  plan_name              VARCHAR(100),
  duration_months        INTEGER,
  amount                 NUMERIC(12,2) NOT NULL,
  kind                   VARCHAR(12)   NOT NULL CHECK (kind IN ('new','renewal','plan_change')),
  approved_at            TIMESTAMPTZ   NOT NULL,
  period_end             TIMESTAMPTZ,
  source                 VARCHAR(10)   NOT NULL DEFAULT 'live'
);
CREATE INDEX IF NOT EXISTS idx_income_ledger_approved ON income_ledger (approved_at);
CREATE INDEX IF NOT EXISTS idx_income_ledger_user ON income_ledger (user_id, approved_at);

CREATE TABLE IF NOT EXISTS operator_activity (
  user_id        UUID        PRIMARY KEY,
  last_active_at TIMESTAMPTZ NOT NULL
);
