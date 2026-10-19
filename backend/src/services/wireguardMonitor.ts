import { pool } from '../config/database';
import logger from '../config/logger';
import { Sentry, sentryEnabled } from '../config/sentry';
import { notifyRouterOffline, notifyRouterOnline } from './notification.service';
import { listPeers, resetPeer, WgPeerStatus } from './wireguardPeer';

/** How often to check router statuses (ms). */
const CHECK_INTERVAL_MS = 60_000;

/** A handshake older than this many seconds means the tunnel is down. */
const HANDSHAKE_TIMEOUT_S = 150;

/** How long a router must be offline before triggering a notification (ms). */
const OFFLINE_GRACE_PERIOD_MS = 180_000;

/**
 * Age of the last handshake (seconds) beyond which a peer is considered stuck
 * and should be reset in-place to clear the kernel's stored TAI64N timestamp.
 *
 * 300 s is well past WireGuard's REJECT_AFTER_TIME (180 s), so no live session
 * can exist for a peer this stale — the reset cannot drop traffic that is
 * actually flowing. See resetPeer() in wireguardPeer.ts for the rationale.
 */
const STALE_PEER_RESET_AFTER_S = 300;

/**
 * Minimum number of routers that were online in the previous tick for the
 * fleet-offline alarm to be eligible to fire. Below this threshold the fleet
 * is too small to distinguish an outage from routine router churn.
 */
const MIN_FLEET_FOR_ALARM = 5;

/**
 * If the online count this tick drops to at or below this fraction of the
 * previous tick's online count, treat it as a sudden fleet-wide outage.
 * 0.5 = "online count has at least halved".
 */
const FLEET_DROP_RATIO = 0.5;

/**
 * The fleet is considered recovered when the online count returns to at least
 * this fraction of the pre-drop baseline. Math.ceil is used so e.g. 80% of
 * 8 routers requires 7 (ceil(6.4)) back online, not just 6.
 */
const FLEET_RECOVER_RATIO = 0.8;

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

// ---------------------------------------------------------------------------
// Fleet-offline alarm state — persists across monitoring ticks.
// ---------------------------------------------------------------------------

/**
 * Online count observed in the previous monitoring tick.
 * Initialized to -1 so the very first tick (no baseline yet) never triggers
 * the alarm — lastOnlineCount < MIN_FLEET_FOR_ALARM is always false at -1.
 */
let lastOnlineCount = -1;

/**
 * True while a fleet-offline episode is in progress. Prevents the alarm from
 * re-firing on every subsequent tick while the fleet remains down.
 */
let fleetAlarmActive = false;

/**
 * The online count snapshotted just before the collapse was detected.
 * Recovery is declared when online returns to ≥ Math.ceil(preDropOnlineCount * FLEET_RECOVER_RATIO).
 */
let preDropOnlineCount = 0;

// ---------------------------------------------------------------------------

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
 * 6. Evaluates the fleet-offline alarm after all per-router statuses are known.
 */
