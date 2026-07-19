-- Migration 038: Remove Max-Total-Octets / Max-Total-Octets-Gigawords from check tables
--
-- Background: commit a5882bc moved data-limit enforcement to the router side via
-- the Mikrotik-Total-Limit (+ Gigawords) radreply attribute and retired the
-- FreeRADIUS max_total_octets sqlcounter.  The sqlcounter was the only thing
-- that auto-registered the "Max-Total-Octets" attribute name in FreeRADIUS.
-- Without it, any radcheck or radgroupcheck row carrying that attribute causes
-- the rlm_sql authorize step to abort with:
--   Auth: Login incorrect (sql: Failed to create the pair: Unknown name "Max-Total-Octets")
-- making ALL data-limited vouchers fail authentication.
--
-- Fix: purge those rows from both check tables.  Byte-cap enforcement is now
-- exclusively handled by:
--   1. Mikrotik-Total-Limit (+ Gigawords) in radreply / radgroupreply (router enforces live)
--   2. usageLimitEnforcement cron + dataUsageCoaDisconnect CoA (backend enforces on accounting)
--
-- Note: existing profiles that carried Max-Total-Octets in radgroupcheck do NOT
-- get a Mikrotik-Total-Limit backfill here — re-saving the profile via the API
-- re-applies all RADIUS attributes with the corrected logic.  This is a known
-- follow-up: operators with data-capped group profiles should resave them once
-- after this migration runs.

DELETE FROM radcheck
  WHERE attribute IN ('Max-Total-Octets', 'Max-Total-Octets-Gigawords');

DELETE FROM radgroupcheck
  WHERE attribute IN ('Max-Total-Octets', 'Max-Total-Octets-Gigawords');
