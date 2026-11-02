/**
 * voucherCodeReuse.ts — pure classifier, no pg import.
 *
 * Determines what, if anything, needs to be done to a voucher card that may
 * have inherited radacct rows from a previously-deleted card that shared the
 * same username. Used by both the repair script and its tests.
 *
 * Terminology
 * -----------
 *   foreign row  — a radacct row whose acctstarttime is non-null AND earlier
 *                  than the card's createdAt. A row with NULL acctstarttime is
 *                  NOT foreign (it may be a fresh open accounting Start).
 *   repair       — the set of actions the script should take under the lock.
 *   verdict      — the top-level classification of the card.
 *
 * REUSE_CUTOVER
 *   2026-10-19 19:10 UTC, when acctstarttime switched from router clock to
 *   server time. Before that boundary, "this row started before the card was
 *   created" is not a reliable signal — the router's clock could be hours or
 *   days behind. So for cards created before REUSE_CUTOVER, we report the
 *   situation but take no action.
 */

import { formatRadiusExpiration } from './radius';

export const REUSE_CUTOVER = new Date('2026-10-19T19:10:00Z');
export const RETIRED_SUFFIX = '-old';

// ---- Types ----

export interface RadacctRow {
  radacctid: bigint;
  acctstarttime: Date | null;
  acctstoptime: Date | null;
  acctsessiontime: number | null;
  acctinputoctets: bigint | null;
  acctoutputoctets: bigint | null;
}

export interface ClassifyInput {
  createdAt: Date;
  status: string;
  limitType: string | null;
  limitValue: bigint | null;
  validitySeconds: number;
  expiration: string | null;
  hasReject: boolean;
  rows: RadacctRow[];
}

export type Verdict =
  | 'clean'
  | 'pre_cutover'
  | 'deferred_open_row'
  | 'repair';

export interface ClassifyResult {
  verdict: Verdict;
  /** radacctids of foreign rows only; undefined / empty when not repair. */
  renameRowIds: bigint[];
  deleteExpiration: boolean;
  /** expiration was non-null but not provably false, so it was kept. */
  expirationKept: boolean;
  deleteReject: boolean;
  resetStatus: boolean;
  /** reject/status were eligible but some condition was not met, so kept. */
  rejectKept: boolean;
}

// ---- Internal helpers ----

/**
 * Sum acctsessiontime (seconds) over a set of rows, mirroring the job's
 * COALESCE(SUM(acctsessiontime),0) arithmetic.
 */
function sumTime(rows: RadacctRow[]): bigint {
  return rows.reduce((acc, r) => acc + BigInt(r.acctsessiontime ?? 0), 0n);
}

/**
 * Sum acctinputoctets + acctoutputoctets over a set of rows. A row with
 * either octet column NULL contributes 0, mirroring the job's
 * COALESCE(SUM(acctinputoctets + acctoutputoctets), 0) arithmetic.
 */
function sumData(rows: RadacctRow[]): bigint {
  return rows.reduce((acc, r) => {
    if (r.acctinputoctets === null || r.acctoutputoctets === null) return acc;
    return acc + r.acctinputoctets + r.acctoutputoctets;
  }, 0n);
}

// ---- Exported classifier ----

export function classifyCard(input: ClassifyInput): ClassifyResult {
  const { createdAt, status, limitType, limitValue, validitySeconds, expiration, hasReject, rows } = input;

  const empty: ClassifyResult = {
    verdict: 'clean',
    renameRowIds: [],
    deleteExpiration: false,
    expirationKept: false,
    deleteReject: false,
    resetStatus: false,
    rejectKept: false,
  };

  // Separate foreign rows from native rows.
  const foreignRows = rows.filter(
    (r) => r.acctstarttime !== null && r.acctstarttime < createdAt,
  );

  if (foreignRows.length === 0) {
    return { ...empty, verdict: 'clean' };
  }

  // For cards created before REUSE_CUTOVER, report only — no actions.
  if (createdAt < REUSE_CUTOVER) {
    return { ...empty, verdict: 'pre_cutover' };
  }

  // Defer if any foreign row is still open (acctstoptime NULL). An open row
  // means accounting is still in flight and renaming would corrupt that session.
  const hasOpenForeignRow = foreignRows.some((r) => r.acctstoptime === null);
  if (hasOpenForeignRow) {
    return { ...empty, verdict: 'deferred_open_row' };
  }

  // From here: repair verdict. Compute the actions.
  const renameRowIds = foreignRows.map((r) => r.radacctid);

  // ---- Expiration action ----
  let deleteExpiration = false;
  let expirationKept = false;

  if (expiration !== null && validitySeconds > 0) {
    // Find the earliest foreign acctstarttime.
    const earliest = foreignRows.reduce<Date | null>((min, r) => {
      if (r.acctstarttime === null) return min;
      return min === null || r.acctstarttime < min ? r.acctstarttime : min;
    }, null);

    if (earliest !== null) {
      const jobWouldWrite = formatRadiusExpiration(
        new Date(earliest.getTime() + validitySeconds * 1000),
      );
      if (expiration === jobWouldWrite) {
        deleteExpiration = true;
      } else {
        expirationKept = true;
      }
    } else {
      // No non-null acctstarttime among foreign rows (safety net, shouldn't
      // be reachable since we checked for foreign rows above).
      expirationKept = true;
    }
  } else if (expiration !== null) {
    // validitySeconds === 0 or negative — cannot reproduce a job-written string;
    // keep it.
    expirationKept = true;
  }

  // ---- Reject / status action ----
  // Never touch reject or status on disabled cards.
  let deleteReject = false;
  let resetStatus = false;
  let rejectKept = false;

  if (status !== 'disabled' && hasReject) {
    const eligible =
      status === 'expired' &&
      (limitType === 'time' || limitType === 'data') &&
      limitValue !== null;

    if (eligible) {
      const allRows = rows;
      const nativeRows = rows.filter((r) => !foreignRows.includes(r));

      let usageAll: bigint;
      let usageNative: bigint;

      if (limitType === 'time') {
        usageAll = sumTime(allRows);
        usageNative = sumTime(nativeRows);
      } else {
        usageAll = sumData(allRows);
        usageNative = sumData(nativeRows);
      }

      const overLimitWithForeign = usageAll >= limitValue;
      const underLimitWithoutForeign = usageNative < limitValue;

      if (overLimitWithForeign && underLimitWithoutForeign) {
        deleteReject = true;
        resetStatus = true;
      } else {
        rejectKept = true;
      }
    } else {
      rejectKept = true;
    }
  }

  return {
    verdict: 'repair',
    renameRowIds,
    deleteExpiration,
    expirationKept,
    deleteReject,
    resetStatus,
    rejectKept,
  };
}