export async function checkRouterStatuses(): Promise<void> {
  // If listPeers fails (wg binary missing, interface down, permission denied)
  // fall through with an empty set rather than returning — otherwise every
  // router's status freezes at its last known value forever, which is how a
  // dead tunnel can keep showing "online" indefinitely.
  // A total wg failure also means onlineCount = 0 this tick, which correctly
  // triggers the fleet alarm if the fleet was healthy last tick.
  let peers: WgPeerStatus[] = [];

  try {
    peers = await listPeers();
  } catch (error) {
    logger.error('WireGuard monitor: failed to list peers, treating all peers as unreachable', {
      error: error instanceof Error ? error.message : String(error),
    });
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
    // Do not update lastOnlineCount: we have no information about the fleet
    // this tick and a stale baseline is safer than a bogus 0.
    return;
  }

  if (routers.length === 0) {
    // No routers provisioned yet — reset baseline so the alarm doesn't retain
    // a stale high count from a previous fleet that has since been deleted.
    lastOnlineCount = 0;
    return;
  }

  const nowMs = Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);

  // Collect updates to batch into a single transaction
  const updates: Array<{ id: string; newStatus: RouterStatus; lastSeen: Date | null }> = [];

  // Fleet-alarm accumulators — computed in the per-router loop below.
  let onlineCount = 0;
  let totalActive = 0;

  for (const router of routers) {
    const peer = peerMap.get(router.wg_public_key);
    const newStatus = determineStatus(peer, nowSeconds);
    const statusChanged = newStatus !== router.status;

    // Count as "plausibly active" if the peer has ever handshaked (peer exists
    // and latestHandshake > 0) OR if the router was already online in the DB
    // at tick start. This excludes never-connected/dormant routers (peer absent
    // AND status already 'offline') so they don't dilute the fleet baseline and
    // trigger false alarms on partially-provisioned fleets.
    const isActive =
      (peer !== undefined && peer.latestHandshake > 0) || router.status === 'online';
    if (isActive) totalActive++;
    if (newStatus === 'online') onlineCount++;

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

  // ---------------------------------------------------------------------------
  // Fleet-offline alarm — evaluated after all per-router statuses are known.
  // ---------------------------------------------------------------------------

  // Step 1: if a fleet-offline episode is active, check for recovery.
  // Recovery threshold: online count returns to ≥ Math.ceil(preDropOnlineCount * FLEET_RECOVER_RATIO).
  // Using ceil means e.g. 80% of 8 pre-drop routers requires 7 back online (ceil(6.4)),
  // not just 6 — this avoids premature "all clear" on borderline recovery.
  if (fleetAlarmActive && onlineCount >= Math.ceil(preDropOnlineCount * FLEET_RECOVER_RATIO)) {
    fleetAlarmActive = false;
    logger.info('WireGuard fleet-offline alarm cleared: fleet recovered', {
      onlineCount,
      preDropOnlineCount,
      totalActive,
      recoveryThreshold: Math.ceil(preDropOnlineCount * FLEET_RECOVER_RATIO),
    });
  }

  // Step 2: check for a new sudden-drop event.
  // Conditions:
  //   (a) The fleet was non-trivial last tick (lastOnlineCount >= MIN_FLEET_FOR_ALARM).
  //   (b) Online count has collapsed to at most FLEET_DROP_RATIO of last tick's count.
  //   (c) No alarm is already active (prevents re-firing while fleet stays down).
  if (
    !fleetAlarmActive &&
    lastOnlineCount >= MIN_FLEET_FOR_ALARM &&
    onlineCount <= Math.floor(lastOnlineCount * FLEET_DROP_RATIO)
  ) {
    fleetAlarmActive = true;
    preDropOnlineCount = lastOnlineCount;
    logger.error('WireGuard fleet-offline alarm: online routers collapsed', {
      onlineCount,
      previousOnlineCount: lastOnlineCount,
      totalActive,
      dropThreshold: Math.floor(lastOnlineCount * FLEET_DROP_RATIO),
    });
    // Route to Sentry so it triggers an email/alert — this is an ops signal,
    // not a per-user push notification. Guard so it is a true no-op in dev/test.
    if (sentryEnabled) {
      Sentry.captureMessage('WireGuard fleet-offline alarm', 'error');
    }
  }

  // Always update the baseline so the next tick has an accurate reference.
  lastOnlineCount = onlineCount;

  // ---------------------------------------------------------------------------
  // Batch-update router statuses in a single transaction
  // ---------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Stale-peer safety net: reset peers whose last handshake is older than
  // STALE_PEER_RESET_AFTER_S. This clears the kernel's stored TAI64N timestamp
  // so a router whose clock jumped backwards (power cut on a board with no
  // RTC battery) can re-handshake on its next initiation. See resetPeer().
  //
  // Status note: the status DB write above intentionally uses the PRE-reset
  // peer map. A reset is an in-memory action on the server; the router's
  // handshake state does not change until the router sends another init. So
  // "pre-reset" status (= still offline) is the accurate observation for this
  // tick, and the reset only affects what the next tick observes. Separating
  // these keeps the status write and the repair action independent.
  //
  // Self-limiting: after a successful reset the kernel reports latestHandshake
  // = 0 for that peer, which the hs > 0 guard below excludes — a powered-off
  // router is reset exactly once and never again until it handshakes and goes
  // stale again.
  // -------------------------------------------------------------------------
  await resetStalePeersSafely(peers, nowSeconds);
}

