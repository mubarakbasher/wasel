import cron from 'node-cron';
import type { QueryConfig } from 'pg';
import { pool } from '../config/database';
import logger from '../config/logger';
import {
  createRadacctCandidateTracker,
  type RadacctCandidateTracker,
} from '../services/voucherEnforcement.service';

/**
 * Validity-from-first-use job.
 *
 * For vouchers with validity_seconds > 0, this job detects the first login
 * (via radacct) and sets the Expiration attribute in radcheck so the voucher
 * expires after the validity period from first use.
 *
 * Architecture (post incident 2026-09-15):
 *   - Fast pass (every 30 s): filters the enforcement query to the small set
 *     of recently-active usernames identified by the candidate tracker.
 *     Cost drops from ~430 k to ~3 k (measured with EXPLAIN on prod).
 *   - Reconciliation (once at startup +3 min, then daily at 02:10 UTC): runs
 *     the original unfiltered SQL on a dedicated client with an extended
 *     statement_timeout to catch any session the incremental window might miss
 *     (backend downtime, late Stops, manual DB edits).
 *   - Single-flight guard: prevents a slow tick from overlapping the next one.
 */

// ---- Module-level state (reset by _resetJobState in tests) ----

// Single-flight guard shared by the fast pass and the reconciliation so
// neither can start while the other is already running.
let running = false;

// Becomes non-null at job start (+3 min) and when the daily cron fires.
// Cleared to null before each reconciliation attempt so two rapid ticks
// cannot double-run it.
let reconciliationDue: Date | null = null;

// One tracker instance per job; owns the watermark + prevOpen state.
let tracker: RadacctCandidateTracker = createRadacctCandidateTracker();

// ---- Constants ----

const CHUNK_SIZE = 5000; // max usernames per $1 array in the fast-pass query

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ---- SQL ----

// Fast pass: same query as the original but filtered to candidate usernames.
// The ANY($1::text[]) clause turns the hash join into index nested loops
// (cost ~3 k vs ~430 k on prod). Text is otherwise IDENTICAL to RECON_SQL
// so enforcement semantics are unchanged.
const FAST_SQL = `
  SELECT vm.radius_username, vm.validity_seconds,
         MIN(ra.acctstarttime) AS first_login
  FROM voucher_meta vm
  JOIN radacct ra ON ra.username = vm.radius_username
  WHERE vm.validity_seconds IS NOT NULL
    AND vm.validity_seconds > 0
    AND vm.status != 'disabled'
    AND NOT EXISTS (
      SELECT 1 FROM radcheck rc
      WHERE rc.username = vm.radius_username
        AND rc.attribute = 'Expiration'
    )
    AND vm.radius_username = ANY($1::text[])
  GROUP BY vm.radius_username, vm.validity_seconds
`;

// Reconciliation: original unfiltered query, text UNCHANGED.
const RECON_SQL = `
  SELECT vm.radius_username, vm.validity_seconds,
         MIN(ra.acctstarttime) AS first_login
  FROM voucher_meta vm
  JOIN radacct ra ON ra.username = vm.radius_username
  WHERE vm.validity_seconds IS NOT NULL
    AND vm.validity_seconds > 0
    AND vm.status != 'disabled'
    AND NOT EXISTS (
      SELECT 1 FROM radcheck rc
      WHERE rc.username = vm.radius_username
        AND rc.attribute = 'Expiration'
    )
  GROUP BY vm.radius_username, vm.validity_seconds
`;

// ---- Row type ----

interface ValidityRow {
  radius_username: string;
  validity_seconds: number;
  first_login: Date | null;
}

// ---- Apply a single row (shared between fast pass and reconciliation) ----

