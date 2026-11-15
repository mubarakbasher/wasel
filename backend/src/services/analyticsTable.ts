/**
 * Pure in-memory table query helper: search, filter, sort with nulls-last in both directions.
 */

export function applyTableQuery<T>(
  rows: T[],
  q: { q?: string; filter?: string; sort?: string; dir?: 'asc' | 'desc' },
  spec: {
    search: (r: T) => string[];
    filters: Record<string, (r: T) => boolean>;
    sorts: Record<string, (r: T) => string | number | null>;
  },
): T[] {
  let result = rows;

  // Search
  if (q.q) {
    const needle = q.q.toLowerCase();
    result = result.filter((r) =>
      spec.search(r).some((s) => s.toLowerCase().includes(needle)),
    );
  }

  // Filter
  if (q.filter && spec.filters[q.filter]) {
    result = result.filter(spec.filters[q.filter]);
  }

  // Sort
  if (q.sort && spec.sorts[q.sort]) {
    const key = spec.sorts[q.sort];
    const dir = q.dir === 'desc' ? -1 : 1;
    result = [...result].sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      // nulls last in both directions
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
  }

  return result;
}
