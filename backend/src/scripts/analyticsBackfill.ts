/**
 * analyticsBackfill.ts — one-shot history backfill script
 *
 * Purpose
 * -------
 * Fills the analytics summary tables for the period before the analytics
 * recording jobs were deployed.  Covers three distinct passes:
 *   1. cards    — voucher_meta rows created before migration 045 was applied
 *   2. first-use — analytics_card_first_use from radacct up to the seeded cursor
 *   3. usage    — analytics_usage_hourly / _daily rebuilt from radacct hour by hour
 *   4. days     — analytics_card_daily + analytics_uptime_daily rebuilt per day
 *   5. all      — 1 + 2 + 3 + 4 in order
 *
 * Safety model
 * ------------
 *   • DEFAULT is a dry run — reads and counts only; writes NOTHING.
 *   • Set CONFIRM=1 to write.
 *   • Logs current_database() and inet_server_addr().
 *   • Refuses to write outside 04:00–06:00 UTC unless IGNORE_WINDOW=1.
 *   • Progress stored in analytics_state: backfill_cards_router,
 *     backfill_first_use_cursor, backfill_usage_day.
 *   • 250 ms pause between chunks; doubled when a chunk takes > 5 s.
 *   • Stops after 3 consecutive chunk failures.
 *
 * Usage
 * -----
 *   # dry run
 *   npx ts-node src/scripts/analyticsBackfill.ts
 *
 *   # write (inside 04:00–06:00 UTC)
 *   CONFIRM=1 npx ts-node src/scripts/analyticsBackfill.ts
 *
 *   # write outside the window (staging / dev)
 *   CONFIRM=1 IGNORE_WINDOW=1 npx ts-node src/scripts/analyticsBackfill.ts
 *
 *   # single step
 *   STEP=cards CONFIRM=1 IGNORE_WINDOW=1 npx ts-node src/scripts/analyticsBackfill.ts
 */

import { pool } from '../config/database';
import logger from '../config/logger';
import { config } from '../config';
import {
  withGuardedClient,
  getAnalyticsState,
  setAnalyticsState,
} from '../services/analyticsDb';
import { ingestBatch } from '../jobs/analyticsIngest';
import {
  rebuildUsageHours,
  rebuildCardDay,
  rebuildUptimeDay,
} from '../jobs/analyticsRollup';
import { addDays, khartoumToday } from '../services/analyticsPeriod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackfillStep = 'cards' | 'first-use' | 'usage' | 'days' | 'all';

export interface BackfillReport {
  cards: { routers: number; pages: number; batches: number };
  firstUse: { fromId: number; toId: number; chunks: number; inserted: number };
  usageDays: number;
  rebuiltDays: number;
}

