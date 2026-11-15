import { AppError } from '../middleware/errorHandler';
import type { PeriodPreset, AnalyticsTab, ResolvedPeriod } from './analytics.types';

/** Return the wall-clock date string (YYYY-MM-DD) in the given timezone. */
export function khartoumToday(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

/** Add n days to a YYYY-MM-DD string. n may be negative. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** How many days between two inclusive day strings. */
function daySpan(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

/** Return the UTC start and end of a named timezone calendar day. */
export function dayBoundsUtc(day: string, tz: string): { start: Date; end: Date } {
  const start = _tzMidnightUtc(day, tz);
  const end = _tzMidnightUtc(addDays(day, 1), tz);
  return { start, end };
}

/** Return the UTC start and end of a named timezone hour within a calendar day. */
export function hourBoundsUtc(
  day: string,
  hour: number,
  tz: string,
): { start: Date; end: Date } {
  const dayStart = _tzMidnightUtc(day, tz);
  const start = new Date(dayStart.getTime() + hour * 3_600_000);
  const end = new Date(start.getTime() + 3_600_000);
  return { start, end };
}

/**
 * Find the UTC timestamp that corresponds to 00:00:00 of `day` in `tz`.
 * Derives the UTC offset by formatting noon UTC in the target timezone,
 * then computes midnight as noon UTC minus the offset.
 * Works correctly for fixed-offset and DST timezones.
 */
function _tzMidnightUtc(day: string, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);

  // Use noon UTC as the reference point to avoid ambiguity at midnight.
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

  // Format noon UTC in the target timezone with hourCycle h23 (0–23).
  const fmtHour = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const hourPart = fmtHour.formatToParts(noonUtc).find((p) => p.type === 'hour');
  const localNoonHour = parseInt(hourPart!.value, 10);

  // Also get the local date to detect day boundaries (offset spans midnight).
  const fmtDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateParts = fmtDate.formatToParts(noonUtc);
  const localDay =
    dateParts.find((p) => p.type === 'year')!.value +
    '-' +
    dateParts.find((p) => p.type === 'month')!.value +
    '-' +
    dateParts.find((p) => p.type === 'day')!.value;

  // Compute offset in hours: how much ahead of UTC is the local time?
  // We know local time = noon UTC + offset, so offset = localNoonHour - 12
  // adjusted for the date shift.
  let offsetHours = localNoonHour - 12;
  if (localDay > day) {
    // Local date advanced past midnight; e.g. UTC-14: noon UTC = 22:00 yesterday local
    offsetHours += 24;
  } else if (localDay < day) {
    offsetHours -= 24;
  }

  // midnight local on `day` = UTC midnight on `day` - offsetHours
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetHours * 3_600_000;
  return new Date(utcMidnight);
}

const MONEY_PRESETS: PeriodPreset[] = ['month', '3m', '12m'];
const OTHER_PRESETS: PeriodPreset[] = ['30d', '3m', '12m'];

function tabPresets(tab: AnalyticsTab): PeriodPreset[] {
  return tab === 'money' ? MONEY_PRESETS : OTHER_PRESETS;
}

function firstPreset(tab: AnalyticsTab): PeriodPreset {
  return tabPresets(tab)[0];
}

export function resolvePeriod(
  q: { period?: PeriodPreset; from?: string; to?: string },
  tab: AnalyticsTab,
  now: Date,
  tz: string,
): ResolvedPeriod {
  const today = khartoumToday(now, tz);

  // --- Custom range ---
  if (q.from !== undefined || q.to !== undefined) {
    if (!q.from || !q.to) {
      throw new AppError(400, 'Both from and to are required for a custom range', 'VALIDATION_ERROR');
    }
    let to = q.to > today ? today : q.to;
    const from = q.from;
    if (from > to) {
      throw new AppError(400, 'from must not be after to', 'VALIDATION_ERROR');
    }
    const span = daySpan(from, to);
    if (span > 400) {
      throw new AppError(400, 'Date range must not exceed 400 days', 'VALIDATION_ERROR');
    }
    const previousTo = addDays(from, -1);
    const previousFrom = addDays(previousTo, -(span - 1));
    return { period: 'custom', from, to, previousFrom, previousTo, days: span };
  }

  // --- Preset ---
  const presets = tabPresets(tab);
  let preset: PeriodPreset = q.period && presets.includes(q.period) ? q.period : firstPreset(tab);

  if (preset === 'month') {
    // First of this month → today
    const [year, month] = today.split('-').map(Number);
    const from = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    const to = today;
    const dayOfMonth = Number(today.split('-')[2]);
    // Previous: first of last month → same day-of-month clamped to that month's end
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonthEnd = daysInMonth(prevYear, prevMonth);
    const prevDay = Math.min(dayOfMonth, prevMonthEnd);
    const previousFrom = `${String(prevYear).padStart(4, '0')}-${String(prevMonth).padStart(2, '0')}-01`;
    const previousTo = `${String(prevYear).padStart(4, '0')}-${String(prevMonth).padStart(2, '0')}-${String(prevDay).padStart(2, '0')}`;
    const days = daySpan(from, to);
    return { period: 'month', from, to, previousFrom, previousTo, days };
  }

  if (preset === '30d') {
    const from = addDays(today, -29);
    const to = today;
    const previousTo = addDays(from, -1);
    const previousFrom = addDays(previousTo, -29);
    return { period: '30d', from, to, previousFrom, previousTo, days: 30 };
  }

  if (preset === '3m') {
    // First day of the month 2 months back → today
    const [year, month] = today.split('-').map(Number);
    const startMonth = month <= 2 ? month + 10 : month - 2;
    const startYear = month <= 2 ? year - 1 : year;
    const from = `${String(startYear).padStart(4, '0')}-${String(startMonth).padStart(2, '0')}-01`;
    const to = today;
    const days = daySpan(from, to);
    const previousTo = addDays(from, -1);
    const previousFrom = addDays(previousTo, -(days - 1));
    return { period: '3m', from, to, previousFrom, previousTo, days };
  }

  if (preset === '12m') {
    // First day of the month 11 months back → today
    const [year, month] = today.split('-').map(Number);
    const startMonth = month === 1 ? 2 : month <= 1 ? 2 : (month - 1 === 0 ? 12 : month - 1);
    // 11 months back: if month=11, startMonth = 12 of prev year
    const rawStart = month - 11;
    const startM = rawStart <= 0 ? rawStart + 12 : rawStart;
    const startY = rawStart <= 0 ? year - 1 : year;
    const from = `${String(startY).padStart(4, '0')}-${String(startM).padStart(2, '0')}-01`;
    const to = today;
    const days = daySpan(from, to);
    const previousTo = addDays(from, -1);
    const previousFrom = addDays(previousTo, -(days - 1));
    return { period: '12m', from, to, previousFrom, previousTo, days };
  }

  // Should never reach here
  throw new AppError(400, 'Unknown preset', 'VALIDATION_ERROR');
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
