-- 023_voucher_nas_scope_rollback.sql
--
-- Undo migration 022's NAS-IP-Address scope backfill, and remove any
-- NAS-IP-Address == rows written by voucher.service.ts:insertRadiusEntriesV2
-- before that insert was removed.
--
-- Per RFC 2865 §5.4, the NAS-IP-Address attribute is the NAS-self-reported
-- identity, not the IP-layer source of the packet. FreeRADIUS compares the
-- radcheck 'NAS-IP-Address == X' value against the Access-Request AVP, which
-- RouterOS fills with "IP address of the router itself" (per MikroTik docs) —
-- typically the router's LAN IP, not the WireGuard peer IP stored in
-- routers.tunnel_ip. On a WG-tunnel-only topology this comparison cannot
-- succeed, so every scoped voucher rejects with "no Auth-Type found"
-- regardless of how many times FR is restarted.
--
-- The DELETE predicate is tight (NAS-IP-Address == on voucher_meta usernames
-- only) so it cannot touch any other RADIUS data and is safe to re-run.

DELETE FROM radcheck rc
 USING voucher_meta vm
 WHERE rc.username = vm.radius_username
   AND rc.attribute = 'NAS-IP-Address'
   AND rc.op = '==';
