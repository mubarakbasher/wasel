import * as admin from 'firebase-admin';
import logger from '../config/logger';
import { config } from '../config';
import { redis } from '../config/redis';
import { pool } from '../config/database';
import * as deviceTokenService from './deviceToken.service';
import * as notificationPrefsService from './notificationPrefs.service';
import * as inboxService from './inbox.service';
import { buildNotificationText } from '../i18n/notificationStrings';

// Firebase initialization (graceful no-op if credentials missing)
let fcmAvailable = false;
let fcmInitError: string | null = null;

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
  fcmInitError = err instanceof Error ? err.message : String(err);
  logger.error('Failed to initialize Firebase Admin SDK', { error: err });
}

/**
 * Exposes FCM availability to other services (e.g. admin system-status endpoint)
 * without leaking the module-local mutable boolean.
 */
export function isFcmAvailable(): boolean {
  return fcmAvailable;
}

/**
 * Returns the init error message if Firebase init threw during startup
 * (bad service account, missing file, etc). Null when init either
 * succeeded or was skipped because the env var was unset.
 */
export function getFcmInitError(): string | null {
  return fcmInitError;
}

// Dedup categories (prevent repeated notifications for same event within 24h)
const DEDUP_CATEGORIES = ['subscription_expiring', 'subscription_expired', 'voucher_quota_low'];

/**
 * Look up the stored language preference for a user.
 * Returns 'en' if the row is missing or the value is not a recognised locale.
 */
export async function getUserLanguage(userId: string): Promise<'en' | 'ar'> {
  try {
    const result = await pool.query<{ language: string }>(
      'SELECT language FROM users WHERE id = $1',
      [userId],
    );
    const lang = result.rows[0]?.language;
    return lang === 'ar' ? 'ar' : 'en';
  } catch (err) {
    logger.warn('Failed to fetch user language, defaulting to en', { userId, error: err });
    return 'en';
  }
}

/**
 * Core push-notification dispatcher.
 *
 * @param userId   - recipient
 * @param category - notification category key (matches i18n template + dedup logic)
 * @param params   - named placeholder values for the template; also stored verbatim in FCM data
 * @param opts     - optional extra FCM data fields (merged last, category always wins)
 */
async function sendPushToUser(
  userId: string,
  category: string,
  params: Record<string, string>,
  opts?: { extraData?: Record<string, string> },
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

    // 3. Resolve user language and build localized title/body
    const lang = await getUserLanguage(userId);
    const { title, body } = buildNotificationText(category, lang, params);

    // 4. Persist to in-app inbox (source of truth — independent of FCM delivery).
    try {
      const data: Record<string, string> = { ...params, ...(opts?.extraData ?? {}) };
      await inboxService.createNotification({ userId, category, title, body, data });
    } catch (err) {
      logger.error('Failed to persist inbox notification', { error: err, userId, category });
    }

    // 5. Get device tokens
    const tokens = await deviceTokenService.getTokensForUser(userId);
    if (tokens.length === 0) {
      logger.debug('No device tokens for user', { userId });
      return;
    }

    // 6. Send via FCM or log
    if (!fcmAvailable) {
      logger.info('Push notification (FCM unavailable)', { userId, category, title, body });
      return;
    }

    const fcmData: Record<string, string> = {
      category,
      ...params,
      ...(opts?.extraData ?? {}),
    };

    const message: admin.messaging.MulticastMessage = {
      tokens: tokens.map(t => t.token),
      notification: { title, body },
      data: fcmData,
      android: { priority: 'high' as const },
      apns: { payload: { aps: { sound: 'default' } } },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    logger.info('Push notification sent', { userId, category, successCount: response.successCount, failureCount: response.failureCount });

    // Cleanup stale tokens
    response.responses.forEach((resp: admin.messaging.SendResponse, idx: number) => {
      if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
        deviceTokenService
          .removeStaleTokens(tokens[idx].token)
          .catch((err) =>
            logger.warn('Failed to remove stale device token', {
              error: err instanceof Error ? err.message : String(err),
            }),
          );
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
  const minutes = String(Math.round(params.offlineDurationMs / 60000));
  await sendPushToUser(
    params.userId,
    'router_offline',
    { routerId: params.routerId, routerName: params.routerName, minutes },
  );
}

export async function notifyRouterOnline(params: {
  userId: string; routerId: string; routerName: string; tunnelIp: string; wasOfflineForMs: number;
}): Promise<void> {
  const minutes = String(Math.round(params.wasOfflineForMs / 60000));
  await sendPushToUser(
    params.userId,
    'router_online',
    { routerId: params.routerId, routerName: params.routerName, minutes },
  );
}

export async function notifySubscriptionExpiring(userId: string, daysLeft: number): Promise<void> {
  await sendPushToUser(userId, 'subscription_expiring', { daysLeft: String(daysLeft) });
}

export async function notifySubscriptionExpired(userId: string): Promise<void> {
  await sendPushToUser(userId, 'subscription_expired', {});
}

export async function notifyPaymentConfirmed(userId: string, planName: string): Promise<void> {
  await sendPushToUser(userId, 'payment_confirmed', { planName });
}

export async function notifyVoucherQuotaLow(userId: string, percentUsed: number): Promise<void> {
  await sendPushToUser(userId, 'voucher_quota_low', { percentUsed: String(percentUsed) });
}

export async function notifyBulkCreationComplete(userId: string, count: number, routerName: string): Promise<void> {
  await sendPushToUser(userId, 'bulk_creation_complete', { count: String(count), routerName });
}

export async function notifySupportReply(userId: string, preview: string): Promise<void> {
  await sendPushToUser(userId, 'support_reply', { preview });
}
