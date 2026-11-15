import { describe, it, expect } from 'vitest';
import { foldUptimeDay } from '../analyticsUptime';
import type { UptimeDayInput } from '../analyticsUptime';

// Day: 2026-11-14 Khartoum = UTC 2026-11-14T21:00Z to 2026-11-15T21:00Z
// But for simplicity we use a plain UTC day for testing (the pure function
// does not care how dayStart/dayEnd were computed).
const DAY_START = new Date('2026-11-14T22:00:00Z'); // dayStart
const DAY_END = new Date('2026-11-15T22:00:00Z');   // dayEnd

const NOW = new Date('2026-11-15T22:00:00Z'); // = dayEnd

function base(overrides: Partial<UptimeDayInput> = {}): UptimeDayInput {
  return {
    dayStart: DAY_START,
    dayEnd: DAY_END,
    now: NOW,
    heartbeat: NOW, // monitor is current
    states: [],
    outages: [],
    gaps: [],
    ...overrides,
  };
}

const STATE_A = {
  routerId: 'r1',
  userId: 'u1',
  trackedSince: DAY_START,
  untrackedAt: null,
};

describe('foldUptimeDay', () => {
  it('a router up all day has 86400 observed and 0 down', () => {
    const rows = foldUptimeDay(base({ states: [STATE_A] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].observedSeconds).toBe(86400);
    expect(rows[0].downSeconds).toBe(0);
    expect(rows[0].drops).toBe(0);
    expect(rows[0].longestOutageSeconds).toBe(0);
  });

  it('an outage inside the day counts its seconds and one drop', () => {
    // 10:00Z–10:30Z → 1800 s
    const outageStart = new Date('2026-11-15T10:00:00Z');
    const outageEnd = new Date('2026-11-15T10:30:00Z');
    const rows = foldUptimeDay(
      base({
        states: [STATE_A],
        outages: [{ routerId: 'r1', startedAt: outageStart, endedAt: outageEnd }],
      }),
    );
    expect(rows[0].downSeconds).toBe(1800);
    expect(rows[0].drops).toBe(1);
    expect(rows[0].longestOutageSeconds).toBe(1800);
    expect(rows[0].observedSeconds).toBe(86400);
  });

  it('an outage that started the day before counts no drop but counts its seconds', () => {
    const outageStart = new Date('2026-11-14T21:00:00Z'); // before dayStart
    const outageEnd = new Date('2026-11-15T01:00:00Z');   // 3 h into day
    const rows = foldUptimeDay(
      base({
        states: [STATE_A],
        outages: [{ routerId: 'r1', startedAt: outageStart, endedAt: outageEnd }],
      }),
    );
    // drop = 0 (startedAt is before dayStart)
    expect(rows[0].drops).toBe(0);
    // down seconds = overlap of outage with observation window
    // window = [dayStart, DAY_END) = [22:00, +24h)
    // outage overlap = [22:00, 01:00+1d) → but actually outage ends at 01:00 same day
    // dayStart = 2026-11-14T22:00Z, outageEnd = 2026-11-15T01:00Z
    // overlap = outageEnd - dayStart = 3h = 10800 s
    expect(rows[0].downSeconds).toBe(10800);
    // longest = full outage from 21:00 to 01:00 = 4h = 14400 s
    expect(rows[0].longestOutageSeconds).toBe(14400);
  });

  it('a gap is removed from observed and from down seconds', () => {
    // Outage 10:00–11:00, gap 10:15–10:45 (overlaps outage)
    const outageStart = new Date('2026-11-15T10:00:00Z');
    const outageEnd = new Date('2026-11-15T11:00:00Z');
    const gapStart = new Date('2026-11-15T10:15:00Z');
    const gapEnd = new Date('2026-11-15T10:45:00Z');
    const rows = foldUptimeDay(
      base({
        states: [STATE_A],
        outages: [{ routerId: 'r1', startedAt: outageStart, endedAt: outageEnd }],
        gaps: [{ startedAt: gapStart, endedAt: gapEnd }],
      }),
    );
    // gap overlap with observation window = 30 min = 1800 s
    expect(rows[0].observedSeconds).toBe(86400 - 1800);
    // down = 60 min outage - 30 min gap = 30 min = 1800 s
    expect(rows[0].downSeconds).toBe(1800);
    // longest = 60 min - 30 min = 1800 s
    expect(rows[0].longestOutageSeconds).toBe(1800);
  });

  it('observation stops at the heartbeat while the monitor is blind', () => {
    // heartbeat is 10 min before NOW → monitor has been blind for 10 min > 180 s
    const heartbeat = new Date(NOW.getTime() - 10 * 60 * 1000); // 10 min ago
    const rows = foldUptimeDay(base({ states: [STATE_A], heartbeat }));
    // observedSeconds = heartbeat - dayStart = 24h - 10min = 86400 - 600 = 85800
    expect(rows[0].observedSeconds).toBe(85800);
  });

  it('tracking that began mid-day starts the window there', () => {
    const midDay = new Date('2026-11-15T10:00:00Z');
    const state = { ...STATE_A, trackedSince: midDay };
    const rows = foldUptimeDay(base({ states: [state] }));
    // window = [10:00, 22:00) = 12h = 43200 s
    expect(rows[0].observedSeconds).toBe(43200);
  });

  it('an untracked router stops being observed at untrackedAt', () => {
    const untrackedAt = new Date('2026-11-15T12:00:00Z');
    const state = { ...STATE_A, untrackedAt };
    const rows = foldUptimeDay(base({ states: [state] }));
    // window = [22:00 prev day, 12:00] = 14h = 50400 s
    expect(rows[0].observedSeconds).toBe(50400);
  });

  it('a router with no observed seconds yields no row', () => {
    // trackedSince after the observation end
    const state = {
      ...STATE_A,
      trackedSince: new Date(NOW.getTime() + 1000), // in the future
    };
    const rows = foldUptimeDay(base({ states: [state] }));
    expect(rows).toHaveLength(0);
  });

  it('returns no rows when heartbeat is null', () => {
    const rows = foldUptimeDay(base({ states: [STATE_A], heartbeat: null }));
    expect(rows).toHaveLength(0);
  });
});
