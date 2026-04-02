import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';

// ----- Plan definitions -----

export interface PlanDefinition {
  tier: string;
  name: string;
  price: number;
  currency: string;
  maxRouters: number;
  monthlyVouchers: number;
  sessionMonitoring: string;
  dashboard: string;
  features: string[];
  allowedDurations: number[];
}

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
  created_at: Date;
  updated_at: Date;
}

function toPlanDefinition(row: PlanRow): PlanDefinition {
  return {
    tier: row.tier,
    name: row.name,
    price: parseFloat(row.price),
    currency: row.currency,
    maxRouters: row.max_routers,
    monthlyVouchers: row.monthly_vouchers,
    sessionMonitoring: row.session_monitoring ?? '',
    dashboard: row.dashboard ?? '',
    features: row.features,
    allowedDurations: row.allowed_durations,
  };
}

async function getPlanByTier(tier: string): Promise<PlanDefinition | null> {
  const result = await pool.query<PlanRow>(
    `SELECT * FROM plans WHERE tier = $1 AND is_active = true LIMIT 1`,
    [tier],
  );
  if (result.rows.length === 0) return null;
  return toPlanDefinition(result.rows[0]);
}

// ----- Interfaces -----

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_tier: string;
  start_date: Date;
  end_date: Date;
  status: string;
  voucher_quota: number;
  vouchers_used: number;
  duration_months: number;
  previous_subscription_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentRow {
  id: string;
  user_id: string;
  plan_tier: string;
  amount: string;
  currency: string;
  reference_code: string | null;
  receipt_url: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SubscriptionInfo {
  id: string;
  planTier: string;
  planName: string;
  status: string;
  startDate: string;
  endDate: string;
  voucherQuota: number;
  vouchersUsed: number;
  daysRemaining: number;
  maxRouters: number;
  durationMonths: number;
}

// ----- Helpers -----

function generateReferenceCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = 'WAS-';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

async function toSubscriptionInfo(row: SubscriptionRow): Promise<SubscriptionInfo> {
  const now = new Date();
  const endDate = new Date(row.end_date);
  const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / 86400000));
  const plan = await getPlanByTier(row.plan_tier);

  return {
    id: row.id,
    planTier: row.plan_tier,
    planName: plan ? plan.name : row.plan_tier,
    status: row.status,
    startDate: new Date(row.start_date).toISOString(),
    endDate: endDate.toISOString(),
    voucherQuota: row.voucher_quota,
    vouchersUsed: row.vouchers_used,
    daysRemaining,
    maxRouters: plan ? plan.maxRouters : 0,
    durationMonths: row.duration_months ?? 1,
  };
}

// ----- Service Functions -----

/**
 * Return all active plan definitions from the database.
 */
export async function getPlans(): Promise<PlanDefinition[]> {
  const result = await pool.query<PlanRow>(
    `SELECT * FROM plans WHERE is_active = true ORDER BY price ASC`,
  );
  return result.rows.map(toPlanDefinition);
}

/**
 * Get the current active or pending subscription for a user.
 * If the subscription is active but past its end_date, it is automatically transitioned to 'expired'.
 * Returns null if no relevant subscription is found.
 */
export async function getCurrentSubscription(userId: string): Promise<{ subscription: SubscriptionInfo | null; pendingChange: SubscriptionInfo | null }> {
  const result = await pool.query<SubscriptionRow>(
    `SELECT *
     FROM subscriptions
     WHERE user_id = $1 AND status IN ('active', 'pending', 'pending_change')
     ORDER BY created_at DESC`,
    [userId],
  );

  let subscription: SubscriptionInfo | null = null;
  let pendingChange: SubscriptionInfo | null = null;

  for (const row of result.rows) {
    // Auto-expire if active but past end_date
    if (row.status === 'active' && new Date(row.end_date) < new Date()) {
      await pool.query(
        `UPDATE subscriptions SET status = 'expired' WHERE id = $1`,
        [row.id],
      );
      logger.info('Subscription auto-expired on access', {
        userId,
        subscriptionId: row.id,
      });
      continue;
    }

    if ((row.status === 'active' || row.status === 'pending') && !subscription) {
      subscription = await toSubscriptionInfo(row);
    } else if (row.status === 'pending_change' && !pendingChange) {
      pendingChange = await toSubscriptionInfo(row);
    }
  }

  return { subscription, pendingChange };
}

/**
 * Request a new subscription. Creates both a subscription (pending) and a payment record (pending)
 * with an auto-generated reference code.
 *
 * Rejects if user already has an active or pending subscription.
 */
