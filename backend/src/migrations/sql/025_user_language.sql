-- 025_user_language.sql
-- Add language preference to users so the backend can generate push-notification
-- text in the user's chosen language (default English; Arabic supported).

ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(5) NOT NULL DEFAULT 'en';

-- Drop then re-add so the constraint is idempotent on re-runs
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_language_check;
ALTER TABLE users ADD CONSTRAINT users_language_check
  CHECK (language IN ('en', 'ar'));
