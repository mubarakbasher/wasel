import bcrypt from 'bcrypt';
import { pool } from '../config/database';
import { redis } from '../config/redis';
import { config } from '../config';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { notifyPaymentConfirmed, isFcmAvailable, getFcmInitError } from './notification.service';
import { getActiveSubscription, SubscriptionInfo } from './subscription.service';

const BCRYPT_ROUNDS = 12;

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
  currency: string;
  reference_code: string | null;
  receipt_url: string | null;
  rejection_reason: string | null;
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

interface UserDetailRouterRow {
  id: string;
  name: string;
  model: string | null;
  status: string;
  tunnel_ip: string | null;
  created_at: string;
}

interface UserDetailResult {
  user: UserRow;
  subscription: SubscriptionInfo | null;
  routers: UserDetailRouterRow[];
  routerCount: number;
}

/**
 * Get full detail for a single user: profile, active subscription, and routers list.
 * Throws 404 if the user does not exist.
 */
export async function getUserDetail(userId: string): Promise<UserDetailResult> {
  const userResult = await pool.query<UserRow>(
    `SELECT id, name, email, phone, business_name, is_verified, is_active, role, created_at
     FROM users
     WHERE id = $1`,
    [userId],
  );

  if (userResult.rows.length === 0) {
    throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  }

  const user = userResult.rows[0];

  const [subscription, routersResult] = await Promise.all([
    getActiveSubscription(userId),
    pool.query<UserDetailRouterRow>(
      `SELECT id, name, model, status, tunnel_ip, created_at
       FROM routers
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    ),
  ]);

  const routers = routersResult.rows;

  logger.info('Admin fetched user detail', { userId, routerCount: routers.length });

  return { user, subscription, routers, routerCount: routers.length };
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
 * Delete a subscription.
 */
export async function deleteSubscription(subId: string): Promise<void> {
  const result = await pool.query(
    `DELETE FROM subscriptions WHERE id = $1`,
    [subId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'Subscription not found');
  }

  logger.info('Admin deleted subscription', { subId });
}

// ----- Plan management -----

interface PlanRow {
  id: string;
  tier: string;
  name: string;
  price: string;
  currency: string;
  max_routers: number;
  monthly_vouchers: number;
  session_monitoring: string | null;
  dashboard: string | null;
  features: string[];
  allowed_durations: number[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Get all plans (active and inactive).
 */
export async function getPlans(): Promise<PlanRow[]> {
  const result = await pool.query<PlanRow>(
    `SELECT * FROM plans ORDER BY price ASC`,
  );
  return result.rows;
}

/**
 * Create a new plan.
 */
export async function createPlan(data: {
  tier: string;
  name: string;
  price: number;
  currency?: string;
  max_routers: number;
  monthly_vouchers: number;
  session_monitoring?: string;
  dashboard?: string;
  features?: string[];
  allowed_durations?: number[];
  is_active?: boolean;
}): Promise<PlanRow> {
  const result = await pool.query<PlanRow>(
    `INSERT INTO plans (tier, name, price, currency, max_routers, monthly_vouchers, session_monitoring, dashboard, features, allowed_durations, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      data.tier,
      data.name,
      data.price,
      data.currency ?? 'SDG',
      data.max_routers,
      data.monthly_vouchers,
      data.session_monitoring ?? null,
      data.dashboard ?? null,
      JSON.stringify(data.features ?? []),
      JSON.stringify(data.allowed_durations ?? [1]),
      data.is_active ?? true,
    ],
  );

  logger.info('Admin created plan', { tier: data.tier });
  return result.rows[0];
}

/**
 * Update an existing plan.
 */
export async function updatePlan(
  planId: string,
  data: Record<string, unknown>,
): Promise<PlanRow> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  const fields = ['tier', 'name', 'price', 'currency', 'max_routers', 'monthly_vouchers', 'session_monitoring', 'dashboard', 'is_active'];
  for (const field of fields) {
    if (data[field] !== undefined) {
      setClauses.push(`${field} = $${paramIndex++}`);
      params.push(data[field]);
    }
  }

  // JSONB fields
  if (data.features !== undefined) {
    setClauses.push(`features = $${paramIndex++}`);
    params.push(JSON.stringify(data.features));
  }
  if (data.allowed_durations !== undefined) {
    setClauses.push(`allowed_durations = $${paramIndex++}`);
    params.push(JSON.stringify(data.allowed_durations));
  }

  if (setClauses.length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  setClauses.push(`updated_at = NOW()`);

  const result = await pool.query<PlanRow>(
    `UPDATE plans SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    [...params, planId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'Plan not found');
  }

  logger.info('Admin updated plan', { planId, fields: Object.keys(data) });
  return result.rows[0];
}

/**
 * Delete a plan. Blocks deletion if subscriptions reference this plan's tier.
 */
export async function deletePlan(planId: string): Promise<void> {
  // Get the plan tier first
  const planResult = await pool.query<{ id: string; tier: string }>(
    `SELECT id, tier FROM plans WHERE id = $1`,
    [planId],
  );

  if (planResult.rowCount === 0) {
    throw new AppError(404, 'Plan not found');
  }

  const tier = planResult.rows[0].tier;

  // Check if any subscriptions use this tier
  const subCount = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM subscriptions WHERE plan_tier = $1`,
    [tier],
  );

  if (parseInt(subCount.rows[0].count, 10) > 0) {
    throw new AppError(
      409,
      `Cannot delete plan "${tier}" — it has existing subscriptions. Deactivate it instead.`,
    );
  }

  await pool.query(`DELETE FROM plans WHERE id = $1`, [planId]);
  logger.info('Admin deleted plan', { planId, tier });
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
 * When rejecting, rejectionReason is persisted and shown to the user so they can fix
 * the issue and resubmit a new receipt against the same payment.
 */
export async function reviewPayment(
  paymentId: string,
  adminId: string,
  decision: 'approved' | 'rejected',
  rejectionReason?: string,
): Promise<PaymentRow> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Update the payment status. On approval, clear any prior rejection_reason
    //    (defensive — payment may have been rejected then resubmitted).
    const reasonToStore = decision === 'rejected' ? (rejectionReason ?? null) : null;
    const paymentResult = await client.query(
      `UPDATE payments
       SET status = $1,
           reviewed_by = $2,
           reviewed_at = NOW(),
           rejection_reason = $4
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [decision, adminId, paymentId, reasonToStore],
    );

    if (paymentResult.rowCount === 0) {
      throw new AppError(404, 'Payment not found or already reviewed');
    }

    const payment = paymentResult.rows[0];

    // 2. If approved, activate the matching pending subscription.
    // SELECT FOR UPDATE locks the row so concurrent approval calls on the same
    // payment cannot race and double-activate.
    if (decision === 'approved') {
      // Check for pending_change (upgrade/downgrade) first — lock it immediately.
      const pendingChange = await client.query(
        `SELECT id, previous_subscription_id FROM subscriptions
         WHERE user_id = $1 AND status = 'pending_change'
         ORDER BY created_at DESC LIMIT 1
         FOR UPDATE`,
        [payment.user_id],
      );

      if (pendingChange.rows.length > 0) {
        const change = pendingChange.rows[0];

        // Cancel the old active subscription
        if (change.previous_subscription_id) {
          await client.query(
            `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW()
             WHERE id = $1`,
            [change.previous_subscription_id],
          );
        }

        // Activate the new subscription
        await client.query(
          `UPDATE subscriptions
           SET status = 'active', start_date = NOW(),
               end_date = NOW() + (duration_months * INTERVAL '30 days'),
               updated_at = NOW()
           WHERE id = $1`,
          [change.id],
        );
      } else {
        // Regular new subscription activation — lock the pending row first.
        const pendingSub = await client.query(
          `SELECT id FROM subscriptions
           WHERE user_id = $1 AND status = 'pending'
           ORDER BY created_at DESC LIMIT 1
           FOR UPDATE`,
          [payment.user_id],
        );

        if (pendingSub.rows.length > 0) {
          await client.query(
            `UPDATE subscriptions
             SET status = 'active', start_date = NOW(),
                 end_date = NOW() + (duration_months * INTERVAL '30 days'),
                 updated_at = NOW()
             WHERE id = $1`,
            [pendingSub.rows[0].id],
          );
        }
      }
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
      `SELECT al.*, u.name AS admin_name, u.email AS admin_email
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

// ----- Admin management -----

export interface AdminRow {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  created_at: string;
}

/**
 * List all admin users, newest first.
 */
export async function listAdmins(): Promise<AdminRow[]> {
  const result = await pool.query<AdminRow>(
    `SELECT id, name, email, is_active, created_at
     FROM users
     WHERE role = 'admin'
     ORDER BY created_at DESC`,
  );
  return result.rows;
}

/**
 * Create a new admin. Throws 409 EMAIL_EXISTS if the email is already registered
 * (to any role). The new admin is created already verified + active.
 */
export async function createAdmin(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AdminRow> {
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [input.email]);
  if (existing.rows.length > 0) {
    throw new AppError(409, 'Email already registered', 'EMAIL_EXISTS');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const result = await pool.query<AdminRow>(
    `INSERT INTO users (name, email, password_hash, role, is_verified, is_active)
     VALUES ($1, $2, $3, 'admin', TRUE, TRUE)
     RETURNING id, name, email, is_active, created_at`,
    [input.name, input.email, passwordHash],
  );

  logger.info('Admin created new admin', { adminId: result.rows[0].id, email: input.email });
  return result.rows[0];
}

/**
 * Ensure at least one other ACTIVE admin would remain after the pending op on `targetId`.
 * Throws 400 LAST_ADMIN if the target is the last active admin.
 */
async function assertNotLastActiveAdmin(targetId: string): Promise<void> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM users
     WHERE role = 'admin' AND is_active = TRUE AND id <> $1`,
    [targetId],
  );
  if (parseInt(result.rows[0].count, 10) < 1) {
    throw new AppError(
      400,
      'Cannot deactivate or delete the last active admin',
      'LAST_ADMIN',
    );
  }
}

/**
 * Toggle admin active state. Blocks self-modification and last-admin deactivation.
 */
export async function deactivateAdmin(
  adminId: string,
  isActive: boolean,
  actingAdminId: string,
): Promise<AdminRow> {
  if (adminId === actingAdminId) {
    throw new AppError(400, 'You cannot modify your own active state', 'CANNOT_MODIFY_SELF');
  }

  if (!isActive) {
    await assertNotLastActiveAdmin(adminId);
  }

  const result = await pool.query<AdminRow>(
    `UPDATE users
     SET is_active = $1, updated_at = NOW()
     WHERE id = $2 AND role = 'admin'
     RETURNING id, name, email, is_active, created_at`,
    [isActive, adminId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'Admin not found', 'ADMIN_NOT_FOUND');
  }

  logger.info('Admin set admin active state', { adminId, isActive, actingAdminId });
  return result.rows[0];
}

/**
 * Hard-delete an admin. Blocks self-delete and last-active-admin delete.
 */
export async function deleteAdmin(adminId: string, actingAdminId: string): Promise<void> {
  if (adminId === actingAdminId) {
    throw new AppError(400, 'You cannot delete your own account', 'CANNOT_DELETE_SELF');
  }

  await assertNotLastActiveAdmin(adminId);

  const result = await pool.query(
    `DELETE FROM users WHERE id = $1 AND role = 'admin'`,
    [adminId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'Admin not found', 'ADMIN_NOT_FOUND');
  }

  logger.info('Admin deleted admin', { adminId, actingAdminId });
}

/**
 * Reset another admin's password. Clears lockout fields (same pattern as auth.service).
 */
export async function resetAdminPassword(adminId: string, newPassword: string): Promise<void> {
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  const result = await pool.query(
    `UPDATE users
     SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL
     WHERE id = $2 AND role = 'admin'
     RETURNING id`,
    [passwordHash, adminId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'Admin not found', 'ADMIN_NOT_FOUND');
  }

  logger.info('Admin password reset', { adminId });
}

// ----- System status -----

export interface SystemStatus {
  database: { status: 'ok' | 'error'; responseMs: number };
  redis: { status: 'ok' | 'error'; responseMs: number };
  fcm: {
    status: 'ok' | 'disabled' | 'error';
    serviceAccountPath: string | null;
    message?: string;
  };
  process: { uptimeSeconds: number; nodeVersion: string; memoryMb: number };
}

export async function getSystemStatus(): Promise<SystemStatus> {
  // Database ping
  let dbStatus: 'ok' | 'error' = 'ok';
  let dbMs = 0;
  {
    const start = Date.now();
    try {
      await pool.query('SELECT 1');
      dbMs = Date.now() - start;
    } catch (err) {
      dbMs = Date.now() - start;
      dbStatus = 'error';
      logger.warn('System status: database ping failed', { error: err });
    }
  }

  // Redis ping
  let redisStatus: 'ok' | 'error' = 'ok';
  let redisMs = 0;
  {
    const start = Date.now();
    try {
      await redis.ping();
      redisMs = Date.now() - start;
    } catch (err) {
      redisMs = Date.now() - start;
      redisStatus = 'error';
      logger.warn('System status: redis ping failed', { error: err });
    }
  }

  const memoryBytes = process.memoryUsage().rss;

  const fcmPath = config.FIREBASE_SERVICE_ACCOUNT_PATH ?? null;
  const fcmErr = getFcmInitError();
  const fcmStatus: 'ok' | 'disabled' | 'error' = isFcmAvailable()
    ? 'ok'
    : fcmErr
      ? 'error'
      : 'disabled';
  const fcmMessage =
    fcmStatus === 'disabled'
      ? 'FIREBASE_SERVICE_ACCOUNT_PATH not set'
      : fcmStatus === 'error'
        ? (fcmErr ?? 'Firebase init failed')
        : undefined;

  return {
    database: { status: dbStatus, responseMs: dbMs },
    redis: { status: redisStatus, responseMs: redisMs },
    fcm: { status: fcmStatus, serviceAccountPath: fcmPath, message: fcmMessage },
    process: {
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memoryMb: Math.round(memoryBytes / 1e6),
    },
  };
}
