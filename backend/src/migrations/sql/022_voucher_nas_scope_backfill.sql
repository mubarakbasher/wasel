-- 022_voucher_nas_scope_backfill.sql
--
-- Backfill the NAS-IP-Address check attribute onto existing UNUSED vouchers
-- so they match the new behavior from voucher.service.ts#insertRadiusEntriesV2
-- (vouchers are now scoped to their home router).
--
-- ACTIVE and USED vouchers are deliberately left alone: retroactively scoping
-- a voucher that's already in flight could reject an in-progress session or
-- invalidate usage the operator has already sold. The new attribute only
-- applies to vouchers created AFTER this migration runs, plus UNUSED ones
-- which haven't been handed out yet.

INSERT INTO radcheck (username, attribute, op, value)
SELECT vm.radius_username,
       'NAS-IP-Address',
       '==',
       r.tunnel_ip
  FROM voucher_meta vm
  JOIN routers r ON r.id = vm.router_id
 WHERE vm.status = 'unused'
   AND r.tunnel_ip IS NOT NULL
   -- Skip vouchers that already have the row (safe to re-run migration).
   AND NOT EXISTS (
     SELECT 1 FROM radcheck rc
      WHERE rc.username = vm.radius_username
        AND rc.attribute = 'NAS-IP-Address'
   )
   -- Safety: only touch vouchers that actually have a radcheck row (i.e.
   -- were successfully created; skip half-inserted rows from old bugs).
   AND EXISTS (
     SELECT 1 FROM radcheck rc
      WHERE rc.username = vm.radius_username
        AND rc.attribute = 'Cleartext-Password'
   );
