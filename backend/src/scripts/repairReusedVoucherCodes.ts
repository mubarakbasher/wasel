/**
 * repairReusedVoucherCodes.ts — one-shot maintenance script
 *
 * Purpose
 * -------
 * Voucher codes are 8-digit RADIUS usernames in a global namespace. Deleting a
 * voucher removes its radcheck/radreply rows but leaves radacct rows in place
 * (they are session history). If a new voucher is allocated the same code, it
 * inherits that history. The nightly validity-expiration job then reads the old
 * rows as the new card's first login and writes an Expiration already in the
 * past, killing the card before it is ever sold.
 *
 * This script identifies cards created on or after 2026-10-19T19:10:00Z (when
 * acctstarttime switched to server time, making the "started before card was
 * born" criterion reliable), renames the foreign radacct rows to
 * username + '-old', and removes the false Expiration and/or Auth-Type Reject
 * that the job inserted, restoring the card to 'unused'.
 *
 * Safety model
 * ------------
 *   • DEFAULT is a dry run — queries the DB, prints a summary, writes NOTHING.
 *   • Set CONFIRM=1 (or pass confirm: true to runRepair) to write.
 *   • Dry run never creates the ledger table; confirm run does (IF NOT EXISTS).
 *   • Every run logs current_database() and inet_server_addr(). Writing needs
 *     ACK_COUNT=<n> (required by the CLI entry point, opts.ackCount in code): the
 *     repair count from the dry run. A database name would prove nothing, because
 *     prod and dev are both called wasel. A wrong target or a changed population
 *     gives a different count, and the run aborts.
 *   • Refuses to write between 02:05 and 02:55 UTC because the 02:10
 *     reconciliation job can re-write a false Expiration on any card touched
 *     between its radacct read and its radcheck write. The clock is checked
 *     again before every batch, and a run that reaches the window stops.
 *   • Aborts before any write when the repair count exceeds maxCards (default
 *     5000) — a safety net against running on the wrong DB.
 *   • Each write batch of 100 cards is one transaction with lock_timeout=2s
 *     and statement_timeout=10s; a missed lock rolls the whole batch back.
 *   • Stops after 3 consecutive failed batches.
 *   • The run exits non-zero if any batch failed, it stopped early, a card was
 *     left unrepaired, or a card was deferred on an open row. Batches that
 *     committed still get the post-checks, and a rerun finishes the rest.
 *   • Post-check after postCheckDelayMs (default 35 000 ms, > one 30 s job
 *     tick) re-deletes any Expiration value equal to what the job would write
 *     from the renamed rows, covering both removed_expiration=TRUE rows and
 *     rows where no Expiration existed at repair time.  A second pass clears
 *     a Reject that enforceLimit latched from the old usage when the rename and
 *     the job's usage read raced.
 *   • A kept Expiration already in the past is logged with its voucher id. It
 *     may be an operator's, so it does not fail the run; the ledger keeps the
 *     value, because the rename takes the card out of any later discovery.
 *   • Do NOT restart the backend during a run because reconciliation fires at
 *     startup +3 min. Run off-peak.
 *
 * Sequence
 * --------
 *   1. Log the DB identity.
 *      Discover affected cards per router, keyset pages of 2 000 on
 *      (router_id, created_at DESC, id DESC), created_at >= REUSE_CUTOVER.
 *      The cursor uses a microsecond-precision text value from Postgres to
 *      avoid page gaps when a batch of cards shares a sub-millisecond
 *      created_at.
 *      If REPORT_OLDER=1 / opts.reportOlder=true, also page older cards (they
 *      are classified pre_cutover — reported but not repaired).
 *      Foreign-row detection uses EXISTS on radacct by username + acctstarttime
 *      < created_at, which hits radacct_username_idx.
 *   2. Classify each candidate with classifyCard and print a summary.
 *   3. If dry run, stop here.
 *   4. In confirm mode: abort if UTC hour:minute is in 02:05–02:55; abort if
 *      the repair count differs from ACK_COUNT or exceeds maxCards; then proceed
 *      in batches of 100 per transaction.
 *   5. Create ledger table (IF NOT EXISTS).
 *   6. Batches: recheck the clock; BEGIN; FOR UPDATE; re-read under lock;
 *      re-classify; act on fresh verdict; write ledger row; COMMIT.
 *   7. Post-check A: re-delete stale Expiration values from all ledger rows
 *      (including those where no Expiration existed at repair time).
 *   8. Post-check B: clear a Reject latched by enforceLimit from the old usage,
 *      where usage reaches the limit only with the renamed rows.
 *   9. Exit non-zero on abort, failed batches, an early stop, or cards still
 *      unrepaired or deferred.
 *
 * Usage
 * -----
 *   # dry run — prints summary, writes nothing
 *   npx ts-node src/scripts/repairReusedVoucherCodes.ts
 *
 *   # also count pre-cutover cards (no writes, but pages every card: off-peak)
 *   REPORT_OLDER=1 npx ts-node src/scripts/repairReusedVoucherCodes.ts
 *
 *   # actually repair (off-peak, not 02:05–02:55 UTC), with the dry run's repair count
 *   ACK_COUNT=<n> CONFIRM=1 npx ts-node src/scripts/repairReusedVoucherCodes.ts
 *
 *   # finish: expect repair 0 and deferred 0; this also clears any late latch
 *   ACK_COUNT=0 CONFIRM=1 npx ts-node src/scripts/repairReusedVoucherCodes.ts
 *
 *   # write the rollback SQL to a file
 *   WRITE_ROLLBACK=rollback.sql npx ts-node src/scripts/repairReusedVoucherCodes.ts
 *
 * MAX_CARDS=<n> overrides the default abort limit of 5000.
 *
 * Rollback
 * --------
 * The ledger table stores everything needed to undo a run. ROLLBACK_SQL, one
 * transaction, restores every renamed radacct row, reinserts deleted Expiration
 * and Auth-Type rows (skipping those that already exist), and resets
 * voucher_meta.status back to 'expired' for every card where the Reject was
 * removed. Write it out with WRITE_ROLLBACK and run it with psql -f.
 *
 * CAUTION: Only a card that still exists, has the status the repair left it with
 * and has no session of its own is rolled back. Any other card is skipped, because
 * rolling it back could kill a live card, including one whose session was already
 * open at repair time. The final SELECT prints skipped_in_service; handle those
 * cards by hand.
 *
 * The ledger holds voucher codes. Drop it once a rollback is no longer wanted.
 */

