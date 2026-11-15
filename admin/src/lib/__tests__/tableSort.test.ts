import { describe, it, expect } from 'vitest';
import { sortRows, matchesSearch } from '../tableSort';

describe('sortRows', () => {
  it('keeps nulls last in both directions', () => {
    const rows = [{ v: 2 }, { v: null }, { v: 1 }];
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.v)).toEqual([2, 1, null]);
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.v)).toEqual([1, 2, null]);
  });

  it('returns a new array and leaves the input alone', () => {
    const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
    const sorted = sortRows(rows, (r) => r.v, 'asc');
    expect(sorted).not.toBe(rows);
    expect(rows.map((r) => r.v)).toEqual([3, 1, 2]);
    expect(sorted.map((r) => r.v)).toEqual([1, 2, 3]);
  });

  it('sorts numbers by value, not as text', () => {
    const rows = [{ v: 10 }, { v: 9 }, { v: 100 }];
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.v)).toEqual([9, 10, 100]);
  });

  it('sorts text without regard to case', () => {
    const rows = [{ n: 'beta' }, { n: 'Alpha' }, { n: 'gamma' }];
    expect(sortRows(rows, (r) => r.n, 'asc').map((r) => r.n)).toEqual(['Alpha', 'beta', 'gamma']);
    expect(sortRows(rows, (r) => r.n, 'desc').map((r) => r.n)).toEqual(['gamma', 'beta', 'Alpha']);
  });

  it('keeps the delivered order for equal values', () => {
    const rows = [
      { id: 'a', v: 1 },
      { id: 'b', v: 1 },
      { id: 'c', v: 0 },
      { id: 'd', v: 1 },
    ];
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('treats NaN like a missing value', () => {
    const rows = [{ v: NaN }, { v: 5 }, { v: 1 }];
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.v)).toEqual([5, 1, NaN]);
  });
});

describe('matchesSearch', () => {
  it('matches any field, ignoring case and outer spaces', () => {
    expect(matchesSearch(['Cafe Nile', 'owner@example.com'], 'nile')).toBe(true);
    expect(matchesSearch(['Cafe Nile', 'owner@example.com'], '  EXAMPLE.com ')).toBe(true);
    expect(matchesSearch(['Cafe Nile', 'owner@example.com'], 'atbara')).toBe(false);
  });

  it('an empty query matches everything', () => {
    expect(matchesSearch(['Cafe Nile'], '')).toBe(true);
    expect(matchesSearch([], '   ')).toBe(true);
  });

  it('skips null fields', () => {
    expect(matchesSearch([null, 'Cafe Nile'], 'cafe')).toBe(true);
    expect(matchesSearch([null], 'null')).toBe(false);
  });
});
