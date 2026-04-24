ALTER TABLE routers
  DROP COLUMN IF EXISTS last_provision_status,
  DROP COLUMN IF EXISTS last_provision_error,
  DROP COLUMN IF EXISTS last_provision_at,
  DROP COLUMN IF EXISTS provision_applied_at,
  DROP COLUMN IF EXISTS needs_hotspot_confirmation,
  DROP COLUMN IF EXISTS suggested_hotspot_interface;