import { writeFileSync } from 'fs';
import type { Pool, PoolClient } from 'pg';
import logger from '../config/logger';
import {
  REUSE_CUTOVER,
  RETIRED_SUFFIX,
  classifyCard,
  type ClassifyInput,
  type RadacctRow,
  type ClassifyResult,
  type Verdict,
} from '../utils/voucherCodeReuse';
import { formatRadiusExpiration } from '../utils/radius';

// ---- Constants ----

const BATCH_SIZE = 100;
const PAGE_SIZE = 2000;
const MAX_CONSECUTIVE_FAILURES = 3;
const LEDGER_TABLE = 'voucher_code_reuse_repair_2026_10';

/**
 * True for a ledger row whose card is safe to roll back: the same voucher still
 * exists (a deleted card would get orphan radcheck rows that burn the code, and a
 * reissued code has a new id), its status is what the repair left or what rollback
 * restores, and it has no session of its own. That last test uses created_at, not
 * repaired_at, so a session already open at repair time counts.
 */
const ROLLBACK_SAFE_SQL = `
       EXISTS (
         SELECT 1 FROM voucher_meta self
          WHERE self.id = l.voucher_id
            AND (self.status = l.old_status OR (l.removed_reject AND self.status = 'unused'))
            AND NOT EXISTS (
              SELECT 1 FROM radacct own
               WHERE own.username = l.username
                 AND own.acctstarttime >= self.created_at
            )
       )`;

/**
 * ROLLBACK_SQL — one transaction that undoes a confirmed run.
 *
 * Run in psql against the same DB. Idempotent: re-running finds nothing to
 * change. The final SELECT reports the cards it left alone.
 */
export const ROLLBACK_SQL = `
-- Rollback script for repairReusedVoucherCodes.ts
-- CAUTION: Cards in service are excluded automatically.
--          skipped_in_service below counts them; handle those cards by hand.
-- Run in psql: psql "$DATABASE_URL" -f rollback.sql
BEGIN;

-- 1. Restore renamed radacct rows (skip cards in service)
UPDATE radacct ra
   SET username = LEFT(ra.username, LENGTH(ra.username) - ${RETIRED_SUFFIX.length})
  FROM ${LEDGER_TABLE} l,
       UNNEST(l.radacct_ids) AS rid
 WHERE ra.radacctid = rid
   AND ra.username = l.username || '${RETIRED_SUFFIX}'
   AND ${ROLLBACK_SAFE_SQL};

-- 2. Reinsert deleted Expiration values (skip cards in service)
INSERT INTO radcheck (username, attribute, op, value)
SELECT DISTINCT ON (l.username) l.username, 'Expiration', ':=', l.old_expiration
  FROM ${LEDGER_TABLE} l
 WHERE l.removed_expiration = TRUE
   AND l.old_expiration IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM radcheck rc
      WHERE rc.username = l.username
        AND rc.attribute = 'Expiration'
   )
   AND ${ROLLBACK_SAFE_SQL}
 ORDER BY l.username, l.id DESC;

-- 3. Reinsert deleted Auth-Type Reject (skip cards in service)
INSERT INTO radcheck (username, attribute, op, value)
SELECT DISTINCT l.username, 'Auth-Type', ':=', 'Reject'
  FROM ${LEDGER_TABLE} l
 WHERE l.removed_reject = TRUE
   AND NOT EXISTS (
     SELECT 1 FROM radcheck rc
      WHERE rc.username = l.username
        AND rc.attribute = 'Auth-Type'
        AND rc.value = 'Reject'
   )
   AND ${ROLLBACK_SAFE_SQL};

-- 4. Reset voucher_meta status back to 'expired' where Reject was removed (skip cards in service)
UPDATE voucher_meta vm
   SET status = 'expired'
  FROM ${LEDGER_TABLE} l
 WHERE vm.id = l.voucher_id
   AND l.removed_reject = TRUE
   AND vm.status = 'unused'
   AND ${ROLLBACK_SAFE_SQL};

-- 5. Report what was left alone
SELECT COUNT(DISTINCT l.username) AS skipped_in_service
  FROM ${LEDGER_TABLE} l
 WHERE NOT (${ROLLBACK_SAFE_SQL});

COMMIT;
`.trim();

