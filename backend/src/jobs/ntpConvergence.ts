import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';
import {
  connectToRouter,
  ensureNtpClient,
  ensureRadiusTimeout,
} from '../services/routerOs.service';
import {
  withRouterDeadline,
  disconnectWithDeadline,
} from '../services/routerDeadline';
import { isRadiusTimeoutRolloutEnabled } from '../services/radiusTimeoutRollout';
import { WG_VPS_TUNNEL_IP } from '../services/wireguardConfig';

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
 * that is only powered on during the day. Hourly passes converge every router
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
 *
 * Ordering / fairness:
 *   - Routers are processed least-recently-attempted first (never-attempted
 *     first). This spreads convergence evenly across a large fleet and
 *     prevents a small set of slow or offline routers from starving the rest.
 *   - A router that timed out is skipped for TIMEOUT_BACKOFF_MS (2 h) so a
 *     single stuck router doesn't consume a deadline slot every hour.
 *
 * Sweep budget:
 *   - The sweep stops starting new routers after SWEEP_BUDGET_MS (45 min)
 *     so the job always finishes before the next hourly :50 mark and the
 *     `running` guard is reliably cleared.
 */

/** WireGuard VPS tunnel address — the IP routers are told to use for RADIUS. */
const RADIUS_SERVER_IP = WG_VPS_TUNNEL_IP;

/** How long one router's whole unit (connect→ntp→[radius]→disconnect) may run. */
const DEFAULT_PER_ROUTER_MS = 120_000;

/** Stop starting new routers once the sweep has been running this long. */
const DEFAULT_SWEEP_BUDGET_MS = 45 * 60 * 1000;

/**
 * Don't retry a timed-out router until at least this many ms have passed
 * since its timeout, so a single stuck router can't consume a deadline slot
 * every hour.
 */
const TIMEOUT_BACKOFF_MS = 2 * 60 * 60 * 1000;

let running = false;

/**
 * Router IDs whose NTP client has been confirmed (repaired or already
 * configured) by this process. Skipped on later passes; failures are not
 * added, so they are retried next hour.
 */
const converged = new Set<string>();

/** Per-router attempt tracking for ordering and timeout backoff. */
interface RouterAttempt {
  lastAttemptAt: number;
  timedOutAt?: number;
}
const attempts = new Map<string, RouterAttempt>();

/** Exported so tests can reset state between runs. */
export function _resetJobState(): void {
  running = false;
  converged.clear();
  attempts.clear();
}

interface RouterRow {
  id: string;
  user_id: string;
  tunnel_ip: string;
}

export interface NtpConvergenceResult {
  checked: number;
  repaired: number;
  alreadyConfigured: number;
  failed: number;
  timedOut: number;
  radiusRaised: number;
  radiusAlready: number;
  radiusFailed: number;
  leftForNextRun: number;
}