async function applyValidityRow(row: ValidityRow): Promise<void> {
  // Defensive: skip rows where we can't compute an expiry date. A null
  // first_login means MIN(ra.acctstarttime) returned NULL, which should not
  // happen given the JOIN but can occur on DB inconsistencies. Skip rather
  // than throwing so one bad row does not abort the whole tick.
  if (row.first_login === null) {
    logger.warn('Validity expiration: skipping row with null first_login', {
      username: row.radius_username,
    });
    return;
  }

  const expDate = new Date(row.first_login.getTime() + row.validity_seconds * 1000);
  const formatted =
    `${MONTHS[expDate.getUTCMonth()]} ` +
    `${String(expDate.getUTCDate()).padStart(2, '0')} ` +
    `${expDate.getUTCFullYear()} ` +
    `${String(expDate.getUTCHours()).padStart(2, '0')}:` +
    `${String(expDate.getUTCMinutes()).padStart(2, '0')}:` +
    `${String(expDate.getUTCSeconds()).padStart(2, '0')}`;

  // Guard against a concurrent cron tick inserting a second Expiration
  // row for the same voucher: emit the INSERT conditionally so two
  // replicas racing on the same username produce one row, not two.
  // Explicit ::varchar casts on every $-param: without them Postgres
  // fails with 42P08 ("text versus character varying") because node-pg
  // sends parameters as text by default and they are referenced in
  // both the SELECT projection (varchar target columns) and the WHERE
  // clause (varchar column comparisons), producing an ambiguous type.
  await pool.query(
    `INSERT INTO radcheck (username, attribute, op, value)
     SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar
     WHERE NOT EXISTS (
       SELECT 1 FROM radcheck
       WHERE username = $1::varchar AND attribute = $2::varchar
     )`,
    [row.radius_username, 'Expiration', ':=', formatted],
  );

  logger.info('Validity expiration set', {
    username: row.radius_username,
    firstLogin: row.first_login.toISOString(),
    expiration: formatted,
    validitySeconds: row.validity_seconds,
  });
}

// ---- Reconciliation runner ----

async function runReconciliation(): Promise<void> {
  const client = await pool.connect();
  let rows: ValidityRow[] = [];

  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '300s'`);

    // node-pg 8.x reads query_timeout from the query config object at runtime
    // (lib/client.js:613). @types/pg does not model it in QueryConfig (it
    // lives in ClientConfig), so we use a local intersection type to pass the
    // per-query override without 'any'. This prevents the pool-level 30 s
    // query_timeout from cancelling the long-running reconciliation query
    // before the server-side 300 s limit fires.
    type ReconcileConfig = QueryConfig & { query_timeout: number };
    const reconConfig: ReconcileConfig = {
      text: RECON_SQL,
      query_timeout: 310_000,
    };
    const result = await client.query<ValidityRow>(reconConfig as QueryConfig);

    rows = result.rows;
    await client.query('COMMIT');
  } catch (err) {
    // Roll back the statement_timeout transaction; ignore secondary errors.
    // Destroy the connection instead of returning it to the pool: if a
    // timed-out query is still in flight, ROLLBACK may never reach the server
    // and a pooled client would stay idle-in-transaction, silently absorbing
    // later autocommit writes.
    await client.query('ROLLBACK').catch(() => undefined);
    client.release(true);
    throw err;
  }

  client.release();

  // Apply each row outside the transaction; enforceLimit has its own
  // per-row transactions.
  let applied = 0;
  for (const row of rows) {
    await applyValidityRow(row);
    if (row.first_login !== null) applied++;
  }

  logger.info('Validity reconciliation completed', { found: rows.length, applied });
}

// ---- Public API ----

export function startValidityExpirationJob(): void {
  // Schedule the first reconciliation 3 min after boot: gives the pool time
  // to warm up and lets the fast pass run at least once before the expensive
  // full scan.
  reconciliationDue = new Date(Date.now() + 3 * 60 * 1000);

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
          const result = await pool.query<ValidityRow>(FAST_SQL, [chunk]);
          for (const row of result.rows) {
            await applyValidityRow(row);
          }
        }
      }
      // Always commit, even when there were no candidates, to advance
      // lastSuccessAt and prevent the recency window from growing unboundedly.
      commit();

      // Check whether a reconciliation pass is due. Cleared before running
      // so that a concurrent (impossible here due to the guard) or failed-
      // then-rescheduled run does not double-trigger.
      if (reconciliationDue !== null && new Date() >= reconciliationDue) {
        reconciliationDue = null;
        try {
          await runReconciliation();
        } catch (reconError) {
          logger.error(
            'Validity reconciliation failed, rescheduling in 15 min',
            { error: reconError },
          );
          // Reschedule so a transient DB failure does not leave the table
          // unreconciled until the next 02:10 UTC cron.
          reconciliationDue = new Date(Date.now() + 15 * 60 * 1000);
        }
      }
    } catch (error) {
      logger.error('Validity expiration fast pass failed', { error });
    } finally {
      running = false;
    }
  });

  // Daily marker at 02:10 UTC: sets reconciliationDue so the next 30 s tick
  // picks it up (respecting the running guard rather than spawning a
  // concurrent run from the cron callback itself).
  cron.schedule('0 10 2 * * *', () => {
    reconciliationDue = new Date();
  });

  logger.info(
    'Validity expiration job scheduled (every 30s, reconciliation at startup +3 min and daily 02:10 UTC)',
  );
}

/** Reset module-level state. Exported for tests only. */
export function _resetJobState(): void {
  running = false;
  reconciliationDue = null;
  tracker = createRadacctCandidateTracker();
}
