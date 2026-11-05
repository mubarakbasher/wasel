import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';
import {
  connectToRouter,
  ensureMacCookieRelogin,
  resolveActiveServerProfileNames,
} from '../services/routerOs.service';
import {
  withRouterDeadline,
  disconnectWithDeadline,
} from '../services/routerDeadline';

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
 *
 * Sweep budget: the sweep stops starting new routers after 20 min so the
 * 03:30 run always finishes well before the 03:50 NTP sweep.
 */

/** How long one router's whole unit (connect→mac-cookie→disconnect) may run. */
const DEFAULT_PER_ROUTER_MS = 120_000;

/** Stop starting new routers once the sweep has been running this long. */
const DEFAULT_SWEEP_BUDGET_MS = 20 * 60 * 1000;

let running = false;

/** Exported so tests can reset state between runs. */
export function _resetJobState(): void {
  running = false;
}

interface RouterRow {
  id: string;
  user_id: string;
}

export interface MacCookieConvergenceResult {
  checked: number;
  repaired: number;
  failed: number;
  timedOut: number;
  leftForNextRun: number;
}

export async function runMacCookieConvergence(opts?: {
  /** Override the per-router deadline for tests / local e2e. */
  perRouterMs?: number;
  /** Override the total sweep budget for tests / local e2e. */
  sweepBudgetMs?: number;
}): Promise<MacCookieConvergenceResult> {
  if (running) {
    logger.info('MAC-cookie convergence: previous run still in progress, skipping');
    return { checked: 0, repaired: 0, failed: 0, timedOut: 0, leftForNextRun: 0 };
  }
  running = true;

  const perRouterMs = opts?.perRouterMs ?? DEFAULT_PER_ROUTER_MS;
  const sweepBudgetMs = opts?.sweepBudgetMs ?? DEFAULT_SWEEP_BUDGET_MS;

  const startMs = Date.now();
  let checked = 0;
  let repaired = 0;
  let failed = 0;
  let timedOut = 0;
  let leftForNextRun = 0;

  try {
    const result = await pool.query<RouterRow>(`
      SELECT id, user_id
      FROM routers
      WHERE status = 'online'
        AND tunnel_ip IS NOT NULL
        AND api_user IS NOT NULL
        AND api_pass_enc IS NOT NULL
    `);

    const rows = result.rows;
    const sweepDeadlineMs = startMs + sweepBudgetMs;

    for (let i = 0; i < rows.length; i++) {
      if (Date.now() >= sweepDeadlineMs) {
        leftForNextRun = rows.length - i;
        logger.info('MAC-cookie convergence: sweep budget reached, deferring remaining routers', {
          leftForNextRun,
        });
        break;
      }

      const row = rows[i];
      const deadlineResult = await withRouterDeadline(
        row.id,
        perRouterMs,
        async (ctx) => {
          ctx.step = 'connect';
          const conn = await connectToRouter(row.id, row.user_id, {
            signal: ctx.signal,
            onClient: ctx.onClient,
          });
          const client = conn.client;
          const api = conn.api;

          try {
            ctx.step = 'server-profiles';
            const serverProfileNames = await resolveActiveServerProfileNames(api);

            ctx.step = 'mac-cookie';
            const outcome = await ensureMacCookieRelogin(api, { serverProfileNames });

            return { outcome };
          } finally {
            ctx.step = 'disconnect';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await disconnectWithDeadline(client as any, 5_000);
          }
        },
      );

      if (deadlineResult.status === 'timeout') {
        timedOut++;
        failed++;
        // The deadline module already logged a warn with routerId and step.
        continue;
      }

      if (deadlineResult.status === 'error') {
        failed++;
        logger.warn('MAC-cookie convergence: failed to process router', {
          routerId: row.id,
          error:
            deadlineResult.error instanceof Error
              ? deadlineResult.error.message
              : String(deadlineResult.error),
        });
        continue;
      }

      // status === 'ok'
      const { outcome } = deadlineResult.value;

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
    }

    logger.info('MAC-cookie convergence sweep complete', {
      checked,
      repaired,
      failed,
      timedOut,
      leftForNextRun,
    });
  } finally {
    running = false;
  }

  return { checked, repaired, failed, timedOut, leftForNextRun };
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
