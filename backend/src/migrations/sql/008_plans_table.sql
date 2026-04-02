-- 008_plans_table.sql
-- Move subscription plan definitions from hardcoded constants to a database table.

CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tier VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    max_routers INTEGER NOT NULL,
    monthly_vouchers INTEGER NOT NULL,  -- -1 = unlimited
    session_monitoring VARCHAR(100),
    dashboard VARCHAR(100),
    features JSONB NOT NULL DEFAULT '[]',
    allowed_durations JSONB NOT NULL DEFAULT '[1]',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the three existing plans
INSERT INTO plans (tier, name, price, currency, max_routers, monthly_vouchers, session_monitoring, dashboard, features, allowed_durations)
VALUES
  ('starter', 'Starter', 5, 'USD', 1, 500, 'Active only', 'Basic stats',
   '["1 Router","500 Vouchers/month","Active session monitoring","Basic dashboard"]', '[1]'),
  ('professional', 'Professional', 12, 'USD', 3, 2000, 'Active + history', 'Advanced analytics',
   '["3 Routers","2,000 Vouchers/month","Session history","Advanced analytics"]', '[1,2]'),
  ('enterprise', 'Enterprise', 25, 'USD', 10, -1, 'Full + export', 'Full analytics + reports',
   '["10 Routers","Unlimited Vouchers","Full session history + export","Full analytics + reports"]', '[1,2,6]')
ON CONFLICT (tier) DO NOTHING;

-- Remove hardcoded CHECK constraints on plan_tier so new plans can be added dynamically
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_tier_check;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_plan_tier_check;

-- Auto-update updated_at
CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
