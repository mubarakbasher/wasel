-- 031_radcheck_simultaneous_use_backfill.sql
-- Raise the per-voucher concurrent-session limit from 1 to 20 for all existing
-- vouchers (RADIUS users) in radcheck.
--
-- Why 20?
-- Modern phones rotate their Wi-Fi MAC address per network (MAC randomisation).
-- When a device reconnects with a new MAC the router sends a fresh
-- Accounting-Start; if the previous accounting session has not yet been closed
-- by a Stop packet (e.g. the device roamed or lost power abruptly) FreeRADIUS
-- sees two open sessions for the same username.  With Simultaneous-Use = 1 the
-- second Access-Request is rejected with "Maximum logins N exceeded", locking
-- the user out until the stale session is reaped.
--
-- Setting the limit to 20 gives enough headroom for several MAC-rotation cycles
-- while migration 030's partial index enables the stale-session reaper cron to
-- close lingering open radacct rows quickly.  New vouchers will be created with
-- value = '20' directly from voucher.service.ts (handled separately).
--
-- This UPDATE is idempotent: rows already at '20' are unaffected by the WHERE
-- clause, so re-running the migration on a partially-applied database is safe.

UPDATE radcheck
SET    value = '20'
WHERE  attribute = 'Simultaneous-Use'
  AND  value = '1';

-- The UPDATE above preserves operator overrides (only raises rows already at '1'
-- to '20'; rows already at a custom value are untouched).
-- The INSERT below covers vouchers that are MISSING the Simultaneous-Use attribute
-- entirely (e.g. created before it was introduced).
INSERT INTO radcheck (username, attribute, op, value)
SELECT vm.radius_username, 'Simultaneous-Use', ':=', '20'
FROM voucher_meta vm
WHERE NOT EXISTS (
  SELECT 1 FROM radcheck rc
  WHERE rc.username = vm.radius_username AND rc.attribute = 'Simultaneous-Use'
);
