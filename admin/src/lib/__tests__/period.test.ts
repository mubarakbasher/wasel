import { describe, it, expect } from 'vitest';
import { PRESETS, parsePeriod, periodToParams, periodKey } from '../period';

describe('period', () => {
  it('PRESETS: money offers This month, the other tabs 30 days', () => {
    expect(PRESETS.money).toEqual([
      { key: 'month', label: 'This month' },
      { key: '3m', label: '3 months' },
      { key: '12m', label: '12 months' },
    ]);
    const usage = [
      { key: '30d', label: '30 days' },
      { key: '3m', label: '3 months' },
      { key: '12m', label: '12 months' },
    ];
    expect(PRESETS.operators).toEqual(usage);
    expect(PRESETS.network).toEqual(usage);
  });

  it('parsePeriod: a preset the tab offers is kept', () => {
    expect(parsePeriod(new URLSearchParams('period=3m'), 'money')).toEqual({ period: '3m' });
    expect(parsePeriod(new URLSearchParams('period=30d'), 'operators')).toEqual({ period: '30d' });
    expect(parsePeriod(new URLSearchParams('period=12m'), 'network')).toEqual({ period: '12m' });
  });

  it('parsePeriod: a missing, unknown or unsupported preset becomes the first one of the tab', () => {
    expect(parsePeriod(new URLSearchParams('period=30d'), 'money')).toEqual({ period: 'month' });
    expect(parsePeriod(new URLSearchParams('period=month'), 'operators')).toEqual({ period: '30d' });
    expect(parsePeriod(new URLSearchParams(''), 'money')).toEqual({ period: 'month' });
    expect(parsePeriod(new URLSearchParams(''), 'network')).toEqual({ period: '30d' });
    expect(parsePeriod(new URLSearchParams('period=bogus'), 'network')).toEqual({ period: '30d' });
  });

  it('parsePeriod: from + to make a custom range', () => {
    expect(
      parsePeriod(new URLSearchParams('from=2026-11-01&to=2026-11-10'), 'network'),
    ).toEqual({ from: '2026-11-01', to: '2026-11-10' });
    // A custom range wins over a preset in the same query string.
    expect(
      parsePeriod(new URLSearchParams('period=3m&from=2026-11-01&to=2026-11-10'), 'money'),
    ).toEqual({ from: '2026-11-01', to: '2026-11-10' });
    // A single day is a valid range.
    expect(
      parsePeriod(new URLSearchParams('from=2026-11-10&to=2026-11-10'), 'money'),
    ).toEqual({ from: '2026-11-10', to: '2026-11-10' });
  });

  it('parsePeriod: a half, malformed or reversed range is ignored', () => {
    expect(parsePeriod(new URLSearchParams('from=2026-11-01'), 'money')).toEqual({ period: 'month' });
    expect(parsePeriod(new URLSearchParams('from=2026-11-01&to=soon'), 'money')).toEqual({ period: 'month' });
    expect(parsePeriod(new URLSearchParams('from=2026-02-31&to=2026-03-05'), 'money')).toEqual({ period: 'month' });
    expect(parsePeriod(new URLSearchParams('from=1-1-2026&to=2026-03-05'), 'money')).toEqual({ period: 'month' });
    expect(parsePeriod(new URLSearchParams('from=2026-11-10&to=2026-11-01'), 'money')).toEqual({ period: 'month' });
    // The preset beside a bad range is still honoured.
    expect(
      parsePeriod(new URLSearchParams('period=12m&from=2026-11-10&to=2026-11-01'), 'money'),
    ).toEqual({ period: '12m' });
  });

  it('periodToParams: exactly the query the API takes', () => {
    expect(periodToParams({ period: '3m' })).toEqual({ period: '3m' });
    expect(periodToParams({ from: '2026-11-01', to: '2026-11-10' })).toEqual({
      from: '2026-11-01',
      to: '2026-11-10',
    });
  });

  it('periodKey: one stable string per period', () => {
    expect(periodKey({ period: '12m' })).toBe('12m');
    expect(periodKey({ from: '2026-11-01', to: '2026-11-10' })).toBe('2026-11-01..2026-11-10');
    expect(periodKey({ from: '2026-11-01', to: '2026-11-10' })).not.toBe(
      periodKey({ from: '2026-11-01', to: '2026-11-11' }),
    );
  });
});
