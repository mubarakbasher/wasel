import { describe, it, expect } from 'vitest';
import {
  formatSdg,
  formatCompact,
  formatNumber,
  formatPercent,
  formatChange,
  formatDuration,
  formatBytes,
  formatQuota,
  formatRelative,
  apiErrorMessage,
} from '../format';
import { formatDay, formatMonth } from '../datetime';

describe('format', () => {
  it('formatSdg: en-GB grouping behind the currency code', () => {
    expect(formatSdg(1240000)).toBe('SDG 1,240,000');
    expect(formatSdg(0)).toBe('SDG 0');
    expect(formatSdg(1250.5)).toBe('SDG 1,250.5');
  });

  it('formatCompact and formatNumber', () => {
    expect(formatCompact(1240000)).toBe('1.2M');
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(15300)).toBe('15.3K');
    expect(formatNumber(1240000)).toBe('1,240,000');
    expect(formatNumber(0)).toBe('0');
  });

  it('formatPercent: a dash for null, fixed digits otherwise', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(93)).toBe('93%');
    expect(formatPercent(93.26, 1)).toBe('93.3%');
    expect(formatPercent(0)).toBe('0%');
  });

  it('formatChange: signed whole percent, a dash for null', () => {
    expect(formatChange(18.4)).toBe('+18%');
    expect(formatChange(-62)).toBe('-62%');
    expect(formatChange(null)).toBe('—');
    expect(formatChange(0)).toBe('0%');
    // Rounds to zero from below: never "-0%".
    expect(formatChange(-0.3)).toBe('0%');
    expect(formatChange(1234)).toBe('+1,234%');
  });

  it('formatDuration: the largest sensible unit', () => {
    expect(formatDuration(360)).toBe('6 min');
    expect(formatDuration(32400)).toBe('9 h');
    expect(formatDuration(172800)).toBe('2 d');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(0)).toBe('0 s');
    // 59.5 minutes rounds up to the next unit rather than "60 min".
    expect(formatDuration(3570)).toBe('1 h');
    expect(formatDuration(36 * 3600)).toBe('36 h');
  });

  it('formatBytes: binary units', () => {
    expect(formatBytes(38 * 1024 ** 3)).toBe('38 GB');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 ** 4)).toBe('2 TB');
    // Never "1,024 MB": the value is promoted to the next unit.
    expect(formatBytes(1024 ** 3 - 1)).toBe('1 GB');
  });

  it('formatQuota: -1 is unlimited', () => {
    expect(formatQuota(-1)).toBe('Unlimited');
    expect(formatQuota(5000)).toBe('5,000');
    expect(formatQuota(0)).toBe('0');
  });

  it('never prints NaN or Infinity', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(formatSdg(bad)).toBe('—');
      expect(formatCompact(bad)).toBe('—');
      expect(formatNumber(bad)).toBe('—');
      expect(formatPercent(bad)).toBe('—');
      expect(formatChange(bad)).toBe('—');
      expect(formatDuration(bad)).toBe('—');
      expect(formatBytes(bad)).toBe('—');
      expect(formatQuota(bad)).toBe('—');
    }
  });

  it('formatRelative: "2m ago" style, empty without a timestamp', () => {
    const now = 1_800_000_000_000;
    expect(formatRelative(0, now)).toBe('');
    expect(formatRelative(now - 4_000, now)).toBe('just now');
    expect(formatRelative(now - 30_000, now)).toBe('30s ago');
    expect(formatRelative(now - 120_000, now)).toBe('2m ago');
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatRelative(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  it('apiErrorMessage: the API envelope message, then Error.message, else undefined', () => {
    expect(
      apiErrorMessage({
        response: { data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'Range too long' } } },
        message: 'Request failed with status code 400',
      }),
    ).toBe('Range too long');
    expect(apiErrorMessage(new Error('Network Error'))).toBe('Network Error');
    expect(apiErrorMessage({ response: { data: 'gateway timeout' } })).toBeUndefined();
    expect(apiErrorMessage(null)).toBeUndefined();
    expect(apiErrorMessage('boom')).toBeUndefined();
  });
});

describe('datetime: plain day and month labels', () => {
  it('formatDay: "15 Nov", never shifted by the timezone', () => {
    expect(formatDay('2026-11-15')).toBe('15 Nov');
    expect(formatDay('2026-01-01')).toBe('1 Jan');
    expect(formatDay('2026-12-31')).toBe('31 Dec');
  });

  it('formatMonth: "Nov 2026"', () => {
    expect(formatMonth('2026-11')).toBe('Nov 2026');
    expect(formatMonth('2025-12')).toBe('Dec 2025');
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(formatDay('soon')).toBe('soon');
    expect(formatDay('2026-02-31')).toBe('2026-02-31');
    expect(formatMonth('2026-13')).toBe('2026-13');
  });
});
