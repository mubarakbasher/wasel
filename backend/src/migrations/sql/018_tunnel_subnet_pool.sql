-- Migration: 018_tunnel_subnet_pool
-- Description: Replace linear-scan tunnel IP allocation with an atomic
--              pool table to eliminate subnet collision under concurrent
--              router creation.
-- Date: 2026-04-18

-- Pool table: one row per /30 block in 10.10.0.0/16 (16 384 subnets).
-- subnet_id = zero-based /30 block index (see ipAllocation.ts for math).
-- router_id is NULL when the subnet is free, UUID when allocated.
CREATE TABLE IF NOT EXISTS tunnel_subnets (
  subnet_id    INTEGER PRIMARY KEY,
  router_id    UUID UNIQUE REFERENCES routers(id) ON DELETE SET NULL,
  allocated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed all 16 384 /30 subnet IDs (0 .. 16 383 inclusive).
-- ON CONFLICT DO NOTHING makes this idempotent.
INSERT INTO tunnel_subnets (subnet_id)
  SELECT generate_series(0, 16383)
  ON CONFLICT DO NOTHING;

-- Back-fill existing routers so their subnet rows show as allocated.
-- routerIpToBlockIndex arithmetic:
--   thirdOctet  = split_part(tunnel_ip,'.',3)::int
--   fourthOctet = split_part(tunnel_ip,'.',4)::int
--   blockIndex  = thirdOctet * 64 + (fourthOctet - 2) / 4
UPDATE tunnel_subnets ts
SET    router_id    = r.id,
       allocated_at = r.created_at
FROM   routers r
WHERE  r.tunnel_ip IS NOT NULL
  AND  ts.subnet_id = (
         split_part(r.tunnel_ip, '.', 3)::int * 64
         + (split_part(r.tunnel_ip, '.', 4)::int - 2) / 4
       );
