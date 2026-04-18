-- radacct-archive.sql
-- Move radacct rows older than 90 days into radacct_archive to keep the
-- hot table small. Run monthly via cron (see deploy.md crontab entry).
-- Safe to re-run: CREATE TABLE IF NOT EXISTS + idempotent DELETE/INSERT.

CREATE TABLE IF NOT EXISTS radacct_archive (LIKE radacct INCLUDING ALL);

WITH moved AS (
  DELETE FROM radacct
    WHERE acctstarttime < NOW() - INTERVAL '90 days'
    RETURNING *
)
INSERT INTO radacct_archive SELECT * FROM moved;
