import { pool } from '../config/database';

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
 */

const BASE_FIRST_OCTET = 10;
const BASE_SECOND_OCTET = 10;
const BLOCKS_PER_THIRD_OCTET = 64; // 256 / 4
const MAX_THIRD_OCTET = 255;
const MAX_BLOCK_INDEX = (MAX_THIRD_OCTET + 1) * BLOCKS_PER_THIRD_OCTET; // 16,384

export interface TunnelAllocation {
  serverIp: string;   // e.g., "10.10.0.1"
  routerIp: string;   // e.g., "10.10.0.2"
  subnet: string;     // e.g., "10.10.0.0/30"
  subnetMask: string; // "255.255.255.252"
}

/**
 * Convert a /30 block index to a full tunnel allocation.
 *
 * @param blockIndex Zero-based sequential block number
 * @returns The tunnel allocation for that block
 */
function blockIndexToAllocation(blockIndex: number): TunnelAllocation {
  const thirdOctet = Math.floor(blockIndex / BLOCKS_PER_THIRD_OCTET);
  const positionInOctet = blockIndex % BLOCKS_PER_THIRD_OCTET;
  const fourthOctetBase = positionInOctet * 4; // network address of the /30

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
 *
 * Router IPs always end in .2, .6, .10, ... (base + 2 within the /30).
 *
 * @param routerIp The router's tunnel IP address
 * @returns The zero-based block index
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

  // The router IP's fourth octet should be base+2 within a /30
  // So fourthOctetBase = fourthOctet - 2, and positionInOctet = fourthOctetBase / 4
  const fourthOctetBase = fourthOctet - 2;
  if (fourthOctetBase < 0 || fourthOctetBase % 4 !== 0) {
    throw new Error(`Invalid router tunnel IP: ${routerIp} (fourth octet ${fourthOctet} is not a valid .2 position in a /30 block)`);
  }

  const positionInOctet = fourthOctetBase / 4;
  return thirdOctet * BLOCKS_PER_THIRD_OCTET + positionInOctet;
}

/**
 * Allocate the next available /30 tunnel subnet for a new router.
 *
 * Queries all currently assigned tunnel IPs from the routers table,
 * determines which /30 blocks are in use, and returns the first free block.
 *
 * @returns The next available tunnel allocation
 * @throws Error if all 16,384 /30 blocks are exhausted
 */
export async function allocateNextTunnelIp(): Promise<TunnelAllocation> {
  const result = await pool.query<{ tunnel_ip: string }>(
    'SELECT tunnel_ip FROM routers WHERE tunnel_ip IS NOT NULL ORDER BY tunnel_ip'
  );

  const usedIndices = new Set<number>();
  for (const row of result.rows) {
    try {
      usedIndices.add(routerIpToBlockIndex(row.tunnel_ip));
    } catch {
      // Skip malformed IPs that don't parse — they don't occupy a valid block
    }
  }

  for (let i = 0; i < MAX_BLOCK_INDEX; i++) {
    if (!usedIndices.has(i)) {
      return blockIndexToAllocation(i);
    }
  }

  throw new Error('No available tunnel IP addresses — all /30 blocks in 10.10.0.0/16 are allocated');
}

/**
 * Release a tunnel IP address. Currently a no-op because IPs are freed
 * automatically when the router row is deleted from the database.
 *
 * Placeholder for future IP recycling or soft-delete support.
 *
 * @param _routerIp The router tunnel IP to release
 */
export async function releaseTunnelIp(_routerIp: string): Promise<void> {
  // No-op: tunnel IPs are freed when the router record is deleted.
  // This function exists as a hook for future IP recycling logic.
}

/**
 * Parse a router tunnel IP and return its full /30 allocation details.
 *
 * @param routerIp The router's tunnel IP (e.g., "10.10.0.2")
 * @returns The complete tunnel allocation for that /30 block
 */
export function parseTunnelSubnet(routerIp: string): TunnelAllocation {
  const blockIndex = routerIpToBlockIndex(routerIp);
  return blockIndexToAllocation(blockIndex);
}
