import type { PoolClient } from 'pg';
import { pool } from '../config/database';
import logger from '../config/logger';

export const UPTIME_CONFIRM_MS = 180_000;
export const HEARTBEAT_GAP_MS = 180_000;
export const HANDSHAKE_BACKDATE_MAX_MS = 300_000;

export interface RouterTick {
  id: string;
  userId: string;
  online: boolean;
  lastSeen: Date | null;
}

export interface UptimeState {
  routerId: string;
  userId: string;
  isUp: boolean;
  changedAt: Date;
  untrackedAt: Date | null;
  hasOpenOutage: boolean;
}

export interface UptimeWrites {
  newStates: { routerId: string; userId: string; trackedSince: Date }[];
  setDown: { routerId: string; changedAt: Date }[];
  setUp: { routerId: string; changedAt: Date }[];
  restartConfirmation: { routerId: string; changedAt: Date }[];
  openOutages: { routerId: string; userId: string; startedAt: Date }[];
  closeOutages: { routerId: string; endedAt: Date; reason: 'recovered' | 'removed' }[];
  untrack: { routerId: string; at: Date }[];
  gap: { startedAt: Date; endedAt: Date } | null;
}

export function planUptimeWrites(
  prev: { states: UptimeState[]; heartbeat: Date | null },
  routers: RouterTick[],
  now: Date,
): UptimeWrites {
  const writes: UptimeWrites = {
    newStates: [],
    setDown: [],
    setUp: [],
    restartConfirmation: [],
    openOutages: [],
    closeOutages: [],
    untrack: [],
    gap: null,
  };

  const stateMap = new Map(prev.states.map((s) => [s.routerId, s]));
  const tickIds = new Set(routers.map((r) => r.id));

  const gapDetected =
    prev.heartbeat !== null &&
    now.getTime() - prev.heartbeat.getTime() > HEARTBEAT_GAP_MS;
  if (gapDetected && prev.heartbeat) {
    writes.gap = { startedAt: prev.heartbeat, endedAt: now };
  }

  for (const tick of routers) {
    const state = stateMap.get(tick.id);
    if (!state) {
      if (tick.online) {
        writes.newStates.push({
          routerId: tick.id,
          userId: tick.userId,
          trackedSince: now,
        });
      }
      continue;
    }
    if (state.untrackedAt) continue;

    if (tick.online) {
      if (!state.isUp) {
        writes.setUp.push({ routerId: tick.id, changedAt: now });
        if (state.hasOpenOutage) {
          writes.closeOutages.push({
            routerId: tick.id,
            endedAt: now,
            reason: 'recovered',
          });
        }
      }
    } else {
      if (state.isUp) {
        writes.setDown.push({ routerId: tick.id, changedAt: now });
      } else if (!state.hasOpenOutage) {
        if (gapDetected) {
          writes.restartConfirmation.push({ routerId: tick.id, changedAt: now });
        } else {
          const downMs = now.getTime() - state.changedAt.getTime();
          if (downMs >= UPTIME_CONFIRM_MS) {
            let startedAt: Date = state.changedAt;
            if (
              tick.lastSeen &&
              tick.lastSeen.getTime() <= state.changedAt.getTime() &&
              state.changedAt.getTime() - tick.lastSeen.getTime() <=
                HANDSHAKE_BACKDATE_MAX_MS
            ) {
              startedAt = tick.lastSeen;
            }
            writes.openOutages.push({
              routerId: tick.id,
              userId: tick.userId,
              startedAt,
            });
          }
        }
      }
    }
  }

  for (const state of prev.states) {
    if (state.untrackedAt) continue;
    if (!tickIds.has(state.routerId)) {
      writes.untrack.push({ routerId: state.routerId, at: now });
      if (state.hasOpenOutage) {
        writes.closeOutages.push({
          routerId: state.routerId,
          endedAt: now,
          reason: 'removed',
        });
      }
    }
  }

  return writes;
}

let inFlight = false;

