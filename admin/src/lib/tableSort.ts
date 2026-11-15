/**
 * Sorting and searching for tables whose rows are already in the browser.
 * `DataTable` shows the sort state and reports clicks; the page that owns the
 * rows orders them with `sortRows` before it cuts the page to display.
 */

export type SortState = { key: string; dir: 'asc' | 'desc' };

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function isMissing(v: string | number | null): v is null {
  return v === null || (typeof v === 'number' && Number.isNaN(v));
}

/**
 * A sorted copy of `rows`. Rows whose value is null (or NaN) go last in both
 * directions, and rows with equal values keep the order they came in.
 */
export function sortRows<T>(
  rows: T[],
  value: (r: T) => string | number | null,
  dir: 'asc' | 'desc',
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      const aMissing = isMissing(a.v);
      const bMissing = isMissing(b.v);
      if (aMissing || bMissing) {
        if (aMissing && bMissing) return a.index - b.index;
        return aMissing ? 1 : -1;
      }
      const av = a.v as string | number;
      const bv = b.v as string | number;
      let order: number;
      if (typeof av === 'number' && typeof bv === 'number') {
        order = av < bv ? -1 : av > bv ? 1 : 0;
      } else {
        order = collator.compare(String(av), String(bv));
      }
      return order !== 0 ? sign * order : a.index - b.index;
    })
    .map((entry) => entry.row);
}

/**
 * True when `q` appears in any of the fields, ignoring case and the spaces
 * around it. An empty query matches every row.
 */
export function matchesSearch(haystack: (string | null)[], q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return haystack.some((field) => field !== null && field.toLowerCase().includes(needle));
}
