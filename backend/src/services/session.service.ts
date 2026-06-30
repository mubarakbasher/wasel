import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { decrypt } from '../utils/encryption';
import { isSafeAcctSessionId } from '../utils/radius';
import { getActiveHotspotUsers, HotspotUser } from './routerOs.service';
import { disconnectHotspotUser } from './routerOs.service';
import { sendDisconnectRequest } from './radclient.service';

// ----- Interfaces -----

export interface SessionHistoryEntry {
  id: number;
  sessionId: string;
  uniqueId: string;
  username: string;
  nasIpAddress: string;
  startTime: string | null;
  stopTime: string | null;
  sessionTime: number | null;
  inputOctets: number | null;
  outputOctets: number | null;
  calledStationId: string;
  callingStationId: string;
  terminateCause: string;
  framedIpAddress: string;
}

export interface SessionHistoryResult {
  sessions: SessionHistoryEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface SessionHistoryOptions {
  username?: string;
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  terminateCause?: string;
}

// ----- Helpers -----

/**
 * Verify router ownership and return the router row.
 */
async function verifyRouterOwnership(routerId: string, userId: string) {
  const routerCheck = await pool.query(
    'SELECT id, tunnel_ip, radius_secret_enc FROM routers WHERE id = $1 AND user_id = $2',
    [routerId, userId]
  );

  if (routerCheck.rows.length === 0) {
    throw new AppError(404, 'Router not found', 'ROUTER_NOT_FOUND');
  }

  return routerCheck.rows[0];
}

/**
 * Map a radacct row to a SessionHistoryEntry.
 */
function toSessionHistoryEntry(row: any): SessionHistoryEntry {
  return {
    id: parseInt(row.radacctid, 10),
    sessionId: row.acctsessionid || '',
    uniqueId: row.acctuniqueid || '',
    username: row.username || '',
    nasIpAddress: row.nasipaddress || '',
    startTime: row.acctstarttime ? row.acctstarttime.toISOString() : null,
    stopTime: row.acctstoptime ? row.acctstoptime.toISOString() : null,
    sessionTime: row.acctsessiontime != null ? parseInt(row.acctsessiontime, 10) : null,
    inputOctets: row.acctinputoctets != null ? parseInt(row.acctinputoctets, 10) : null,
    outputOctets: row.acctoutputoctets != null ? parseInt(row.acctoutputoctets, 10) : null,
    calledStationId: row.calledstationid || '',
    callingStationId: row.callingstationid || '',
    terminateCause: row.acctterminatecause || '',
    framedIpAddress: row.framedipaddress || '',
  };
}

// ----- Service functions -----

/**
 * List all active hotspot sessions on a router.
 *
 * Verifies router ownership, then queries the router via RouterOS API
 * for currently active hotspot users.
 */
export async function getActiveSessions(
  userId: string,
  routerId: string
): Promise<HotspotUser[]> {
  await verifyRouterOwnership(routerId, userId);

  const sessions = await getActiveHotspotUsers(routerId, userId);

  logger.info('Retrieved active sessions', {
    userId,
    routerId,
    count: sessions.length,
  });

  return sessions;
}

/**
 * Disconnect a specific hotspot session from a router.
 *
 * 1. Disconnects via RouterOS API (removes the active hotspot entry).
 * 2. Sends a RADIUS CoA Disconnect-Request via radclient (fire-and-forget).
 */
export async function disconnectSession(
  userId: string,
  routerId: string,
  sessionId: string
): Promise<void> {
  const router = await verifyRouterOwnership(routerId, userId);

  // Disconnect via RouterOS API and capture the username of the disconnected
  // session. The RouterOS internal .id (e.g. "*1A") is NOT stored in
  // radacct.acctsessionid — that column holds the RADIUS Acct-Session-Id AVP
  // assigned by FreeRADIUS, which is an opaque hex string. We must scope the
  // radacct lookup by username instead.
  const username = await disconnectHotspotUser(routerId, userId, sessionId);

  // Fire-and-forget: send CoA Disconnect-Request via the safe spawn-based helper.
  // B1 fix: scope the radacct lookup by USERNAME (Simultaneous-Use=20 means up to
  // 20 open rows are possible due to MAC-randomisation; the stale-session reaper
  // closes stragglers, so the most-recent open row is the live one). We send a
  // single CoA per disconnect action — intentional UX. Scoping by the RouterOS
  // .id (the URL :sid param) was broken — that value never appears in radacct.
  try {
    const tunnelIp = router.tunnel_ip;
    const radiusSecret = decrypt(router.radius_secret_enc);

    if (!username) {
      logger.debug('CoA skipped: disconnectHotspotUser returned empty username', {
        routerId,
        sessionId,
        tunnelIp,
      });
      logger.info('Session disconnected', { userId, routerId, sessionId });
      return;
    }

    const radacctResult = await pool.query<{ acctsessionid: string; username: string; framedipaddress: string | null }>(
      `SELECT acctsessionid, username, framedipaddress FROM radacct
       WHERE nasipaddress = $1 AND username = $2 AND acctstoptime IS NULL
       ORDER BY acctstarttime DESC LIMIT 1`,
      [tunnelIp, username],
    );

    if (radacctResult.rows.length > 0) {
      const { acctsessionid, framedipaddress } = radacctResult.rows[0];

      // Defense-in-depth: reject any acctsessionid that contains characters
      // outside [A-Za-z0-9._-]. An attacker who can write to radacct could
      // otherwise attempt injection even through the safe helper's stdin path.
      if (!isSafeAcctSessionId(acctsessionid)) {
        logger.warn('CoA skipped: acctsessionid contains unsafe characters', {
          routerId,
          sessionId,
          tunnelIp,
          acctsessionid,
        });
      } else {
        // Non-blocking fire-and-forget — do not await so disconnectSession returns quickly.
        sendDisconnectRequest({
          secret: radiusSecret,
          nasIp: tunnelIp,
          username,
          acctSessionId: acctsessionid,
          framedIp: framedipaddress ?? undefined,
        }).then((result) => {
          if (result === 'ack') {
            logger.info('CoA Disconnect-Request acknowledged', {
              routerId,
              sessionId,
              tunnelIp,
              username,
              acctSessionId: acctsessionid,
            });
          } else {
            logger.warn('CoA Disconnect-Request not acknowledged (non-fatal)', {
              routerId,
              sessionId,
              tunnelIp,
              username,
              acctSessionId: acctsessionid,
              result,
            });
          }
        }).catch((err: unknown) => {
          logger.warn('CoA Disconnect-Request threw unexpectedly (non-fatal)', {
            routerId,
            sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } else {
      logger.debug('No matching active radacct session found for CoA disconnect', {
        routerId,
        sessionId,
        tunnelIp,
        username,
      });
    }
  } catch (error: unknown) {
    logger.warn('Failed to send CoA Disconnect-Request (non-fatal)', {
      routerId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('Session disconnected', {
    userId,
    routerId,
    sessionId,
  });
}

/**
 * Query session history from the radacct table with pagination and filters.
 *
 * Filters sessions by the router's tunnel IP (nasipaddress) and supports
 * optional username search, date range, and terminate cause filtering.
 */
export async function getSessionHistory(
  userId: string,
  routerId: string,
  options: SessionHistoryOptions = {}
): Promise<SessionHistoryResult> {
  const router = await verifyRouterOwnership(routerId, userId);

  const {
    username,
    page = 1,
    limit = 20,
    startDate,
    endDate,
    terminateCause,
  } = options;

  const tunnelIp = router.tunnel_ip;

  // Build dynamic WHERE clause
  const conditions: string[] = ['nasipaddress = $1'];
  const params: any[] = [tunnelIp];
  let paramIndex = 2;

  if (username) {
    conditions.push(`username ILIKE $${paramIndex}`);
    params.push(`%${username}%`);
    paramIndex++;
  }

  if (startDate) {
    conditions.push(`acctstarttime >= $${paramIndex}`);
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    conditions.push(`acctstarttime <= $${paramIndex}`);
    params.push(endDate);
    paramIndex++;
  }

  if (terminateCause) {
    conditions.push(`acctterminatecause = $${paramIndex}`);
    params.push(terminateCause);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // Count total matching records
  const countResult = await pool.query(
    `SELECT COUNT(*) AS total FROM radacct WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Fetch paginated results
  const offset = (page - 1) * limit;
  const dataParams = [...params, limit, offset];

  const dataResult = await pool.query(
    `SELECT radacctid, acctsessionid, acctuniqueid, username, nasipaddress,
            acctstarttime, acctstoptime, acctsessiontime,
            acctinputoctets, acctoutputoctets,
            calledstationid, callingstationid, acctterminatecause, framedipaddress
     FROM radacct
     WHERE ${whereClause}
     ORDER BY acctstarttime DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    dataParams
  );

  const sessions = dataResult.rows.map(toSessionHistoryEntry);

  logger.info('Retrieved session history', {
    userId,
    routerId,
    total,
    page,
    limit,
    filters: { username, startDate, endDate, terminateCause },
  });

  return {
    sessions,
    total,
    page,
    limit,
  };
}
