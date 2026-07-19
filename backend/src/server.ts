// Sentry must initialize before the rest of the app loads (import order matters).
import { Sentry } from './config/sentry';
import app from './app';
import { config } from './config';
import logger from './config/logger';
import { testDbConnection, pool } from './config/database';
import { redis } from './config/redis';
import { startPurgeUnverifiedJob } from './jobs/purgeUnverified';
import { startPurgeEmailLogJob } from './jobs/purgeEmailLog';
import { startSnapshotMetricsJob } from './jobs/snapshotMetrics';
import { startSubscriptionNotificationJob } from './jobs/subscriptionNotifications';
import { startQuotaMonitorJob } from './jobs/quotaMonitor';
import { startValidityExpirationJob } from './jobs/validityExpiration';
import { startValidityCoaDisconnectJob } from './jobs/validityCoaDisconnect';
import { startDataUsageCoaDisconnectJob } from './jobs/dataUsageCoaDisconnect';
import { startUsageLimitEnforcementJob } from './jobs/usageLimitEnforcement';
import { startStaleSessionReaperJob } from './jobs/staleSessionReaper';
import { startMonitoring } from './services/wireguardMonitor';
import { syncPeersFromDatabase } from './services/wireguardPeer';
import { verifyServerEndpointResolves } from './services/wireguardConfig';
import { runMigrations } from './migrations/runner';

// ── Crash handlers ────────────────────────────────────────────────────────────
// Log and exit so Docker's restart: unless-stopped cycles the container cleanly.

process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception — exiting', {
    error: err.message,
    stack: err.stack,
  });
  Sentry.captureException(err);
  // Give Sentry up to 2 s to deliver the event, then exit either way.
  void Sentry.flush(2000).finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection — exiting', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  Sentry.captureException(reason);
  void Sentry.flush(2000).finally(() => process.exit(1));
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function registerShutdownHandlers(server: ReturnType<typeof app.listen>): void {
  async function shutdown(signal: string): Promise<void> {
    logger.info(`${signal} received, shutting down gracefully`);

    // Hard-kill timeout: if the chain takes > 30 s, bail out.
    const killTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 30_000);
    killTimer.unref(); // don't keep the event loop alive

    try {
      // 1. Stop accepting new connections; wait for in-flight requests.
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );

      // 2. Disconnect Redis.
      await redis.disconnect();
      logger.info('Redis disconnected');

      // 3. Close DB pool.
      await pool.end();
      logger.info('DB pool closed');

      clearTimeout(killTimer);
      process.exit(0);
    } catch (err) {
      logger.error('Error during graceful shutdown', {
        error: err instanceof Error ? err.message : String(err),
      });
      clearTimeout(killTimer);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function startServer(): Promise<void> {
  try {
    // Test database connection
    await testDbConnection();

    // Run pending database migrations
    await runMigrations();

    // Test Redis connection
    await redis.ping();
    logger.info('Redis ping successful');

    // Best-effort DNS check for WG_SERVER_ENDPOINT so a typo'd hostname
    // is surfaced in the boot log. Never throws — bare IPs resolve to
    // themselves, DNS outages are logged as WARN.
    await verifyServerEndpointResolves();

    // Restore WireGuard peers before monitoring starts
    try {
      await syncPeersFromDatabase();
    } catch (error) {
      logger.warn('WireGuard peer sync failed on startup (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Start background jobs
    startPurgeUnverifiedJob();
    startPurgeEmailLogJob();
    startSnapshotMetricsJob();
    startSubscriptionNotificationJob();
    startQuotaMonitorJob();
    startValidityExpirationJob();
    startValidityCoaDisconnectJob();
    startDataUsageCoaDisconnectJob();
    startUsageLimitEnforcementJob();
    startStaleSessionReaperJob();
    startMonitoring();

    // Start HTTP server. Bind explicitly to 0.0.0.0 (IPv4) rather than letting
    // Node default to IPv6 dual-stack `::` — WSL2's wslrelay only mirrors the
    // address family the inner process bound, so an IPv6 bind leaves Windows-
    // side adb-reverse / netsh portproxy targets unable to reach the server.
    // Containerised prod expects 0.0.0.0 binding too, so this is harmless there.
    const server = app.listen(config.PORT, '0.0.0.0', () => {
      logger.info(`Server running on port ${config.PORT}`, {
        env: config.NODE_ENV,
        port: config.PORT,
      });
    });

    registerShutdownHandlers(server);
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to start server', {
      message: err?.message,
      name: err?.name,
      stack: err?.stack,
      raw: String(error),
    });
    process.exit(1);
  }
}

startServer();