// ---- Types ----

export interface RepairOpts {
  confirm: boolean;
  /** Source of the current time for the maintenance-window checks. */
  clock?: () => Date;
  maxCards?: number;
  reportOlder?: boolean;
  sleep?: (ms: number) => Promise<void>;
  postCheckDelayMs?: number;
  /**
   * When provided, the script aborts before writing unless this equals the repair
   * count it discovered.  The CLI entry point requires ACK_COUNT=<n> in the
   * environment when CONFIRM=1.  Programmatic callers (integration tests) may omit it.
   */
  ackCount?: number;
  /**
   * Override the page size used by fetchPage. Intended for integration tests
   * that need to exercise the cursor logic without seeding thousands of rows.
   * Defaults to PAGE_SIZE (2000).
   */
  pageSize?: number;
}

interface VoucherMetaRow {
  id: string;
  radius_username: string;
  status: string;
  limit_type: string | null;
  limit_value: string | null;   // pg returns numeric as string
  validity_seconds: number;
  created_at: Date;
}

/**
 * Extended row type returned by fetchPage: includes a microsecond-precision
 * text form of created_at used for keyset cursor advancement.
 */
interface VoucherMetaDbRow extends VoucherMetaRow {
  created_at_us: string;
}

interface RadcheckRow {
  attribute: string;
  op: string;
  value: string;
}

interface LedgerRow {
  voucherId: string;
  username: string;
  radacctIds: bigint[];
  oldStatus: string;
  oldExpiration: string | null;
  removedExpiration: boolean;
  removedReject: boolean;
  rejectKept: boolean;
}

interface RepairCard {
  meta: VoucherMetaRow;
  radacctRows: RadacctRow[];
  radcheckRows: RadcheckRow[];
  verdict: Verdict;
  result: ClassifyResult;
}

interface Summary {
  total: number;
  byVerdict: Record<string, number>;
  expirationKept: number;
  rejectKept: number;
  deferredOpenRow: number;
}

/**
 * Keyset cursor for fetchPage.  Uses a microsecond-precision text value so
 * that batches of cards sharing a sub-millisecond created_at are not silently
 * split across page boundaries (a JS Date rounds to milliseconds).
 */
interface PageCursor {
  createdAtUs: string;
  id: string;
}

// ---- Helpers ----

/** A Pool, or a PoolClient inside a transaction. */
type Queryable = Pick<PoolClient, 'query'>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns true when UTC time is in the 02:05–02:55 maintenance window. */
function isInMaintenanceWindow(now: Date): boolean {
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const totalMin = h * 60 + m;
  return totalMin >= 2 * 60 + 5 && totalMin <= 2 * 60 + 55;
}

/**
 * Run fn in one short-timeout transaction. Rolls back and rethrows on failure,
 * so nothing from a failed batch reaches the DB.
 */
async function withRepairTx<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '2s'`);
    await client.query(`SET LOCAL statement_timeout = '10s'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

function buildClassifyInput(
  meta: VoucherMetaRow,
  radacctRows: RadacctRow[],
  radcheckRows: RadcheckRow[],
): ClassifyInput {
  const expRow = radcheckRows.find((r) => r.attribute === 'Expiration');
  const hasReject = radcheckRows.some(
    (r) => r.attribute === 'Auth-Type' && r.value === 'Reject',
  );
  return {
    createdAt: meta.created_at,
    status: meta.status,
    limitType: meta.limit_type,
    limitValue: meta.limit_value !== null ? BigInt(meta.limit_value) : null,
    validitySeconds: meta.validity_seconds ?? 0,
    expiration: expRow?.value ?? null,
    hasReject,
    rows: radacctRows,
  };
}

// ---- Discovery ----

async function fetchRouterIds(db: Pool): Promise<string[]> {
  const res = await db.query<{ id: string }>('SELECT id FROM routers ORDER BY id');
  return res.rows.map((r) => r.id);
}

