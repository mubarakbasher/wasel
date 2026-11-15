/**
 * The Analytics period: one of a tab's presets, or a custom range of days.
 *
 * It lives in the page's query string (`?period=3m` or `?from=…&to=…`) and is
 * sent to the API unchanged. The server turns it into real dates; the browser
 * only decides which preset a tab offers.
 */
import type { AnalyticsTab, PeriodPreset } from './analytics';

export type { AnalyticsTab, PeriodPreset };

export type PeriodQuery = { period: PeriodPreset } | { from: string; to: string };

const USAGE_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: '30d', label: '30 days' },
  { key: '3m', label: '3 months' },
  { key: '12m', label: '12 months' },
];

/** The presets each tab offers, in display order. The first one is its default. */
export const PRESETS: Record<AnalyticsTab, { key: PeriodPreset; label: string }[]> = {
  money: [
    { key: 'month', label: 'This month' },
    { key: '3m', label: '3 months' },
    { key: '12m', label: '12 months' },
  ],
  operators: USAGE_PRESETS,
  network: USAGE_PRESETS,
};

/** The longest custom range the API accepts, counting both end days. */
export const MAX_RANGE_DAYS = 400;

/** True for a real calendar day written as YYYY-MM-DD. */
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  // "2026-02-31" parses, but as 3 March: it must read back as itself.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Days from `from` to `to`, counting both. Both must pass `isDay`. */
export function rangeDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Read the period from a query string for one tab.
 *
 * A complete, well-formed `from` + `to` in order is a custom range. Otherwise
 * `period` is used when this tab offers it. Anything else (missing, unknown,
 * or a preset of another tab) becomes the tab's first preset, as on the server.
 */
export function parsePeriod(params: URLSearchParams, tab: AnalyticsTab): PeriodQuery {
  const from = params.get('from');
  const to = params.get('to');
  if (from && to && isDay(from) && isDay(to) && from <= to) {
    return { from, to };
  }
  const requested = params.get('period');
  const preset = PRESETS[tab].find((p) => p.key === requested);
  return { period: (preset ?? PRESETS[tab][0]).key };
}

/** The query parameters for the API (and for the page URL). */
export function periodToParams(p: PeriodQuery): Record<string, string> {
  return 'period' in p ? { period: p.period } : { from: p.from, to: p.to };
}

/** One stable string per period, for query keys. */
export function periodKey(p: PeriodQuery): string {
  return 'period' in p ? p.period : `${p.from}..${p.to}`;
}
