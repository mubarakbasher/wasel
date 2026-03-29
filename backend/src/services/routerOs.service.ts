import { RouterOSClient } from 'routeros-client';
import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { decrypt } from '../utils/encryption';

// ----- Interfaces -----

export interface RouterSystemInfo {
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

export interface HotspotUser {
  id: string;
  username: string;
  address: string;
  macAddress: string;
  uptime: string;
  bytesIn: number;
  bytesOut: number;
  idleTime: string;
  loginBy: string;
}

// ----- Helper -----

/**
 * Fetch router record from DB and validate it belongs to the user.
 * Returns the raw DB row with tunnel_ip, api_user, api_pass_enc.
 */
async function fetchRouterRecord(routerId: string, userId: string) {
  const result = await pool.query(
    'SELECT id, tunnel_ip, api_user, api_pass_enc FROM routers WHERE id = $1 AND user_id = $2',
    [routerId, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Router not found', 'ROUTER_NOT_FOUND');
  }

  const router = result.rows[0];

  if (!router.tunnel_ip || !router.api_user || !router.api_pass_enc) {
    throw new AppError(
      400,
      'Router is not fully configured — missing tunnel IP, API user, or API password',
      'ROUTER_NOT_CONFIGURED'
    );
  }

  return router;
}

// ----- Service functions -----

/**
 * Connect to a Mikrotik router via its WireGuard tunnel IP.
 *
 * Looks up the router in the database, decrypts credentials, and establishes
 * a RouterOS API connection on port 8728.
 *
 * IMPORTANT: The caller is responsible for disconnecting the client when done.
 */
export async function connectToRouter(
  routerId: string,
  userId: string
): Promise<{ client: RouterOSClient; api: any }> {
  const router = await fetchRouterRecord(routerId, userId);

  const password = decrypt(router.api_pass_enc);

  const client = new RouterOSClient({
    host: router.tunnel_ip,
    user: router.api_user,
    password,
    port: 8728,
    timeout: 10,
  });

  try {
    const api = await client.connect();
    return { client, api };
  } catch (error: any) {
    logger.error('Failed to connect to router', {
      routerId,
      tunnelIp: router.tunnel_ip,
      error: error.message,
    });
    throw new AppError(
      502,
      'Unable to reach the router — it may be offline or unreachable',
      'ROUTER_UNREACHABLE'
    );
  }
}

/**
 * Retrieve system information from a Mikrotik router.
 *
 * Queries /system/resource, /system/identity, and /system/routerboard in
 * parallel, then returns a unified RouterSystemInfo object.
 */
export async function getSystemInfo(
  routerId: string,
  userId: string
): Promise<RouterSystemInfo> {
  const { client, api } = await connectToRouter(routerId, userId);

  try {
    const [resourceResult, identityResult, routerboardResult] = await Promise.all([
      api.menu('/system/resource').get(),
      api.menu('/system/identity').get(),
      api.menu('/system/routerboard').get().catch(() => []),
    ]);

    const resource = resourceResult[0] || {};
    const identity = identityResult[0] || {};
    const routerboard = routerboardResult[0] || null;

    return {
      identity: identity.name || 'Unknown',
      uptime: resource.uptime || '0s',
      cpuLoad: parseInt(resource['cpu-load'] || '0', 10),
      freeMemory: parseInt(resource['free-memory'] || '0', 10),
      totalMemory: parseInt(resource['total-memory'] || '0', 10),
      boardName: resource['board-name'] || 'Unknown',
      architecture: resource['architecture-name'] || 'Unknown',
      version: resource.version || 'Unknown',
      model: routerboard?.model || null,
      serialNumber: routerboard?.['serial-number'] || null,
      firmware: routerboard?.firmware || null,
    };
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    logger.error('Failed to get system info from router', {
      routerId,
      error: error.message,
    });
    throw new AppError(502, 'Failed to retrieve system information from the router', 'ROUTER_UNREACHABLE');
  } finally {
    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
}

/**
 * List all active hotspot users on a Mikrotik router.
 */
export async function getActiveHotspotUsers(
  routerId: string,
  userId: string
): Promise<HotspotUser[]> {
  const { client, api } = await connectToRouter(routerId, userId);

  try {
    const activeUsers = await api.menu('/ip/hotspot/active').get();

    return (activeUsers || []).map((entry: any) => ({
      id: entry['.id'] || '',
      username: entry.user || '',
      address: entry.address || '',
      macAddress: entry['mac-address'] || '',
      uptime: entry.uptime || '0s',
      bytesIn: parseInt(entry['bytes-in'] || '0', 10),
      bytesOut: parseInt(entry['bytes-out'] || '0', 10),
      idleTime: entry['idle-time'] || '0s',
      loginBy: entry['login-by'] || '',
    }));
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    logger.error('Failed to get active hotspot users', {
      routerId,
      error: error.message,
    });
    throw new AppError(502, 'Failed to retrieve active hotspot users from the router', 'ROUTER_UNREACHABLE');
  } finally {
    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
}

/**
 * Disconnect a specific hotspot user session from a Mikrotik router.
 *
 * @param routerId - UUID of the router
 * @param userId - UUID of the authenticated user (for ownership check)
 * @param sessionId - The .id of the active hotspot session (e.g., "*1A")
 */
export async function disconnectHotspotUser(
  routerId: string,
  userId: string,
  sessionId: string
): Promise<void> {
  const { client, api } = await connectToRouter(routerId, userId);

  try {
    // Verify the session exists
    const activeSessions = await api.menu('/ip/hotspot/active').get();
    const session = (activeSessions || []).find((s: any) => s['.id'] === sessionId);

    if (!session) {
      throw new AppError(404, 'Hotspot session not found', 'SESSION_NOT_FOUND');
    }

    // Remove the active session to disconnect the user
    await api.menu('/ip/hotspot/active').where('.id', sessionId).remove();

    logger.info('Hotspot user disconnected', {
      routerId,
      userId,
      sessionId,
      username: session.user,
      macAddress: session['mac-address'],
    });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    logger.error('Failed to disconnect hotspot user', {
      routerId,
      sessionId,
      error: error.message,
    });
    throw new AppError(502, 'Failed to disconnect the hotspot user from the router', 'ROUTER_UNREACHABLE');
  } finally {
    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
}

/**
 * Test whether a RouterOS API connection can be established to the router.
 *
 * @returns true if the connection succeeds, false otherwise
 */
export async function testConnection(
  routerId: string,
  userId: string
): Promise<boolean> {
  let client: RouterOSClient | null = null;

  try {
    const result = await connectToRouter(routerId, userId);
    client = result.client;
    return true;
  } catch {
    return false;
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
  }
}
