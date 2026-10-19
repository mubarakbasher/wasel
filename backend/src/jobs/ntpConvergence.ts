import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';
import { connectToRouter, ensureNtpClient } from '../services/routerOs.service';

/**
 * NTP convergence job.
 *
 * Sweeps online routers every hour (at :50) and calls ensureNtpClient on
 * each one not yet confirmed, so that routers that come back from a power
 * cut with a dead clock battery get NTP enabled before their stale timestamp
 * causes WireGuard to reject handshakes as replays.
 *
 * Why hourly, not daily: most of the fleet is powered off overnight (power
 * cuts, shops closed), so a single 03:50 UTC pass would never reach a router
 * that is only online during the day. Hourly passes converge every router
 * within an hour of it first being online after a backend boot.
 *
 * Why it stays cheap: routers confirmed `repaired` or `already_configured`
 * are remembered in-process and skipped on later passes, so after the first
 * pass each hourly run only touches routers that are new, newly online, or
 * failed last time. The set is per-process (cleared on boot), which is fine:
 * a boot-time pass re-confirms the fleet once, read-only for routers that
 * are already configured.
 *
 * The :50 slot keeps the 03:50 run 20 min after the MAC-cookie sweep (03:30)
 * so the two jobs never hold RouterOS API sessions at the same time.
 *
 * An additional startup pass fires 10 min after backend boot so a fresh
 * deploy converges the online fleet right away instead of waiting for :50.
 *
 * Sequentially processes routers (no Promise.all) to avoid flooding the API
 * on large fleets. One router failure never stops the sweep.
 *
 * An in-flight guard prevents overlapping runs.
 */

let running = false;

/**
 * Router IDs whose NTP client has been confirmed (repaired or already
 * configured) by this process. Skipped on later passes; failures are not
 * added, so they are retried next hour.
 */
const converged = new Set<string>();

/** Exported so tests can reset state between runs. */
export function _resetJobState(): void {
  running = false;
  converged.clear();
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
  let skipped = 0;

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
      if (converged.has(row.id)) {
        skipped++;
        continue;
      }
      let client: import('routeros-client').RouterOSClient | undefined;
      try {
        const conn = await connectToRouter(row.id, row.user_id);
        client = conn.client;
        const api = conn.api;

        const outcome = await ensureNtpClient(api);

        if (outcome.status === 'repaired') {
          repaired++;
          checked++;
          converged.add(row.id);
          logger.info('NTP convergence: repaired router', {
            routerId: row.id,
            tunnelIp: row.tunnel_ip,
            detail: outcome.detail,
          });
        } else if (outcome.status === 'already_configured') {
          alreadyConfigured++;
          checked++;
          converged.add(row.id);
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
      skipped,
      durationMs,
    });
  } finally {
    running = false;
  }

  return { checked, repaired, alreadyConfigured, failed };
}

export function startNtpConvergenceJob(): void {
  // Hourly sweep at :50 — the 03:50 run lands 20 min after the MAC-cookie
  // sweep (03:30) so the two jobs never hold RouterOS API sessions at the
  // same time. Already-confirmed routers are skipped, so this is cheap.
  cron.schedule('0 50 * * * *', () => {
    runNtpConvergence().catch((error) => {
      logger.error('NTP convergence job failed unexpectedly', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  // Startup pass: run once 10 min after backend boot so a deploy converges
  // the online fleet right away rather than waiting for the next :50.
  setTimeout(() => {
    runNtpConvergence().catch((error) => {
      logger.error('NTP convergence startup pass failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 10 * 60 * 1000);

  logger.info('NTP convergence job scheduled (hourly at :50, startup pass at +10 min)');
}
