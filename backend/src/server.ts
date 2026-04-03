import app from './app';
import { config } from './config';
import logger from './config/logger';
import { testDbConnection } from './config/database';
import { redis } from './config/redis';
import { startPurgeUnverifiedJob } from './jobs/purgeUnverified';
import { startSubscriptionNotificationJob } from './jobs/subscriptionNotifications';
import { startQuotaMonitorJob } from './jobs/quotaMonitor';
import { startMonitoring } from './services/wireguardMonitor';
import { syncPeersFromDatabase } from './services/wireguardPeer';

async function startServer(): Promise<void> {
  try {
    // Test database connection
    await testDbConnection();

    // Test Redis connection
    await redis.ping();
    logger.info('Redis ping successful');

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
    startSubscriptionNotificationJob();
    startQuotaMonitorJob();
    startMonitoring();

    // Start HTTP server
    app.listen(config.PORT, () => {
      logger.info(`Server running on port ${config.PORT}`, {
        env: config.NODE_ENV,
        port: config.PORT,
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  redis.disconnect();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  redis.disconnect();
  process.exit(0);
});

startServer();
