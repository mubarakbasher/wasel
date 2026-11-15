/**
 * Pure fold function: computes per-router uptime metrics for a single Khartoum
 * calendar day from recorded state, outages and monitor gaps.
 *
 * No I/O — all data is passed in; this is a pure function suitable for unit
 * testing without a database connection.
 */

export interface UptimeDayInput {
  /** UTC start of the Khartoum calendar day (inclusive). */
  dayStart: Date;
  /** UTC end of the Khartoum calendar day (exclusive). */
  dayEnd: Date;
  /** Current wall-clock time (used to bound open outages). */
  now: Date;
  /** Last recorded monitor heartbeat, or null if never recorded. */
  heartbeat: Date | null;
  states: {
    routerId: string;
    userId: string;
    trackedSince: Date;
    untrackedAt: Date | null;
  }[];
  outages: { routerId: string; startedAt: Date; endedAt: Date | null }[];
  gaps: { startedAt: Date; endedAt: Date }[];
}

export interface UptimeDayRow {
  routerId: string;
  userId: string;
  /** Milliseconds the router was under observation, minus gap overlap. */
  observedSeconds: number;
  /** Milliseconds the router spent in a confirmed outage, minus gap overlap. */
  downSeconds: number;
  /** Number of outages whose startedAt falls inside the day. */
  drops: number;
  /** Full length of the longest outage overlapping the day, minus gap overlap. */
  longestOutageSeconds: number;
}

/** How long (ms) since the heartbeat before we consider the monitor blind. */
const BLIND_THRESHOLD_MS = 180_000;

/** Sum the ms overlap of a list of [startedAt, endedAt) intervals with [start, end). */
function totalOverlapMs(
  intervals: { startedAt: Date; endedAt: Date }[],
  start: number,
  end: number,
): number {
  let overlap = 0;
  for (const g of intervals) {
    const s = Math.max(start, g.startedAt.getTime());
    const e = Math.min(end, g.endedAt.getTime());
    if (e > s) overlap += e - s;
  }
  return overlap;
}

/**
 * Compute per-router uptime rows for one Khartoum calendar day.
 *
 * Returns one row per router that had at least one second of observation.
 * Routers with zero observed seconds are omitted.
 */
export function foldUptimeDay(input: UptimeDayInput): UptimeDayRow[] {
  const { dayStart, dayEnd, now, heartbeat, states, outages, gaps } = input;

  // If we have no heartbeat at all, there is no observation data.
  if (heartbeat === null) return [];

  // Observation ceiling: use heartbeat when the monitor has been blind for
  // more than 180 s, otherwise use now.
  const monitorBlind =
    now.getTime() - heartbeat.getTime() > BLIND_THRESHOLD_MS;
  const obsEnd: Date = monitorBlind ? heartbeat : now;

  const rows: UptimeDayRow[] = [];

  for (const state of states) {
    // Per-router observation window inside the day.
    const winStart = Math.max(dayStart.getTime(), state.trackedSince.getTime());
    let winEnd = Math.min(dayEnd.getTime(), obsEnd.getTime());
    if (state.untrackedAt) {
      winEnd = Math.min(winEnd, state.untrackedAt.getTime());
    }
    if (winEnd <= winStart) continue;

    // Subtract gap overlap from the observation window.
    const gapMs = totalOverlapMs(gaps, winStart, winEnd);
    const observedMs = winEnd - winStart - gapMs;
    if (observedMs <= 0) continue;

    // Collect outages for this router.
    const routerOutages = outages.filter((o) => o.routerId === state.routerId);

    let downMs = 0;
    let drops = 0;
    let longestMs = 0;

    for (const outage of routerOutages) {
      const outageEnd = outage.endedAt
        ? outage.endedAt.getTime()
        : obsEnd.getTime();

      // Skip outages that don't overlap the day at all.
      if (outage.startedAt.getTime() >= dayEnd.getTime()) continue;
      if (outageEnd <= dayStart.getTime()) continue;

      // Drop = outage whose startedAt falls inside this day.
      if (
        outage.startedAt.getTime() >= dayStart.getTime() &&
        outage.startedAt.getTime() < dayEnd.getTime()
      ) {
        drops++;
      }

      // Down seconds = overlap with the observation window, minus gap overlap.
      const downWinStart = Math.max(winStart, outage.startedAt.getTime());
      const downWinEnd = Math.min(winEnd, outageEnd);
      if (downWinEnd > downWinStart) {
        const outageGap = totalOverlapMs(gaps, downWinStart, downWinEnd);
        downMs += downWinEnd - downWinStart - outageGap;
      }

      // Longest: full length from startedAt to endedAt/obsEnd, minus gap overlap.
      const fullStart = outage.startedAt.getTime();
      const fullEnd = outageEnd;
      const fullGap = totalOverlapMs(gaps, fullStart, fullEnd);
      const netLen = fullEnd - fullStart - fullGap;
      if (netLen > longestMs) longestMs = netLen;
    }

    rows.push({
      routerId: state.routerId,
      userId: state.userId,
      observedSeconds: Math.round(observedMs / 1000),
      downSeconds: Math.round(downMs / 1000),
      drops,
      longestOutageSeconds: Math.round(longestMs / 1000),
    });
  }

  return rows;
}
