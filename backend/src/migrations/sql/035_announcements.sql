-- Migration: 035_announcements
-- Description: Admin-authored broadcast announcements (bilingual) pushed to
--   users, with delivery-count bookkeeping for the push fan-out job.
-- Date: 2026-07-16

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title_en VARCHAR(200) NOT NULL,
  body_en TEXT NOT NULL,
  title_ar VARCHAR(200) NOT NULL,
  body_ar TEXT NOT NULL,
  audience VARCHAR(32) NOT NULL DEFAULT 'all_active',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  push_success_count INTEGER,
  push_failure_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at DESC);
