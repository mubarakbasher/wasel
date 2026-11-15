/**
 * Centralized date/time formatting for the admin panel.
 *
 * Backend timestamps are stored and returned as UTC (TIMESTAMPTZ in postgres,
 * serialized as ISO 8601 with Z suffix). The browser's `toLocaleString` uses
 * the browser's local timezone, which is often not the operator's actual
 * business timezone — especially for operators running on a server or
 * accessing the panel from a different region than where their customers
 * are. Hard-coding a single business timezone here keeps every admin user
 * looking at the same wall-clock times regardless of where they happen to
 * be physically.
 *
 * Override via Vite env var VITE_ADMIN_TIMEZONE if you operate in a
 * different region (e.g. "Asia/Riyadh", "Asia/Dubai", "UTC").
 */

const DEFAULT_TZ = 'Africa/Khartoum'; // Sudan, UTC+2, no DST
export const ADMIN_TIMEZONE: string =
  (import.meta.env.VITE_ADMIN_TIMEZONE as string | undefined) ?? DEFAULT_TZ;

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: ADMIN_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: ADMIN_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Format a UTC ISO/Date as "DD/MM/YYYY, HH:MM" in ADMIN_TIMEZONE. */
export function formatDateTime(input: string | Date | number | null | undefined): string {
  if (input === null || input === undefined || input === '') return '—';
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return '—';
  return dateTimeFmt.format(d);
}

/** Format a UTC ISO/Date as "DD/MM/YYYY" in ADMIN_TIMEZONE. */
export function formatDate(input: string | Date | number | null | undefined): string {
  if (input === null || input === undefined || input === '') return '—';
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return '—';
  return dateFmt.format(d);
}

// ---------------------------------------------------------------------------
// Plain calendar labels
// ---------------------------------------------------------------------------
//
// The analytics API returns days and months as text ("2026-11-15", "2026-11")
// that already mean a Khartoum calendar day or month. They are not instants,
// so they are parsed and printed as UTC: no timezone can move them to the day
// before or after.

const dayLabelFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});

const monthLabelFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  month: 'short',
  year: 'numeric',
});

/** "2026-11-15" → "15 Nov". Anything that is not a real day is returned unchanged. */
export function formatDay(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) return day;
  return dayLabelFmt.format(d);
}

/** "2026-11" → "Nov 2026". Anything that is not a real month is returned unchanged. */
export function formatMonth(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  const d = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return month;
  return monthLabelFmt.format(d);
}
