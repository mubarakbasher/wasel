-- 040_router_hotspot_template_error_code.sql
-- Add a machine-readable error code column alongside hotspot_template_error so
-- mobile clients can localise the failure message without parsing English strings.

ALTER TABLE routers ADD COLUMN IF NOT EXISTS hotspot_template_error_code VARCHAR(64);
