import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';

export interface InboxNotification {
  id: string;
  category: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

interface InboxRow {
  id: string;
  category: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read_at: Date | null;
  created_at: Date;
}

function toInboxNotification(row: InboxRow): InboxNotification {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    data: row.data,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Persist a notification into the user's inbox. Returns the created row id.
 * Safe to call regardless of FCM availability — the inbox is the source of truth.
 */
export async function createNotification(params: {
  userId: string;
  category: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO notifications (user_id, category, title, body, data)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      params.userId,
      params.category,
      params.title,
      params.body,
      params.data ? JSON.stringify(params.data) : null,
    ],
  );
  return result.rows[0].id;
}

/**
 * List a user's notifications newest first with pagination. Returns the page
 * plus the current unread count so the client can refresh its badge.
 */
export async function listNotifications(
  userId: string,
  page: number,
  limit: number,
): Promise<{ items: InboxNotification[]; total: number; unreadCount: number; page: number; limit: number }> {
  const offset = (page - 1) * limit;

  const [itemsResult, countResult, unreadResult] = await Promise.all([
    pool.query<InboxRow>(
      `SELECT id, category, title, body, data, read_at, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1`,
      [userId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    ),
  ]);

  return {
    items: itemsResult.rows.map(toInboxNotification),
    total: parseInt(countResult.rows[0].count, 10),
    unreadCount: parseInt(unreadResult.rows[0].count, 10),
    page,
    limit,
  };
}

export async function getUnreadCount(userId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return parseInt(result.rows[0].count, 10);
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  const result = await pool.query(
    `UPDATE notifications
     SET read_at = NOW()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [notificationId, userId],
  );

  if (result.rowCount === 0) {
    // Could be not-owned, not-found, or already-read. Verify ownership first.
    const owned = await pool.query(
      `SELECT 1 FROM notifications WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [notificationId, userId],
    );
    if (owned.rowCount === 0) {
      throw new AppError(404, 'Notification not found', 'NOTIFICATION_NOT_FOUND');
    }
    // else already read — no-op
  }
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  const updated = result.rowCount ?? 0;
  logger.info('Marked notifications as read', { userId, count: updated });
  return updated;
}

export async function deleteNotification(userId: string, notificationId: string): Promise<void> {
  const result = await pool.query(
    `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
    [notificationId, userId],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'Notification not found', 'NOTIFICATION_NOT_FOUND');
  }
}
