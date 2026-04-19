import { pool } from '../config/database';
import { config } from '../config';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { generateKeyPair, generatePresharedKey } from '../utils/wireguard';
import { allocateNextTunnelIp, releaseTunnelSubnet, parseTunnelSubnet } from '../utils/ipAllocation';
import { encrypt, decrypt, generateRadiusSecret, generateNasIdentifier } from '../utils/encryption';
import { addPeer, removePeer } from './wireguardPeer';
import { generateMikrotikConfigText, generateSetupSteps } from './wireguardConfig';
import { getRouterLimit } from './subscription.service';
import { getSystemInfo } from './routerOs.service';

// ----- Interfaces -----

export interface RouterRow {
  id: string;
  user_id: string;
  name: string;
  model: string | null;
  ros_version: string | null;
  api_user: string | null;
  api_pass_enc: string | null;
  wg_public_key: string | null;
  wg_private_key_enc: string | null;
  wg_preshared_key_enc: string | null;
  wg_endpoint: string | null;
  tunnel_ip: string | null;
  radius_secret_enc: string | null;
  nas_identifier: string | null;
  status: string;
  last_seen: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface RouterInfo {
  id: string;
  userId: string;
  name: string;
  model: string | null;
  rosVersion: string | null;
  apiUser: string | null;
  wgPublicKey: string | null;
  tunnelIp: string | null;
  nasIdentifier: string | null;
  status: string;
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
}

// ----- Helpers -----

function toRouterInfo(row: RouterRow): RouterInfo {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    model: row.model,
    rosVersion: row.ros_version,
    apiUser: row.api_user,
    wgPublicKey: row.wg_public_key,
    tunnelIp: row.tunnel_ip,
    nasIdentifier: row.nas_identifier,
    status: row.status,
    lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

// ----- Service Functions -----

/**
 * Create a new router with WireGuard keys, tunnel IP, and RADIUS configuration.
 */
export async function createRouter(
  userId: string,
  data: { name: string; model?: string; rosVersion?: string; apiUser?: string; apiPass?: string },
  opts?: { skipQuotaCheck?: boolean },
): Promise<RouterInfo> {
  // Check router limit against subscription (can be skipped by admin override)
  if (!opts?.skipQuotaCheck) {
    const routerLimit = await getRouterLimit(userId);
    const countResult = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM routers WHERE user_id = $1',
      [userId],
    );
    const currentCount = parseInt(countResult.rows[0].count, 10);

    if (currentCount >= routerLimit) {
      throw new AppError(
        403,
        `Router limit reached. Your plan allows ${routerLimit} router(s).`,
        'ROUTER_LIMIT_REACHED',
      );
    }
  }

  // Generate WireGuard keys
  const { privateKey: routerPrivateKey, publicKey: routerPublicKey } = generateKeyPair();
  const presharedKey = generatePresharedKey();

  // Generate RADIUS secret
  const radiusSecret = generateRadiusSecret();

  // Encrypt sensitive fields
  const wgPrivateKeyEnc = encrypt(routerPrivateKey);
  const wgPresharedKeyEnc = encrypt(presharedKey);
  const radiusSecretEnc = encrypt(radiusSecret);
  const apiPassEnc = data.apiPass ? encrypt(data.apiPass) : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert router with a NULL tunnel_ip placeholder; we'll fill it after
    // atomically claiming a subnet from the pool (tunnel_ip requires a router ID).
    const result = await client.query<RouterRow>(
      `INSERT INTO routers (
        user_id, name, model, ros_version, api_user, api_pass_enc,
        wg_public_key, wg_private_key_enc, wg_preshared_key_enc, tunnel_ip,
        radius_secret_enc, nas_identifier, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $11, 'offline')
      RETURNING *`,
      [
        userId,
        data.name,
        data.model || null,
        data.rosVersion || null,
        data.apiUser || null,
        apiPassEnc,
        routerPublicKey,
        wgPrivateKeyEnc,
        wgPresharedKeyEnc,
        radiusSecretEnc,
        'pending', // placeholder nas_identifier, will update after we have the ID
      ],
    );

    const router = result.rows[0];

    // Atomically claim the next free /30 from the tunnel_subnets pool.
    // This UPDATE uses FOR UPDATE SKIP LOCKED so concurrent transactions
    // never collide on the same subnet block.
    const tunnel = await allocateNextTunnelIp(client, router.id);

    // Write the allocated tunnel IP back onto the router row.
    await client.query(
      'UPDATE routers SET tunnel_ip = $1 WHERE id = $2',
      [tunnel.routerIp, router.id],
    );
    router.tunnel_ip = tunnel.routerIp;

    // Generate NAS identifier using the router ID
    const nasIdentifier = generateNasIdentifier(data.name, router.id);

    // Update router with proper NAS identifier
    await client.query(
      'UPDATE routers SET nas_identifier = $1 WHERE id = $2',
      [nasIdentifier, router.id],
    );
    router.nas_identifier = nasIdentifier;

    // Register as NAS client in FreeRADIUS nas table
    await client.query(
      `INSERT INTO nas (nasname, shortname, type, ports, secret, server, community, description)
       VALUES ($1, $2, $3, NULL, $4, NULL, NULL, $5)`,
      [tunnel.routerIp, nasIdentifier, 'other', radiusSecret, data.name],
    );

    await client.query('COMMIT');

    // Add WireGuard peer (non-fatal if wg isn't available in dev)
    try {
      await addPeer({
        publicKey: routerPublicKey,
        routerIp: tunnel.routerIp,
        presharedKey,
      });
    } catch (error) {
      logger.warn('Failed to add WireGuard peer (non-fatal)', {
        routerId: router.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('Router created', {
      routerId: router.id,
      userId,
      name: data.name,
      tunnelIp: tunnel.routerIp,
      nasIdentifier,
    });

    return toRouterInfo(router);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * List all routers belonging to a user.
 */
export async function getRoutersByUser(userId: string): Promise<RouterInfo[]> {
  const result = await pool.query<RouterRow>(
    'SELECT * FROM routers WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );

  return result.rows.map(toRouterInfo);
}

/**
 * Get a single router by ID, verifying user ownership.
 */
export async function getRouterById(userId: string, routerId: string): Promise<RouterInfo> {
  const result = await pool.query<RouterRow>(
    'SELECT * FROM routers WHERE id = $1 AND user_id = $2',
    [routerId, userId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Router not found', 'ROUTER_NOT_FOUND');
  }

  return toRouterInfo(result.rows[0]);
}

/**
 * Update a router's editable fields.
 */
export async function updateRouter(
  userId: string,
  routerId: string,
  data: { name?: string; model?: string; rosVersion?: string; apiUser?: string; apiPass?: string },
): Promise<RouterInfo> {
  // Verify ownership
  const existing = await pool.query<RouterRow>(
    'SELECT * FROM routers WHERE id = $1 AND user_id = $2',
    [routerId, userId],
  );

  if (existing.rows.length === 0) {
    throw new AppError(404, 'Router not found', 'ROUTER_NOT_FOUND');
  }

  // Build dynamic UPDATE
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    values.push(data.name);
  }
  if (data.model !== undefined) {
    setClauses.push(`model = $${paramIndex++}`);
    values.push(data.model);
  }
  if (data.rosVersion !== undefined) {
    setClauses.push(`ros_version = $${paramIndex++}`);
    values.push(data.rosVersion);
  }
  if (data.apiUser !== undefined) {
    setClauses.push(`api_user = $${paramIndex++}`);
    values.push(data.apiUser);
  }
  if (data.apiPass !== undefined) {
    setClauses.push(`api_pass_enc = $${paramIndex++}`);
    values.push(encrypt(data.apiPass));
  }

  if (setClauses.length === 0) {
    return toRouterInfo(existing.rows[0]);
  }

  values.push(routerId);
  const result = await pool.query<RouterRow>(
    `UPDATE routers SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );

  const updatedRouter = result.rows[0];

  // Sync NAS shortname if name changed
  if (data.name !== undefined && updatedRouter.tunnel_ip) {
    await pool.query(
      'UPDATE nas SET shortname = $1, description = $2 WHERE nasname = $3',
      [updatedRouter.nas_identifier, data.name, updatedRouter.tunnel_ip],
    );
  }

  logger.info('Router updated', { routerId, userId });

  return toRouterInfo(updatedRouter);
}

/**
 * Delete a router and clean up WireGuard peer and NAS entry.
 */
export async function deleteRouter(userId: string, routerId: string): Promise<void> {
  const result = await pool.query<RouterRow>(
    'SELECT * FROM routers WHERE id = $1 AND user_id = $2',
    [routerId, userId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Router not found', 'ROUTER_NOT_FOUND');
  }

  const router = result.rows[0];

  // Delete NAS entry
  if (router.tunnel_ip) {
    await pool.query('DELETE FROM nas WHERE nasname = $1', [router.tunnel_ip]);
  }

  // Release the tunnel subnet back to the free pool before deleting the
  // router row. The ON DELETE SET NULL FK in tunnel_subnets would handle
  // this automatically, but doing it explicitly inside the same statement
  // sequence avoids any window where the router row is gone but the subnet
  // still appears allocated.
  await releaseTunnelSubnet(pool, routerId);

  // Delete router record
  await pool.query('DELETE FROM routers WHERE id = $1', [routerId]);

  // Remove WireGuard peer (non-fatal)
  if (router.wg_public_key) {
    try {
      await removePeer(router.wg_public_key);
    } catch (error) {
      logger.warn('Failed to remove WireGuard peer (non-fatal)', {
        routerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Router deleted', {
    routerId,
    userId,
    name: router.name,
    tunnelIp: router.tunnel_ip,
  });
}

export interface RouterStatusSystemInfo {
  identity: string;
  uptime: string;
  cpuLoad: number;
  freeMemory: number;
  totalMemory: number;
  boardName: string;
  architecture: string;
  version: string;
  model: string | null;
  serialNumber: string | null;
  firmware: string | null;
}

export interface RouterStatusResult {
  id: string;
  name: string;
  status: string;
  lastSeen: string | null;
  tunnelIp: string | null;
  liveDataAvailable?: boolean;
  systemInfo?: RouterStatusSystemInfo;
}

/**
 * Get router status information.
 * When the router is online, attempts to fetch live system info from RouterOS API.
 */
export async function getRouterStatus(
  userId: string,
  routerId: string,
): Promise<RouterStatusResult> {
  const result = await pool.query<RouterRow>(
    'SELECT * FROM routers WHERE id = $1 AND user_id = $2',
    [routerId, userId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Router not found', 'ROUTER_NOT_FOUND');
  }

  const router = result.rows[0];
  const statusResult: RouterStatusResult = {
    id: router.id,
    name: router.name,
    status: router.status,
    lastSeen: router.last_seen ? new Date(router.last_seen).toISOString() : null,
    tunnelIp: router.tunnel_ip,
  };

  if (router.status === 'online') {
    try {
      const sysInfo = await getSystemInfo(routerId, userId);
      statusResult.systemInfo = sysInfo;
    } catch (error) {
      logger.warn('Failed to fetch live system info from router', {
        routerId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      statusResult.liveDataAvailable = false;
    }
  }

  return statusResult;
}

export type SetupGuideResult = {
  routerName: string;
  setupGuide: string;
  tunnelIp: string | null;
  serverEndpoint: string;
  steps: import('./wireguardConfig').SetupStep[];
};

function buildSetupGuideFromRow(router: RouterRow): SetupGuideResult {
  if (!router.wg_private_key_enc || !router.radius_secret_enc || !router.tunnel_ip) {
    throw new AppError(400, 'Router is missing WireGuard or RADIUS configuration', 'ROUTER_NOT_CONFIGURED');
  }

  const routerPrivateKey = decrypt(router.wg_private_key_enc);
  const radiusSecret = decrypt(router.radius_secret_enc);
  const presharedKey = router.wg_preshared_key_enc ? decrypt(router.wg_preshared_key_enc) : undefined;
  const serverEndpoint = `${config.WG_SERVER_ENDPOINT}:${config.WG_SERVER_PORT}`;

  const configParams = {
    routerName: router.name,
    routerPrivateKey,
    routerTunnelIp: router.tunnel_ip,
    serverPublicKey: config.WG_SERVER_PUBLIC_KEY,
    serverEndpoint,
    presharedKey,
    radiusSecret,
    radiusServerIp: '10.10.0.1', // VPS wg0 address — always the same for all routers
  };

  return {
    routerName: router.name,
    setupGuide: generateMikrotikConfigText(configParams),
    tunnelIp: router.tunnel_ip,
    serverEndpoint,
    steps: generateSetupSteps(configParams),
  };
}

/**
 * Generate the Mikrotik setup guide for a router.
 * Decrypts WireGuard private key and RADIUS secret for inclusion.
 */
export async function getSetupGuide(
  userId: string,
  routerId: string,
): Promise<SetupGuideResult> {
  const result = await pool.query<RouterRow>(
    'SELECT * FROM routers WHERE id = $1 AND user_id = $2',
    [routerId, userId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Router not found', 'ROUTER_NOT_FOUND');
  }

  return buildSetupGuideFromRow(result.rows[0]);
}

/**
 * Admin variant: fetch the setup guide for any router, regardless of owner.
 * Caller MUST audit-log this access since the response embeds plaintext secrets.
 */
export async function getSetupGuideForAdmin(routerId: string): Promise<SetupGuideResult> {
  const result = await pool.query<RouterRow>(
    'SELECT * FROM routers WHERE id = $1',
    [routerId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Router not found', 'ROUTER_NOT_FOUND');
  }

  return buildSetupGuideFromRow(result.rows[0]);
}