export interface BackfillOpts {
  confirm: boolean;
  step: BackfillStep;
  ignoreWindow: boolean;
  /**
   * When true (and confirm is also true): before the cards step, delete every
   * analytics_card_batches row with source='backfill', every analytics_state key
   * that starts with 'backfill_cards_router:', and the 'backfill_cards_done' key.
   * Does nothing in a dry run.  Defaults to false.
   */
  resetCards?: boolean;
  /** Injected for tests; defaults to new Date() */
  _now?: Date;
  /** Override pause ms for tests; defaults to BASE_PAUSE_MS */
  _delayMs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 5_000;
const CHUNK_SIZE = 2_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BASE_PAUSE_MS = 250;
const SLOW_CHUNK_THRESHOLD_MS = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Check whether we are allowed to write right now. */
function assertWriteWindow(now: Date, ignoreWindow: boolean): void {
  if (ignoreWindow) return;
  const utcHour = now.getUTCHours();
  if (utcHour < 4 || utcHour >= 6) {
    throw new Error(
      `analyticsBackfill: outside the write window (04:00–06:00 UTC). ` +
        `Current UTC hour: ${utcHour}. Set IGNORE_WINDOW=1 to override.`,
    );
  }
}

/** Fetch and log the database identity. */
async function logDbIdentity(): Promise<void> {
  try {
    const res = await pool.query<{ db: string; addr: string }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr`,
    );
    const row = res.rows[0];
    logger.info('analyticsBackfill: database identity', {
      database: row?.db,
      address: row?.addr,
    });
  } catch (err) {
    logger.warn('analyticsBackfill: could not read DB identity', { err });
  }
}

/** Load the executed_at timestamp for migration 045. */
async function getMigration045Date(): Promise<Date> {
  const res = await pool.query<{ executed_at: Date }>(
    `SELECT executed_at FROM schema_migrations WHERE filename LIKE '045%' LIMIT 1`,
  );
  const row = res.rows[0];
  if (!row) {
    throw new Error('analyticsBackfill: migration 045 not applied yet');
  }
  return row.executed_at;
}

// ---------------------------------------------------------------------------
// Step 1: Cards
// ---------------------------------------------------------------------------

async function backfillCards(
  confirm: boolean,
  basePauseMs: number = BASE_PAUSE_MS,
): Promise<BackfillReport['cards']> {
  const migration045Date = await getMigration045Date();

  // List routers
  const routersRes = await pool.query<{ id: string }>(
    `SELECT id FROM routers ORDER BY created_at`,
  );
  const routers = routersRes.rows.map((r) => r.id);

  let totalPages = 0;
  let totalBatches = 0;

  for (const routerId of routers) {
    // Load the resume cursor for this router
    const savedCursor = await getAnalyticsState(`backfill_cards_router:${routerId}`);
    // cursor is encoded as "created_at_iso::id" or null = start
    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;
    if (savedCursor) {
      const parts = savedCursor.split('::');
      cursorCreatedAt = parts[0] ?? null;
      cursorId = parts[1] ?? null;
    }

    // Per router: delete previous backfill batches (only in confirm mode), then insert fresh
    // Only DELETE previous batches when starting fresh (no saved cursor).
    // If a cursor exists we are resuming — deleting would lose already-written rows.
    if (confirm && !savedCursor) {
      await pool.query(
        `DELETE FROM analytics_card_batches WHERE router_id = $1 AND source = 'backfill'`,
        [routerId],
      );
    }

    // Page through voucher_meta for this router
    let consecutiveFailures = 0;
    let pauseMs = basePauseMs;
    let done = false;

    while (!done) {
      const tChunkStart = Date.now();
      let page: Array<{
        created_at: Date;
        created_at_text: string;
        id: string;
        price: string | null;
        limit_type: string | null;
        cnt: string;
      }> = [];

      try {
        const res = await withGuardedClient(async (client) => {
          return client.query<{
            created_at: Date;
            created_at_text: string;
            id: string;
            price: string | null;
            limit_type: string | null;
            cnt: string;
          }>(
            cursorCreatedAt
              ? `SELECT created_at,
                        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_text,
                        id, price::text, limit_type, COUNT(*) OVER () AS cnt
                   FROM voucher_meta
                  WHERE router_id = $1::uuid
                    AND created_at < $2::timestamptz
                    AND (created_at < $3::timestamptz OR (created_at = $3::timestamptz AND id < $4::uuid))
                  ORDER BY created_at DESC, id DESC
                  LIMIT $5::int`
              : `SELECT created_at,
                        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_text,
                        id, price::text, limit_type, COUNT(*) OVER () AS cnt
                   FROM voucher_meta
                  WHERE router_id = $1::uuid
                    AND created_at < $2::timestamptz
                  ORDER BY created_at DESC, id DESC
                  LIMIT $3::int`,
            cursorCreatedAt
              ? [routerId, migration045Date, cursorCreatedAt, cursorId, PAGE_SIZE]
              : [routerId, migration045Date, PAGE_SIZE],
          );
        });
        page = res.rows;
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        logger.error('analyticsBackfill: cards page failed', {
          routerId,
          error: err instanceof Error ? err.message : String(err),
          consecutiveFailures,
        });
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logger.error('analyticsBackfill: stopping cards step after 3 consecutive failures');
          done = true;
          break;
        }
        await sleep(pauseMs);
        continue;
      }

      if (page.length === 0) {
        done = true;
        break;
      }

      totalPages++;

      // Group by (created_at_text, price, limit_type) → batch rows.
      // Use the full-precision text from Postgres so microseconds are preserved.
      const groups = new Map<
        string,
        { created_at_text: string; price: number | null; limit_type: string | null; count: number }
      >();
      for (const row of page) {
        const key = `${row.created_at_text}|${row.price}|${row.limit_type}`;
        const existing = groups.get(key);
        if (existing) {
          existing.count++;
        } else {
          groups.set(key, {
            created_at_text: row.created_at_text,
            price: row.price !== null ? Number(row.price) : null,
            limit_type: row.limit_type,
            count: 1,
          });
        }
      }

      if (confirm) {
        for (const batch of groups.values()) {
          await pool.query(
            `INSERT INTO analytics_card_batches
               (user_id, router_id, created_at, card_count, price, limit_type, source)
             SELECT user_id, $1, $2::timestamptz, $3, $4, $5, 'backfill'
               FROM routers WHERE id = $1`,
            [
              routerId,
              batch.created_at_text,
              batch.count,
              batch.price,
              batch.limit_type,
            ],
          );
          totalBatches++;
        }
      }

      // Save progress — cursor uses the full-precision text, never a JS Date round-trip.
      const lastRow = page[page.length - 1];
      const newCursor = `${lastRow.created_at_text}::${lastRow.id}`;
      if (confirm) {
        await setAnalyticsState(`backfill_cards_router:${routerId}`, newCursor);
      }

      cursorCreatedAt = lastRow.created_at_text;
      cursorId = lastRow.id;

      if (page.length < PAGE_SIZE) {
        done = true;
      }

      const elapsed = Date.now() - tChunkStart;
      pauseMs = elapsed > SLOW_CHUNK_THRESHOLD_MS ? pauseMs * 2 : basePauseMs;
      await sleep(pauseMs);
    }
  }

  // Mark cards backfill done
  if (confirm) {
    await setAnalyticsState('backfill_cards_done', 'true');
  }

  return { routers: routers.length, pages: totalPages, batches: totalBatches };
}

// ---------------------------------------------------------------------------
// Step 2: First-use ingest
// ---------------------------------------------------------------------------

async function backfillFirstUse(
  confirm: boolean,
  basePauseMs: number = BASE_PAUSE_MS,
): Promise<BackfillReport['firstUse']> {
  const tz = config.ANALYTICS_TZ;
  const startDate = config.ANALYTICS_USAGE_START_DATE;

  // Find the starting radacctid: first session on or after the start date, minus 1000
  const firstRes = await pool.query<{ radacctid: string }>(
    `SELECT radacctid FROM radacct
      WHERE acctstarttime >= $1
      ORDER BY acctstarttime
      LIMIT 1`,
    [new Date(`${startDate}T00:00:00Z`)],
  );

  // Check for a resume cursor
  const savedCursor = await getAnalyticsState('backfill_first_use_cursor');

  let cursor: number;
  if (savedCursor !== null) {
    cursor = Number(savedCursor);
  } else if (firstRes.rows.length > 0) {
    cursor = Math.max(0, Number(firstRes.rows[0].radacctid) - 1000);
  } else {
    cursor = 0;
  }

  const fromId = cursor;

  // End at the stored radacct_cursor
  const cursorStateRes = await pool.query<{ value: string }>(
    `SELECT value FROM analytics_state WHERE key = 'radacct_cursor'`,
  );
  const endId =
    cursorStateRes.rows.length > 0 ? Number(cursorStateRes.rows[0].value) : 0;

  let chunks = 0;
  let totalInserted = 0;
  let consecutiveFailures = 0;
  let pauseMs = basePauseMs;

  while (cursor < endId) {
    const tChunkStart = Date.now();
    try {
      let inserted = 0;

      if (confirm) {
        await withGuardedClient(async (client) => {
          const result = await ingestBatch(client, cursor, endId);
          if (result.read === 0) {
            cursor = endId; // nothing left
            return;
          }
          inserted = result.inserted;
          cursor = result.nextCursor;
          await setAnalyticsState('backfill_first_use_cursor', String(cursor), client);
        });
      } else {
        // Dry run: advance by CHUNK_SIZE without writing anything
        cursor = Math.min(cursor + CHUNK_SIZE, endId);
      }

      totalInserted += inserted;
      chunks++;
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      logger.error('analyticsBackfill: first-use chunk failed', {
        cursor,
        error: err instanceof Error ? err.message : String(err),
        consecutiveFailures,
      });
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logger.error('analyticsBackfill: stopping first-use step after 3 consecutive failures');
        break;
      }
    }

    const elapsed = Date.now() - tChunkStart;
    const pause = elapsed > SLOW_CHUNK_THRESHOLD_MS ? pauseMs * 2 : basePauseMs;
    pauseMs = elapsed > SLOW_CHUNK_THRESHOLD_MS ? pauseMs * 2 : basePauseMs;
    await sleep(pause);
  }

  return { fromId, toId: endId, chunks, inserted: totalInserted };
}

// ---------------------------------------------------------------------------
// Step 3: Usage rebuild
// ---------------------------------------------------------------------------

async function backfillUsage(confirm: boolean, basePauseMs: number = BASE_PAUSE_MS): Promise<number> {
  const tz = config.ANALYTICS_TZ;
  const startDate = config.ANALYTICS_USAGE_START_DATE;
  const today = khartoumToday(new Date(), tz);

  // Load resume day
  const savedDay = await getAnalyticsState('backfill_usage_day');
  let currentDay = savedDay ?? startDate;

  let daysProcessed = 0;
  let consecutiveFailures = 0;
  let pauseMs = basePauseMs;

  // Include today so hours before the last 3 are not left missing when the jobs
  // are enabled in the middle of a day.
  while (currentDay <= today) {
    const tChunkStart = Date.now();
    try {
      if (confirm) {
        await rebuildUsageHours(currentDay, Array.from({ length: 24 }, (_, i) => i));
        await setAnalyticsState('backfill_usage_day', currentDay);
      }
      consecutiveFailures = 0;
      daysProcessed++;
    } catch (err) {
      consecutiveFailures++;
      logger.error('analyticsBackfill: usage day failed', {
        day: currentDay,
        error: err instanceof Error ? err.message : String(err),
        consecutiveFailures,
      });
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logger.error('analyticsBackfill: stopping usage step after 3 consecutive failures');
        break;
      }
    }

    currentDay = addDays(currentDay, 1);

    const elapsed = Date.now() - tChunkStart;
    const pause = elapsed > SLOW_CHUNK_THRESHOLD_MS ? pauseMs * 2 : basePauseMs;
    pauseMs = elapsed > SLOW_CHUNK_THRESHOLD_MS ? pauseMs * 2 : basePauseMs;
    await sleep(pause);
  }

  return daysProcessed;
}

// ---------------------------------------------------------------------------
// Step 4: Days rebuild (cards + uptime)
// ---------------------------------------------------------------------------

async function backfillDays(confirm: boolean, basePauseMs: number = BASE_PAUSE_MS): Promise<number> {
  const tz = config.ANALYTICS_TZ;
  const usageStartDate = config.ANALYTICS_USAGE_START_DATE;
  const today = khartoumToday(new Date(), tz);

  // Determine the earliest day that has batches (in configured tz), so card-day
  // rebuilds cover history that pre-dates the usage-start date.
  const batchMinRes = await pool.query<{ d: string | null }>(
    `SELECT to_char((MIN(created_at) AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d
       FROM analytics_card_batches`,
    [tz],
  );
  const cardStartDay: string = batchMinRes.rows[0]?.d ?? usageStartDate;

  // Determine the earliest tracked_since day for uptime; skip uptime entirely when none.
  const uptimeMinRes = await pool.query<{ d: string | null }>(
    `SELECT to_char((MIN(tracked_since) AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d
       FROM router_uptime_state`,
    [tz],
  );
  const uptimeStartDay: string | null = uptimeMinRes.rows[0]?.d ?? null;

  // The main loop starts from the earliest of cardStartDay and uptimeStartDay.
  const effectiveStart =
    uptimeStartDay !== null && uptimeStartDay < cardStartDay
      ? uptimeStartDay
      : cardStartDay;

  logger.info('analyticsBackfill: days step bounds', {
    cardStartDay,
    uptimeStartDay,
    effectiveStart,
    today,
  });

  let currentDay = effectiveStart;
  let daysRebuilt = 0;
  let consecutiveFailures = 0;
  let pauseMs = basePauseMs;

  // Include today: rebuildCardDay and rebuildUptimeDay are idempotent and safe
  // mid-day (they read from already-committed summary tables).
  while (currentDay <= today) {
    const tChunkStart = Date.now();
    try {
      if (confirm) {
        if (currentDay >= cardStartDay) {
          await rebuildCardDay(currentDay);
        }
        if (uptimeStartDay !== null && currentDay >= uptimeStartDay) {
          await rebuildUptimeDay(currentDay);
        }
      }
      consecutiveFailures = 0;
      daysRebuilt++;
    } catch (err) {
      consecutiveFailures++;
      logger.error('analyticsBackfill: day rebuild failed', {
        day: currentDay,
        error: err instanceof Error ? err.message : String(err),
        consecutiveFailures,
      });
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logger.error('analyticsBackfill: stopping days step after 3 consecutive failures');
        break;
      }
    }

    currentDay = addDays(currentDay, 1);

    const elapsed = Date.now() - tChunkStart;
    const pause = elapsed > SLOW_CHUNK_THRESHOLD_MS ? pauseMs * 2 : basePauseMs;
    pauseMs = elapsed > SLOW_CHUNK_THRESHOLD_MS ? pauseMs * 2 : basePauseMs;
    await sleep(pause);
  }

  return daysRebuilt;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runBackfill(opts: BackfillOpts): Promise<BackfillReport> {
  const now = opts._now ?? new Date();
  const { confirm, step, ignoreWindow } = opts;
  const delayMs = opts._delayMs ?? BASE_PAUSE_MS;

  // Log DB identity first
  await logDbIdentity();

  // Check write window
  if (confirm) {
    assertWriteWindow(now, ignoreWindow);
  }

  const report: BackfillReport = {
    cards: { routers: 0, pages: 0, batches: 0 },
    firstUse: { fromId: 0, toId: 0, chunks: 0, inserted: 0 },
    usageDays: 0,
    rebuiltDays: 0,
  };

  const runCards = step === 'cards' || step === 'all';
  const runFirstUse = step === 'first-use' || step === 'all';
  const runUsage = step === 'usage' || step === 'all';
  const runDays = step === 'days' || step === 'all';

  if (runCards && confirm && opts.resetCards) {
    // Reset: wipe previous backfill batches and progress so the step runs clean.
    const batchDel = await pool.query(
      `DELETE FROM analytics_card_batches WHERE source = 'backfill'`,
    );
    const stateDel = await pool.query(
      `DELETE FROM analytics_state WHERE key LIKE 'backfill_cards_router:%' OR key = 'backfill_cards_done'`,
    );
    logger.info('analyticsBackfill: resetCards wiped previous run', {
      batchRowsDeleted: batchDel.rowCount,
      stateRowsDeleted: stateDel.rowCount,
    });
  }

  if (runCards) {
    report.cards = await backfillCards(confirm, delayMs);
    logger.info('analyticsBackfill: cards step complete', report.cards);
  }

  if (runFirstUse) {
    report.firstUse = await backfillFirstUse(confirm, delayMs);
    logger.info('analyticsBackfill: first-use step complete', report.firstUse);
  }

  if (runUsage) {
    report.usageDays = await backfillUsage(confirm, delayMs);
    logger.info('analyticsBackfill: usage step complete', { days: report.usageDays });
  }

  if (runDays) {
    report.rebuiltDays = await backfillDays(confirm, delayMs);
    logger.info('analyticsBackfill: days step complete', { days: report.rebuiltDays });
  }

  return report;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const confirm = process.env['CONFIRM'] === '1';
  const ignoreWindow = process.env['IGNORE_WINDOW'] === '1';
  const resetCards = process.env['RESET_CARDS'] === '1';
  const rawStep = process.env['STEP'] ?? 'all';
  const validSteps: BackfillStep[] = ['cards', 'first-use', 'usage', 'days', 'all'];
  const step: BackfillStep = validSteps.includes(rawStep as BackfillStep)
    ? (rawStep as BackfillStep)
    : 'all';

  logger.info('analyticsBackfill: starting', { confirm, step, ignoreWindow, resetCards });

  runBackfill({ confirm, step, ignoreWindow, resetCards })
    .then((report) => {
      logger.info('analyticsBackfill: done', report);
      process.exit(0);
    })
    .catch((err) => {
      logger.error('analyticsBackfill: fatal error', {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    });
}
