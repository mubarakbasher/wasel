import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as deviceTokenService from '../services/deviceToken.service';
import * as notificationPrefsService from '../services/notificationPrefs.service';
import * as inboxService from '../services/inbox.service';

export async function registerToken(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await deviceTokenService.registerToken(req.user!.id, req.body.token, req.body.platform);
    res.status(200).json({
      success: true,
      data: { message: 'Device token registered' },
    });
  } catch (error) {
    next(error);
  }
}

export async function unregisterToken(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await deviceTokenService.unregisterToken(req.user!.id, req.body.token);
    res.status(200).json({
      success: true,
      data: { message: 'Device token unregistered' },
    });
  } catch (error) {
    next(error);
  }
}

export async function getPreferences(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const preferences = await notificationPrefsService.getPreferences(req.user!.id);

    // All available categories with defaults (true if not explicitly set)
    const allCategories = [
      'router_offline',
      'router_online',
      'subscription_expiring',
      'subscription_expired',
      'payment_confirmed',
      'voucher_quota_low',
      'bulk_creation_complete',
      'support_reply',
    ];

    const prefsMap = new Map(preferences.map(p => [p.category, p.enabled]));
    const fullPreferences = allCategories.map((category) => ({
      category,
      enabled: prefsMap.has(category) ? prefsMap.get(category)! : true,
    }));

    res.status(200).json({
      success: true,
      data: { preferences: fullPreferences },
    });
  } catch (error) {
    next(error);
  }
}

export async function updatePreferences(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await notificationPrefsService.updatePreferences(req.user!.id, req.body.preferences);
    res.status(200).json({
      success: true,
      data: { message: 'Notification preferences updated' },
    });
  } catch (error) {
    next(error);
  }
}

// ---- In-app inbox ----

export async function listInbox(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit } = req.query as Record<string, string>;
    const result = await inboxService.listNotifications(
      req.user!.id,
      Number(page) || 1,
      Number(limit) || 20,
    );
    res.status(200).json({
      success: true,
      data: result.items,
      meta: { page: result.page, limit: result.limit, total: result.total, unreadCount: result.unreadCount },
    });
  } catch (error) {
    next(error);
  }
}

export async function markNotificationRead(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await inboxService.markRead(req.user!.id, req.params.id as string);
    const unreadCount = await inboxService.getUnreadCount(req.user!.id);
    res.status(200).json({ success: true, data: { unreadCount } });
  } catch (error) {
    next(error);
  }
}

export async function markAllNotificationsRead(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const count = await inboxService.markAllRead(req.user!.id);
    res.status(200).json({ success: true, data: { markedCount: count, unreadCount: 0 } });
  } catch (error) {
    next(error);
  }
}

export async function deleteNotification(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await inboxService.deleteNotification(req.user!.id, req.params.id as string);
    const unreadCount = await inboxService.getUnreadCount(req.user!.id);
    res.status(200).json({ success: true, data: { unreadCount } });
  } catch (error) {
    next(error);
  }
}
