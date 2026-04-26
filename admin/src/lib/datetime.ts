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
