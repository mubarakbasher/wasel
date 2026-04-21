-- 020_router_health.sql
-- Persist the most recent router health-check run on the router row so the
-- mobile UI can render the last known status without re-running all probes.
-- The full structured ProbeResult array is stored as JSONB.

ALTER TABLE routers
  ADD COLUMN last_health_check_at TIMESTAMPTZ,
  ADD COLUMN last_health_report JSONB;