export async function recordRouterTick(input: {
  peersOk: boolean;
  peerCount: number;
  routers: RouterTick[];
  now: Date;
}): Promise<void> {
  if (!input.peersOk || input.peerCount === 0) return;
  if (inFlight) return;
  inFlight = true;

  let client: PoolClient | null = null;
  try {
    client = (await pool.connect()) as PoolClient;
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '3s'");
    await client.query("SET LOCAL lock_timeout = '1s'");

    const statesRes = await client.query<{
      router_id: string;
      user_id: string;
      is_up: boolean;
      changed_at: Date;
      untracked_at: Date | null;
      has_open_outage: boolean;
    }>(
      `SELECT s.router_id, s.user_id, s.is_up, s.changed_at, s.untracked_at,
              EXISTS(SELECT 1 FROM router_outages o
                      WHERE o.router_id = s.router_id AND o.ended_at IS NULL) AS has_open_outage
         FROM router_uptime_state s
        WHERE s.untracked_at IS NULL`,
    );
    const states: UptimeState[] = statesRes.rows.map((r) => ({
      routerId: r.router_id,
      userId: r.user_id,
      isUp: r.is_up,
      changedAt: new Date(r.changed_at),
      untrackedAt: r.untracked_at ? new Date(r.untracked_at) : null,
      hasOpenOutage: r.has_open_outage,
    }));

    const hbRes = await client.query<{ value: string | null }>(
      `SELECT value FROM analytics_state WHERE key = 'monitor_heartbeat'`,
    );
    const hbVal = hbRes.rows[0]?.value ?? null;
    const heartbeat = hbVal ? new Date(hbVal) : null;

    const writes = planUptimeWrites(
      { states, heartbeat },
      input.routers,
      input.now,
    );

    if (writes.newStates.length > 0) {
      await client.query(
        `INSERT INTO router_uptime_state (router_id, user_id, tracked_since, is_up, changed_at)
           SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::timestamptz[], $4::bool[], $5::timestamptz[])
           ON CONFLICT (router_id) DO NOTHING`,
        [
          writes.newStates.map((n) => n.routerId),
          writes.newStates.map((n) => n.userId),
          writes.newStates.map((n) => n.trackedSince),
          writes.newStates.map(() => true),
          writes.newStates.map((n) => n.trackedSince),
        ],
      );
    }

    if (writes.setDown.length > 0) {
      await client.query(
        `UPDATE router_uptime_state AS s
            SET is_up = false, changed_at = u.changed_at
           FROM unnest($1::uuid[], $2::timestamptz[]) AS u(router_id, changed_at)
          WHERE s.router_id = u.router_id`,
        [writes.setDown.map((x) => x.routerId), writes.setDown.map((x) => x.changedAt)],
      );
    }

    if (writes.setUp.length > 0) {
      await client.query(
        `UPDATE router_uptime_state AS s
            SET is_up = true, changed_at = u.changed_at
           FROM unnest($1::uuid[], $2::timestamptz[]) AS u(router_id, changed_at)
          WHERE s.router_id = u.router_id`,
        [writes.setUp.map((x) => x.routerId), writes.setUp.map((x) => x.changedAt)],
      );
    }

    if (writes.restartConfirmation.length > 0) {
      await client.query(
        `UPDATE router_uptime_state AS s
            SET changed_at = u.changed_at
           FROM unnest($1::uuid[], $2::timestamptz[]) AS u(router_id, changed_at)
          WHERE s.router_id = u.router_id`,
        [
          writes.restartConfirmation.map((x) => x.routerId),
          writes.restartConfirmation.map((x) => x.changedAt),
        ],
      );
    }

    if (writes.openOutages.length > 0) {
      await client.query(
        `INSERT INTO router_outages (router_id, user_id, started_at)
           SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::timestamptz[])
           ON CONFLICT DO NOTHING`,
        [
          writes.openOutages.map((o) => o.routerId),
          writes.openOutages.map((o) => o.userId),
          writes.openOutages.map((o) => o.startedAt),
        ],
      );
    }

    if (writes.closeOutages.length > 0) {
      await client.query(
        `UPDATE router_outages AS o
            SET ended_at = u.ended_at, end_reason = u.reason
           FROM unnest($1::uuid[], $2::timestamptz[], $3::text[]) AS u(router_id, ended_at, reason)
          WHERE o.router_id = u.router_id AND o.ended_at IS NULL`,
        [
          writes.closeOutages.map((c) => c.routerId),
          writes.closeOutages.map((c) => c.endedAt),
          writes.closeOutages.map((c) => c.reason),
        ],
      );
    }

    if (writes.untrack.length > 0) {
      await client.query(
        `UPDATE router_uptime_state AS s
            SET untracked_at = u.at
           FROM unnest($1::uuid[], $2::timestamptz[]) AS u(router_id, at)
          WHERE s.router_id = u.router_id AND s.untracked_at IS NULL`,
        [writes.untrack.map((x) => x.routerId), writes.untrack.map((x) => x.at)],
      );
    }

    if (writes.gap) {
      await client.query(
        `INSERT INTO monitor_gaps (started_at, ended_at) VALUES ($1, $2)`,
        [writes.gap.startedAt, writes.gap.endedAt],
      );
    }

    await client.query(
      `INSERT INTO analytics_state (key, value, updated_at)
            VALUES ('monitor_heartbeat', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [input.now.toISOString()],
    );

    await client.query('COMMIT');
    client.release();
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release(true);
    }
    logger.error('routerUptimeRecorder: tick failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlight = false;
  }
}

/** Test-only hook to clear the in-flight guard between isolated tests. */
export function _resetRecorderState(): void {
  inFlight = false;
}
