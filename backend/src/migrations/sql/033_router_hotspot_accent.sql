-- 033_router_hotspot_accent.sql
-- Store the operator-chosen hotspot login-page accent color for a router.
-- NULL means "use the template's built-in default accent" — no color is forced.
-- The Zod layer validates against the same list; pinning the CHECK to the
-- curated presets (not just a hex-format regex) keeps defence-in-depth if a
-- future write path bypasses the API. Adding a preset later = new migration
-- that drops/re-adds this constraint (it is written to be idempotent).

ALTER TABLE routers ADD COLUMN IF NOT EXISTS hotspot_accent_color VARCHAR(7);

-- Drop then re-add so the constraint is idempotent on re-runs
ALTER TABLE routers DROP CONSTRAINT IF EXISTS routers_hotspot_accent_color_check;
ALTER TABLE routers ADD CONSTRAINT routers_hotspot_accent_color_check
  CHECK (hotspot_accent_color IS NULL OR hotspot_accent_color IN (
    '#0f766e', '#4f46e5', '#1d4ed8', '#047857',
    '#be123c', '#c2410c', '#7c3aed', '#334155'
  ));
