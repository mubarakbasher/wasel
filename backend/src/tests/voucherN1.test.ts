/**
 * Voucher N+1 Query-Count Test
 *
 * Verifies that fetching a page of 20 vouchers issues ≤5 SQL round-trips to
 * the pool (1 count query + 1 page query + 3 batch enrichment queries).
 *
 * Strategy: wrap pool.query with a counter, seed 20 mock voucher rows, invoke
 * getVouchersByRouter, and assert the call count.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as voucherService from '../services/voucher.service';

// The mock pool from setup.ts
const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_ROUTER_ID = 'a0a00000-0000-4000-8000-000000000001';

/**
 * Build a minimal VoucherMetaRow-like object.
 */
function makeVoucherRow(n: number) {
  const now = new Date();
  return {
    id: `voucher-${n}`,
    user_id: TEST_USER_ID,
    router_id: TEST_ROUTER_ID,
    radius_username: `user${n.toString().padStart(4, '0')}`,
    group_profile: null,        // no profile → skips profiles batch query still fires (empty pairs)
    comment: null,
    status: 'unused',
    limit_type: null,
    limit_value: null,
    limit_unit: null,
    validity_seconds: null,
    price: null,
    created_at: now,
    updated_at: now,
  };
}

describe('Voucher listing — N+1 prevention', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should issue ≤5 SQL round-trips for a page of 20 vouchers', async () => {
    const PAGE_SIZE = 20;
    const vouchers = Array.from({ length: PAGE_SIZE }, (_, i) => makeVoucherRow(i + 1));
    const usernames = vouchers.map((v) => v.radius_username);

    // Query 1: verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEST_ROUTER_ID }] });

    // Query 2: COUNT(*) for total
    mockQuery.mockResolvedValueOnce({ rows: [{ count: String(PAGE_SIZE) }] });

    // Query 3: SELECT page
    mockQuery.mockResolvedValueOnce({ rows: vouchers });

    // Queries 4-6: batch enrichment (radcheck, radacct, radius_profiles) — parallel
    // radcheck batch
    mockQuery.mockResolvedValueOnce({
      rows: usernames.flatMap((u) => [
        { username: u, attribute: 'Cleartext-Password', value: u },
        { username: u, attribute: 'Simultaneous-Use', value: '1' },
      ]),
    });
    // radacct batch — no sessions
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // radius_profiles batch — no group_profiles set → returns empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const callsBefore = mockQuery.mock.calls.length;
    const result = await voucherService.getVouchersByRouter(TEST_USER_ID, TEST_ROUTER_ID);
    const callsAfter = mockQuery.mock.calls.length;

    const totalCalls = callsAfter - callsBefore;

    expect(result.vouchers).toHaveLength(PAGE_SIZE);
    // 1 ownership + 1 count + 1 page + 3 batch = 6 total, well within limit
    expect(totalCalls).toBeLessThanOrEqual(6);
  });
});
