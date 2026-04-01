import * as admin from 'firebase-admin';
import logger from '../config/logger';
import { config } from '../config';
import { redis } from '../config/redis';
import * as deviceTokenService from './deviceToken.service';
import * as notificationPrefsService from './notificationPrefs.service';

// Firebase initialization (graceful no-op if credentials missing)
let fcmAvailable = false;

try {
  if (config.FIREBASE_SERVICE_ACCOUNT_PATH) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const serviceAccount = require(config.FIREBASE_SERVICE_ACCOUNT_PATH);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    fcmAvailable = true;
    logger.info('Firebase Admin SDK initialized');
  } else {
    logger.warn('FIREBASE_SERVICE_ACCOUNT_PATH not set — push notifications disabled');
  }
} catch (err) {
  logger.error('Failed to initialize Firebase Admin SDK', { error: err });
}

// Dedup categories (prevent repeated notifications for same event within 24h)
const DEDUP_CATEGORIES = ['subscription_expiring', 'subscription_expired', 'voucher_quota_low'];

async function sendPushToUser(
  userId: string,
  category: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  try {
    // 1. Check preference
    const enabled = await notificationPrefsService.isNotificationEnabled(userId, category);
    if (!enabled) {
      logger.debug('Notification suppressed by preference', { userId, category });
      return;
    }

    // 2. Dedup check for recurring categories
    if (DEDUP_CATEGORIES.includes(category)) {
      const dedupKey = `notif:${userId}:${category}:${new Date().toISOString().slice(0, 10)}`;
      const exists = await redis.get(dedupKey);
      if (exists) {
        logger.debug('Notification deduplicated', { userId, category });
        return;
      }
      await redis.set(dedupKey, '1', 'EX', 86400);
    }

    // 3. Get device tokens
    const tokens = await deviceTokenService.getTokensForUser(userId);
    if (tokens.length === 0) {
      logger.debug('No device tokens for user', { userId });
      return;
    }

    // 4. Send via FCM or log
    if (!fcmAvailable) {
      logger.info('Push notification (FCM unavailable)', { userId, category, title, body });
      return;
    }

    const message: admin.messaging.MulticastMessage = {
      tokens: tokens.map(t => t.token),
      notification: { title, body },
      data: { category, ...(data || {}) },
      android: { priority: 'high' as const },
      apns: { payload: { aps: { sound: 'default' } } },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    logger.info('Push notification sent', { userId, category, successCount: response.successCount, failureCount: response.failureCount });

    // Cleanup stale tokens
    response.responses.forEach((resp: admin.messaging.SendResponse, idx: number) => {
      if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
        deviceTokenService.removeStaleTokens(tokens[idx].token).catch(() => {});
      }
    });
  } catch (error) {
    logger.error('Failed to send push notification', { userId, category, error });
  }
}

// ---- Public notification functions ----

export async function notifyRouterOffline(params: {
  userId: string; routerId: string; routerName: string; tunnelIp: string; offlineDurationMs: number;
}): Promise<void> {
  const minutes = Math.round(params.offlineDurationMs / 60000);
  await sendPushToUser(params.userId, 'router_offline',
    'Router Offline',
    `${params.routerName} has been offline for ${minutes} minutes`,
    { routerId: params.routerId },
  );
}

export async function notifyRouterOnline(params: {
  userId: string; routerId: string; routerName: string; tunnelIp: string; wasOfflineForMs: number;
}): Promise<void> {
  const minutes = Math.round(params.wasOfflineForMs / 60000);
  await sendPushToUser(params.userId, 'router_online',
    'Router Back Online',
    `${params.routerName} is back online (was offline for ${minutes} min)`,
    { routerId: params.routerId },
  );
}

export async function notifySubscriptionExpiring(userId: string, daysLeft: number): Promise<void> {
  await sendPushToUser(userId, 'subscription_expiring',
    'Subscription Expiring Soon',
    `Your subscription expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}. Renew now to avoid service interruption.`,
  );
}

export async function notifySubscriptionExpired(userId: string): Promise<void> {
  await sendPushToUser(userId, 'subscription_expired',
    'Subscription Expired',
    'Your subscription has expired. Renew to continue managing your routers.',
  );
}

export async function notifyPaymentConfirmed(userId: string, planName: string): Promise<void> {
  await sendPushToUser(userId, 'payment_confirmed',
    'Payment Confirmed',
    `Your ${planName} subscription is now active. Enjoy!`,
  );
}

export async function notifyVoucherQuotaLow(userId: string, percentUsed: number): Promise<void> {
  await sendPushToUser(userId, 'voucher_quota_low',
    'Voucher Quota Running Low',
    `You have used ${percentUsed}% of your monthly voucher quota.`,
  );
}

export async function notifyBulkCreationComplete(userId: string, count: number, routerName: string): Promise<void> {
  await sendPushToUser(userId, 'bulk_creation_complete',
    'Bulk Vouchers Created',
    `${count} vouchers created for ${routerName}.`,
  );
}
