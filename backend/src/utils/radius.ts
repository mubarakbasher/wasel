/** True if an Acct-Session-Id from radacct contains only safe chars (defense-in-depth before forwarding to radclient). */
export function isSafeAcctSessionId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id);
}

/**
 * Parse a FreeRADIUS Expiration attribute value back to a Date (the inverse of
 * formatRadiusExpiration). The stored format is "Month DD YYYY HH:MM:SS" where
 * all parts are UTC (e.g. "August 15 2026 18:05:00"). We append " UTC" before
 * passing to the Date constructor so the parse is unambiguous regardless of
 * the server's local timezone.
 *
 * Returns null if the value is null/undefined or cannot be parsed (i.e. the
 * resulting Date is NaN).
 */
export function parseRadiusExpiration(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value} UTC`);
  return isNaN(d.getTime()) ? null : d;
}

const RADIUS_EXPIRATION_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Format an ISO date string (or Date) as the FreeRADIUS Expiration attribute value.
 * FreeRADIUS expects: "January 01 2026 00:00:00" (UTC, zero-padded day/time).
 *
 * Used by both the validity-expiration job and the repair script so that any
 * Expiration written by the job can be reproduced exactly for comparison.
 */
export function formatRadiusExpiration(isoDate: string | Date): string {
  const d = typeof isoDate === 'string' ? new Date(isoDate) : isoDate;
  return (
    `${RADIUS_EXPIRATION_MONTHS[d.getUTCMonth()]} ` +
    `${String(d.getUTCDate()).padStart(2, '0')} ` +
    `${d.getUTCFullYear()} ` +
    `${String(d.getUTCHours()).padStart(2, '0')}:` +
    `${String(d.getUTCMinutes()).padStart(2, '0')}:` +
    `${String(d.getUTCSeconds()).padStart(2, '0')}`
  );
}
