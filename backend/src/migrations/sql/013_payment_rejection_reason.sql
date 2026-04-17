-- Migration: 013_payment_rejection_reason
-- Description: Add rejection_reason column to payments and widen status CHECK to include 'cancelled'
-- Date: 2026-04-17

-- Add rejection_reason column (nullable; set only when a payment is rejected)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Allow 'cancelled' status so users can abandon a rejected/pending payment
-- and start a fresh plan selection without leaving orphaned rows.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));