/**
 * Fetch one keyset page of voucher_meta for a router.
 *
 * The cursor carries a microsecond-precision text timestamp (created_at_us)
 * cast back to ::timestamptz for the comparison.  This prevents silent page
 * gaps when multiple cards share a created_at value within the same
 * sub-millisecond (all cards in a batch typically share one created_at).
 */
async function fetchPage(
  db: Pool,
  routerId: string,
  cutover: Date,
  cursor: PageCursor | null,
  pageSize: number,
): Promise<{ rows: VoucherMetaRow[]; nextCursor: PageCursor | null }> {
  // Microsecond-precision text: matches the precision stored in Postgres.
  const createdAtUsSql = `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

  let sql: string;
  let params: unknown[];

  if (cursor === null) {
    sql = `
      SELECT id, radius_username, status, limit_type,
             limit_value::text AS limit_value, validity_seconds, created_at,
             ${createdAtUsSql} AS created_at_us
        FROM voucher_meta
       WHERE router_id = $1
         AND created_at >= $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3
    `;
    params = [routerId, cutover, pageSize];
  } else {
    sql = `
      SELECT id, radius_username, status, limit_type,
             limit_value::text AS limit_value, validity_seconds, created_at,
             ${createdAtUsSql} AS created_at_us
        FROM voucher_meta
       WHERE router_id = $1
         AND created_at >= $2
         AND (created_at, id) < ($3::timestamptz, $4)
       ORDER BY created_at DESC, id DESC
       LIMIT $5
    `;
    params = [routerId, cutover, cursor.createdAtUs, cursor.id, pageSize];
  }

  const res = await db.query<VoucherMetaDbRow>(sql, params);
  const rows: VoucherMetaRow[] = res.rows;

  const last = res.rows[res.rows.length - 1];
  const nextCursor: PageCursor | null =
    res.rows.length < pageSize
      ? null
      : { createdAtUs: last.created_at_us, id: last.id };

  return { rows, nextCursor };
}

/**
 * For a page of voucher_meta rows, return only those that have at least one
 * foreign radacct row (acctstarttime < created_at), using EXISTS on the
 * username index.
 */
async function filterForeignCandidates(
  db: Pool,
  rows: VoucherMetaRow[],
): Promise<VoucherMetaRow[]> {
  if (rows.length === 0) return [];

  // Pass parallel arrays: $1 = usernames, $2 = corresponding created_ats.
  // EXISTS is evaluated per-pair via UNNEST + lateral correlation.
  const sql = `
    SELECT u.username
      FROM UNNEST($1::text[], $2::timestamptz[]) AS u(username, created_at)
     WHERE EXISTS (
       SELECT 1 FROM radacct ra
        WHERE ra.username = u.username
          AND ra.acctstarttime IS NOT NULL
          AND ra.acctstarttime < u.created_at
     )
  `;
  const usernames = rows.map((r) => r.radius_username);
  const createdAts = rows.map((r) => r.created_at);
  const res = await db.query<{ username: string }>(sql, [usernames, createdAts]);
  const hitSet = new Set(res.rows.map((r) => r.username));
  return rows.filter((r) => hitSet.has(r.radius_username));
}

async function fetchRadacctRows(db: Queryable, username: string): Promise<RadacctRow[]> {
  const res = await db.query<{
    radacctid: string;
    acctstarttime: Date | null;
    acctstoptime: Date | null;
    acctsessiontime: number | null;
    acctinputoctets: string | null;
    acctoutputoctets: string | null;
  }>(
    `SELECT radacctid, acctstarttime, acctstoptime, acctsessiontime,
            acctinputoctets::text, acctoutputoctets::text
       FROM radacct
      WHERE username = $1`,
    [username],
  );
  return res.rows.map((r) => ({
    radacctid: BigInt(r.radacctid),
    acctstarttime: r.acctstarttime,
    acctstoptime: r.acctstoptime,
    acctsessiontime: r.acctsessiontime,
    acctinputoctets: r.acctinputoctets !== null ? BigInt(r.acctinputoctets) : null,
    acctoutputoctets: r.acctoutputoctets !== null ? BigInt(r.acctoutputoctets) : null,
  }));
}

async function fetchRadcheckRows(db: Queryable, username: string): Promise<RadcheckRow[]> {
  const res = await db.query<RadcheckRow>(
    `SELECT attribute, op, value FROM radcheck WHERE username = $1`,
    [username],
  );
  return res.rows;
}

// ---- Discovery phase ----

async function discoverCandidates(
  db: Pool,
  opts: RepairOpts,
  sleepFn: (ms: number) => Promise<void>,
): Promise<RepairCard[]> {
  const cutover = opts.reportOlder ? new Date(0) : REUSE_CUTOVER;
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const routerIds = await fetchRouterIds(db);
  const candidates: RepairCard[] = [];

  for (const routerId of routerIds) {
    let cursor: PageCursor | null = null;

    for (;;) {
      const { rows: page, nextCursor } = await fetchPage(db, routerId, cutover, cursor, pageSize);
      if (page.length === 0) break;

      const foreign = await filterForeignCandidates(db, page);
      for (const meta of foreign) {
        const radacctRows = await fetchRadacctRows(db, meta.radius_username);
        const radcheckRows = await fetchRadcheckRows(db, meta.radius_username);
        const input = buildClassifyInput(meta, radacctRows, radcheckRows);
        const result = classifyCard(input);
        candidates.push({ meta, radacctRows, radcheckRows, verdict: result.verdict, result });
      }

      if (nextCursor === null) break;
      cursor = nextCursor;
      await sleepFn(50);
    }
  }

  return candidates;
}

// ---- Summary print ----

function printSummary(candidates: RepairCard[], confirm: boolean): Summary {
  const byVerdict: Record<string, number> = {};
  let expirationKept = 0;
  let rejectKept = 0;
  let deferredOpenRow = 0;

  for (const c of candidates) {
    byVerdict[c.verdict] = (byVerdict[c.verdict] ?? 0) + 1;
    if (c.result.expirationKept) expirationKept++;
    if (c.result.rejectKept) rejectKept++;
    if (c.verdict === 'deferred_open_row') deferredOpenRow++;
  }

  logger.info('repairReusedVoucherCodes: discovery summary', {
    total: candidates.length,
    byVerdict,
    expirationKept,
    rejectKept,
    deferredOpenRow,
    mode: confirm ? 'CONFIRM' : 'DRY-RUN',
  });

  return { total: candidates.length, byVerdict, expirationKept, rejectKept, deferredOpenRow };
}

// ---- Repair phase ----

/**
 * Apply one card's verdict inside an already-open transaction. Returns the
 * ledger row, or null if the card vanished or re-classifies to a non-repair
 * verdict under the lock.
 */
async function repairCardInTx(
  client: PoolClient,
  meta: VoucherMetaRow,
): Promise<LedgerRow | null> {
  // Re-read under lock
  const lockRes = await client.query<VoucherMetaRow>(
    `SELECT id, radius_username, status, limit_type,
            limit_value::text AS limit_value, validity_seconds, created_at
       FROM voucher_meta
      WHERE id = $1
      FOR UPDATE`,
    [meta.id],
  );
  if (lockRes.rows.length === 0) return null; // vanished

  const freshMeta = lockRes.rows[0];

  const radacctRows = await fetchRadacctRows(client, freshMeta.radius_username);
  const radcheckRows = await fetchRadcheckRows(client, freshMeta.radius_username);

  const input = buildClassifyInput(freshMeta, radacctRows, radcheckRows);
  const result = classifyCard(input);

  if (result.verdict !== 'repair') return null;

  const { renameRowIds, deleteExpiration, deleteReject, resetStatus } = result;
  const expRow = radcheckRows.find((r) => r.attribute === 'Expiration');
  const oldExpiration = expRow?.value ?? null;

  // 1. Rename foreign radacct rows (only closed rows).
  if (renameRowIds.length > 0) {
    const updateRes = await client.query(
      `UPDATE radacct
          SET username = username || $1
        WHERE radacctid = ANY($2::bigint[])
          AND username = $3
          AND acctstoptime IS NOT NULL`,
      [RETIRED_SUFFIX, renameRowIds.map(String), freshMeta.radius_username],
    );
    if (updateRes.rowCount !== renameRowIds.length) {
      throw new Error(
        `radacct rename count mismatch for voucher ${meta.id}: ` +
        `expected ${renameRowIds.length}, got ${updateRes.rowCount}`,
      );
    }
  }

  // 2. Delete Expiration if we should.
  let removedExpiration = false;
  if (deleteExpiration && oldExpiration !== null) {
    const del = await client.query(
      `DELETE FROM radcheck
        WHERE username = $1
          AND attribute = 'Expiration'
          AND value = $2`,
      [freshMeta.radius_username, oldExpiration],
    );
    removedExpiration = (del.rowCount ?? 0) > 0;
  }

  // 3. Delete Auth-Type Reject if we should.
  let removedReject = false;
  if (deleteReject) {
    const del = await client.query(
      `DELETE FROM radcheck
        WHERE username = $1
          AND attribute = 'Auth-Type'
          AND value = 'Reject'`,
      [freshMeta.radius_username],
    );
    removedReject = (del.rowCount ?? 0) > 0;
  }

  // 4. Reset status to 'unused' if Reject was removed.
  if (resetStatus) {
    await client.query(
      `UPDATE voucher_meta SET status = 'unused' WHERE id = $1`,
      [freshMeta.id],
    );
  }

  return {
    voucherId: freshMeta.id,
    username: freshMeta.radius_username,
    radacctIds: renameRowIds,
    oldStatus: freshMeta.status,
    oldExpiration,
    removedExpiration,
    removedReject,
    rejectKept: result.rejectKept,
  };
}

async function ensureLedgerTable(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      id             bigserial PRIMARY KEY,
      voucher_id     uuid        NOT NULL,
      username       varchar(64) NOT NULL,
      radacct_ids    bigint[]    NOT NULL,
      old_status     varchar     NOT NULL,
      old_expiration text,
      removed_expiration boolean NOT NULL DEFAULT FALSE,
      removed_reject boolean     NOT NULL DEFAULT FALSE,
      reject_kept    boolean     NOT NULL DEFAULT FALSE,
      repaired_at    timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function insertLedgerRow(client: PoolClient, row: LedgerRow): Promise<void> {
  await client.query(
    `INSERT INTO ${LEDGER_TABLE}
       (voucher_id, username, radacct_ids, old_status, old_expiration,
        removed_expiration, removed_reject, reject_kept)
     VALUES ($1, $2, $3::bigint[], $4, $5, $6, $7, $8)`,
    [
      row.voucherId,
      row.username,
      row.radacctIds.map(String),
      row.oldStatus,
      row.oldExpiration,
      row.removedExpiration,
      row.removedReject,
      row.rejectKept,
    ],
  );
}

// ---- Post-check helpers ----

/**
 * Compute the Expiration string the validity job would write for a card whose
 * foreign rows have been renamed.  Looks up the earliest acctstarttime among
 * the renamed rows (by radacctid) and adds validity_seconds from voucher_meta.
 * Returns null if there is insufficient data to compute it.
 */
async function computeExpectedExpiration(
  db: Pool,
  username: string,
  radacctIds: string[],
): Promise<string | null> {
  const res = await db.query<{ earliest: Date | null; validity_seconds: number | null }>(
    `SELECT MIN(ra.acctstarttime) AS earliest, vm.validity_seconds
       FROM radacct ra, voucher_meta vm
      WHERE ra.radacctid = ANY($1::bigint[])
        AND ra.acctstarttime IS NOT NULL
        AND vm.radius_username = $2
      GROUP BY vm.validity_seconds`,
    [radacctIds, username],
  );

  if (res.rows.length === 0 || res.rows[0].earliest === null) return null;
  const { earliest, validity_seconds } = res.rows[0];
  if (!validity_seconds || validity_seconds <= 0) return null;

  return formatRadiusExpiration(new Date(earliest.getTime() + validity_seconds * 1000));
}

// ---- Post-check A: stale Expirations ----

/**
 * Re-delete any Expiration value that equals what the validity job would
 * write from the renamed foreign rows.  Covers two races:
 *
 *   removed_expiration=TRUE  — the job read before the rename and re-wrote the
 *                              same value after the repair committed.
 *   removed_expiration=FALSE — no Expiration existed at repair time; the job
 *                              ran after the rename and computed a stale value
 *                              from the original acctstarttime row, which the
 *                              rename had not yet hidden.
 */
async function postCheck(db: Pool): Promise<number> {
  const res = await db.query<{
    username: string;
    old_expiration: string | null;
    radacct_ids: string[];
    removed_expiration: boolean;
  }>(
    `SELECT username, old_expiration, radacct_ids, removed_expiration
       FROM ${LEDGER_TABLE}`,
  );

  let count = 0;
  for (const row of res.rows) {
    const toDelete: string[] = [];

    // Case 1: we knew the Expiration value at repair time — delete the same string
    if (row.removed_expiration && row.old_expiration !== null) {
      toDelete.push(row.old_expiration);
    }

    // Case 2: no Expiration at repair time, but job may have written one since
    if (!row.removed_expiration && row.radacct_ids.length > 0) {
      const computed = await computeExpectedExpiration(db, row.username, row.radacct_ids);
      if (computed !== null) toDelete.push(computed);
    }

    for (const val of toDelete) {
      const del = await db.query(
        `DELETE FROM radcheck
          WHERE username = $1
            AND attribute = 'Expiration'
            AND value = $2`,
        [row.username, val],
      );
      count += del.rowCount ?? 0;
    }
  }

  if (count > 0) {
    logger.info('repairReusedVoucherCodes: post-check removed stale Expirations', { count });
  }
  return count;
}

// ---- Post-check B: re-latched Rejects ----

/**
 * Clear an Auth-Type Reject that enforceLimit latched from the old usage.
 *
 * Scenario: the usage job read a total that included the foreign rows, the
 * repair renamed them, and only then did the job write Reject and 'expired'.
 * The card may have had no Reject at repair time, so this covers every ledger
 * row, not only those where the repair removed one.
 *
 * enforceLimit is the only writer of Reject with status 'expired', so the Reject
 * is false when usage reaches the limit only with the renamed rows counted. A
 * Reject the repair saw and kept stays out of this: an open session can grow usage
 * past the limit afterwards, which says nothing about why that Reject was there.
 *
 * Returns the number of cards cleared.
 */
async function postCheckRejects(db: Pool): Promise<number> {
  const res = await db.query<{
    voucher_id: string;
    username: string;
    radacct_ids: string[];
    limit_type: string;
    limit_value: string;
  }>(
    `SELECT l.voucher_id, l.username, l.radacct_ids,
            vm.limit_type, vm.limit_value::text AS limit_value
       FROM ${LEDGER_TABLE} l
       JOIN voucher_meta vm ON vm.id = l.voucher_id
      WHERE vm.status = 'expired'
        AND NOT l.reject_kept
        AND vm.limit_type IN ('time', 'data')
        AND vm.limit_value IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM radcheck rc
           WHERE rc.username = l.username
             AND rc.attribute = 'Auth-Type'
             AND rc.value = 'Reject'
        )`,
  );

  let cleared = 0;

  for (const row of res.rows) {
    const usedSql = row.limit_type === 'time'
      ? 'acctsessiontime'
      : 'acctinputoctets + acctoutputoctets';

    const usageRes = await db.query<{ native: string; with_foreign: string }>(
      `SELECT COALESCE(SUM(${usedSql}) FILTER (WHERE username = $1), 0)::bigint AS native,
              COALESCE(SUM(${usedSql}), 0)::bigint AS with_foreign
         FROM radacct
        WHERE username = $1
           OR radacctid = ANY($2::bigint[])`,
      [row.username, row.radacct_ids],
    );

    const limit = BigInt(row.limit_value);
    const native = BigInt(usageRes.rows[0].native);
    const withForeign = BigInt(usageRes.rows[0].with_foreign);
    if (native >= limit || withForeign < limit) continue;

    cleared += await withRepairTx(db, async (client) => {
      const meta = await client.query(
        `UPDATE voucher_meta SET status = 'unused' WHERE id = $1 AND status = 'expired'`,
        [row.voucher_id],
      );
      if (meta.rowCount === 0) return 0;

      await client.query(
        `DELETE FROM radcheck
          WHERE username = $1
            AND attribute = 'Auth-Type'
            AND value = 'Reject'`,
        [row.username],
      );
      return 1;
    });
  }

  if (cleared > 0) {
    logger.warn('repairReusedVoucherCodes: post-check cleared re-latched Rejects', { cleared });
  }

  return cleared;
}

// ---- Kept Expirations ----

/**
 * Log cards that kept an Expiration already in the past. The rename takes them out
 * of any later discovery, so this and the ledger are the only trace. It may be an
 * operator's own value, so it warns rather than failing the run.
 */
async function reportKeptExpirations(db: Pool, now: Date): Promise<void> {
  const res = await db.query<{ voucher_id: string; old_expiration: string }>(
    `SELECT voucher_id, old_expiration
       FROM ${LEDGER_TABLE}
      WHERE NOT removed_expiration
        AND old_expiration IS NOT NULL`,
  );

  const voucherIds = res.rows
    .filter((r) => !(Date.parse(`${r.old_expiration} UTC`) > now.getTime()))
    .map((r) => r.voucher_id);

  if (voucherIds.length > 0) {
    logger.warn('repairReusedVoucherCodes: cards kept an Expiration already in the past, check by hand', {
      count: voucherIds.length,
      voucherIds,
    });
  }
}

// ---- Main exported function ----

export async function runRepair(db: Pool, opts: RepairOpts): Promise<void> {
  const {
    confirm,
    clock = () => new Date(),
    maxCards = 5000,
    reportOlder = false,
    sleep: sleepFn = sleep,
    postCheckDelayMs = 35000,
    ackCount,
  } = opts;

  // ---- DB identity (always log) ----
  const dbIdRes = await db.query<{ current_database: string; inet_server_addr: string | null }>(
    `SELECT current_database(), inet_server_addr()`,
  );
  const dbName = dbIdRes.rows[0]?.current_database ?? '(unknown)';
  const dbAddr = dbIdRes.rows[0]?.inet_server_addr ?? '(unix socket)';

  logger.info('repairReusedVoucherCodes starting', {
    mode: confirm ? 'CONFIRM' : 'DRY-RUN',
    reportOlder,
    maxCards,
    dbName,
    dbAddr,
  });

  // ---- Discovery ----
  const candidates = await discoverCandidates(db, { ...opts, reportOlder }, sleepFn);
  const summary = printSummary(candidates, confirm);

  if (!confirm) {
    logger.info('DRY RUN complete — no changes were written. Re-run with CONFIRM=1 to apply.');
    return;
  }

  // ---- Pre-write checks ----

  const now = clock();
  if (isInMaintenanceWindow(now)) {
    logger.error('repairReusedVoucherCodes: refusing to run in maintenance window (02:05–02:55 UTC)', {
      utcTime: now.toISOString(),
    });
    throw new Error('Refusing to run during 02:05–02:55 UTC maintenance window');
  }

  const repairCount = summary.byVerdict['repair'] ?? 0;
  if (ackCount !== undefined && ackCount !== repairCount) {
    throw new Error(
      `ACK_COUNT mismatch: expected ${ackCount}, found ${repairCount} cards to repair. ` +
      'Check the target and repeat the dry run.',
    );
  }

  if (repairCount > maxCards) {
    logger.error('repairReusedVoucherCodes: repair count exceeds maxCards', {
      repairCount,
      maxCards,
    });
    throw new Error(`Repair count ${repairCount} exceeds maxCards ${maxCards}`);
  }

  // ---- Create ledger table ----
  await ensureLedgerTable(db);

  // ---- Write batches ----
  const repairCards = candidates.filter((c) => c.verdict === 'repair');
  let consecutiveFailures = 0;
  let failedBatches = 0;
  let totalRepaired = 0;
  let stopReason: string | null = null;

  for (let i = 0; i < repairCards.length; i += BATCH_SIZE) {
    if (isInMaintenanceWindow(clock())) {
      stopReason = 'maintenance window opened';
      logger.warn('repairReusedVoucherCodes: stopping, maintenance window opened', { batchStart: i });
      break;
    }

    const batch = repairCards.slice(i, i + BATCH_SIZE);

    try {
      const repaired = await withRepairTx(db, async (client) => {
        let count = 0;
        for (const card of batch) {
          const ledgerRow = await repairCardInTx(client, card.meta);
          if (ledgerRow === null) continue;

          await insertLedgerRow(client, ledgerRow);
          count++;
        }
        return count;
      });

      totalRepaired += repaired;
      consecutiveFailures = 0;
      logger.info('repairReusedVoucherCodes: batch committed', {
        batchStart: i,
        batchSize: batch.length,
        totalRepaired,
      });
    } catch (err) {
      failedBatches++;
      consecutiveFailures++;
      logger.error('repairReusedVoucherCodes: batch failed', {
        batchStart: i,
        error: err instanceof Error ? err.message : String(err),
        consecutiveFailures,
      });

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stopReason = `${MAX_CONSECUTIVE_FAILURES} consecutive batch failures`;
        logger.error('repairReusedVoucherCodes: stopping after consecutive batch failures', {
          consecutiveFailures,
        });
        break;
      }
    }

    await sleepFn(500);
  }

  logger.info('repairReusedVoucherCodes: writes complete', {
    totalRepaired,
    failedBatches,
    stopReason,
  });

  // ---- Post-checks: they protect the batches that did commit, so a stopped run still gets them ----
  logger.info('repairReusedVoucherCodes: waiting before post-check', { postCheckDelayMs });
  await sleepFn(postCheckDelayMs);
  const postFixed = await postCheck(db);
  const relocked = await postCheckRejects(db);
  logger.info('repairReusedVoucherCodes: post-check done', { postFixed, relocked });

  await reportKeptExpirations(db, clock());

  const deferred = summary.deferredOpenRow;
  if (failedBatches > 0 || stopReason !== null || totalRepaired < repairCards.length || deferred > 0) {
    throw new Error(
      `Repair incomplete: ${totalRepaired} of ${repairCards.length} repaired, ` +
      `${deferred} deferred on open rows, ` +
      `${failedBatches} batches failed${stopReason ? `, stopped: ${stopReason}` : ''}. ` +
      'Rerun to finish.',
    );
  }
}

// ---- CLI entry point ----

if (require.main === module) {
  // A file, not stdout: dotenv prints a banner there, which would corrupt the SQL.
  if (process.env.WRITE_ROLLBACK) {
    if (process.env.CONFIRM) {
      // eslint-disable-next-line no-console
      console.error('Error: WRITE_ROLLBACK and CONFIRM cannot be combined.');
      process.exit(1);
    }
    writeFileSync(process.env.WRITE_ROLLBACK, `${ROLLBACK_SQL}\n`);
    process.exit(0);
  }

  const { pool } = require('../config/database') as { pool: Pool };

  const confirm = process.env.CONFIRM === '1';
  const ackCount = process.env.ACK_COUNT === undefined ? undefined : Number(process.env.ACK_COUNT);

  if (confirm && !(ackCount !== undefined && Number.isInteger(ackCount) && ackCount >= 0)) {
    // eslint-disable-next-line no-console
    console.error(
      'Error: ACK_COUNT=<n> is required when CONFIRM=1.\n' +
      'Run the dry run first and pass the repair count it reports.\n' +
      'This prevents a confirmed repair against the wrong target or a changed population.',
    );
    process.exit(1);
  }

  const maxCards = process.env.MAX_CARDS === undefined ? undefined : Number(process.env.MAX_CARDS);
  if (maxCards !== undefined && !(Number.isInteger(maxCards) && maxCards > 0)) {
    // eslint-disable-next-line no-console
    console.error('Error: MAX_CARDS must be a positive whole number.');
    process.exit(1);
  }

  const opts: RepairOpts = {
    confirm,
    ackCount,
    maxCards,
    reportOlder: process.env.REPORT_OLDER === '1',
  };

  runRepair(pool, opts)
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error('repairReusedVoucherCodes failed', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      try { await pool.end(); } catch { /* ignore */ }
      process.exit(1);
    });
}
