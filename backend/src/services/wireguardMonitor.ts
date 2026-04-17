import { pool } from '../config/database';
import logger from '../config/logger';
import { notifyRouterOffline, notifyRouterOnline } from './notification.service';
import { listPeers, WgPeerStatus } from './wireguardPeer';

/** How often to check router statuses (ms). */
const CHECK_INTERVAL_MS = 60_000;

/** A handshake older than this many seconds means the tunnel is down. */
const HANDSHAKE_TIMEOUT_S = 150;

/** How long a router must be offline before triggering a notification (ms). */
const OFFLINE_GRACE_PERIOD_MS = 180_000;

type RouterStatus = 'online' | 'offline' | 'degraded';

interface RouterRow {
  id: string;
  user_id: string;
  name: string;
  wg_public_key: string;
  status: RouterStatus;
  tunnel_ip: string;
}

/**
 * Tracks when each router (by ID) was first detected as offline.
 * Entries are removed when the router comes back online.
 */
const offlineSince: Map<string, number> = new Map();

/**
 * Routers we have already fired an offline notification for this session.
 * Cleared when the router comes back online, so the next offline period
 * notifies again. Without this, the monitor would re-notify every tick.
 */
const notifiedOffline: Set<string> = new Set();

/**
 * Determine the new status for a router based on its WireGuard peer data.
 *
 * - Online: handshake within HANDSHAKE_TIMEOUT_S
 * - Offline: no handshake or handshake older than HANDSHAKE_TIMEOUT_S
 *
 * Note: "degraded" (WireGuard up but API unresponsive) requires an active
 * RouterOS API probe, which is handled separately. For the WireGuard-only
 * check, we only distinguish online vs offline.
 */
function determineStatus(peer: WgPeerStatus | undefined, nowSeconds: number): RouterStatus {
  if (!peer || peer.latestHandshake === 0) {
    return 'offline';
  }

  const handshakeAge = nowSeconds - peer.latestHandshake;
  if (handshakeAge <= HANDSHAKE_TIMEOUT_S) {
    return 'online';
  }

  return 'offline';
}

/**
 * Main monitoring function. Runs on each tick of the monitoring loop.
 *
 * 1. Fetches all WireGuard peer statuses via `wg show wg0 dump`.
 * 2. Queries all routers with a WireGuard public key from the database.
 * 3. Compares each router's peer handshake against the timeout threshold.
 * 4. Batch-updates router statuses in the database.
 * 5. Tracks offline duration and logs when the grace period is exceeded.
 */
