/**
 * Analytics rollup job.
 *
 * Reads per-hour radacct data and the card/uptime fact tables, then writes
 * compact per-day summary rows.  Every read is an independent guarded
 * transaction; writes happen in a single short transaction protected by a
 * Postgres advisory lock so two concurrent rollups cannot collide.
 *
 * Schedule:  second=0, minute=20, hours 0 and 4–23 (UTC).
 *   i.e. 00:20, 04:20, 05:20, … 23:20  (not 01–03 UTC).
 * Gated:     ANALYTICS_JOBS_ENABLED must be 'true'.
 */

import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';
import { config } from '../config';
import {
  withGuardedClient,
  getAnalyticsState,
  setAnalyticsState,
  analyticsJobsEnabled,
} from '../services/analyticsDb';
import {
  dayBoundsUtc,
  hourBoundsUtc,
  khartoumToday,
  addDays,
} from '../services/analyticsPeriod';
import { foldUptimeDay } from '../services/analyticsUptime';
import type { UptimeDayInput } from '../services/analyticsUptime';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADVISORY_LOCK_SQL = `SELECT pg_try_advisory_xact_lock(hashtext('analytics_rollup'))`;

/** Delay ms between per-hour radacct reads. */
const HOUR_READ_DELAY_MS = 100;

// ---------------------------------------------------------------------------
// rebuildUsageHours
// ---------------------------------------------------------------------------