/**
 * Reset peers that look stuck on a stale TAI64N timestamp.
 *
 * Caller passes the per-tick dump (`peers`) already read by checkRouterStatuses.
 * We re-read JUST the handshake timestamps with a fresh `wg show` right before
 * acting so a peer that handshook in the gap between the two reads is NOT
 * reset — never reset a peer that is up.
 *
 * All errors are swallowed; the status tick must complete regardless.
 */
async function resetStalePeersSafely(
  peers: WgPeerStatus[],
  nowSeconds: number,
): Promise<void> {
  try {
    const stale: WgPeerStatus[] = [];
    for (const peer of peers) {
      // Guard: hs == 0 means the peer has never handshook (fresh add, or we
      // just reset it). Resetting those again is pointless and would loop.
      if (peer.latestHandshake <= 0) continue;
      const age = nowSeconds - peer.latestHandshake;
      if (age > STALE_PEER_RESET_AFTER_S) stale.push(peer);
    }
    if (stale.length === 0) return;

    // Race guard: re-read live handshakes once, then re-check each candidate
    // against the fresh timestamp before touching it.
    let freshHandshakes: Map<string, number>;
    try {
      const fresh = await listPeers();
      freshHandshakes = new Map(fresh.map((p) => [p.publicKey, p.latestHandshake]));
    } catch (error) {
      logger.warn('WireGuard monitor: race-guard re-read failed, skipping stale-peer resets this tick', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let reset = 0;
    let failed = 0;
    const freshNow = Math.floor(Date.now() / 1000);

    for (const peer of stale) {
      const freshHs = freshHandshakes.get(peer.publicKey) ?? 0;
      if (freshHs > 0 && freshNow - freshHs <= STALE_PEER_RESET_AFTER_S) {
        // Peer handshook between the two reads — leave it alone.
        continue;
      }
      const routerIp = peer.allowedIps.split('/')[0];
      try {
        await resetPeer({
          publicKey: peer.publicKey,
          allowedIps: peer.allowedIps,
          presharedKey: peer.presharedKey,
        });
        reset++;
        logger.info('WireGuard monitor: stale peer reset', {
          tunnelIp: routerIp,
          handshakeAgeS: freshNow - peer.latestHandshake,
        });
      } catch (error) {
        failed++;
        logger.error('WireGuard monitor: stale peer reset failed', {
          tunnelIp: routerIp,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (reset > 0 || failed > 0) {
      logger.info('WireGuard monitor: stale-peer sweep complete', { reset, failed });
    }
  } catch (error) {
    // Belt-and-braces: never let a repair error crash the status tick.
    logger.error('WireGuard monitor: unexpected error in resetStalePeersSafely', {
      error: error instanceof Error ? error.message : String(error),
    });
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
    minFleetForAlarm: MIN_FLEET_FOR_ALARM,
    fleetDropRatio: FLEET_DROP_RATIO,
    fleetRecoverRatio: FLEET_RECOVER_RATIO,
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

/**
 * Reset all module-level monitoring and alarm state.
 *
 * FOR TESTING ONLY — not part of the production API. Allows test suites to
 * isolate tick sequences without reloading the module.
 */
export function _resetMonitorState(): void {
  lastOnlineCount = -1;
  fleetAlarmActive = false;
  preDropOnlineCount = 0;
  offlineSince.clear();
  notifiedOffline.clear();
}
