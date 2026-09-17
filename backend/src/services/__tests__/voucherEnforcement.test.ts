import { describe, it, expect, vi, beforeEach } from 'vitest';

// pool is mocked globally by src/tests/setup.ts.
const mockPoolQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;

import { createRadacctCandidateTracker } from '../voucherEnforcement.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a candidate row as returned by the three-branch UNION query. */
function candidateRow(username: string, open: boolean, maxId: string) {
  return { username, open, max_id: maxId };
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockPoolQuery.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('createRadacctCandidateTracker', () => {
  describe('first collect()', () => {
    it('initialises watermark via MAX(radacctid) on the first call', async () => {
      const tracker = createRadacctCandidateTracker();

      // First pool.query: watermark init
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ max_id: '1000' }] });
      // Second pool.query: candidate query (no rows)
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      await tracker.collect();

      expect(mockPoolQuery).toHaveBeenCalledTimes(2);

      // First call should be the MAX init
      const initSql = (mockPoolQuery.mock.calls[0] as [string])[0] as string;
      expect(initSql).toMatch(/COALESCE\s*\(\s*MAX\s*\(\s*radacctid/i);
    });

    it('does NOT run the init query on subsequent calls', async () => {
      const tracker = createRadacctCandidateTracker();

      // First collect: init + candidate
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '500' }] })
        .mockResolvedValueOnce({ rows: [] });
      const r1 = await tracker.collect();
      r1.commit();

      // Second collect: candidate only (no init)
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      await tracker.collect();

      // Total: 3 calls (init, candidate1, candidate2) not 4
      expect(mockPoolQuery).toHaveBeenCalledTimes(3);
    });
  });

  describe('$1 (window start) calculation', () => {
    it('passes watermark - 100 as a string for the new-row scan', async () => {
      const tracker = createRadacctCandidateTracker();

      // Watermark initialised to 1000
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '1000' }] })
        .mockResolvedValueOnce({ rows: [] });

      await tracker.collect();

      // The candidate query is the second pool.query call
      const candidateArgs = mockPoolQuery.mock.calls[1] as [string, [string, string]];
      expect(candidateArgs[1][0]).toBe('900'); // 1000 - 100
    });

    it('clamps $1 to "0" when watermark is less than 100 (never negative)', async () => {
      const tracker = createRadacctCandidateTracker();

      // Watermark 50 → windowStart = max(50-100, 0) = 0
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '50' }] })
        .mockResolvedValueOnce({ rows: [] });

      await tracker.collect();

      const candidateArgs = mockPoolQuery.mock.calls[1] as [string, [string, string]];
      expect(candidateArgs[1][0]).toBe('0');
    });

    it('uses "0" as $1 when watermark is exactly 0', async () => {
      const tracker = createRadacctCandidateTracker();

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await tracker.collect();

      const candidateArgs = mockPoolQuery.mock.calls[1] as [string, [string, string]];
      expect(candidateArgs[1][0]).toBe('0');
    });
  });

  describe('usernames union with prevOpen', () => {
    it('includes usernames from the query result', async () => {
      const tracker = createRadacctCandidateTracker();

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({
          rows: [candidateRow('u1', true, '10'), candidateRow('u2', false, '11')],
        });

      const r = await tracker.collect();

      expect(r.usernames).toContain('u1');
      expect(r.usernames).toContain('u2');
    });

    it('includes prevOpen usernames that are no longer in the query result', async () => {
      const tracker = createRadacctCandidateTracker();

      // First collect: 'a' is open, 'b' is closed
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({
          rows: [candidateRow('a', true, '1'), candidateRow('b', false, '2')],
        });
      const r1 = await tracker.collect();
      r1.commit(); // prevOpen = {'a'}

      // Second collect: only 'b' comes back from the query
      mockPoolQuery.mockResolvedValueOnce({
        rows: [candidateRow('b', false, '3')],
      });
      const r2 = await tracker.collect();

      // 'a' must be in results (from prevOpen) even though it wasn't in query
      expect(r2.usernames).toContain('a');
      expect(r2.usernames).toContain('b');
    });

    it('deduplicates usernames appearing in both query result and prevOpen', async () => {
      const tracker = createRadacctCandidateTracker();

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({ rows: [candidateRow('shared', true, '5')] });
      const r1 = await tracker.collect();
      r1.commit(); // prevOpen = {'shared'}

      mockPoolQuery.mockResolvedValueOnce({
        rows: [candidateRow('shared', true, '6')],
      });
      const r2 = await tracker.collect();

      const count = r2.usernames.filter((u) => u === 'shared').length;
      expect(count).toBe(1);
    });
  });

  describe('state without commit()', () => {
    it('does not advance watermark when commit is not called', async () => {
      const tracker = createRadacctCandidateTracker();

      // First collect: watermark init = 1000, rows with max_id 1200
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '1000' }] })
        .mockResolvedValueOnce({ rows: [candidateRow('u1', true, '1200')] });

      await tracker.collect(); // intentionally NOT calling commit

      // Second collect: watermark still 1000 → $1 still '900'
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      await tracker.collect();

      const secondCandidateArgs = mockPoolQuery.mock.calls[2] as [string, [string, string]];
      expect(secondCandidateArgs[1][0]).toBe('900'); // 1000 - 100, not 1100
    });

    it('retains prevOpen across ticks when commit is not called', async () => {
      const tracker = createRadacctCandidateTracker();

      // First collect: 'u1' is open; commit to set prevOpen
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({ rows: [candidateRow('u1', true, '1')] });
      const r1 = await tracker.collect();
      r1.commit(); // prevOpen = {'u1'}

      // Second collect: 'u2' appears, no commit
      mockPoolQuery.mockResolvedValueOnce({
        rows: [candidateRow('u2', true, '2')],
      });
      await tracker.collect(); // no commit

      // Third collect: prevOpen still {'u1'} (from first commit, not the missed second)
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      const r3 = await tracker.collect();

      expect(r3.usernames).toContain('u1');
    });
  });

  describe('commit()', () => {
    it('advances watermark to the maximum max_id in the batch', async () => {
      const tracker = createRadacctCandidateTracker();

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '1000' }] })
        .mockResolvedValueOnce({
          rows: [
            candidateRow('u1', true, '1500'),
            candidateRow('u2', false, '1200'),
          ],
        });
      const r = await tracker.collect();
      r.commit(); // watermark should advance to 1500

      // Next collect: $1 = 1500 - 100 = '1400'
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      await tracker.collect();

      const candidateArgs = mockPoolQuery.mock.calls[2] as [string, [string, string]];
      expect(candidateArgs[1][0]).toBe('1400');
    });

    it('does not change watermark when the batch is empty', async () => {
      const tracker = createRadacctCandidateTracker();

      // Watermark init = 1000, no rows
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '1000' }] })
        .mockResolvedValueOnce({ rows: [] });
      const r = await tracker.collect();
      r.commit(); // nothing to advance

      // Next collect: $1 still '900'
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      await tracker.collect();

      const candidateArgs = mockPoolQuery.mock.calls[2] as [string, [string, string]];
      expect(candidateArgs[1][0]).toBe('900');
    });

    it('replaces prevOpen with only the open usernames from the batch', async () => {
      const tracker = createRadacctCandidateTracker();

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({
          rows: [
            candidateRow('open-user', true, '10'),
            candidateRow('closed-user', false, '11'),
          ],
        });
      const r = await tracker.collect();
      r.commit(); // prevOpen = {'open-user'}

      // Next collect returns nothing from the query
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      const r2 = await tracker.collect();

      expect(r2.usernames).toContain('open-user');
      expect(r2.usernames).not.toContain('closed-user');
    });

    it('sets prevOpen to empty when all sessions are closed', async () => {
      const tracker = createRadacctCandidateTracker();

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ max_id: '0' }] })
        .mockResolvedValueOnce({
          rows: [candidateRow('u1', false, '5'), candidateRow('u2', false, '6')],
        });
      const r = await tracker.collect();
      r.commit(); // prevOpen = {} (none are open)

      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      const r2 = await tracker.collect();

      expect(r2.usernames).toHaveLength(0);
    });
  });
});
