import cron from 'node-cron';
import type { QueryConfig } from 'pg';
import { pool } from '../config/database';
import logger from '../config/logger';
import {
  createRadacctCandidateTracker,
  type RadacctCandidateTracker,
} from '../services/voucherEnforcement.service';

/**
 * Usage-limit enforcement job.
 *
 * For vouchers with a time or data limit, this job checks cumulative usage
 * (from radacct) against the limit stored in voucher_meta. When usage >= limit,
 * it inserts Auth-Type := Reject in radcheck to block further authentication
 * and marks the voucher as expired.
 *
 * Architecture (post incident 2026-09-15):
 *   - Fast pass (every 30 s): filters the enforcement queries to the small set
 *     of recently-active usernames identified by the candidate tracker.
 *     Cost drops from ~430 k to ~3 k (measured with EXPLAIN on prod).
 *   - Reconciliation (once at startup +5 min, then daily at 02:40 UTC): runs
 *     the original unfiltered SQL on a dedicated client with an extended
 *     statement_timeout to catch any session the incremental window might miss
 *     (backend downtime, late Stops, manual DB edits).
 *   - Single-flight guard: prevents a slow tick from overlapping the next one.
 */

// ---- Module-level state (reset by _resetJobState in tests) ----

// Single-flight guard shared by the fast pass and the reconciliation.
let running = false;

// Becomes non-null at job start (+5 min) and when the daily cron fires.
let reconciliationDue: Date | null = null;

// One tracker instance per job.
let tracker: RadacctCandidateTracker = createRadacctCandidateTracker();

// ---- Constants ----

const CHUNK_SIZE = 5000;

// ---- SQL ----

// Fast pass — time-limited: filtered to candidate usernames.
const FAST_TIME_SQL = `
  SELECT vm.radius_username, vm.limit_value,
         COALESCE(SUM(ra.acctsessiontime), 0)::bigint AS total_used
  FROM voucher_meta vm
  JOIN radacct ra ON ra.username = vm.radius_username
  WHERE vm.limit_type = 'time'
    AND vm.limit_value IS NOT NULL
    AND vm.status NOT IN ('disabled', 'expired')
    AND NOT EXISTS (
      SELECT 1 FROM radcheck rc
      WHERE rc.username = vm.radius_username
        AND rc.attribute = 'Auth-Type'
        AND rc.value = 'Reject'
    )
    AND vm.radius_username = ANY($1::text[])
  GROUP BY vm.radius_username, vm.limit_value
  HAVING COALESCE(SUM(ra.acctsessiontime), 0) >= vm.limit_value::bigint
`;

// Fast pass — data-limited: filtered to candidate usernames.
const FAST_DATA_SQL = `
  SELECT vm.radius_username, vm.limit_value,
         COALESCE(SUM(ra.acctinputoctets + ra.acctoutputoctets), 0)::bigint AS total_used
  FROM voucher_meta vm
  JOIN radacct ra ON ra.username = vm.radius_username
  WHERE vm.limit_type = 'data'
    AND vm.limit_value IS NOT NULL
    AND vm.status NOT IN ('disabled', 'expired')
    AND NOT EXISTS (
      SELECT 1 FROM radcheck rc
      WHERE rc.username = vm.radius_username
        AND rc.attribute = 'Auth-Type'
        AND rc.value = 'Reject'
    )
    AND vm.radius_username = ANY($1::text[])
  GROUP BY vm.radius_username, vm.limit_value
  HAVING COALESCE(SUM(ra.acctinputoctets + ra.acctoutputoctets), 0) >= vm.limit_value::bigint
`;

// Reconciliation — time-limited: UNCHANGED original SQL (no ANY filter).
const RECON_TIME_SQL = `
  SELECT vm.radius_username, vm.limit_value,
         COALESCE(SUM(ra.acctsessiontime), 0)::bigint AS total_used
  FROM voucher_meta vm
  JOIN radacct ra ON ra.username = vm.radius_username
  WHERE vm.limit_type = 'time'
    AND vm.limit_value IS NOT NULL
    AND vm.status NOT IN ('disabled', 'expired')
    AND NOT EXISTS (
      SELECT 1 FROM radcheck rc
      WHERE rc.username = vm.radius_username
        AND rc.attribute = 'Auth-Type'
        AND rc.value = 'Reject'
    )
  GROUP BY vm.radius_username, vm.limit_value
  HAVING COALESCE(SUM(ra.acctsessiontime), 0) >= vm.limit_value::bigint
`;

// Reconciliation — data-limited: UNCHANGED original SQL (no ANY filter).
const RECON_DATA_SQL = `
  SELECT vm.radius_username, vm.limit_value,
         COALESCE(SUM(ra.acctinputoctets + ra.acctoutputoctets), 0)::bigint AS total_used
  FROM voucher_meta vm
  JOIN radacct ra ON ra.username = vm.radius_username
  WHERE vm.limit_type = 'data'
    AND vm.limit_value IS NOT NULL
    AND vm.status NOT IN ('disabled', 'expired')
    AND NOT EXISTS (
      SELECT 1 FROM radcheck rc
      WHERE rc.username = vm.radius_username
        AND rc.attribute = 'Auth-Type'
        AND rc.value = 'Reject'
    )
  GROUP BY vm.radius_username, vm.limit_value
  HAVING COALESCE(SUM(ra.acctinputoctets + ra.acctoutputoctets), 0) >= vm.limit_value::bigint
`;

// ---- Row type ----

interface UsageLimitRow {
  radius_username: string;
  limit_value: string;
  total_used: string;
}

