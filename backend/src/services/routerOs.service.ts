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

// ----- Circuit breaker -------------------------------------------------------
//
// Tracks per-router failure counts. After 3 failures within 60 s, the router
// is "open" (offline) for 30 s and all connection attempts are rejected
// immediately without trying to reach the device.

interface CircuitState {
  failures: number;
  firstFailureAt: number; // ms epoch
  openUntil: number;       // ms epoch; 0 = closed
}

const circuitMap = new Map<string, CircuitState>();

const CB_MAX_FAILURES   = 3;
const CB_WINDOW_MS      = 60_000;  // 60 s window for counting failures
const CB_OPEN_DURATION_MS = 30_000; // open for 30 s after tripping

function circuitIsOpen(routerId: string): boolean {
  const state = circuitMap.get(routerId);
  if (!state) return false;
  if (state.openUntil && Date.now() < state.openUntil) return true;
  // Half-open — let through; failure counter will be reset on success
  return false;
}

function recordCircuitFailure(routerId: string): void {
  const now = Date.now();
  const state = circuitMap.get(routerId) ?? { failures: 0, firstFailureAt: now, openUntil: 0 };

  // Reset window if it has elapsed
  if (now - state.firstFailureAt > CB_WINDOW_MS) {
    state.failures = 0;
    state.firstFailureAt = now;
    state.openUntil = 0;
  }

  state.failures++;
  if (state.failures >= CB_MAX_FAILURES) {
    state.openUntil = now + CB_OPEN_DURATION_MS;
    logger.warn('RouterOS circuit breaker tripped', { routerId, openUntilMs: state.openUntil });
  }

  circuitMap.set(routerId, state);
}

function recordCircuitSuccess(routerId: string): void {
  circuitMap.delete(routerId);
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
 * - Timeout bumped to 30 s (routers behind WireGuard can be slow to respond).
 * - Retried twice with exponential back-off (500 ms, 1 500 ms).
 * - Per-router in-memory circuit breaker: after 3 failures within 60 s the
 *   call is rejected immediately for 30 s without touching the device.
 *
 * IMPORTANT: The caller is responsible for disconnecting the client when done.
 */
export async function connectToRouter(
  routerId: string,
  userId: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ client: RouterOSClient; api: any }> {
  if (circuitIsOpen(routerId)) {
    throw new AppError(
      502,
      'Router is temporarily unreachable — circuit breaker open',
      'ROUTER_UNREACHABLE'
    );
  }

  const router = await fetchRouterRecord(routerId, userId);
  const password = decrypt(router.api_pass_enc);

  const RETRY_DELAYS = [500, 1500];

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const client = new RouterOSClient({
      host: router.tunnel_ip,
      user: router.api_user,
      password,
      port: 8728,
      timeout: 30, // seconds
    });

    try {
      const api = await client.connect();
      recordCircuitSuccess(routerId);
      return { client, api };
    } catch (err: unknown) {
      lastError = err;

      if (attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        logger.warn('RouterOS connect failed, retrying', {
          routerId,
          attempt: attempt + 1,
          delayMs: delay,
          error: err instanceof Error ? err.message : String(err),
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  recordCircuitFailure(routerId);

  logger.error('Failed to connect to router after retries', {
    routerId,
    tunnelIp: router.tunnel_ip,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw new AppError(
    502,
    'Unable to reach the router — it may be offline or unreachable',
    'ROUTER_UNREACHABLE'
  );
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [resourceResult, identityResult, routerboardResult] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (api as any).menu('/system/resource').get(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (api as any).menu('/system/identity').get(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (api as any).menu('/system/routerboard').get().catch(() => []),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resource = (resourceResult as any[])[0] || {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const identity = (identityResult as any[])[0] || {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routerboard = (routerboardResult as any[])[0] || null;

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
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    logger.error('Failed to get system info from router', {
      routerId,
      error: error instanceof Error ? error.message : String(error),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeUsers = await (api as any).menu('/ip/hotspot/active').get();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    logger.error('Failed to get active hotspot users', {
      routerId,
      error: error instanceof Error ? error.message : String(error),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeSessions = await (api as any).menu('/ip/hotspot/active').get();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = (activeSessions || []).find((s: any) => s['.id'] === sessionId);

    if (!session) {
      throw new AppError(404, 'Hotspot session not found', 'SESSION_NOT_FOUND');
    }

    // Remove the active session to disconnect the user
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (api as any).menu('/ip/hotspot/active').where('.id', sessionId).remove();

    logger.info('Hotspot user disconnected', {
      routerId,
      userId,
      sessionId,
      username: session.user,
      macAddress: session['mac-address'],
    });
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    logger.error('Failed to disconnect hotspot user', {
      routerId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
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
