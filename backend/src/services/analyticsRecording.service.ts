import type { PoolClient } from 'pg';
import { pool } from '../config/database';
import logger from '../config/logger';

// ---------------------------------------------------------------------------
// Shared INSERT statement — $1 payment id or NULL (all)
//                           $2 activated subscription id or NULL
//                           $3 source ('live' | 'reconcile')
// ---------------------------------------------------------------------------

const INCOME_INSERT_SQL = `
INSERT INTO income_ledger (payment_id, user_id, operator_name, operator_email, subscription_id,
  replaces_subscription_id, plan_tier, plan_name, duration_months, amount, kind, approved_at, period_end, source)
SELECT p.id, p.user_id, u.name, u.email, s.id, s.previous_subscription_id, p.plan_tier,
       COALESCE(pl.name, p.plan_tier), s.duration_months, p.amount,
       CASE WHEN NOT EXISTS (SELECT 1 FROM payments e WHERE e.user_id = p.user_id AND e.status = 'approved'
              AND e.id <> p.id
              AND (COALESCE(e.reviewed_at, e.created_at), e.created_at) < (COALESCE(p.reviewed_at, p.created_at), p.created_at))
            THEN 'new'
            WHEN s.previous_subscription_id IS NOT NULL THEN 'plan_change' ELSE 'renewal' END,
       COALESCE(p.reviewed_at, p.created_at), s.end_date, $3
  FROM payments p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN plans pl ON pl.tier = p.plan_tier
  LEFT JOIN LATERAL (
    SELECT x.id, x.previous_subscription_id, x.duration_months, x.end_date FROM subscriptions x
     WHERE x.user_id = p.user_id
       AND (x.id = $2 OR x.start_date = p.reviewed_at OR x.created_at = p.created_at)
     ORDER BY (x.id = $2) DESC NULLS LAST, (x.start_date = p.reviewed_at) DESC NULLS LAST, x.created_at DESC
     LIMIT 1) s ON TRUE
 WHERE p.status = 'approved' AND ($1::uuid IS NULL OR p.id = $1)
ON CONFLICT (payment_id) DO NOTHING`;

/**
 * Record a single approved payment in the income ledger.
 * Manages its own SAVEPOINT so a ledger failure never rolls back the calling
 * transaction. Never throws.
 */
export async function recordIncome(
  client: PoolClient,
  paymentId: string,
  activatedSubscriptionId: string | null,
): Promise<void> {
  try {
    await client.query('SAVEPOINT analytics_income');
    await client.query(INCOME_INSERT_SQL, [paymentId, activatedSubscriptionId, 'live']);
    await client.query('RELEASE SAVEPOINT analytics_income');
  } catch (err) {
    try {
      await client.query('ROLLBACK TO SAVEPOINT analytics_income');
    } catch {
      // ignore rollback failure
    }
    logger.error('recordIncome failed', { err, paymentId });
  }
}

/**
 * Back-fill any approved payments missing from the ledger.
 * Returns the number of rows inserted.
 */
export async function reconcileIncomeLedger(): Promise<number> {
  const result = await pool.query(INCOME_INSERT_SQL, [null, null, 'reconcile']);
  return result.rowCount ?? 0;
}