export async function rebuildUsageHours(
  day: string,
  hours: number[],
): Promise<void> {
  const tz = config.ANALYTICS_TZ;

  // Load the router table once (small, ~390 rows).
  const routersRes = await pool.query<{
    id: string;
    user_id: string;
    tunnel_ip: string;
    created_at: Date;
  }>(`SELECT id, user_id, tunnel_ip, created_at FROM routers`);
  const routers = routersRes.rows;

  // Per-hour reads: each in its own guarded client.
  type HourResult = {
    hour: number;
    rows: {
      routerId: string | null;
      userId: string | null;
      sessions: number;
      dataBytes: bigint;
    }[];
  };
  const hourResults: HourResult[] = [];

  for (const hour of hours) {
    if (hourResults.length > 0) {
      await new Promise<void>((r) => setTimeout(r, HOUR_READ_DELAY_MS));
    }

    const { start, end } = hourBoundsUtc(day, hour, tz);

    const rawRows = await withGuardedClient(async (client) => {
      const res = await client.query<{
        nasipaddress: string;
        sessions: string;
        data_bytes: string;
      }>(
        `SELECT nasipaddress, COUNT(*) AS sessions,
                COALESCE(SUM(COALESCE(acctinputoctets,0)+COALESCE(acctoutputoctets,0)),0) AS data_bytes
           FROM radacct
          WHERE acctstarttime >= $1 AND acctstarttime < $2
          GROUP BY nasipaddress`,
        [start, end],
      );
      return res.rows;
    });

    // Map tunnel IP to a router created before the hour ended.
    const mapped = rawRows.map((row) => {
      const router = routers.find(
        (r) =>
          r.tunnel_ip === row.nasipaddress && new Date(r.created_at) < end,
      );
      return {
        routerId: router?.id ?? null,
        userId: router?.user_id ?? null,
        sessions: Number(row.sessions),
        dataBytes: BigInt(row.data_bytes),
      };
    });

    hourResults.push({ hour, rows: mapped });
  }

  // Single write transaction protected by the advisory lock.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '60s'`);
    const lockRes = await client.query<{ pg_try_advisory_xact_lock: boolean }>(
      ADVISORY_LOCK_SQL,
    );
    if (!lockRes.rows[0].pg_try_advisory_xact_lock) {
      await client.query('ROLLBACK');
      client.release();
      return;
    }

    for (const { hour, rows } of hourResults) {
      await client.query(
        `DELETE FROM analytics_usage_hourly WHERE day = $1 AND hour = $2`,
        [day, hour],
      );
      if (rows.length > 0) {
        await client.query(
          `INSERT INTO analytics_usage_hourly (day, hour, router_id, user_id, sessions, data_bytes)
           SELECT $1, $2,
                  router_id::uuid, user_id::uuid,
                  sessions::int, data_bytes::bigint
             FROM unnest(
               $3::text[], $4::text[],
               $5::int[], $6::bigint[]
             ) AS t(router_id, user_id, sessions, data_bytes)`,
          [
            day,
            hour,
            rows.map((r) => r.routerId),
            rows.map((r) => r.userId),
            rows.map((r) => r.sessions),
            rows.map((r) => String(r.dataBytes)),
          ],
        );
      }
    }

    // Re-derive daily and hour_daily aggregates from the hourly table.
    await client.query(
      `DELETE FROM analytics_usage_daily WHERE day = $1`,
      [day],
    );
    await client.query(
      `INSERT INTO analytics_usage_daily (day, router_id, user_id, sessions, data_bytes)
       SELECT day, router_id, user_id, SUM(sessions), SUM(data_bytes)
         FROM analytics_usage_hourly
        WHERE day = $1
        GROUP BY day, router_id, user_id`,
      [day],
    );

    await client.query(
      `DELETE FROM analytics_hour_daily WHERE day = $1`,
      [day],
    );
    await client.query(
      `INSERT INTO analytics_hour_daily (day, hour, sessions, data_bytes)
       SELECT day, hour, SUM(sessions), SUM(data_bytes)
         FROM analytics_usage_hourly
        WHERE day = $1
        GROUP BY day, hour`,
      [day],
    );

    await client.query('COMMIT');
    client.release();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release(true);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// rebuildCardDay
// ---------------------------------------------------------------------------

export async function rebuildCardDay(day: string): Promise<void> {
  const tz = config.ANALYTICS_TZ;
  const { start, end } = dayBoundsUtc(day, tz);
  const usageStart = config.ANALYTICS_USAGE_START_DATE;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '60s'`);
    const lockRes = await client.query<{ pg_try_advisory_xact_lock: boolean }>(
      ADVISORY_LOCK_SQL,
    );
    if (!lockRes.rows[0].pg_try_advisory_xact_lock) {
      await client.query('ROLLBACK');
      client.release();
      return;
    }

    await client.query(`DELETE FROM analytics_card_daily WHERE day = $1`, [
      day,
    ]);

    await client.query(
      `INSERT INTO analytics_card_daily
         (day, user_id, router_id, limit_type, price, cards_created, cards_used)
       SELECT
         $1::date,
         COALESCE(b.user_id, f.user_id),
         COALESCE(b.router_id, f.router_id),
         COALESCE(b.limit_type, f.limit_type),
         COALESCE(b.price, f.price),
         COALESCE(b.created, 0),
         COALESCE(f.used, 0)
         FROM (
           SELECT user_id, router_id, limit_type, price,
                  SUM(card_count)::int AS created
             FROM analytics_card_batches
            WHERE created_at >= $2 AND created_at < $3
            GROUP BY user_id, router_id, limit_type, price
         ) b
         FULL OUTER JOIN (
           SELECT user_id, router_id, limit_type, price,
                  COUNT(*)::int AS used
             FROM analytics_card_first_use
            WHERE first_used_at >= $2 AND first_used_at < $3
              AND first_used_at >= $4::date
            GROUP BY user_id, router_id, limit_type, price
         ) f ON b.user_id = f.user_id
             AND b.router_id = f.router_id
             AND b.limit_type IS NOT DISTINCT FROM f.limit_type
             AND b.price IS NOT DISTINCT FROM f.price`,
      [day, start, end, usageStart],
    );

    await client.query('COMMIT');
    client.release();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release(true);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// rebuildUptimeDay
// ---------------------------------------------------------------------------

export async function rebuildUptimeDay(day: string, now?: Date): Promise<void> {
  const tz = config.ANALYTICS_TZ;
  const { start: dayStart, end: dayEnd } = dayBoundsUtc(day, tz);
  const effectiveNow = now ?? new Date();

  // Read states, outages, gaps and heartbeat in one guarded read.
  const data = await withGuardedClient(async (client) => {
    const statesRes = await client.query<{
      router_id: string;
      user_id: string;
      tracked_since: Date;
      untracked_at: Date | null;
    }>(`SELECT router_id, user_id, tracked_since, untracked_at
          FROM router_uptime_state`);

    const outagesRes = await client.query<{
      router_id: string;
      started_at: Date;
      ended_at: Date | null;
    }>(
      `SELECT router_id, started_at, ended_at
         FROM router_outages
        WHERE started_at < $1
          AND (ended_at IS NULL OR ended_at > $2)`,
      [dayEnd, dayStart],
    );

    const gapsRes = await client.query<{
      started_at: Date;
      ended_at: Date;
    }>(
      `SELECT started_at, ended_at
         FROM monitor_gaps
        WHERE started_at < $1
          AND ended_at > $2`,
      [dayEnd, dayStart],
    );

    const hbRes = await client.query<{ value: string | null }>(
      `SELECT value FROM analytics_state WHERE key = 'monitor_heartbeat'`,
    );

    return { statesRes, outagesRes, gapsRes, hbRes };
  });

  const hbVal = data.hbRes.rows[0]?.value ?? null;
  const heartbeat = hbVal ? new Date(hbVal) : null;

  const uptimeInput: UptimeDayInput = {
    dayStart,
    dayEnd,
    now: effectiveNow,
    heartbeat,
    states: data.statesRes.rows.map((r) => ({
      routerId: r.router_id,
      userId: r.user_id,
      trackedSince: new Date(r.tracked_since),
      untrackedAt: r.untracked_at ? new Date(r.untracked_at) : null,
    })),
    outages: data.outagesRes.rows.map((r) => ({
      routerId: r.router_id,
      startedAt: new Date(r.started_at),
      endedAt: r.ended_at ? new Date(r.ended_at) : null,
    })),
    gaps: data.gapsRes.rows.map((r) => ({
      startedAt: new Date(r.started_at),
      endedAt: new Date(r.ended_at),
    })),
  };

  const rows = foldUptimeDay(uptimeInput);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '60s'`);
    const lockRes = await client.query<{ pg_try_advisory_xact_lock: boolean }>(
      ADVISORY_LOCK_SQL,
    );
    if (!lockRes.rows[0].pg_try_advisory_xact_lock) {
      await client.query('ROLLBACK');
      client.release();
      return;
    }

    await client.query(
      `DELETE FROM analytics_uptime_daily WHERE day = $1`,
      [day],
    );

    if (rows.length > 0) {
      await client.query(
        `INSERT INTO analytics_uptime_daily
           (day, router_id, user_id, observed_seconds, down_seconds, drops, longest_outage_seconds)
         SELECT $1, router_id::uuid, user_id::uuid,
                obs_s::int, down_s::int, drops_v::int, longest_s::int
           FROM unnest(
             $2::text[], $3::text[],
             $4::int[], $5::int[], $6::int[], $7::int[]
           ) AS t(router_id, user_id, obs_s, down_s, drops_v, longest_s)`,
        [
          day,
          rows.map((r) => r.routerId),
          rows.map((r) => r.userId),
          rows.map((r) => r.observedSeconds),
          rows.map((r) => r.downSeconds),
          rows.map((r) => r.drops),
          rows.map((r) => r.longestOutageSeconds),
        ],
      );
    }

    await client.query('COMMIT');
    client.release();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release(true);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// correctCardCounts
// ---------------------------------------------------------------------------

export async function correctCardCounts(day: string): Promise<void> {
  const tz = config.ANALYTICS_TZ;
  const { start: dayStart, end: dayEnd } = dayBoundsUtc(day, tz);

  // Use all routers so the guarded per-router COUNT (which uses the index) finds
  // any router with vouchers in the window and returns nothing for the rest.
  const routersRes = await pool.query<{ id: string }>(
    `SELECT id FROM routers`,
  );
  const routerIds = routersRes.rows.map((r) => r.id);
  if (routerIds.length === 0) return;

  // Find when migration 045 was applied (the floor for voucher_meta reads).
  const migRes = await pool.query<{ executed_at: Date }>(
    `SELECT executed_at FROM schema_migrations WHERE filename = $1`,
    ['045_analytics_recording.sql'],
  );
  const migApplied = migRes.rows[0]?.executed_at ?? null;
  const effectiveStart = migApplied
    ? new Date(Math.max(dayStart.getTime(), new Date(migApplied).getTime()))
    : dayStart;

  // Count actual voucher_meta rows per (router_id, user_id, price, limit_type).
  const vmRes = await withGuardedClient(
    async (client) => {
      return client.query<{
        router_id: string;
        user_id: string;
        price: string | null;
        limit_type: string | null;
        cnt: string;
      }>(
        `SELECT router_id, user_id, price, limit_type, COUNT(*) AS cnt
           FROM voucher_meta
          WHERE router_id = ANY($1::uuid[])
            AND created_at >= $2
            AND created_at < $3
          GROUP BY 1, 2, 3, 4`,
        [routerIds, effectiveStart, dayEnd],
      );
    },
    { allowHashJoin: true },
  );

  if (vmRes.rows.length === 0) return;

  // Sum the recorded batch counts for the same window.
  const batchRes = await pool.query<{
    router_id: string;
    user_id: string;
    price: string | null;
    limit_type: string | null;
    total: string;
  }>(
    `SELECT router_id, user_id, price, limit_type, SUM(card_count) AS total
       FROM analytics_card_batches
      WHERE router_id = ANY($1::uuid[])
        AND created_at >= $2
        AND created_at < $3
      GROUP BY 1, 2, 3, 4`,
    [routerIds, effectiveStart, dayEnd],
  );

  const batchMap = new Map<string, number>();
  for (const row of batchRes.rows) {
    const key = `${row.router_id}:${row.user_id}:${row.price ?? ''}:${row.limit_type ?? ''}`;
    batchMap.set(key, Number(row.total));
  }

  // Collect reconcile rows where voucher_meta exceeds batches.
  const reconcileAt = new Date(dayEnd.getTime() - 1000); // 1 s before window end
  const reconcileRows: {
    userId: string;
    routerId: string;
    excess: number;
    price: string | null;
    limitType: string | null;
  }[] = [];
  for (const vm of vmRes.rows) {
    const key = `${vm.router_id}:${vm.user_id}:${vm.price ?? ''}:${vm.limit_type ?? ''}`;
    const recorded = batchMap.get(key) ?? 0;
    const actual = Number(vm.cnt);
    const excess = actual - recorded;
    if (excess > 0) {
      reconcileRows.push({
        userId: vm.user_id,
        routerId: vm.router_id,
        excess,
        price: vm.price,
        limitType: vm.limit_type,
      });
    }
  }

  if (reconcileRows.length === 0) return;

  // Insert all reconcile rows inside an advisory-locked transaction.
  const writeClient = await pool.connect();
  try {
    await writeClient.query('BEGIN');
    await writeClient.query(`SET LOCAL statement_timeout = '60s'`);
    const lockRes2 = await writeClient.query<{ pg_try_advisory_xact_lock: boolean }>(
      ADVISORY_LOCK_SQL,
    );
    if (!lockRes2.rows[0].pg_try_advisory_xact_lock) {
      await writeClient.query('ROLLBACK');
      writeClient.release();
      return;
    }

    await writeClient.query(
      `INSERT INTO analytics_card_batches
         (user_id, router_id, created_at, card_count, price, limit_type, source)
       SELECT user_id::uuid, router_id::uuid, $1, card_count::int,
              price::numeric, limit_type, 'reconcile'
         FROM unnest(
           $2::text[], $3::text[],
           $4::int[], $5::text[], $6::text[]
         ) AS t(user_id, router_id, card_count, price, limit_type)`,
      [
        reconcileAt,
        reconcileRows.map((r) => r.userId),
        reconcileRows.map((r) => r.routerId),
        reconcileRows.map((r) => r.excess),
        reconcileRows.map((r) => r.price),
        reconcileRows.map((r) => r.limitType),
      ],
    );

    await writeClient.query('COMMIT');
    writeClient.release();
  } catch (err) {
    await writeClient.query('ROLLBACK').catch(() => undefined);
    writeClient.release(true);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// runAnalyticsRollup
// ---------------------------------------------------------------------------

let running = false;

export async function runAnalyticsRollup(now?: Date): Promise<void> {
  if (!analyticsJobsEnabled()) return;
  if (running) return;
  running = true;

  const t = now ?? new Date();
  const tz = config.ANALYTICS_TZ;
  const today = khartoumToday(t, tz);
  const yesterday = addDays(today, -1);
  const utcHour = t.getUTCHours();

  try {
    // --- Always: last 3 Khartoum hours of today + today's card and uptime. ---

    // Determine which Khartoum hours to rebuild (last 3 from "now").
    // Derive the local hour from Intl so the offset tracks the configured TZ.
    const khartoumHourNow = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        hour12: false,
      }).format(t),
    );
    // Build the 3-hour window; if it crosses midnight, some hours belong to yesterday.
    const rawHours = [khartoumHourNow - 2, khartoumHourNow - 1, khartoumHourNow];
    const todayHours: number[] = [];
    const yesterdayHours: number[] = [];
    for (const h of rawHours) {
      if (h < 0) {
        yesterdayHours.push((h + 24) % 24);
      } else {
        todayHours.push(h);
      }
    }
    // todayHours may be a subset of [0,1,2] when the 3-hour window crosses Khartoum midnight;
    // the midnight-crossing hours are rebuilt against yesterday above.
    if (yesterdayHours.length > 0) {
      try {
        await rebuildUsageHours(yesterday, yesterdayHours);
      } catch (err) {
        logger.error('rollup: rebuildUsageHours (yesterday, midnight-crossing hours) failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    try {
      await rebuildUsageHours(today, todayHours);
    } catch (err) {
      logger.error('rollup: rebuildUsageHours (today, last 3) failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await rebuildCardDay(today);
    } catch (err) {
      logger.error('rollup: rebuildCardDay (today) failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await rebuildUptimeDay(today, t);
    } catch (err) {
      logger.error('rollup: rebuildUptimeDay (today) failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // --- UTC hour 22: full rebuild of yesterday (Khartoum). ---
    if (utcHour === 22) {
      const allHours = Array.from({ length: 24 }, (_, i) => i);

      try {
        await rebuildUsageHours(yesterday, allHours);
      } catch (err) {
        logger.error('rollup: rebuildUsageHours (yesterday, 24h) failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        await rebuildCardDay(yesterday);
      } catch (err) {
        logger.error('rollup: rebuildCardDay (yesterday) failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        await rebuildUptimeDay(yesterday, t);
      } catch (err) {
        logger.error('rollup: rebuildUptimeDay (yesterday) failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- UTC hour 4: deep rebuild of 4 prior days + correction + prune. ---
    if (utcHour === 4) {
      const allHours = Array.from({ length: 24 }, (_, i) => i);

      for (let d = 1; d <= 4; d++) {
        const priorDay = addDays(today, -d); // yesterday through today-4

        try {
          await rebuildUsageHours(priorDay, allHours);
        } catch (err) {
          logger.error(`rollup: rebuildUsageHours (prior day ${d}) failed`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        try {
          await rebuildCardDay(priorDay);
        } catch (err) {
          logger.error(`rollup: rebuildCardDay (prior day ${d}) failed`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        try {
          await rebuildUptimeDay(priorDay, t);
        } catch (err) {
          logger.error(`rollup: rebuildUptimeDay (prior day ${d}) failed`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Card-count correction for yesterday, then rebuild.
      try {
        await correctCardCounts(yesterday);
      } catch (err) {
        logger.error('rollup: correctCardCounts (yesterday) failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        await rebuildCardDay(yesterday);
      } catch (err) {
        logger.error('rollup: rebuildCardDay (yesterday, after correction) failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Prune hourly rows older than 40 days.
      try {
        const cutoff = addDays(today, -40);
        await pool.query(
          `DELETE FROM analytics_usage_hourly WHERE day < $1::date`,
          [cutoff],
        );
      } catch (err) {
        logger.error('rollup: hourly prune failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Record the last successful run.
    await setAnalyticsState('rollup_last_ok', t.toISOString());
  } catch (err) {
    logger.error('analyticsRollup: run failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    running = false;
  }
}

/** @internal — reset the in-flight guard between tests. */
export function _resetRollupState(): void {
  running = false;
}

export function startAnalyticsRollupJob(): void {
  cron.schedule(
    '0 20 0,4-23 * * *',
    () => { void runAnalyticsRollup(); },
    { timezone: 'UTC' },
  );
}
