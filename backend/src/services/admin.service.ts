import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { notifyPaymentConfirmed } from './notification.service';

// ----- Interfaces -----

interface PaginatedResult<T> {
  total: number;
  page: number;
  limit: number;
  [key: string]: T[] | number;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  business_name: string | null;
  is_verified: boolean;
  is_active: boolean;
  role: string;
  created_at: string;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_tier: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  voucher_quota: number;
  created_at: string;
  user_name: string;
  user_email: string;
}

interface PaymentRow {
  id: string;
  user_id: string;
  amount: number;
  status: string;
  plan_tier: string;
  proof_url: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  user_name: string;
  user_email: string;
}

interface RouterRow {
  id: string;
  name: string;
  status: string;
  user_id: string;
  tunnel_ip: string | null;
  last_seen: string | null;
  created_at: string;
  owner_name: string;
  owner_email: string;
}

interface AuditLogRow {
  id: string;
  admin_id: string;
  action: string;
  target_entity: string;
  target_id: string;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  admin_name: string | null;
}

interface AdminStats {
  totalUsers: number;
  subscriptionsByStatus: Record<string, number>;
  pendingPayments: number;
  totalRevenue: number;
  routersByStatus: Record<string, number>;
  totalVouchers: number;
}

// ----- Service functions -----

/**
 * Get paginated list of users with optional search and status filters.
 */
