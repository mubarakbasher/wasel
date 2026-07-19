import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';
import { sendDisconnectRequest } from '../services/radclient.service';
import { isSafeAcctSessionId } from '../utils/radius';

/**
 * Data-usage CoA-disconnect job.
 *
 * For data-limited vouchers whose cumulative usage (acctinputoctets +
 * acctoutputoctets across all radacct rows) has reached or exceeded their
 * limit_value AND that still have an active session (radacct row with
 * acctstoptime IS NULL), this job sends a RFC 5176 Disconnect-Request to the
 * router so the active session is terminated immediately.
 *
 * This is a backstop for cases where the router-enforced Mikrotik-Total-Limit
 * reply attribute (written at voucher creation) is not honoured — e.g. older
 * RouterOS versions — and for the cross-session "reconnect gives a fresh cap"
 * case. It re-fires every 30 s until the router sends an Accounting-Stop and
 * acctstoptime is set, making it self-healing against dropped CoA packets.
 *
 * Usage counting uses full-precision BIGINT arithmetic so >4 GB limits work
 * correctly (unlike the 32-bit rlm_sqlcounter max_total_octets counter).
 *
 * The query is bounded to sessions started within the last 24 hours (truly
 * stale open sessions are owned by staleSessionReaper) and capped at 200 rows
 * per tick to prevent runaway radclient spawns. An in-flight guard ensures a
 * slow tick cannot overlap the next one.
 *
 * Runs every 30 seconds.
 */

// In-flight guard: set true while a tick is executing so that a slow DB query
// or radclient call cannot cause two ticks to overlap.
let running = false;

export function startDataUsageCoaDisconnectJob(): void {
  cron.schedule('*/30 * * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const result = await pool.query<{
        username: string;
        nasipaddress: string;
        acctsessionid: string;
        framedipaddress: string | null;
        secret: string;
      }>(`
        SELECT vm.radius_username AS username,
               ra.nasipaddress,
               ra.acctsessionid,
               ra.framedipaddress,
               n.secret
        FROM voucher_meta vm
        JOIN radacct ra
          ON ra.username = vm.radius_username
         AND ra.acctstoptime IS NULL
         AND ra.acctstarttime > NOW() - INTERVAL '24 hours'
        JOIN nas n
          ON n.nasname = ra.nasipaddress
        JOIN LATERAL (
          SELECT COALESCE(SUM(acctinputoctets + acctoutputoctets), 0)::bigint AS used
          FROM radacct WHERE username = vm.radius_username
        ) u ON TRUE
        WHERE vm.limit_type = 'data'
          AND vm.limit_value IS NOT NULL
          AND vm.status NOT IN ('disabled')
          AND u.used >= vm.limit_value::bigint
        LIMIT 200
      `);

      if (result.rows.length === 0) return;

      for (const row of result.rows) {
        // Defense-in-depth: acctsessionid is passed into radclient stdin where
        // commas/newlines separate AVPs; reject any value with unsafe characters.
        if (!isSafeAcctSessionId(row.acctsessionid)) {
          logger.warn('Data usage CoA skipped: acctsessionid contains unsafe characters', {
            username: row.username,
            nasIp: row.nasipaddress,
            acctsessionid: row.acctsessionid,
          });
          continue;
        }

        const outcome = await sendDisconnectRequest({
          secret: row.secret,
          nasIp: row.nasipaddress,
          username: row.username,
          acctSessionId: row.acctsessionid,
          framedIp: row.framedipaddress ?? undefined,
        });

        logger.info('Data usage CoA disconnect dispatched', {
          username: row.username,
          nasIp: row.nasipaddress,
          acctSessionId: row.acctsessionid,
          outcome,
        });
      }
    } catch (error) {
      logger.error('Data usage CoA disconnect job failed', { error });
    } finally {
      running = false;
    }
  });

  logger.info('Data usage CoA disconnect job scheduled (every 30s)');
}
