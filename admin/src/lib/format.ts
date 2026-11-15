/**
 * Number, amount and duration formatting for the admin panel. Everything is
 * en-GB so every page groups digits the same way.
 *
 * A value that is not a finite number prints as a dash, never "NaN" or
 * "Infinity": a broken figure must not look like a real one.
 */

const DASH = '—';

const numberFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const wholeFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
// Compact notation is the one place en-GB is not used: browsers print its
// suffixes in lower case ("1.5m", "500k") while Node prints "1.5M", so the
// same axis would read differently in tests and on screen. en-US prints
// "1.5M" / "500K" everywhere and groups digits identically.
const compactFmt = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** "1,240,000". Up to two decimals, shown only when the number has them. */
export function formatNumber(n: number): string {
  return Number.isFinite(n) ? numberFmt.format(n) : DASH;
}

/** "SDG 1,240,000". */
export function formatSdg(n: number): string {
  return Number.isFinite(n) ? `SDG ${numberFmt.format(n)}` : DASH;
}

/** "1.2M", "15.3K", "950": for chart axes and tight spaces. */
export function formatCompact(n: number): string {
  return Number.isFinite(n) ? compactFmt.format(n) : DASH;
}

/** "93%". `n` is already a percentage (93, not 0.93); null prints a dash. */
export function formatPercent(n: number | null, digits = 0): string {
  if (n === null || !Number.isFinite(n)) return DASH;
  return `${n.toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

/** Signed whole-percent change: "+18%", "-62%", "0%"; null prints a dash. */
export function formatChange(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return DASH;
  const rounded = Math.round(n);
  if (rounded > 0) return `+${wholeFmt.format(rounded)}%`;
  if (rounded < 0) return `-${wholeFmt.format(-rounded)}%`;
  return '0%';
}

/**
 * Which way a change goes, as `formatChange` prints it: 1 for a rise, -1 for a
 * fall, 0 when it rounds to "0%", null when there is no figure. Colours and
 * arrows read this, never the printed text.
 */
export function changeSign(n: number | null): 1 | -1 | 0 | null {
  if (n === null || !Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded > 0) return 1;
  if (rounded < 0) return -1;
  return 0;
}

/** A length of time in its largest sensible unit: "45 s", "6 min", "9 h", "2 d". */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return DASH;
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const hours = Math.round(s / 3600);
  // Hours stay readable up to two days ("36 h" says more than "2 d").
  if (hours < 48) return `${hours} h`;
  return `${wholeFmt.format(Math.round(s / 86_400))} d`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** "38 GB", "1.5 KB". Binary units (1 KB = 1,024 B). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return DASH;
  let value = Math.max(0, n);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal under 10 of a unit, none above; bytes are always whole.
  const digits = unit > 0 && value < 10 ? 1 : 0;
  let shown = Number(value.toFixed(digits));
  if (shown >= 1024 && unit < BYTE_UNITS.length - 1) {
    // 1,023.9 MB rounds to 1,024 MB: say 1 GB instead.
    shown = 1;
    unit += 1;
  }
  return `${numberFmt.format(shown)} ${BYTE_UNITS[unit]}`;
}

/** A plan limit: "Unlimited" for the -1 sentinel, the number otherwise. */
export function formatQuota(n: number): string {
  if (n === -1) return 'Unlimited';
  return formatNumber(n);
}

/** "2m ago" style label for a millisecond timestamp; empty when there is none. */
export function formatRelative(ts: number, now: number): string {
  if (!ts) return '';
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/**
 * The message to show for a failed request: the API envelope's
 * `error.message` when the server sent one, else the Error's own message.
 * Undefined when there is nothing worth showing, so callers can fall back to
 * their own wording.
 */
export function apiErrorMessage(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as {
    response?: { data?: { error?: { message?: unknown } } | null } | null;
    message?: unknown;
  };
  const apiMessage = e.response?.data?.error?.message;
  if (typeof apiMessage === 'string' && apiMessage) return apiMessage;
  if (typeof e.message === 'string' && e.message) return e.message;
  return undefined;
}
