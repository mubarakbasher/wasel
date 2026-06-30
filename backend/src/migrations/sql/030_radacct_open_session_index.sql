-- 030_radacct_open_session_index.sql
-- Partial index to make the stale-session reaper cron cheap on large radacct
-- tables.  The reaper queries open accounting rows (acctstoptime IS NULL) and
-- orders/filters by their last interim-update time:
--
--   WHERE acctstoptime IS NULL
--     AND COALESCE(acctupdatetime, acctstarttime) < NOW() - INTERVAL '15 minutes'
--
-- Without a partial index this is a full sequential scan; at >500 k rows that
-- stalls the cron.  Filtering on acctstoptime IS NULL in the WHERE clause of
-- the index definition means the index only covers open sessions, keeping it
-- small and fast to maintain on every Accounting-Stop write.
--
-- Existing indexes from 002_freeradius_tables.sql and 017_performance_indices.sql
-- cover (username, acctstoptime) and full-column acctstoptime but none target
-- acctupdatetime on open rows specifically — no duplication.

CREATE INDEX IF NOT EXISTS idx_radacct_open_acctupdatetime
    ON radacct (acctupdatetime)
    WHERE acctstoptime IS NULL;
