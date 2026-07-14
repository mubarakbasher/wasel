-- 034_plans_name_ar.sql
-- Add an Arabic display name to subscription plans so the mobile UI can show
-- localized plan names in the Arabic locale.
-- NULL means "no Arabic name — fall back to `name` (English)". Admin-editable
-- free text, just like `name`; seeded here for the three standard tiers.

ALTER TABLE plans ADD COLUMN IF NOT EXISTS name_ar VARCHAR(100);

-- Seed the standard tiers, only where not already set, so a later admin edit
-- is never clobbered by a migration re-run.
UPDATE plans SET name_ar = 'المبتدئة'   WHERE tier = 'starter'      AND name_ar IS NULL;
UPDATE plans SET name_ar = 'الاحترافية' WHERE tier = 'professional' AND name_ar IS NULL;
UPDATE plans SET name_ar = 'المؤسسات'   WHERE tier = 'enterprise'   AND name_ar IS NULL;
