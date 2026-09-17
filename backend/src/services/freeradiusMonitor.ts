import logger from '../config/logger';
import { Sentry, sentryEnabled } from '../config/sentry';
import { config } from '../config';
import { sendStatusServer } from './radclient.service';
import { getFreeradiusStartTime } from './freeradius.service';

// ---------------------------------------------------------------------------
// Module state — persists across monitoring ticks, reset for tests.
// ---------------------------------------------------------------------------

/**
 * Number of consecutive Status-Server probe failures since the last success.
 * Resets to 0 on the first successful probe after a string of failures.
 */
let consecutiveFailures = 0;

/**
 * True while a "not responding" alarm episode is active. Prevents the same
 * alarm from re-firing on every subsequent failing tick within one episode.
 * Cleared when FreeRADIUS answers again.
 */
let radiusAlarmActive = false;

/**
 * The last non-null `show uptime` value (e.g. "Thu Sep 12 04:10:17 2026").
 * null = either the first read (baseline, no restart check yet) or radmin was
 * unreachable on all reads so far.
 */
let lastKnownStartTime: string | null = null;

/**
 * Whether we have ever received a non-null start time. The very first read is
 * treated as baseline only — we do not alarm on it even if it's different from
 * null (there is no "previous" value to compare against).
 */
let startTimeBaselineSet = false;

/**
 * Consecutive ticks where `getFreeradiusStartTime()` returned null while
 * Status-Server was responding. Resets when a non-null start time is received.
 */
let radminFailures = 0;

/**
 * True while a "control socket unreachable" alarm episode is active (3+
 * consecutive radmin nulls while RADIUS itself responds). Cleared when
 * radmin succeeds again.
 */
let radminAlarmActive = false;

/**
 * True if checkFreeradius() is currently running. Prevents a slow tick from
 * overlapping with the next interval.
 */
let inFlight = false;

// ---------------------------------------------------------------------------
// Core probe
// ---------------------------------------------------------------------------

/**
 * Run a single FreeRADIUS health cycle:
 *
 * 1. Probe Status-Server. Two consecutive failures → one Sentry error per
 *    episode; recovery → one Sentry info.
 *
 * 2. While responding: probe `show uptime` via radmin.
 *    - null three times in a row → one Sentry warning "control socket
 *      unreachable" (eviction calls would silently fail).
 *    - Non-null + different from the previous non-null value → Sentry warning
 *      "FreeRADIUS restarted" (the watchdog may have recycled it).
 *
 * In-flight guard: if a previous tick is still executing, skip immediately.
 */
