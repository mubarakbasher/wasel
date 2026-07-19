-- Migration: 037_mikrotik_total_limit_backfill
-- Description: Backfill Mikrotik-Total-Limit (and Mikrotik-Total-Limit-Gigawords
--   for >4 GB limits) radreply rows for existing active data vouchers.
--   Without this, only newly-created vouchers receive the router-enforced byte
--   ceiling reply attribute; existing vouchers would only be covered by the CoA
--   backstop job until they are re-provisioned.
--   Both INSERTs are guarded by NOT EXISTS so running the migration more than
--   once is safe (idempotent).
-- Date: 2026-07-19

-- limit_value is BIGINT (migration 010), so % and / use integer arithmetic.

INSERT INTO radreply (username, attribute, op, value)
SELECT vm.radius_username,
       'Mikrotik-Total-Limit',
       ':=',
       (vm.limit_value % 4294967296)::text
FROM voucher_meta vm
WHERE vm.limit_type = 'data'
  AND vm.limit_value IS NOT NULL
  AND vm.limit_value >= 0
  AND vm.status NOT IN ('expired', 'disabled')
  AND NOT EXISTS (
    SELECT 1 FROM radreply r
    WHERE r.username = vm.radius_username
      AND r.attribute = 'Mikrotik-Total-Limit'
  );

INSERT INTO radreply (username, attribute, op, value)
SELECT vm.radius_username,
       'Mikrotik-Total-Limit-Gigawords',
       ':=',
       (vm.limit_value / 4294967296)::text
FROM voucher_meta vm
WHERE vm.limit_type = 'data'
  AND vm.limit_value IS NOT NULL
  AND vm.limit_value >= 0
  AND vm.limit_value >= 4294967296
  AND vm.status NOT IN ('expired', 'disabled')
  AND NOT EXISTS (
    SELECT 1 FROM radreply r
    WHERE r.username = vm.radius_username
      AND r.attribute = 'Mikrotik-Total-Limit-Gigawords'
  );
