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
}

export const PLANS: Record<string, PlanDefinition> = {
  starter: {
    tier: 'starter',
    name: 'Starter',
    price: 5,
    currency: 'USD',
    maxRouters: 1,
    monthlyVouchers: 500,
    sessionMonitoring: 'Active only',
    dashboard: 'Basic stats',
    features: ['1 Router', '500 Vouchers/month', 'Active session monitoring', 'Basic dashboard'],
  },
  professional: {
    tier: 'professional',
    name: 'Professional',
    price: 12,
    currency: 'USD',
    maxRouters: 3,
    monthlyVouchers: 2000,
    sessionMonitoring: 'Active + history',
    dashboard: 'Advanced analytics',
    features: ['3 Routers', '2,000 Vouchers/month', 'Session history', 'Advanced analytics'],
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Enterprise',
    price: 25,
    currency: 'USD',
    maxRouters: 10,
    monthlyVouchers: -1, // unlimited
    sessionMonitoring: 'Full + export',
    dashboard: 'Full analytics + reports',
    features: ['10 Routers', 'Unlimited Vouchers', 'Full session history + export', 'Full analytics + reports'],
  },
};

export type PlanTier = keyof typeof PLANS;

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

function toSubscriptionInfo(row: SubscriptionRow): SubscriptionInfo {
  const now = new Date();
  const endDate = new Date(row.end_date);
  const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / 86400000));
  const plan = PLANS[row.plan_tier];

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
  };
}

// ----- Service Functions -----

/**
 * Return all plan definitions as an array.
 */
export function getPlans(): PlanDefinition[] {
  return Object.values(PLANS);
}

/**
 * Get the current active or pending subscription for a user.
 * If the subscription is active but past its end_date, it is automatically transitioned to 'expired'.
 * Returns null if no relevant subscription is found.
 */
export async function getCurrentSubscription(userId: string): Promise<SubscriptionInfo | null> {
  const result = await pool.query<SubscriptionRow>(
    `SELECT id, user_id, plan_tier, start_date, end_date, status, voucher_quota, vouchers_used, created_at, updated_at
     FROM subscriptions
     WHERE user_id = $1 AND status IN ('active', 'pending')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

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

    return null;
  }

  return toSubscriptionInfo(row);
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
): Promise<{ subscription: SubscriptionInfo; payment: { id: string; amount: number; currency: string; referenceCode: string; status: string } }> {
  // Validate plan tier
  const plan = PLANS[planTier];
  if (!plan) {
    throw new AppError(400, `Invalid plan tier: ${planTier}`, 'INVALID_PLAN');
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
    endDate.setDate(endDate.getDate() + 30);

    const voucherQuota = plan.monthlyVouchers;

    // Create subscription
    const subResult = await client.query<SubscriptionRow>(
      `INSERT INTO subscriptions (user_id, plan_tier, start_date, end_date, status, voucher_quota, vouchers_used)
       VALUES ($1, $2, $3, $4, 'pending', $5, 0)
       RETURNING id, user_id, plan_tier, start_date, end_date, status, voucher_quota, vouchers_used, created_at, updated_at`,
      [userId, planTier, startDate.toISOString(), endDate.toISOString(), voucherQuota],
    );

    const subscription = subResult.rows[0];

    // Create payment record
    const referenceCode = generateReferenceCode();
    const paymentResult = await client.query<PaymentRow>(
      `INSERT INTO payments (user_id, plan_tier, amount, currency, reference_code, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, amount, currency, reference_code, status`,
      [userId, planTier, plan.price, plan.currency, referenceCode],
    );

    const payment = paymentResult.rows[0];

    await client.query('COMMIT');

    logger.info('Subscription requested', {
      userId,
      subscriptionId: subscription.id,
      paymentId: payment.id,
      planTier,
      referenceCode,
    });

    return {
      subscription: toSubscriptionInfo(subscription),
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
    `SELECT id, user_id, plan_tier, start_date, end_date, status, voucher_quota, vouchers_used, created_at, updated_at
     FROM subscriptions
     WHERE user_id = $1 AND status = 'active' AND end_date > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return toSubscriptionInfo(result.rows[0]);
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
