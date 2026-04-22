-- 021_router_provision_status.sql
-- Track auto-provisioning state on each router row so the mobile UI can
-- render step-level progress without polling a separate endpoint.

ALTER TABLE routers
  ADD COLUMN last_provision_status      TEXT
    CHECK (last_provision_status IN ('pending','in_progress','succeeded','partial','failed')),
  ADD COLUMN last_provision_error       JSONB,
  ADD COLUMN last_provision_at          TIMESTAMPTZ,
  ADD COLUMN provision_applied_at       TIMESTAMPTZ,
  ADD COLUMN needs_hotspot_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN suggested_hotspot_interface TEXT;
