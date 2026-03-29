import logger from '../config/logger';

/**
 * Send a push notification when a router goes offline beyond the grace period.
 * Phase 2: Will integrate with FCM (Android) and APNs (iOS).
 * Currently logs the event for future integration.
 */
export async function notifyRouterOffline(params: {
  userId: string;
  routerId: string;
  routerName: string;
  tunnelIp: string;
  offlineDurationMs: number;
}): Promise<void> {
  logger.warn('Router offline notification (placeholder)', {
    userId: params.userId,
    routerId: params.routerId,
    routerName: params.routerName,
    tunnelIp: params.tunnelIp,
    offlineDurationMs: params.offlineDurationMs,
  });
  // Phase 2: Send FCM/APNs push notification
}

/**
 * Send a push notification when a router comes back online.
 * Phase 2: Will integrate with FCM (Android) and APNs (iOS).
 * Currently logs the event for future integration.
 */
export async function notifyRouterOnline(params: {
  userId: string;
  routerId: string;
  routerName: string;
  tunnelIp: string;
  wasOfflineForMs: number;
}): Promise<void> {
  logger.info('Router online notification (placeholder)', {
    userId: params.userId,
    routerId: params.routerId,
    routerName: params.routerName,
    tunnelIp: params.tunnelIp,
    wasOfflineForMs: params.wasOfflineForMs,
  });
  // Phase 2: Send FCM/APNs push notification
}
