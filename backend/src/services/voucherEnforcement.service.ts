/**
 * Incremental radacct candidate tracker for voucher enforcement jobs.
 *
 * Context (incident 2026-09-15): on prod, validityExpiration and
 * usageLimitEnforcement each full-scanned radacct (2.29 M rows, 1.7 GB) every
 * 30 s, saturating the 1 GB / 1 CPU Postgres container and causing FreeRADIUS
 * to exceed max_request_time, which eventually triggered a use-after-free in
 * the dynamic-client timer code and hung the main thread for 5 hours.
 *
 * The tracker maintains an in-memory watermark so each 30 s tick only touches
 * the recently-active slice of radacct (index scans, cost ~3 k instead of
 * ~430 k as measured via EXPLAIN on prod 2026-09-16). A full unfiltered
 * reconciliation pass runs once at startup and daily to catch any session the
 * incremental window could miss (backend downtime, late Stops, manual edits).
 */

import { pool } from '../config/database';

// Shape returned by the three-branch candidate query below.
interface CandidateRow {
  username: string;
  open: boolean;   // bool_or(acctstoptime IS NULL)
  max_id: string;  // max(radacctid)::text — bigint transferred as text to avoid
                   // JS Number precision loss for ids > 2^53
}

export interface CollectResult {
  /** Deduplicated candidate usernames for this tick. */
  usernames: string[];
  /**
   * Advance the in-memory state after the whole enforcement tick has succeeded.
   *
   * Calling commit() after every successful tick ensures the tracker makes
   * forward progress. NOT calling it (i.e. the tick threw) leaves state
   * unchanged so the next tick re-covers the same window — no enforcement
   * gap, even across backend restarts.
   */
  commit(): void;
}

export interface RadacctCandidateTracker {
  collect(): Promise<CollectResult>;
}

export function createRadacctCandidateTracker(): RadacctCandidateTracker {
  // Highest radacctid seen so far. null until the first collect().
  let watermark: bigint | null = null;

  // Usernames from the previous tick whose session was still open.
  // Carried into the next tick's candidate set so a session that closes
  // between ticks is still covered even if the router's Accounting-Stop
  // arrives late.
  let prevOpen = new Set<string>();

  // Timestamp of the last successful tick. Used to compute the recency
  // window ($2) for the acctstoptime branch.
  let lastSuccessAt: Date | null = null;

  return {
    async collect(): Promise<CollectResult> {
      const tickStart = new Date();

      // One-time initialisation: jump the watermark to the current table max
      // so the very first tick doesn't re-scan the entire table.
      if (watermark === null) {
        const initRes = await pool.query<{ max_id: string }>(
          `SELECT COALESCE(MAX(radacctid), 0)::text AS max_id FROM radacct`,
        );
        watermark = BigInt(initRes.rows[0]?.max_id ?? '0');
      }

      // Lower bound for the new-row scan.
      // We subtract 100 to cover radacctid values committed out of order:
      // Postgres sequences are allocated in order but transactions can commit
      // in a different order than they began, so a row with id N may appear
      // after a row with id N+5 is already visible.
      const windowStart = watermark - 100n > 0n ? watermark - 100n : 0n;

      // Recency cutoff for recently-closed sessions.
      // We use lastSuccessAt (not tickStart) so that if the backend was stopped
      // for a while, sessions that closed during the outage are still found on
      // the next tick. The extra 5 min absorbs router clock drift and late
      // Accounting-Stop delivery.
      const recencyCutoff = new Date(
        (lastSuccessAt ?? tickStart).getTime() - 5 * 60 * 1000,
      );

      // Three-branch UNION gives index-scan coverage of every recently-active
      // username without a full-table scan:
      //   branch 1 — sessions currently open (no acctstoptime): catches active sessions
      //   branch 2 — rows with radacctid > watermark: catches new logins / updates
      //   branch 3 — rows whose acctstoptime is recent: catches late Accounting-Stops
      const candidateSql = `
        SELECT username,
               bool_or(acctstoptime IS NULL) AS open,
               max(radacctid)::text          AS max_id
        FROM (
          SELECT username, acctstoptime, radacctid
            FROM radacct WHERE acctstoptime IS NULL
          UNION ALL
          SELECT username, acctstoptime, radacctid
            FROM radacct WHERE radacctid > $1::bigint
          UNION ALL
          SELECT username, acctstoptime, radacctid
            FROM radacct WHERE acctstoptime > $2::timestamptz
        ) s
        WHERE username <> ''
        GROUP BY username
      `;

      const candidateRes = await pool.query<CandidateRow>(candidateSql, [
        windowStart.toString(),
        recencyCutoff.toISOString(),
      ]);

      const rows = candidateRes.rows;
      const queryUsernames = new Set(rows.map((r) => r.username));

      // Union with prevOpen so sessions that closed between ticks are still
      // covered without depending on router clocks.
      const merged = [...new Set([...queryUsernames, ...prevOpen])];

      // Capture tick-local state so commit() is a pure closure over it.
      const capturedRows = rows;
      const capturedTickStart = tickStart;

      return {
        usernames: merged,

        commit() {
          // Advance watermark to the highest radacctid seen in this batch
          // so the next tick only scans rows newer than this.
          if (capturedRows.length > 0) {
            const maxId = capturedRows.reduce<bigint>((acc, r) => {
              const id = BigInt(r.max_id);
              return id > acc ? id : acc;
            }, watermark!);
            watermark = maxId;
          }

          // Replace prevOpen with only the usernames still open in this
          // tick's snapshot. Closed ones drop out naturally.
          prevOpen = new Set(
            capturedRows.filter((r) => r.open).map((r) => r.username),
          );

          lastSuccessAt = capturedTickStart;
        },
      };
    },
  };
}
