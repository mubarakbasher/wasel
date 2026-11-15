/**
 * Analytics ingest job.
 *
 * Reads new radacct rows after the saved cursor and records each card's first
 * use in analytics_card_first_use.
 *
 * Schedule:  second=20, minutes 2–57 stepping by 5, every hour (UTC).
 *   i.e. 00:02:20, 00:07:20, … 00:57:20, 01:02:20, …
 * Gated:     ANALYTICS_JOBS_ENABLED must be 'true'.
 * Skipped:   01:10–04:00 UTC (heavy radacct / postgres maintenance window).
 * Up to 5 batches per run; stops when fewer than 2 000 rows are read.
 */

import cron from 'node-cron';
import type { PoolClient } from 'pg';
import logger from '../config/logger';
import {
  withGuardedClient,
  setAnalyticsState,
  analyticsJobsEnabled,
} from '../services/analyticsDb';

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const SELECT_RADACCT = `
SELECT radacctid, username, acctstarttime
  FROM radacct
 WHERE radacctid > $1 - 100
   AND username <> ''
 ORDER BY radacctid
 LIMIT 2000`;

const SELECT_RADACCT_UPPER = `
SELECT radacctid, username, acctstarttime
  FROM radacct
 WHERE radacctid > $1 - 100
   AND radacctid <= $2
   AND username <> ''
 ORDER BY radacctid
 LIMIT 2000`;

const INSERT_FIRST_USE = `
INSERT INTO analytics_card_first_use
SELECT n.username, vm.user_id, vm.router_id, vm.price, vm.limit_type,
       n.acctstarttime, n.radacctid
  FROM unnest($1::text[], $2::bigint[], $3::timestamptz[])
         AS n(username, radacctid, acctstarttime)
  JOIN voucher_meta vm ON vm.radius_username = n.username
 WHERE NOT EXISTS (
         SELECT 1 FROM radacct o
          WHERE o.username = n.username
            AND o.radacctid < n.radacctid
       )
ON CONFLICT (radius_username) DO NOTHING`;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export async function ingestBatch(
  client: PoolClient,
  cursor: number,
  upperBound?: number,
): Promise<{ nextCursor: number; read: number; inserted: number }> {
  const selectRes = await client.query<{
    radacctid: string;
    username: string;
    acctstarttime: Date;
  }>(
    upperBound !== undefined ? SELECT_RADACCT_UPPER : SELECT_RADACCT,
    upperBound !== undefined ? [cursor, upperBound] : [cursor],
  );

  const rows = selectRes.rows;
  if (rows.length === 0) {
    return { nextCursor: cursor, read: 0, inserted: 0 };
  }

  const nextCursor = Number(rows[rows.length - 1].radacctid);
  const usernames = rows.map((r) => r.username);
  const radacctids = rows.map((r) => BigInt(r.radacctid));
  const starttimes = rows.map((r) => r.acctstarttime);

  const insertRes = await client.query(INSERT_FIRST_USE, [
    usernames,
    radacctids,
    starttimes,
  ]);

  return {
    nextCursor,
    read: rows.length,
    inserted: insertRes.rowCount ?? 0,
  };
}

let running = false;

export async function runAnalyticsIngest(now?: Date): Promise<void> {
  if (!analyticsJobsEnabled()) return;
  if (running) return;

  const t = now ?? new Date();
  const utcHour = t.getUTCHours();
  const utcMin = t.getUTCMinutes();

  // Skip 01:10 – 03:59 UTC (maintenance window; rollup runs at 04:20).
  if ((utcHour === 1 && utcMin >= 10) || (utcHour >= 2 && utcHour < 4)) return;

  running = true;
  try {
    for (let i = 0; i < 5; i++) {
      let batchRead = 0;

      await withGuardedClient(async (client) => {
        // Lock the cursor row; if another run holds it, skip immediately.
        const cursorRes = await client.query<{ value: string | null }>(
          `SELECT value FROM analytics_state
            WHERE key = 'radacct_cursor'
            FOR UPDATE SKIP LOCKED`,
        );

        // No row returned = row is locked by another concurrent run.
        if (cursorRes.rows.length === 0) {
          batchRead = -1; // signal to stop
          return;
        }

        const cursorVal = cursorRes.rows[0].value;
        if (cursorVal === null) {
          logger.warn(
            'analyticsIngest: radacct_cursor is NULL — seed on boot first',
          );
          batchRead = -1;
          return;
        }

        const cursor = Number(cursorVal);
        const result = await ingestBatch(client, cursor);
        batchRead = result.read;

        if (result.read > 0) {
          await setAnalyticsState(
            'radacct_cursor',
            String(result.nextCursor),
            client,
          );
        }
      });

      // Stop when: locked by another run, NULL cursor, or fewer than 2 000 rows.
      if (batchRead < 2000) break;
    }
  } catch (err) {
    logger.error('analyticsIngest: run failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    running = false;
  }
}

/** @internal — reset the in-flight guard between tests. */
export function _resetIngestState(): void {
  running = false;
}

export function startAnalyticsIngestJob(): void {
  cron.schedule(
    '20 2-57/5 * * * *',
    () => { void runAnalyticsIngest(); },
    { timezone: 'UTC' },
  );
}
