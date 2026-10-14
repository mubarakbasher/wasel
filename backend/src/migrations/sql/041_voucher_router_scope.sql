-- 041_voucher_router_scope.sql
--
-- WHY: Vouchers must only authenticate on their home router. Without a
-- per-voucher router constraint, a voucher created for router A can be used
-- on any MikroTik in the system that talks to this FreeRADIUS instance,
-- because radcheck only verifies the password, not which NAS sent the request.
--
-- WHY 022/023 FAILED: Migration 022 added a `NAS-IP-Address == <tunnel_ip>`
-- row per voucher. Per RFC 2865 §5.4, NAS-IP-Address is the NAS-self-reported
-- identity AVP inside the Access-Request packet; RouterOS fills it with the
-- router's own LAN IP, not its WireGuard peer IP. Because routers.tunnel_ip
-- stores the WireGuard peer IP, the comparison could never succeed, causing
-- every scoped voucher to fail with "no Auth-Type found". Migration 023
-- deleted all those rows, leaving vouchers un-scoped again.
--
-- WHY Packet-Src-IP-Address WORKS:
--   1. FreeRADIUS 3.2.x rlm_expr/paircmp.c registers Packet-Src-IP-Address
--      with genericcmp(), which compares the check value against the actual
--      UDP source IP of the incoming Access-Request — the IP-layer address,
--      not an AVP inside the packet.
--   2. Every router connects via WireGuard. The dynamic-client loader selects
--      the NAS secret by `nas.nasname = Packet-Src-IP-Address`, and nasname is
--      inserted as routers.tunnel_ip. So the source IP always equals tunnel_ip.
--   3. WireGuard AllowedIPs is configured as <tunnel_ip>/32, making the source
--      IP cryptographically unforgeable — a rogue device cannot spoof it.
--
-- COVERAGE: All voucher statuses (unused, active, used, disabled) are
-- intentionally included (user decision): cards already sold or in use stop
-- working on other routers immediately, while their home router keeps
-- accepting them (its source IP equals tunnel_ip, so the compare passes).
-- Disabled/expired vouchers stay rejected by their existing Auth-Type /
-- Expiration rows; the scope row changes nothing for them on the home router.
--
-- HALF-CREATED ROW GUARD: The EXISTS (Cleartext-Password) predicate skips any
-- radius_username that was never fully written to radcheck (e.g. a crash
-- mid-insert during voucher creation). Such rows have no valid credentials
-- and must not receive a scope row either.
--
-- NULL tunnel_ip: vouchers whose router has no tunnel_ip are skipped (there is
-- no IP to lock to). createRouter sets tunnel_ip in the same transaction and
-- createVouchers refuses ROUTER_NOT_READY, so this set should be empty; the
-- deploy pre-flight checks it (docs/PROJECT_STATE.md).
--
-- IDEMPOTENCY: The NOT EXISTS (Packet-Src-IP-Address) predicate ensures that
-- re-running this migration (e.g. after a partial failure or accidental
-- re-apply) inserts 0 rows for vouchers already scoped. Safe to run twice.
--
-- TRANSACTION: The migration runner wraps every SQL file in BEGIN/COMMIT, so
-- this entire INSERT is atomic.
--
-- TYPES: routers.tunnel_ip is VARCHAR(15) (migration 003). No inet cast is
-- needed; the value is inserted as-is into radcheck.value (VARCHAR(253)).

INSERT INTO radcheck (username, attribute, op, value)
SELECT vm.radius_username, 'Packet-Src-IP-Address', '==', r.tunnel_ip
  FROM voucher_meta vm
  JOIN routers r ON r.id = vm.router_id
 WHERE r.tunnel_ip IS NOT NULL
   AND EXISTS (
         SELECT 1 FROM radcheck rc
          WHERE rc.username = vm.radius_username
            AND rc.attribute = 'Cleartext-Password'
       )
   AND NOT EXISTS (
         SELECT 1 FROM radcheck rc
          WHERE rc.username = vm.radius_username
            AND rc.attribute = 'Packet-Src-IP-Address'
       );
