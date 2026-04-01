-- 007_subscription_tiers.sql
-- Epic 15: Professional & Enterprise Tiers
-- Adds multi-month duration tracking, upgrade/downgrade support

-- Track subscription duration in months
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS duration_months INTEGER NOT NULL DEFAULT 1;

-- Link upgrade/downgrade to the subscription being replaced
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS previous_subscription_id UUID REFERENCES subscriptions(id);

-- Allow 'pending_change' status for upgrade/downgrade requests
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('pending', 'active', 'expired', 'cancelled', 'pending_change'));
