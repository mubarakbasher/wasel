-- Migration: 036_keyset_pagination_indexes
-- Description: Composite B-tree indexes to support efficient keyset (cursor)
--   pagination on the four mobile list endpoints.  ORDER BY clauses are
--   replicated exactly so the planner can perform an index scan without a sort.
-- Date: 2026-07-18

-- vouchers: GET /routers/:id/vouchers  (ORDER BY created_at DESC, id DESC)
-- Covers the leading router_id equality filter + the two-column keyset scan.
CREATE INDEX IF NOT EXISTS idx_voucher_meta_router_keyset
    ON voucher_meta (router_id, created_at DESC, id DESC);

-- notifications: GET /notifications  (ORDER BY created_at DESC, id DESC)
CREATE INDEX IF NOT EXISTS idx_notifications_user_keyset
    ON notifications (user_id, created_at DESC, id DESC);

-- support messages: GET /support/messages  (ORDER BY created_at DESC, id DESC)
CREATE INDEX IF NOT EXISTS idx_support_messages_user_keyset
    ON support_messages (user_id, created_at DESC, id DESC);

-- radacct session history: GET /routers/:id/sessions/history
--   (ORDER BY acctstarttime DESC, radacctid DESC)
-- The existing radacct_acctstarttime_idx (single-column) is not a covering
-- index for the keyset condition; this composite index is needed.
-- We do NOT modify the FreeRADIUS-owned radacct schema — index-only.
CREATE INDEX IF NOT EXISTS idx_radacct_nasip_keyset
    ON radacct (nasipaddress, acctstarttime DESC, radacctid DESC);