export async function checkRouterStatuses(): Promise<void> {
  let peers: WgPeerStatus[];

  try {
    peers = await listPeers();
  } catch (error) {
    logger.error('WireGuard monitor: failed to list peers, skipping cycle', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  // Index peers by public key for O(1) lookup
  const peerMap = new Map<string, WgPeerStatus>();
  for (const peer of peers) {
    peerMap.set(peer.publicKey, peer);
  }

  let routers: RouterRow[];

  try {
    const result = await pool.query<RouterRow>(
      'SELECT id, user_id, name, wg_public_key, status, tunnel_ip FROM routers WHERE wg_public_key IS NOT NULL'
    );
    routers = result.rows;
  } catch (error) {
    logger.error('WireGuard monitor: failed to query routers, skipping cycle', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (routers.length === 0) {
    return;
  }

  const nowMs = Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);

  // Collect updates to batch into a single transaction
  const updates: Array<{ id: string; newStatus: RouterStatus; lastSeen: Date | null }> = [];

  for (const router of routers) {
    const peer = peerMap.get(router.wg_public_key);
    const newStatus = determineStatus(peer, nowSeconds);
    const statusChanged = newStatus !== router.status;

    // Determine last_seen — only update when online
    let lastSeen: Date | null = null;
    if (newStatus === 'online' && peer) {
      lastSeen = new Date(peer.latestHandshake * 1000);
    }

    // Track offline grace period
    if (newStatus === 'offline') {
      if (!offlineSince.has(router.id)) {
        offlineSince.set(router.id, nowMs);
      }

      const offlineDuration = nowMs - offlineSince.get(router.id)!;
      if (offlineDuration >= OFFLINE_GRACE_PERIOD_MS && !notifiedOffline.has(router.id)) {
        // Grace period just exceeded — fire notification once per offline session.
        notifiedOffline.add(router.id);
        logger.warn('Router offline beyond grace period', {
          routerId: router.id,
          tunnelIp: router.tunnel_ip,
          offlineDurationMs: offlineDuration,
        });
        notifyRouterOffline({
          userId: router.user_id,
          routerId: router.id,
          routerName: router.name,
          tunnelIp: router.tunnel_ip,
          offlineDurationMs: offlineDuration,
        }).catch((err) => {
          logger.error('Failed to send router offline notification', {
            routerId: router.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } else {
      // Router is back online (or was never offline) — clear tracking.
      // Only send the "back online" push if we actually fired an offline push,
      // otherwise a brief blip during the grace period would still notify.
      if (offlineSince.has(router.id)) {
        const wasOfflineFor = nowMs - offlineSince.get(router.id)!;
        const hadNotified = notifiedOffline.has(router.id);
        offlineSince.delete(router.id);
        notifiedOffline.delete(router.id);
        if (hadNotified) {
          logger.info('Router back online', {
            routerId: router.id,
            tunnelIp: router.tunnel_ip,
            wasOfflineForMs: wasOfflineFor,
          });
          notifyRouterOnline({
            userId: router.user_id,
            routerId: router.id,
            routerName: router.name,
            tunnelIp: router.tunnel_ip,
            wasOfflineForMs: wasOfflineFor,
          }).catch((err) => {
            logger.error('Failed to send router online notification', {
              routerId: router.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }
    }

    if (statusChanged || lastSeen) {
      updates.push({ id: router.id, newStatus, lastSeen });
    }

    if (statusChanged) {
      logger.info('Router status changed', {
        routerId: router.id,
        tunnelIp: router.tunnel_ip,
        previousStatus: router.status,
        newStatus,
      });
    }
  }

  // Batch update in a single transaction
  if (updates.length > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const update of updates) {
        if (update.lastSeen) {
          await client.query(
            'UPDATE routers SET status = $1, last_seen = $2, updated_at = NOW() WHERE id = $3',
            [update.newStatus, update.lastSeen, update.id]
          );
        } else {
          await client.query(
            'UPDATE routers SET status = $1, updated_at = NOW() WHERE id = $2',
            [update.newStatus, update.id]
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('WireGuard monitor: failed to update router statuses', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      client.release();
    }
  }
}

/**
 * Start the periodic monitoring loop.
 *
 * Runs checkRouterStatuses() immediately, then every CHECK_INTERVAL_MS.
 *
 * @returns The interval handle (pass to stopMonitoring to cancel)
 */
export function startMonitoring(): NodeJS.Timeout {
  logger.info('WireGuard monitor started', {
    checkIntervalMs: CHECK_INTERVAL_MS,
    handshakeTimeoutS: HANDSHAKE_TIMEOUT_S,
    offlineGracePeriodMs: OFFLINE_GRACE_PERIOD_MS,
  });

  // Run immediately on start
  checkRouterStatuses().catch((error) => {
    logger.error('WireGuard monitor: initial check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // Then run on interval
  const handle = setInterval(() => {
    checkRouterStatuses().catch((error) => {
      logger.error('WireGuard monitor: periodic check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, CHECK_INTERVAL_MS);

  return handle;
}

/**
 * Stop the periodic monitoring loop.
 *
 * @param handle - The interval handle returned by startMonitoring()
 */
export function stopMonitoring(handle: NodeJS.Timeout): void {
  clearInterval(handle);
  logger.info('WireGuard monitor stopped');
}