export async function runNtpConvergence(opts?: {
  /** Override the per-router deadline for tests / local e2e. */
  perRouterMs?: number;
  /** Override the total sweep budget for tests / local e2e. */
  sweepBudgetMs?: number;
}): Promise<NtpConvergenceResult> {
  if (running) {
    logger.info('NTP convergence: previous run still in progress, skipping');
    return {
      checked: 0,
      repaired: 0,
      alreadyConfigured: 0,
      failed: 0,
      timedOut: 0,
      radiusRaised: 0,
      radiusAlready: 0,
      radiusFailed: 0,
      leftForNextRun: 0,
    };
  }
  running = true;

  const perRouterMs = opts?.perRouterMs ?? DEFAULT_PER_ROUTER_MS;
  const sweepBudgetMs = opts?.sweepBudgetMs ?? DEFAULT_SWEEP_BUDGET_MS;

  const startMs = Date.now();
  let checked = 0;
  let repaired = 0;
  let alreadyConfigured = 0;
  let failed = 0;
  let timedOut = 0;
  let radiusRaised = 0;
  let radiusAlready = 0;
  let radiusFailed = 0;
  let leftForNextRun = 0;
  let skipped = 0;

  try {
    const dbResult = await pool.query<RouterRow>(`
      SELECT id, user_id, tunnel_ip
      FROM routers
      WHERE status = 'online'
        AND tunnel_ip IS NOT NULL
        AND api_user IS NOT NULL
        AND api_pass_enc IS NOT NULL
    `);

    const now = Date.now();
    const sweepDeadlineMs = startMs + sweepBudgetMs;

    // Filter: exclude already-converged and timed-out-within-backoff routers.
    const eligible: RouterRow[] = [];
    for (const row of dbResult.rows) {
      if (converged.has(row.id)) {
        skipped++;
        continue;
      }
      const att = attempts.get(row.id);
      if (att?.timedOutAt !== undefined && now - att.timedOutAt < TIMEOUT_BACKOFF_MS) {
        skipped++;
        continue;
      }
      eligible.push(row);
    }

    // Sort: least-recently-attempted first; never-attempted (lastAttemptAt === 0)
    // naturally sort first because 0 is smaller than any real timestamp.
    eligible.sort((a, b) => {
      const aAt = attempts.get(a.id)?.lastAttemptAt ?? 0;
      const bAt = attempts.get(b.id)?.lastAttemptAt ?? 0;
      return aAt - bAt;
    });

    for (let i = 0; i < eligible.length; i++) {
      if (Date.now() >= sweepDeadlineMs) {
        leftForNextRun = eligible.length - i;
        logger.info('NTP convergence: sweep budget reached, deferring remaining routers', {
          leftForNextRun,
        });
        break;
      }

      const row = eligible[i];
      const attemptAt = Date.now();
      attempts.set(row.id, {
        ...(attempts.get(row.id) ?? {}),
        lastAttemptAt: attemptAt,
      });

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
            ctx.step = 'ntp';
            const ntpOutcome = await ensureNtpClient(api);

            let radiusStatus: 'already' | 'raised' | 'none' | 'failed' | 'skipped' = 'skipped';
            if (isRadiusTimeoutRolloutEnabled(row.id)) {
              ctx.step = 'radius-timeout';
              const r = await ensureRadiusTimeout(api, { radiusServerIp: RADIUS_SERVER_IP });
              radiusStatus = r.status;
            }

            return { ntpOutcome, radiusStatus };
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
        // Record the timeout time so we back off for 2 h.
        attempts.set(row.id, {
          lastAttemptAt: attemptAt,
          timedOutAt: attemptAt,
        });
        // The deadline module already logged a warn with routerId and step.
        // Don't double-log — one warn per router per run is enough.
        continue;
      }

      if (deadlineResult.status === 'error') {
        failed++;
        logger.warn('NTP convergence: failed to process router', {
          routerId: row.id,
          tunnelIp: row.tunnel_ip,
          error:
            deadlineResult.error instanceof Error
              ? deadlineResult.error.message
              : String(deadlineResult.error),
        });
        continue;
      }

      // status === 'ok'
      const { ntpOutcome, radiusStatus } = deadlineResult.value;

      // Track per-router RADIUS outcome counters.
      if (radiusStatus === 'raised') {
        radiusRaised++;
      } else if (radiusStatus === 'already') {
        radiusAlready++;
      } else if (radiusStatus === 'failed') {
        radiusFailed++;
      } else if (radiusStatus === 'none') {
        // Router has no Wasel /radius entry — log a warning, but do not
        // block NTP convergence (the RADIUS rollout is a best-effort step).
        logger.warn('NTP convergence: router has no Wasel /radius entry', {
          routerId: row.id,
        });
      }

      // A router counts as converged when NTP succeeded AND
      // (rollout is disabled for it OR radius status is not 'failed').
      const radiusOk =
        radiusStatus === 'skipped' ||
        radiusStatus === 'already' ||
        radiusStatus === 'raised' ||
        radiusStatus === 'none';

      if (ntpOutcome.status === 'repaired') {
        repaired++;
        checked++;
        if (radiusOk) {
          converged.add(row.id);
        }
        // radius failed → radiusFailed already incremented above; not converged,
        // retried next hour. The router is counted in `repaired`+`checked` only —
        // adding it to `failed` too would inflate totals beyond routers processed.
        logger.info('NTP convergence: repaired router', {
          routerId: row.id,
          tunnelIp: row.tunnel_ip,
          detail: ntpOutcome.detail,
        });
      } else if (ntpOutcome.status === 'already_configured') {
        alreadyConfigured++;
        checked++;
        if (radiusOk) {
          converged.add(row.id);
        }
        // radius failed — same reasoning as the `repaired` branch above.
        logger.debug('NTP convergence: router already configured', {
          routerId: row.id,
          tunnelIp: row.tunnel_ip,
        });
      } else {
        // NTP status === 'failed'
        failed++;
        logger.warn('NTP convergence: ensureNtpClient reported failure', {
          routerId: row.id,
          tunnelIp: row.tunnel_ip,
          detail: ntpOutcome.detail,
          error: ntpOutcome.error,
        });
      }
    }

    const durationMs = Date.now() - startMs;
    logger.info('NTP convergence sweep complete', {
      checked,
      repaired,
      alreadyConfigured,
      failed,
      timedOut,
      radiusRaised,
      radiusAlready,
      radiusFailed,
      skipped,
      leftForNextRun,
      durationMs,
    });
  } finally {
    running = false;
  }

  return {
    checked,
    repaired,
    alreadyConfigured,
    failed,
    timedOut,
    radiusRaised,
    radiusAlready,
    radiusFailed,
    leftForNextRun,
  };
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
  // .unref() so this timer can't prevent the process from exiting during tests
  // or a clean shutdown before the 10 min window elapses.
  const startupTimer = setTimeout(() => {
    runNtpConvergence().catch((error) => {
      logger.error('NTP convergence startup pass failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 10 * 60 * 1000);
  startupTimer.unref?.();

  logger.info('NTP convergence job scheduled (hourly at :50, startup pass at +10 min)');
}
