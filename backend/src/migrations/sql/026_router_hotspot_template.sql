-- 026_router_hotspot_template.sql
-- Track which captive-portal login-page template an operator has selected for a
-- router and record the outcome of the last apply attempt (pending / applied /
-- failed).  All columns are nullable: NULL hotspot_template_id means the router
-- keeps its existing/default page with no Wasel theme applied.

ALTER TABLE routers ADD COLUMN IF NOT EXISTS hotspot_template_id      VARCHAR(40);
ALTER TABLE routers ADD COLUMN IF NOT EXISTS hotspot_template_status   VARCHAR(20);
ALTER TABLE routers ADD COLUMN IF NOT EXISTS hotspot_template_applied_at TIMESTAMPTZ;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS hotspot_template_error    TEXT;

-- Drop then re-add so the constraint is idempotent on re-runs
ALTER TABLE routers DROP CONSTRAINT IF EXISTS routers_hotspot_template_status_check;
ALTER TABLE routers ADD CONSTRAINT routers_hotspot_template_status_check
  CHECK (hotspot_template_status IN ('pending', 'applied', 'failed'));
