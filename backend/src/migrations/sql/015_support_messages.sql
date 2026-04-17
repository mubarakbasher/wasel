-- Migration: 015_support_messages
-- Description: Threaded conversation between each user and admin support.
-- Date: 2026-04-17

CREATE TABLE IF NOT EXISTS support_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender VARCHAR(10) NOT NULL CHECK (sender IN ('user', 'admin')),
    admin_id UUID REFERENCES users(id),
    body TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_user_created
    ON support_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_user_unread
    ON support_messages(user_id) WHERE read_at IS NULL;