export async function getUsers(
  page: number,
  limit: number,
  search?: string,
  status?: string,
): Promise<{ users: UserRow[]; total: number; page: number; limit: number }> {
  const conditions: string[] = ["role != 'admin'"];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (search) {
    conditions.push(`(name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (status === 'active') {
    conditions.push(`is_active = true`);
  } else if (status === 'inactive') {
    conditions.push(`is_active = false`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, name, email, phone, business_name, is_verified, is_active, role, created_at
       FROM users
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    ),
    pool.query(
      `SELECT COUNT(*) AS count FROM users ${whereClause}`,
      params,
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  logger.info('Admin fetched users', { page, limit, search, status, total });

  return { users: dataResult.rows, total, page, limit };
}

/**
 * Update a non-admin user's details.
 */
export async function updateUser(
  userId: string,
  data: { name?: string; email?: string; is_active?: boolean },
): Promise<UserRow> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    params.push(data.name);
  }
  if (data.email !== undefined) {
    setClauses.push(`email = $${paramIndex++}`);
    params.push(data.email);
  }
  if (data.is_active !== undefined) {
    setClauses.push(`is_active = $${paramIndex++}`);
    params.push(data.is_active);
  }

  if (setClauses.length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  setClauses.push(`updated_at = NOW()`);

  const result = await pool.query(
    `UPDATE users
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND role != 'admin'
     RETURNING id, name, email, phone, business_name, is_verified, is_active, role, created_at`,
    [...params, userId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'User not found or cannot modify admin users');
  }

  logger.info('Admin updated user', { userId, fields: Object.keys(data) });

  return result.rows[0];
}

/**
 * Delete a non-admin user.
 */
export async function deleteUser(userId: string): Promise<void> {
  // First check if the user exists and their role
  const userResult = await pool.query(
    `SELECT id, role FROM users WHERE id = $1`,
    [userId],
  );

  if (userResult.rowCount === 0) {
    throw new AppError(404, 'User not found');
  }

  if (userResult.rows[0].role === 'admin') {
    throw new AppError(403, 'Cannot delete admin users');
  }

  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);

  logger.info('Admin deleted user', { userId });
}

/**
 * Get paginated list of subscriptions with optional filters.
 */
export async function getSubscriptions(
  page: number,
  limit: number,
  status?: string,
  userId?: string,
): Promise<{ subscriptions: SubscriptionRow[]; total: number; page: number; limit: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`s.status = $${paramIndex++}`);
    params.push(status);
  }

  if (userId) {
    conditions.push(`s.user_id = $${paramIndex++}`);
    params.push(userId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT s.*, u.name AS user_name, u.email AS user_email
       FROM subscriptions s
       JOIN users u ON s.user_id = u.id
       ${whereClause}
       ORDER BY s.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    ),
    pool.query(
      `SELECT COUNT(*) AS count
       FROM subscriptions s
       JOIN users u ON s.user_id = u.id
       ${whereClause}`,
      params,
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  logger.info('Admin fetched subscriptions', { page, limit, status, userId, total });

  return { subscriptions: dataResult.rows, total, page, limit };
}

/**
 * Update a subscription's details.
 */
export async function updateSubscription(
  subId: string,
  data: { status?: string; plan_tier?: string; end_date?: string; voucher_quota?: number },
): Promise<SubscriptionRow> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.status !== undefined) {
    setClauses.push(`status = $${paramIndex++}`);
    params.push(data.status);
  }
  if (data.plan_tier !== undefined) {
    setClauses.push(`plan_tier = $${paramIndex++}`);
    params.push(data.plan_tier);
  }
  if (data.end_date !== undefined) {
    setClauses.push(`end_date = $${paramIndex++}`);
    params.push(data.end_date);
  }
  if (data.voucher_quota !== undefined) {
    setClauses.push(`voucher_quota = $${paramIndex++}`);
    params.push(data.voucher_quota);
  }

  if (setClauses.length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  setClauses.push(`updated_at = NOW()`);

  const result = await pool.query(
    `UPDATE subscriptions
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    [...params, subId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'Subscription not found');
  }

  logger.info('Admin updated subscription', { subId, fields: Object.keys(data) });

  return result.rows[0];
}

/**
 * Get paginated list of payments with optional status filter.
 */
export async function getPayments(
  page: number,
  limit: number,
  status?: string,
): Promise<{ payments: PaymentRow[]; total: number; page: number; limit: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  const filterStatus = status || 'pending';
  conditions.push(`p.status = $${paramIndex++}`);
  params.push(filterStatus);

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT p.*, u.name AS user_name, u.email AS user_email
       FROM payments p
       JOIN users u ON p.user_id = u.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    ),
    pool.query(
      `SELECT COUNT(*) AS count
       FROM payments p
       JOIN users u ON p.user_id = u.id
       ${whereClause}`,
      params,
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  logger.info('Admin fetched payments', { page, limit, status: filterStatus, total });

  return { payments: dataResult.rows, total, page, limit };
}

/**
 * Review a pending payment (approve or reject) and activate subscription if approved.
 */
export async function reviewPayment(
  paymentId: string,
  adminId: string,
  decision: 'approved' | 'rejected',
): Promise<PaymentRow> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Update the payment status
    const paymentResult = await client.query(
      `UPDATE payments
       SET status = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [decision, adminId, paymentId],
    );

    if (paymentResult.rowCount === 0) {
      throw new AppError(404, 'Payment not found or already reviewed');
    }

    const payment = paymentResult.rows[0];

    // 2. If approved, activate the matching pending subscription
    if (decision === 'approved') {
      await client.query(
        `UPDATE subscriptions
         SET status = 'active', start_date = NOW(), end_date = NOW() + INTERVAL '30 days', updated_at = NOW()
         WHERE user_id = $1 AND status = 'pending'`,
        [payment.user_id],
      );
    }

    await client.query('COMMIT');

    // 3. Send notification if approved (outside transaction — non-critical)
    if (decision === 'approved') {
      try {
        await notifyPaymentConfirmed(payment.user_id, payment.plan_tier);
      } catch (error) {
        logger.error('Failed to send payment confirmation notification', { error, paymentId });
      }
    }

    logger.info('Admin reviewed payment', { paymentId, adminId, decision });

    return payment;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get aggregated admin statistics.
 */
export async function getStats(): Promise<AdminStats> {
  const [
    usersResult,
    subscriptionsResult,
    pendingPaymentsResult,
    revenueResult,
    routersResult,
    vouchersResult,
  ] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS count FROM users WHERE role = 'user'`),
    pool.query(`SELECT status, COUNT(*) AS count FROM subscriptions GROUP BY status`),
    pool.query(`SELECT COUNT(*) AS count FROM payments WHERE status = 'pending'`),
    pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'approved'`),
    pool.query(`SELECT status, COUNT(*) AS count FROM routers GROUP BY status`),
    pool.query(`SELECT COUNT(*) AS count FROM voucher_meta`),
  ]);

  const subscriptionsByStatus: Record<string, number> = {};
  for (const row of subscriptionsResult.rows) {
    subscriptionsByStatus[row.status] = parseInt(row.count, 10);
  }

  const routersByStatus: Record<string, number> = {};
  for (const row of routersResult.rows) {
    routersByStatus[row.status] = parseInt(row.count, 10);
  }

  const stats: AdminStats = {
    totalUsers: parseInt(usersResult.rows[0].count, 10),
    subscriptionsByStatus,
    pendingPayments: parseInt(pendingPaymentsResult.rows[0].count, 10),
    totalRevenue: parseFloat(revenueResult.rows[0].total),
    routersByStatus,
    totalVouchers: parseInt(vouchersResult.rows[0].count, 10),
  };

  logger.info('Admin fetched stats', { totalUsers: stats.totalUsers });

  return stats;
}

/**
 * Get paginated list of routers with optional filters.
 */
export async function getRouters(
  page: number,
  limit: number,
  status?: string,
  search?: string,
): Promise<{ routers: RouterRow[]; total: number; page: number; limit: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`r.status = $${paramIndex++}`);
    params.push(status);
  }

  if (search) {
    conditions.push(`(r.name ILIKE $${paramIndex} OR u.name ILIKE $${paramIndex})`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT r.*, u.name AS owner_name, u.email AS owner_email
       FROM routers r
       JOIN users u ON r.user_id = u.id
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    ),
    pool.query(
      `SELECT COUNT(*) AS count
       FROM routers r
       JOIN users u ON r.user_id = u.id
       ${whereClause}`,
      params,
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  logger.info('Admin fetched routers', { page, limit, status, search, total });

  return { routers: dataResult.rows, total, page, limit };
}

/**
 * Get paginated audit logs with optional filters.
 */
export async function getAuditLogs(
  page: number,
  limit: number,
  adminId?: string,
  action?: string,
  targetEntity?: string,
  from?: string,
  to?: string,
): Promise<{ logs: AuditLogRow[]; total: number; page: number; limit: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (adminId) {
    conditions.push(`al.admin_id = $${paramIndex++}`);
    params.push(adminId);
  }

  if (action) {
    conditions.push(`al.action ILIKE $${paramIndex++}`);
    params.push(`%${action}%`);
  }

  if (targetEntity) {
    conditions.push(`al.target_entity = $${paramIndex++}`);
    params.push(targetEntity);
  }

  if (from) {
    conditions.push(`al.created_at >= $${paramIndex++}`);
    params.push(from);
  }

  if (to) {
    conditions.push(`al.created_at <= $${paramIndex++}`);
    params.push(to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT al.*, u.name AS admin_name
       FROM audit_logs al
       LEFT JOIN users u ON al.admin_id = u.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    ),
    pool.query(
      `SELECT COUNT(*) AS count
       FROM audit_logs al
       LEFT JOIN users u ON al.admin_id = u.id
       ${whereClause}`,
      params,
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  logger.info('Admin fetched audit logs', { page, limit, adminId, action, targetEntity, total });

  return { logs: dataResult.rows, total, page, limit };
}