export async function requestSubscription(
  userId: string,
  planTier: string,
  durationMonths: number = 1,
): Promise<{ subscription: SubscriptionInfo; payment: { id: string; amount: number; currency: string; referenceCode: string; status: string } }> {
  // Validate plan tier
  const plan = await getPlanByTier(planTier);
  if (!plan) {
    throw new AppError(400, `Invalid plan tier: ${planTier}`, 'INVALID_PLAN');
  }

  // Validate duration against plan's allowed durations
  if (!plan.allowedDurations.includes(durationMonths)) {
    throw new AppError(
      400,
      `${plan.name} plan supports ${plan.allowedDurations.join(', ')} month(s) only`,
      'INVALID_DURATION',
    );
  }

  // Check for existing active or pending subscription
  const existing = await pool.query(
    `SELECT id, status FROM subscriptions
     WHERE user_id = $1 AND status IN ('active', 'pending')
     LIMIT 1`,
    [userId],
  );

  if (existing.rows.length > 0) {
    const sub = existing.rows[0];
    if (sub.status === 'active') {
      throw new AppError(409, 'You already have an active subscription', 'SUBSCRIPTION_ACTIVE');
    }
    throw new AppError(409, 'You already have a pending subscription request', 'SUBSCRIPTION_PENDING');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (durationMonths * 30));

    // Scale quota by duration; enterprise unlimited stays -1
    const voucherQuota = plan.monthlyVouchers === -1 ? -1 : plan.monthlyVouchers * durationMonths;
    const totalAmount = plan.price * durationMonths;

    // Create subscription
    const subResult = await client.query<SubscriptionRow>(
      `INSERT INTO subscriptions (user_id, plan_tier, start_date, end_date, status, voucher_quota, vouchers_used, duration_months)
       VALUES ($1, $2, $3, $4, 'pending', $5, 0, $6)
       RETURNING *`,
      [userId, planTier, startDate.toISOString(), endDate.toISOString(), voucherQuota, durationMonths],
    );

    const subscription = subResult.rows[0];

    // Create payment record
    const referenceCode = generateReferenceCode();
    const paymentResult = await client.query<PaymentRow>(
      `INSERT INTO payments (user_id, plan_tier, amount, currency, reference_code, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, amount, currency, reference_code, status`,
      [userId, planTier, totalAmount, plan.currency, referenceCode],
    );

    const payment = paymentResult.rows[0];

    await client.query('COMMIT');

    logger.info('Subscription requested', {
      userId,
      subscriptionId: subscription.id,
      paymentId: payment.id,
      planTier,
      durationMonths,
      referenceCode,
    });

    return {
      subscription: await toSubscriptionInfo(subscription),
      payment: {
        id: payment.id,
        amount: parseFloat(payment.amount),
        currency: payment.currency,
        referenceCode: payment.reference_code!,
        status: payment.status,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Attach a receipt URL to an existing pending payment.
 * Verifies the payment belongs to the user and is still pending.
 */
export async function uploadReceipt(
  userId: string,
  paymentId: string,
  receiptUrl: string,
): Promise<void> {
  const result = await pool.query<PaymentRow>(
    `SELECT id, user_id, status FROM payments
     WHERE id = $1
     LIMIT 1`,
    [paymentId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Payment not found', 'PAYMENT_NOT_FOUND');
  }

  const payment = result.rows[0];

  if (payment.user_id !== userId) {
    throw new AppError(403, 'You do not have access to this payment', 'PAYMENT_FORBIDDEN');
  }

  if (payment.status !== 'pending') {
    throw new AppError(400, `Cannot upload receipt for a payment with status '${payment.status}'`, 'PAYMENT_NOT_PENDING');
  }

  await pool.query(
    `UPDATE payments SET receipt_url = $1 WHERE id = $2`,
    [receiptUrl, paymentId],
  );

  logger.info('Payment receipt uploaded', {
    userId,
    paymentId,
  });
}

/**
 * Middleware helper: returns the active subscription or null.
 * Does not throw — callers decide how to handle absence.
 */
export async function getActiveSubscription(userId: string): Promise<SubscriptionInfo | null> {
  const result = await pool.query<SubscriptionRow>(
    `SELECT *
     FROM subscriptions
     WHERE user_id = $1 AND status = 'active' AND end_date > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return await toSubscriptionInfo(result.rows[0]);
}

/**
 * Check if user can create `count` more vouchers under their current quota.
 * Enterprise tier (quota = -1) is unlimited.
 * Returns true if within quota, false otherwise.
 */
export async function checkVoucherQuota(userId: string, count: number): Promise<boolean> {
  const subscription = await getActiveSubscription(userId);

  if (!subscription) {
    return false;
  }

  // Enterprise tier has unlimited vouchers (quota = -1)
  if (subscription.voucherQuota === -1) {
    return true;
  }

  const remaining = subscription.voucherQuota - subscription.vouchersUsed;
  return count <= remaining;
}

/**
 * Return the maximum number of routers the user's active plan allows.
 * Returns 0 if user has no active subscription.
 */
export async function getRouterLimit(userId: string): Promise<number> {
  const subscription = await getActiveSubscription(userId);

  if (!subscription) {
    return 0;
  }

  return subscription.maxRouters;
}

/**
 * Request a plan change (upgrade/downgrade) while the user has an active subscription.
 * Creates a new subscription with status 'pending_change' and a payment record.
 * When the admin approves payment, the old subscription is cancelled and the new one activates.
 */
export async function changeSubscription(
  userId: string,
  newPlanTier: string,
  durationMonths: number = 1,
): Promise<{ subscription: SubscriptionInfo; payment: { id: string; amount: number; currency: string; referenceCode: string; status: string } }> {
  const plan = await getPlanByTier(newPlanTier);
  if (!plan) {
    throw new AppError(400, `Invalid plan tier: ${newPlanTier}`, 'INVALID_PLAN');
  }

  if (!plan.allowedDurations.includes(durationMonths)) {
    throw new AppError(
      400,
      `${plan.name} plan supports ${plan.allowedDurations.join(', ')} month(s) only`,
      'INVALID_DURATION',
    );
  }

  // Must have an active subscription to change
  const activeSub = await getActiveSubscription(userId);
  if (!activeSub) {
    throw new AppError(400, 'No active subscription to change. Use /subscription/request instead.', 'NO_ACTIVE_SUBSCRIPTION');
  }

  if (activeSub.planTier === newPlanTier) {
    throw new AppError(400, 'You are already on this plan', 'SAME_PLAN');
  }

  // Check for existing pending change
  const existingChange = await pool.query(
    `SELECT id FROM subscriptions
     WHERE user_id = $1 AND status = 'pending_change'
     LIMIT 1`,
    [userId],
  );

  if (existingChange.rows.length > 0) {
    throw new AppError(409, 'You already have a pending plan change request', 'CHANGE_PENDING');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (durationMonths * 30));

    const voucherQuota = plan.monthlyVouchers === -1 ? -1 : plan.monthlyVouchers * durationMonths;
    const totalAmount = plan.price * durationMonths;

    const subResult = await client.query<SubscriptionRow>(
      `INSERT INTO subscriptions (user_id, plan_tier, start_date, end_date, status, voucher_quota, vouchers_used, duration_months, previous_subscription_id)
       VALUES ($1, $2, $3, $4, 'pending_change', $5, 0, $6, $7)
       RETURNING *`,
      [userId, newPlanTier, startDate.toISOString(), endDate.toISOString(), voucherQuota, durationMonths, activeSub.id],
    );

    const subscription = subResult.rows[0];

    const referenceCode = generateReferenceCode();
    const paymentResult = await client.query<PaymentRow>(
      `INSERT INTO payments (user_id, plan_tier, amount, currency, reference_code, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, amount, currency, reference_code, status`,
      [userId, newPlanTier, totalAmount, plan.currency, referenceCode],
    );

    const payment = paymentResult.rows[0];

    await client.query('COMMIT');

    logger.info('Plan change requested', {
      userId,
      fromTier: activeSub.planTier,
      toTier: newPlanTier,
      durationMonths,
      subscriptionId: subscription.id,
      paymentId: payment.id,
    });

    return {
      subscription: await toSubscriptionInfo(subscription),
      payment: {
        id: payment.id,
        amount: parseFloat(payment.amount),
        currency: payment.currency,
        referenceCode: payment.reference_code!,
        status: payment.status,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Background job: transition active subscriptions past their end_date to 'expired'.
 * Returns the number of subscriptions updated.
 */
export async function updateExpiredSubscriptions(): Promise<number> {
  const result = await pool.query(
    `UPDATE subscriptions
     SET status = 'expired'
     WHERE end_date < NOW() AND status = 'active'`,
  );

  const count = result.rowCount ?? 0;

  if (count > 0) {
    logger.info('Expired subscriptions updated', { count });
  }

  return count;
}