// ---- Per-row enforcement (unchanged transaction logic) ----

async function enforceLimit(
  username: string,
  limitType: string,
  limitValue: string,
  totalUsed: string,
): Promise<void> {
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query('BEGIN');

    // Insert Auth-Type := Reject (delete first to avoid duplicates)
    await client.query(
      `DELETE FROM radcheck WHERE username = $1 AND attribute = 'Auth-Type'`,
      [username],
    );
    await client.query(
      `INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)`,
      [username, 'Auth-Type', ':=', 'Reject'],
    );

    // Update voucher_meta status to expired
    await client.query(
      `UPDATE voucher_meta SET status = 'expired' WHERE radius_username = $1`,
      [username],
    );

    await client.query('COMMIT');

    logger.info('Usage limit enforced', {
      username,
      limitType,
      limitValue,
      totalUsed,
    });
  } catch (error) {
    failed = true;
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    // On failure destroy the connection rather than pooling a client whose
    // transaction state is unknown (same reasoning as runReconciliation).
    client.release(failed);
  }
}

// ---- Reconciliation runner ----

async function runReconciliation(): Promise<void> {
  const client = await pool.connect();
  let timeRows: UsageLimitRow[] = [];
  let dataRows: UsageLimitRow[] = [];

  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '300s'`);

    // node-pg 8.x reads query_timeout from the query config object at runtime
    // (lib/client.js:613). @types/pg does not model it in QueryConfig (it
    // lives in ClientConfig), so we use a local intersection type to pass the
    // per-query override without 'any'. This prevents the pool-level 30 s
    // query_timeout from cancelling the long-running reconciliation queries
    // before the server-side 300 s limit fires.
    type ReconcileConfig = QueryConfig & { query_timeout: number };

    const timeConfig: ReconcileConfig = { text: RECON_TIME_SQL, query_timeout: 310_000 };
    const timeResult = await client.query<UsageLimitRow>(timeConfig as QueryConfig);
    timeRows = timeResult.rows;

    const dataConfig: ReconcileConfig = { text: RECON_DATA_SQL, query_timeout: 310_000 };
    const dataResult = await client.query<UsageLimitRow>(dataConfig as QueryConfig);
    dataRows = dataResult.rows;

    await client.query('COMMIT');
  } catch (err) {
    // Destroy the connection instead of returning it to the pool: if a
    // timed-out query is still in flight, ROLLBACK may never reach the server
    // and a pooled client would stay idle-in-transaction, silently absorbing
    // later autocommit writes.
    await client.query('ROLLBACK').catch(() => undefined);
    client.release(true);
    throw err;
  }

  client.release();

  // Apply enforcement outside the read transaction; enforceLimit has its own
  // per-row transactions.
  let applied = 0;
  for (const row of timeRows) {
    await enforceLimit(row.radius_username, 'time', row.limit_value, row.total_used);
    applied++;
  }
  for (const row of dataRows) {
    await enforceLimit(row.radius_username, 'data', row.limit_value, row.total_used);
    applied++;
  }

  logger.info('Usage limit reconciliation completed', {
    timeFound: timeRows.length,
    dataFound: dataRows.length,
    applied,
  });
}

// ---- Public API ----

export function startUsageLimitEnforcementJob(): void {
  // Schedule the first reconciliation 5 min after boot (slightly later than
  // validity at +3 min to stagger the two heavy scans).
  reconciliationDue = new Date(Date.now() + 5 * 60 * 1000);

  // Fast pass: filtered to recently-active candidates from the tracker.
  cron.schedule('*/30 * * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const { usernames, commit } = await tracker.collect();

      if (usernames.length > 0) {
        // Process in chunks so the $1 array stays below the planner threshold.
        for (let i = 0; i < usernames.length; i += CHUNK_SIZE) {
          const chunk = usernames.slice(i, i + CHUNK_SIZE);

          const timeResult = await pool.query<UsageLimitRow>(FAST_TIME_SQL, [chunk]);
          for (const row of timeResult.rows) {
            await enforceLimit(row.radius_username, 'time', row.limit_value, row.total_used);
          }

          const dataResult = await pool.query<UsageLimitRow>(FAST_DATA_SQL, [chunk]);
          for (const row of dataResult.rows) {
            await enforceLimit(row.radius_username, 'data', row.limit_value, row.total_used);
          }
        }
      }
      // Always commit to advance lastSuccessAt.
      commit();

      if (reconciliationDue !== null && new Date() >= reconciliationDue) {
        reconciliationDue = null;
        try {
          await runReconciliation();
        } catch (reconError) {
          logger.error(
            'Usage limit reconciliation failed, rescheduling in 15 min',
            { error: reconError },
          );
          reconciliationDue = new Date(Date.now() + 15 * 60 * 1000);
        }
      }
    } catch (error) {
      logger.error('Usage limit enforcement fast pass failed', { error });
    } finally {
      running = false;
    }
  });

  // Daily marker at 02:40 UTC (staggered from validity's 02:10 to avoid
  // two heavy scans hitting Postgres at the same time).
  cron.schedule('0 40 2 * * *', () => {
    reconciliationDue = new Date();
  });

  logger.info(
    'Usage limit enforcement job scheduled (every 30s, reconciliation at startup +5 min and daily 02:40 UTC)',
  );
}

/** Reset module-level state. Exported for tests only. */
export function _resetJobState(): void {
  running = false;
  reconciliationDue = null;
  tracker = createRadacctCandidateTracker();
}
