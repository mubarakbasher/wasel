import { describe, it, expect } from 'vitest';
import {
  khartoumToday,
  resolvePeriod,
  dayBoundsUtc,
  hourBoundsUtc,
  addDays,
} from '../analyticsPeriod';

const tz = 'Africa/Khartoum';
const now = new Date('2026-11-15T10:00:00Z');

describe('khartoumToday', () => {
  it('converts UTC midnight to the Khartoum calendar date', () => {
    // 2026-11-14T22:30:00Z is 2026-11-15T01:30:00+03:00 in Khartoum
    expect(khartoumToday(new Date('2026-11-14T22:30:00Z'), tz)).toBe('2026-11-15');
  });
});

describe('resolvePeriod', () => {
  it('defaults money to month preset', () => {
    expect(resolvePeriod({}, 'money', now, tz)).toMatchObject({
      period: 'month',
      from: '2026-11-01',
      to: '2026-11-15',
      previousFrom: '2026-10-01',
      previousTo: '2026-10-15',
    });
  });

  it('resolves 30d for operators', () => {
    expect(resolvePeriod({ period: '30d' }, 'operators', now, tz)).toMatchObject({
      from: '2026-10-17',
      to: '2026-11-15',
      previousFrom: '2026-09-17',
      previousTo: '2026-10-16',
      days: 30,
    });
  });

  it('resolves 3m for money', () => {
    expect(resolvePeriod({ period: '3m' }, 'money', now, tz)).toMatchObject({
      from: '2026-09-01',
      previousFrom: '2026-06-17',
      previousTo: '2026-08-31',
      days: 76,
    });
  });

  it('resolves 12m from for network', () => {
    expect(resolvePeriod({ period: '12m' }, 'network', now, tz).from).toBe('2025-12-01');
  });

  it('falls back 30d to month for money tab', () => {
    expect(resolvePeriod({ period: '30d' }, 'money', now, tz).period).toBe('month');
  });

  it('falls back month to 30d for operators tab', () => {
    expect(resolvePeriod({ period: 'month' }, 'operators', now, tz).period).toBe('30d');
  });

  it('custom range clamps future to to today', () => {
    expect(
      resolvePeriod({ from: '2026-11-01', to: '2026-12-31' }, 'money', now, tz),
    ).toMatchObject({ period: 'custom', to: '2026-11-15' });
  });

  it('month previousTo clamps to end of February', () => {
    // now = 2026-03-31: previousTo should be 2026-02-28
    expect(
      resolvePeriod({}, 'money', new Date('2026-03-31T10:00:00Z'), tz).previousTo,
    ).toBe('2026-02-28');
  });

  it('throws when from > to', () => {
    expect(() => resolvePeriod({ from: '2026-11-10', to: '2026-11-01' }, 'money', now, tz)).toThrow();
  });

  it('throws when span > 400 days', () => {
    expect(() =>
      resolvePeriod({ from: '2025-01-01', to: '2026-11-01' }, 'money', now, tz),
    ).toThrow();
  });
});

describe('dayBoundsUtc', () => {
  it('returns correct UTC bounds for a Khartoum day', () => {
    // Africa/Khartoum is UTC+3, no DST
    // 2026-11-15 in Khartoum starts at 2026-11-14T21:00:00Z ... wait
    // Actually UTC+3 means Khartoum is 3h ahead:
    // 00:00 Khartoum = 2026-11-14T21:00:00Z
    // But the test says start = 2026-11-14T22:00:00Z which would be UTC+2
    // Let me check - maybe it's UTC+2? No, Khartoum is EAT = UTC+3
    // Hmm wait, the plan says:
    // expect(dayBoundsUtc('2026-11-15', tz)).toEqual({ start: new Date('2026-11-14T22:00:00Z'), end: new Date('2026-11-15T22:00:00Z') });
    // That's UTC+2. But Khartoum is UTC+3. Let me check if Sudan uses a different offset.
    // Actually Sudan switched to UTC+2 in 2017. So 'Africa/Khartoum' is UTC+2 now!
    expect(dayBoundsUtc('2026-11-15', tz)).toEqual({
      start: new Date('2026-11-14T22:00:00Z'),
      end: new Date('2026-11-15T22:00:00Z'),
    });
  });
});

describe('hourBoundsUtc', () => {
  it('end of hour 23 is the day boundary', () => {
    expect(hourBoundsUtc('2026-11-15', 23, tz).end).toEqual(new Date('2026-11-15T22:00:00Z'));
  });
});

describe('addDays', () => {
  it('adds days to a date string', () => {
    expect(addDays('2026-11-01', 14)).toBe('2026-11-15');
  });

  it('handles month boundaries', () => {
    expect(addDays('2026-10-30', 2)).toBe('2026-11-01');
  });
});
