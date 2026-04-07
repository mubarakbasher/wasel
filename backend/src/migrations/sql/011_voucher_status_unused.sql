-- Migration: 011_voucher_status_unused
-- Description: Add 'unused' to voucher_meta status constraint and change default

-- Drop the existing CHECK constraint on status
ALTER TABLE voucher_meta DROP CONSTRAINT IF EXISTS voucher_meta_status_check;

-- Add updated constraint including 'unused'
ALTER TABLE voucher_meta ADD CONSTRAINT voucher_meta_status_check
  CHECK (status IN ('unused', 'active', 'disabled', 'expired', 'used'));

-- Change default from 'active' to 'unused'
ALTER TABLE voucher_meta ALTER COLUMN status SET DEFAULT 'unused';

-- Fix existing vouchers that were incorrectly created as 'active'
-- (the dynamic status computation will override at read time, but this keeps DB consistent)
UPDATE voucher_meta SET status = 'unused' WHERE status = 'active';
