import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';
import { connectToRouter, ensureNtpClient } from '../services/routerOs.service';

/**
 * NTP convergence job.
 *
 * Sweeps all online routers once per day (03:50 UTC) and calls
 * ensureNtpClient on each so that routers that come back from a power cut
 * with a dead clock battery get NTP enabled before their stale timestamp
 * causes WireGuard to reject handshakes as replays.
 *
 * Runs daily at 03:50 UTC — 20 min after the MAC-cookie sweep (03:30) so
 * the two jobs never hold RouterOS API sessions at the same time.
 *
 * An additional startup pass fires 10 min after backend boot so a fresh
 * deploy converges the fleet the same day instead of waiting for 03:50.
 *
 * Sequentially processes routers (no Promise.all) to avoid flooding the API
 * on large fleets. One router failure never stops the sweep.
 *
 * An in-flight guard prevents overlapping runs.
 */

let running = false;

/** Exported so tests can reset state between runs. */
export function _resetJobState(): void {
  running = false;
}

interface RouterRow {
  id: string;
  user_id: string;
  tunnel_ip: string;
}

export async function runNtpConvergence(): Promise<{
  checked: number;
  repaired: number;
  alreadyConfigured: number;
  failed: number;
}> {
  if (running) {
    logger.info('NTP convergence: previous run still in progress, skipping');
    return { checked: 0, repaired: 0, alreadyConfigured: 0, failed: 0 };
  }
  running = true;

  const startMs = Date.now();
  let checked = 0;
  let repaired = 0;
  let alreadyConfigured = 0;
  let failed = 0;

  try {
    const result = await pool.query<RouterRow>(`
      SELECT id, user_id, tunnel_ip
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

        const outcome = await ensureNtpClient(api);

        if (outcome.status === 'repaired') {
          repaired++;
          checked++;
          logger.info('NTP convergence: repaired router', {
            routerId: row.id,
            tunnelIp: row.tunnel_ip,
            detail: outcome.detail,
          });
        } else if (outcome.status === 'already_configured') {
          alreadyConfigured++;
          checked++;
          logger.debug('NTP convergence: router already configured', {
            routerId: row.id,
            tunnelIp: row.tunnel_ip,
          });
        } else {
          // status === 'failed'
          failed++;
          logger.warn('NTP convergence: ensureNtpClient reported failure', {
            routerId: row.id,
            tunnelIp: row.tunnel_ip,
            detail: outcome.detail,
            error: outcome.error,
          });
        }
      } catch (error) {
        failed++;
        logger.warn('NTP convergence: failed to process router', {
          routerId: row.id,
          tunnelIp: row.tunnel_ip,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (client) {
          try { await client.disconnect(); } catch { /* ignore */ }
        }
      }
    }

    const durationMs = Date.now() - startMs;
    logger.info('NTP convergence sweep complete', {
      checked,
      repaired,
      alreadyConfigured,
      failed,
      durationMs,
    });
  } finally {
    running = false;
  }

  return { checked, repaired, alreadyConfigured, failed };
}

export function startNtpConvergenceJob(): void {
  // Daily sweep at 03:50 UTC — 20 min after the MAC-cookie sweep (03:30) so
  // the two jobs never hold RouterOS API sessions at the same time.
  cron.schedule('0 50 3 * * *', () => {
    runNtpConvergence().catch((error) => {
      logger.error('NTP convergence job failed unexpectedly', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  // Startup pass: run once 10 min after backend boot so a deploy converges
  // the fleet the same day rather than waiting for 03:50 UTC.
  setTimeout(() => {
    runNtpConvergence().catch((error) => {
      logger.error('NTP convergence startup pass failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 10 * 60 * 1000);

  logger.info('NTP convergence job scheduled (daily at 03:50 UTC, startup pass at +10 min)');
}
