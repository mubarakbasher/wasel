import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { notifySupportReply } from './notification.service';

export interface SupportMessage {
  id: string;
  sender: 'user' | 'admin';
  body: string;
  readAt: string | null;
  createdAt: string;
}

interface SupportRow {
  id: string;
  sender: 'user' | 'admin';
  body: string;
  read_at: Date | null;
  created_at: Date;
}

function toMessage(row: SupportRow): SupportMessage {
  return {
    id: row.id,
    sender: row.sender,
    body: row.body,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// ---------- User side ----------

export async function listMessages(
  userId: string,
  page: number,
  limit: number,
): Promise<{ items: SupportMessage[]; total: number; unreadAdminCount: number; page: number; limit: number }> {
  const offset = (page - 1) * limit;
  const [items, total, unread] = await Promise.all([
    pool.query<SupportRow>(
      `SELECT id, sender, body, read_at, created_at
       FROM support_messages
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM support_messages WHERE user_id = $1`,
      [userId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM support_messages
       WHERE user_id = $1 AND sender = 'admin' AND read_at IS NULL`,
      [userId],
    ),
  ]);
  return {
    items: items.rows.map(toMessage),
    total: parseInt(total.rows[0].count, 10),
    unreadAdminCount: parseInt(unread.rows[0].count, 10),
    page,
    limit,
  };
}

export async function sendUserMessage(userId: string, body: string): Promise<SupportMessage> {
  const result = await pool.query<SupportRow>(
    `INSERT INTO support_messages (user_id, sender, body)
     VALUES ($1, 'user', $2)
     RETURNING id, sender, body, read_at, created_at`,
    [userId, body],
  );
  logger.info('Support message sent by user', { userId, messageId: result.rows[0].id });
  return toMessage(result.rows[0]);
}

export async function markAdminMessagesRead(userId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE support_messages SET read_at = NOW()
     WHERE user_id = $1 AND sender = 'admin' AND read_at IS NULL`,
    [userId],
  );
  return result.rowCount ?? 0;
}

// ---------- Admin side ----------

export interface ConversationSummary {
  userId: string;
  userName: string;
  userEmail: string;
  lastMessageBody: string;
  lastMessageSender: 'user' | 'admin';
  lastMessageAt: string;
  unreadUserCount: number;
}

export async function listConversations(
  page: number,
  limit: number,
  search?: string,
): Promise<{ items: ConversationSummary[]; total: number; page: number; limit: number }> {
  const offset = (page - 1) * limit;
  const params: unknown[] = [];
  let searchClause = '';
  if (search) {
    params.push(`%${search}%`);
    searchClause = `AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
  }

  const baseCTE = `
    WITH latest AS (
      SELECT DISTINCT ON (m.user_id)
             m.user_id, m.body, m.sender, m.created_at
      FROM support_messages m
      ORDER BY m.user_id, m.created_at DESC
    ),
    unread AS (
      SELECT user_id, COUNT(*)::int AS count
      FROM support_messages
      WHERE sender = 'user' AND read_at IS NULL
      GROUP BY user_id
    )
  `;

  params.push(limit, offset);
  const itemsResult = await pool.query<{
    user_id: string;
    user_name: string;
    user_email: string;
    body: string;
    sender: 'user' | 'admin';
    created_at: Date;
    unread_count: number | null;
  }>(
    `${baseCTE}
     SELECT l.user_id, u.name AS user_name, u.email AS user_email,
            l.body, l.sender, l.created_at,
            COALESCE(ur.count, 0) AS unread_count
     FROM latest l
     JOIN users u ON u.id = l.user_id
     LEFT JOIN unread ur ON ur.user_id = l.user_id
     WHERE 1=1 ${searchClause}
     ORDER BY l.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const totalParams: unknown[] = search ? [`%${search}%`] : [];
  const totalResult = await pool.query<{ count: string }>(
    `WITH latest AS (
       SELECT DISTINCT ON (m.user_id) m.user_id FROM support_messages m
     )
     SELECT COUNT(*) AS count FROM latest l
     JOIN users u ON u.id = l.user_id
     ${search ? `WHERE u.name ILIKE $1 OR u.email ILIKE $1` : ''}`,
    totalParams,
  );

  return {
    items: itemsResult.rows.map((r) => ({
      userId: r.user_id,
      userName: r.user_name,
      userEmail: r.user_email,
      lastMessageBody: r.body,
      lastMessageSender: r.sender,
      lastMessageAt: new Date(r.created_at).toISOString(),
      unreadUserCount: Number(r.unread_count) || 0,
    })),
    total: parseInt(totalResult.rows[0].count, 10),
    page,
    limit,
  };
}

export async function listConversationMessages(
  userId: string,
  page: number,
  limit: number,
): Promise<{ items: SupportMessage[]; total: number; page: number; limit: number; user: { id: string; name: string; email: string } | null }> {
  const offset = (page - 1) * limit;
  const [userResult, items, total] = await Promise.all([
    pool.query<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    ),
    pool.query<SupportRow>(
      `SELECT id, sender, body, read_at, created_at
       FROM support_messages
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM support_messages WHERE user_id = $1`,
      [userId],
    ),
  ]);

  return {
    items: items.rows.map(toMessage),
    total: parseInt(total.rows[0].count, 10),
    page,
    limit,
    user: userResult.rows[0] ?? null,
  };
}

export async function sendAdminMessage(
  userId: string,
  adminId: string,
  body: string,
): Promise<SupportMessage> {
  // Verify the user exists so we don't create orphan conversations.
  const exists = await pool.query(`SELECT 1 FROM users WHERE id = $1 LIMIT 1`, [userId]);
  if (exists.rowCount === 0) {
    throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  }

  const result = await pool.query<SupportRow>(
    `INSERT INTO support_messages (user_id, sender, admin_id, body)
     VALUES ($1, 'admin', $2, $3)
     RETURNING id, sender, body, read_at, created_at`,
    [userId, adminId, body],
  );

  const message = toMessage(result.rows[0]);
  logger.info('Support message sent by admin', { userId, adminId, messageId: message.id });

  // Fire inbox/push notification — fire-and-forget.
  const preview = body.length > 80 ? body.slice(0, 77) + '...' : body;
  notifySupportReply(userId, preview).catch((err) => {
    logger.error('Failed to send support_reply notification', { userId, err });
  });

  return message;
}

export async function markUserMessagesRead(userId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE support_messages SET read_at = NOW()
     WHERE user_id = $1 AND sender = 'user' AND read_at IS NULL`,
    [userId],
  );
  return result.rowCount ?? 0;
}

export async function getAdminUnreadCount(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM support_messages
     WHERE sender = 'user' AND read_at IS NULL`,
  );
  return parseInt(result.rows[0].count, 10);
}
