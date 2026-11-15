import { describe, it, expect } from 'vitest';
import { applyTableQuery } from '../analyticsTable';

interface Row { name: string; value: number | null; tag: string }

const rows: Row[] = [
  { name: 'Alice', value: 10, tag: 'quiet' },
  { name: 'Bob', value: null, tag: 'active' },
  { name: 'Charlie', value: 5, tag: 'quiet' },
  { name: 'alice2', value: 20, tag: 'active' },
];

const spec = {
  search: (r: Row) => [r.name],
  filters: {
    quiet: (r: Row) => r.tag === 'quiet',
    active: (r: Row) => r.tag === 'active',
  },
  sorts: {
    name: (r: Row) => r.name,
    value: (r: Row) => r.value,
  },
};

describe('applyTableQuery', () => {
  it('searches case-insensitively', () => {
    const result = applyTableQuery(rows, { q: 'alice' }, spec);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name)).toContain('Alice');
    expect(result.map((r) => r.name)).toContain('alice2');
  });

  it('filters by key', () => {
    const result = applyTableQuery(rows, { filter: 'quiet' }, spec);
    expect(result).toHaveLength(2);
    result.forEach((r) => expect(r.tag).toBe('quiet'));
  });

  it('ignores unknown filter key', () => {
    const result = applyTableQuery(rows, { filter: 'unknown-filter' }, spec);
    expect(result).toHaveLength(rows.length);
  });

  it('ignores unknown sort key', () => {
    const result = applyTableQuery(rows, { sort: 'unknown-sort' }, spec);
    expect(result).toHaveLength(rows.length);
  });

  it('sorts ascending with nulls last', () => {
    const result = applyTableQuery(rows, { sort: 'value', dir: 'asc' }, spec);
    // nulls (Bob) should be last
    expect(result[result.length - 1].name).toBe('Bob');
    expect(result[0].value).toBe(5); // Charlie
  });

  it('sorts descending with nulls last', () => {
    const result = applyTableQuery(rows, { sort: 'value', dir: 'desc' }, spec);
    expect(result[result.length - 1].name).toBe('Bob'); // null still last
    expect(result[0].value).toBe(20); // alice2
  });

  it('applies search, then filter, then sort in sequence', () => {
    const result = applyTableQuery(rows, { q: 'alice', filter: 'active', sort: 'value', dir: 'desc' }, spec);
    // alice2 is active and matches 'alice'
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('alice2');
  });
});
