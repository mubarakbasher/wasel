import { pool } from '../config/database';
import { PoolClient } from 'pg';

/**
 * IP allocation for WireGuard /30 tunnel subnets.
 *
 * Base network: 10.10.0.0/16
 * Each router receives a /30 subnet (4 IPs: network, server, router, broadcast).
 *
 * Block index 0 → 10.10.0.0/30  (server .1, router .2)
 * Block index 1 → 10.10.0.4/30  (server .5, router .6)
 * Block index 2 → 10.10.0.8/30  (server .9, router .10)
 * ...
 * Block index 63 → 10.10.0.252/30
 * Block index 64 → 10.10.1.0/30
 * ...
 *
 * With a /16 base, there are 256 * 64 = 16,384 possible /30 blocks.
 *
 * Allocation is performed via the tunnel_subnets table (migration 018).
 * A single UPDATE … RETURNING with FOR UPDATE SKIP LOCKED makes the
 * allocation atomic — no two concurrent router-create transactions can
 * pick the same block.
 */

const BASE_FIRST_OCTET = 10;
const BASE_SECOND_OCTET = 10;
const BLOCKS_PER_THIRD_OCTET = 64; // 256 / 4

export interface TunnelAllocation {
  serverIp: string;   // e.g., "10.10.0.1"
  routerIp: string;   // e.g., "10.10.0.2"
  subnet: string;     // e.g., "10.10.0.0/30"
  subnetMask: string; // "255.255.255.252"
  subnetId: number;   // zero-based /30 block index
}

/**
 * Convert a /30 block index to a full tunnel allocation.
 */
function blockIndexToAllocation(blockIndex: number): Omit<TunnelAllocation, 'subnetId'> {
  const thirdOctet = Math.floor(blockIndex / BLOCKS_PER_THIRD_OCTET);
  const positionInOctet = blockIndex % BLOCKS_PER_THIRD_OCTET;
  const fourthOctetBase = positionInOctet * 4;

  const prefix = `${BASE_FIRST_OCTET}.${BASE_SECOND_OCTET}.${thirdOctet}`;

  return {
    serverIp: `${prefix}.${fourthOctetBase + 1}`,
    routerIp: `${prefix}.${fourthOctetBase + 2}`,
    subnet: `${prefix}.${fourthOctetBase}/30`,
    subnetMask: '255.255.255.252',
  };
}

/**
 * Convert a router tunnel IP (e.g., "10.10.0.2") to its /30 block index.
 */
function routerIpToBlockIndex(routerIp: string): number {
  const parts = routerIp.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts[0] !== BASE_FIRST_OCTET ||
    parts[1] !== BASE_SECOND_OCTET
  ) {
    throw new Error(`Invalid tunnel IP: ${routerIp} (not in ${BASE_FIRST_OCTET}.${BASE_SECOND_OCTET}.0.0/16)`);
  }

  const thirdOctet = parts[2];
  const fourthOctet = parts[3];
  const fourthOctetBase = fourthOctet - 2;

  if (fourthOctetBase < 0 || fourthOctetBase % 4 !== 0) {
    throw new Error(
      `Invalid router tunnel IP: ${routerIp} (fourth octet ${fourthOctet} is not a valid .2 position in a /30 block)`,
    );
  }

  return thirdOctet * BLOCKS_PER_THIRD_OCTET + (fourthOctetBase / 4);
}

/**
 * Atomically allocate the next free /30 tunnel subnet for a new router.
 *
 * Must be called inside an open transaction using the supplied PoolClient
 * so the allocation is rolled back if the router INSERT fails.
 *
 * Uses UPDATE … FOR UPDATE SKIP LOCKED: concurrent callers skip rows
 * already locked by another transaction, eliminating TOCTOU collisions
 * that the old linear-scan approach suffered from.
 *
 * @param client  An active pg PoolClient with a transaction already started.
 * @param routerId  The UUID of the router being created (written to tunnel_subnets).
 * @returns The tunnel allocation for the claimed /30 block.
 * @throws Error if all 16,384 /30 blocks are exhausted.
 */
export async function allocateNextTunnelIp(
  client: PoolClient,
  routerId: string,
): Promise<TunnelAllocation> {
  const result = await client.query<{ subnet_id: number }>(
    `UPDATE tunnel_subnets
        SET router_id    = $1,
            allocated_at = NOW()
      WHERE subnet_id = (
              SELECT subnet_id
                FROM tunnel_subnets
               WHERE router_id IS NULL
               ORDER BY subnet_id
               LIMIT 1
               FOR UPDATE SKIP LOCKED
            )
      RETURNING subnet_id`,
    [routerId],
  );

  if (result.rows.length === 0) {
    throw new Error('No available tunnel IP addresses — all /30 blocks in 10.10.0.0/16 are allocated');
  }

  const subnetId = result.rows[0].subnet_id;
  return { subnetId, ...blockIndexToAllocation(subnetId) };
}

/**
 * Release a tunnel subnet back to the free pool when a router is deleted.
 * Nulls out router_id so the block becomes available for future allocation.
 *
 * Can be called outside a transaction — the ON DELETE SET NULL FK cascade
 * in migration 018 handles the same cleanup automatically on router DELETE,
 * but calling this explicitly inside the router-delete transaction gives
 * a stronger guarantee when soft-delete or admin delete paths are used.
 *
 * @param client  PoolClient (may or may not be inside a transaction).
 * @param routerId  The UUID of the router being deleted.
 */
export async function releaseTunnelSubnet(
  client: PoolClient | typeof pool,
  routerId: string,
): Promise<void> {
  await (client as typeof pool).query(
    `UPDATE tunnel_subnets SET router_id = NULL WHERE router_id = $1`,
    [routerId],
  );
}

/**
 * Parse a router tunnel IP and return its full /30 allocation details.
 */
export function parseTunnelSubnet(routerIp: string): Omit<TunnelAllocation, 'subnetId'> {
  const blockIndex = routerIpToBlockIndex(routerIp);
  return blockIndexToAllocation(blockIndex);
}
