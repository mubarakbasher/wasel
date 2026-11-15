/**
 * Money-sync job.
 *
 * Always on (not gated by ANALYTICS_JOBS_ENABLED).
 * Schedule: every hour at :07 (UTC), plus once 30 s after boot.
 *
 * Steps (each in its own try/catch; one failure does not stop the others):
 *   1. updateExpiredSubscriptions()
 *   2. reconcileIncomeLedger()
 *   3. Refresh income_ledger.period_end from subscriptions.end_date where they differ.
 *   4. Delete operator_activity rows whose user no longer exists.
 *   5. At UTC hour 4 only: compare approved-payment count/sum with ledger and
 *      logger.error on a mismatch.
 */

import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';
import { reconcileIncomeLedger } from '../services/analyticsRecording.service';
import { updateExpiredSubscriptions } from '../services/subscription.service';

export async function runMoneySync(now?: Date): Promise<void> {
  const t = now ?? new Date();

  // Step 1: expire lapsed subscriptions.
  try {
    await updateExpiredSubscriptions();
  } catch (err) {
    logger.error('moneySync: updateExpiredSubscriptions failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 2: back-fill any approved payments missing from the income ledger.
  try {
    const inserted = await reconcileIncomeLedger();
    if (inserted > 0) {
      logger.info('moneySync: reconciled ledger rows', { inserted });
    }
  } catch (err) {
    logger.error('moneySync: reconcileIncomeLedger failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 3: refresh period_end from the live subscriptions table.
  try {
    await pool.query(`
      UPDATE income_ledger il
         SET period_end = s.end_date
        FROM subscriptions s
       WHERE il.subscription_id = s.id
         AND il.period_end IS DISTINCT FROM s.end_date
    `);
  } catch (err) {
    logger.error('moneySync: period_end refresh failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 4: prune operator_activity rows whose user has been deleted.
  try {
    await pool.query(`
      DELETE FROM operator_activity oa
       WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = oa.user_id)
    `);
  } catch (err) {
    logger.error('moneySync: operator_activity prune failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 5 (UTC hour 4 only): integrity check between payments and the ledger.
  if (t.getUTCHours() === 4) {
    try {
      // Both sides are filtered to users that still exist so deleted operators
      // don't create a permanent false mismatch.
      const paymentsRes = await pool.query<{ cnt: string; total: string }>(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(p.amount), 0) AS total
           FROM payments p
           JOIN users u ON u.id = p.user_id
          WHERE p.status = 'approved'`,
      );
      const ledgerRes = await pool.query<{ cnt: string; total: string }>(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(il.amount), 0) AS total
           FROM income_ledger il
           JOIN users u ON u.id = il.user_id`,
      );
      const pCnt = Number(paymentsRes.rows[0].cnt);
      const pTotal = Number(paymentsRes.rows[0].total);
      const lCnt = Number(ledgerRes.rows[0].cnt);
      const lTotal = Number(ledgerRes.rows[0].total);
      if (pCnt !== lCnt || Math.abs(pTotal - lTotal) > 0.01) {
        logger.error('Analytics ledger mismatch', {
          payments: { count: pCnt, total: pTotal },
          ledger: { count: lCnt, total: lTotal },
        });
      }
    } catch (err) {
      logger.error('moneySync: integrity check failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function startAnalyticsMoneySyncJob(): void {
  // Every hour at :07.
  cron.schedule('0 7 * * * *', () => { void runMoneySync(); }, { timezone: 'UTC' });
  // Once 30 s after boot.
  setTimeout(() => { void runMoneySync().catch((err: unknown) => {
    logger.error('moneySync: boot run failed', {
      error: err instanceof Error ? (err as Error).message : String(err),
    });
  }); }, 30_000);
}