export async function checkFreeradius(): Promise<void> {
  if (inFlight) {
    logger.warn('freeradiusMonitor: previous tick still running, skipping');
    return;
  }
  inFlight = true;

  try {
    // ── Status-Server probe ─────────────────────────────────────────────────
    const probe = await sendStatusServer({ timeoutMs: 3_000 });

    if (!probe.responding) {
      consecutiveFailures++;
      logger.warn('freeradiusMonitor: Status-Server not responding', {
        consecutiveFailures,
        outcome: probe.outcome,
        latencyMs: probe.latencyMs,
      });

      // Fire the alarm on the second consecutive failure (first failure might
      // be a transient network blip; two in a row means the process is likely
      // hung or the container has crashed). Only one alarm per episode.
      if (consecutiveFailures >= 2 && !radiusAlarmActive) {
        radiusAlarmActive = true;
        logger.error('freeradiusMonitor: FreeRADIUS not answering Status-Server', {
          consecutiveFailures,
          outcome: probe.outcome,
        });
        if (sentryEnabled) {
          Sentry.captureMessage('FreeRADIUS not answering Status-Server', {
            level: 'error',
            tags: { monitor: 'freeradius' },
            extra: { consecutiveFailures, outcome: probe.outcome },
          });
        }
      }
      return;
    }

    // ── Probe succeeded ─────────────────────────────────────────────────────
    const wasAlarmed = radiusAlarmActive;
    consecutiveFailures = 0;
    radiusAlarmActive = false;

    if (wasAlarmed) {
      logger.info('freeradiusMonitor: FreeRADIUS answering again', {
        latencyMs: probe.latencyMs,
        outcome: probe.outcome,
      });
      if (sentryEnabled) {
        Sentry.captureMessage('FreeRADIUS answering again', {
          level: 'info',
          tags: { monitor: 'freeradius' },
          extra: { latencyMs: probe.latencyMs },
        });
      }
    }

    // ── Radmin uptime probe (only when RADIUS is responding) ────────────────
    const startTime = await getFreeradiusStartTime();

    if (startTime === null) {
      radminFailures++;
      logger.warn('freeradiusMonitor: getFreeradiusStartTime returned null', {
        radminFailures,
      });

      // Warn once per episode after 3 consecutive nulls. If radmin is down
      // while the RADIUS port is alive, evictDynamicClient calls will fail
      // silently — operators need to know before the next router create/delete.
      if (radminFailures >= 3 && !radminAlarmActive) {
        radminAlarmActive = true;
        logger.warn('freeradiusMonitor: FreeRADIUS control socket unreachable', {
          radminFailures,
        });
        if (sentryEnabled) {
          Sentry.captureMessage('FreeRADIUS control socket unreachable', {
            level: 'warning',
            tags: { monitor: 'freeradius' },
            extra: { radminFailures },
          });
        }
      }
      return;
    }

    // Radmin is responding — reset the failure counter and episode flag.
    radminFailures = 0;
    radminAlarmActive = false;

    if (!startTimeBaselineSet) {
      // First successful read — treat as baseline, do not alarm.
      startTimeBaselineSet = true;
      lastKnownStartTime = startTime;
      logger.info('freeradiusMonitor: baseline start time recorded', { startTime });
      return;
    }

    if (startTime !== lastKnownStartTime) {
      // The start time changed — FreeRADIUS restarted between ticks. This is
      // expected when the watchdog kills it, but operators should know so they
      // can verify the restart was intentional and RADIUS is serving traffic.
      logger.warn('freeradiusMonitor: FreeRADIUS restarted', {
        previous: lastKnownStartTime,
        current: startTime,
      });
      if (sentryEnabled) {
        Sentry.captureMessage('FreeRADIUS restarted', {
          level: 'warning',
          tags: { monitor: 'freeradius' },
          extra: { previous: lastKnownStartTime, current: startTime },
        });
      }
      lastKnownStartTime = startTime;
    }
  } finally {
    inFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the periodic FreeRADIUS health monitor.
 *
 * Uses `config.FREERADIUS_MONITOR_INTERVAL_MS`. If the interval is 0, the
 * monitor is disabled (useful in dev/test without a FreeRADIUS container).
 *
 * Returns the interval handle, or null if the monitor is disabled.
 */
export function startFreeradiusMonitor(): NodeJS.Timeout | null {
  const intervalMs = config.FREERADIUS_MONITOR_INTERVAL_MS;

  if (intervalMs === 0) {
    logger.info('freeradiusMonitor: disabled (FREERADIUS_MONITOR_INTERVAL_MS=0)');
    return null;
  }

  logger.info('freeradiusMonitor: started', { intervalMs });

  // Run on interval only — no immediate first tick so boot probes
  // (Status-Server, socket check from admin endpoint) don't pile up.
  return setInterval(() => {
    checkFreeradius().catch((err) => {
      logger.error('freeradiusMonitor: unexpected error in checkFreeradius', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, intervalMs);
}

/**
 * Reset all module-level state.
 *
 * FOR TESTING ONLY — not part of the production API. Allows test suites to
 * run isolated tick sequences without reloading the module.
 */
export function _resetFreeradiusMonitorState(): void {
  consecutiveFailures = 0;
  radiusAlarmActive = false;
  lastKnownStartTime = null;
  startTimeBaselineSet = false;
  radminFailures = 0;
  radminAlarmActive = false;
  inFlight = false;
}
