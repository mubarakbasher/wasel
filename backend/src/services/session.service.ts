import { exec } from 'child_process';
import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { decrypt } from '../utils/encryption';
import { getActiveHotspotUsers, HotspotUser } from './routerOs.service';
import { disconnectHotspotUser } from './routerOs.service';

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

  // Disconnect via RouterOS API
  await disconnectHotspotUser(routerId, userId, sessionId);

  // Fire-and-forget: send CoA Disconnect-Request via radclient
  try {
    const tunnelIp = router.tunnel_ip;
    const radiusSecret = decrypt(router.radius_secret_enc);

    // Look up the active RADIUS session to get Acct-Session-Id and User-Name
    const radacctResult = await pool.query(
      `SELECT acctsessionid, username FROM radacct
       WHERE nasipaddress = $1 AND acctstoptime IS NULL
       ORDER BY acctstarttime DESC LIMIT 1`,
      [tunnelIp]
    );

    if (radacctResult.rows.length > 0) {
      const { acctsessionid, username } = radacctResult.rows[0];

      const radclientCmd = `echo "Acct-Session-Id=${acctsessionid},User-Name=${username}" | radclient ${tunnelIp}:3799 disconnect ${radiusSecret}`;

      exec(radclientCmd, (error, stdout, stderr) => {
        if (error) {
          logger.warn('CoA Disconnect-Request failed (non-fatal)', {
            routerId,
            sessionId,
            tunnelIp,
            error: error.message,
            stderr,
          });
        } else {
          logger.info('CoA Disconnect-Request sent successfully', {
            routerId,
            sessionId,
            tunnelIp,
            username,
            stdout: stdout.trim(),
          });
        }
      });
    } else {
      logger.debug('No active radacct session found for CoA disconnect', {
        routerId,
        tunnelIp,
      });
    }
  } catch (error: any) {
    logger.warn('Failed to send CoA Disconnect-Request (non-fatal)', {
      routerId,
      sessionId,
      error: error.message,
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
