-- Migration: 010_voucher_wizard
-- Description: Add limit/validity/price columns to voucher_meta for the new
--              profile-less voucher creation wizard.

ALTER TABLE voucher_meta
  ADD COLUMN IF NOT EXISTS limit_type VARCHAR(10) CHECK (limit_type IN ('time', 'data')),
  ADD COLUMN IF NOT EXISTS limit_value BIGINT,
  ADD COLUMN IF NOT EXISTS limit_unit VARCHAR(10),
  ADD COLUMN IF NOT EXISTS validity_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS price DECIMAL(10,2);

-- Make group_profile nullable (new vouchers won't use profiles)
ALTER TABLE voucher_meta
  ALTER COLUMN group_profile DROP NOT NULL;
