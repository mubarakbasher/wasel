import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';
import {
  connectToRouter,
  ensureMacCookieRelogin,
  resolveActiveServerProfileNames,
} from '../services/routerOs.service';

/**
 * MAC-cookie convergence job.
 *
 * Sweeps all online routers once per day (03:30) and calls
 * ensureMacCookieRelogin on each so that returning customers can re-login
 * automatically without retyping their voucher. The health probe also runs
 * this on demand, but the daily sweep catches routers that haven't been health-
 * checked recently (e.g., powered off overnight or in a degraded state where
 * the tunnel is up but no health check was triggered).
 *
 * Sequentially processes routers (no Promise.all) to avoid flooding the API
 * on large fleets. One router failure never stops the sweep.
 *
 * Runs daily at 03:30. An in-flight guard prevents overlapping runs if the
 * sweep takes longer than 24 h (should never happen, but defensive).
 */

let running = false;

/** Exported so tests can reset state between runs. */
export function _resetJobState(): void {
  running = false;
}

interface RouterRow {
  id: string;
  user_id: string;
}

export async function runMacCookieConvergence(): Promise<{
  checked: number;
  repaired: number;
  failed: number;
}> {
  if (running) {
    logger.info('MAC-cookie convergence: previous run still in progress, skipping');
    return { checked: 0, repaired: 0, failed: 0 };
  }
  running = true;

  let checked = 0;
  let repaired = 0;
  let failed = 0;

  try {
    const result = await pool.query<RouterRow>(`
      SELECT id, user_id
      FROM routers
      WHERE status = 'online'
        AND tunnel_ip IS NOT NULL
        AND api_user IS NOT NULL
        AND api_pass_enc IS NOT NULL
    `);

    for (const row of result.rows) {
      let client: import('routeros-client').RouterOSClient | undefined;
      try {
        const conn = await connectToRouter(row.id, row.user_id);
        client = conn.client;
        const api = conn.api;

        const serverProfileNames = await resolveActiveServerProfileNames(api);
        const outcome = await ensureMacCookieRelogin(api, { serverProfileNames });

        if (outcome.checked) {
          checked++;
          if (outcome.repaired.length > 0) {
            repaired++;
            logger.info('MAC-cookie convergence: repaired router', {
              routerId: row.id,
              repaired: outcome.repaired,
            });
          }
        } else {
          failed++;
          logger.warn('MAC-cookie convergence: ensureMacCookieRelogin returned unchecked', {
            routerId: row.id,
            error: outcome.error,
          });
        }
      } catch (error) {
        failed++;
        logger.warn('MAC-cookie convergence: failed to process router', {
          routerId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (client) {
          try { await client.disconnect(); } catch { /* ignore */ }
        }
      }
    }

    logger.info('MAC-cookie convergence sweep complete', { checked, repaired, failed });
  } finally {
    running = false;
  }

  return { checked, repaired, failed };
}

export function startMacCookieConvergenceJob(): void {
  // '0 30 3 * * *' = daily at 03:30:00 (6-field cron with seconds)
  cron.schedule('0 30 3 * * *', () => {
    runMacCookieConvergence().catch((error) => {
      logger.error('MAC-cookie convergence job failed unexpectedly', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  logger.info('MAC-cookie convergence job scheduled (daily at 03:30)');
}
