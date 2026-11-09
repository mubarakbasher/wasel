-- 043_user_print_settings.sql
-- Per-operator voucher print settings: code length, card template, layout knobs.
-- Mirrors notification_preferences as a 1:1 row keyed by user_id.
-- Absent row means all defaults (Classic template, 8-digit codes, 4 columns).

CREATE TABLE IF NOT EXISTS user_print_settings (
    user_id         UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code_length     SMALLINT    NOT NULL DEFAULT 8,
    template_id     VARCHAR(16) NOT NULL DEFAULT 'classic',
    default_columns SMALLINT    NOT NULL DEFAULT 4,
    knobs           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drop then re-add so the constraints are idempotent on re-runs
ALTER TABLE user_print_settings DROP CONSTRAINT IF EXISTS user_print_settings_code_length_check;
ALTER TABLE user_print_settings ADD CONSTRAINT user_print_settings_code_length_check
    CHECK (code_length BETWEEN 6 AND 12);

ALTER TABLE user_print_settings DROP CONSTRAINT IF EXISTS user_print_settings_default_columns_check;
ALTER TABLE user_print_settings ADD CONSTRAINT user_print_settings_default_columns_check
    CHECK (default_columns BETWEEN 2 AND 9);

ALTER TABLE user_print_settings DROP CONSTRAINT IF EXISTS user_print_settings_template_id_check;
ALTER TABLE user_print_settings ADD CONSTRAINT user_print_settings_template_id_check
    CHECK (template_id IN ('classic', 'detailed', 'strips'));

CREATE OR REPLACE TRIGGER trg_user_print_settings_updated_at
    BEFORE UPDATE ON user_print_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
