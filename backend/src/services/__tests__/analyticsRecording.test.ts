import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// Mock pool using the hoistable factory form (no top-level variable references)
// ---------------------------------------------------------------------------

vi.mock('../../config/database', () => {
  const mockPoolQuery = vi.fn();
  const mockConnect = vi.fn();
  return {
    pool: {
      query: mockPoolQuery,
      connect: mockConnect,
    },
  };
});

vi.mock('../../config/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks are in place)
// ---------------------------------------------------------------------------

import { pool } from '../../config/database';
import { recordIncome, reconcileIncomeLedger } from '../analyticsRecording.service';
import logger from '../../config/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(resolvedValue?: unknown): PoolClient {
  const clientQuery = vi.fn().mockResolvedValue(resolvedValue ?? { rowCount: 1, rows: [] });
  return { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
}

beforeEach(() => {
  vi.mocked(pool.query).mockReset();
  vi.mocked(logger.error).mockReset();
});

// ---------------------------------------------------------------------------
// recordIncome
// ---------------------------------------------------------------------------

describe('recordIncome', () => {
  it('passes [paymentId, activatedId, "live"]', async () => {
    const client = makeClient();

    await recordIncome(client, 'pay-123', 'sub-456');

    const clientQuery = vi.mocked(client.query);
    // Calls: SAVEPOINT, INSERT, RELEASE
    expect(clientQuery).toHaveBeenCalledTimes(3);
    const insertCall = clientQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('income_ledger'),
    ) as [string, unknown[]] | undefined;
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual(['pay-123', 'sub-456', 'live']);
  });

  it('issues SAVEPOINT, INSERT, RELEASE in that order', async () => {
    const client = makeClient();
    await recordIncome(client, 'pay-123', null);

    const calls = vi.mocked(client.query).mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toBe('SAVEPOINT analytics_income');
    expect(calls[1]).toContain('income_ledger');
    expect(calls[2]).toBe('RELEASE SAVEPOINT analytics_income');
  });

  it('swallows a database error and logs it', async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({}) // SAVEPOINT
      .mockRejectedValueOnce(new Error('DB down')) // INSERT fails
      .mockResolvedValueOnce({}); // ROLLBACK TO SAVEPOINT
    const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;

    await expect(recordIncome(client, 'pay-err', null)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('recordIncome'),
      expect.objectContaining({ paymentId: 'pay-err' }),
    );

    const calls = clientQuery.mock.calls.map((c) => c[0] as string);
    expect(calls).toContain('ROLLBACK TO SAVEPOINT analytics_income');
  });
});

// ---------------------------------------------------------------------------
// reconcileIncomeLedger
// ---------------------------------------------------------------------------

describe('reconcileIncomeLedger', () => {
  it('passes [null, null, "reconcile"] and returns rowCount', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 42, rows: [] } as never);

    const count = await reconcileIncomeLedger();

    expect(count).toBe(42);
    expect(pool.query).toHaveBeenCalledOnce();
    const args = vi.mocked(pool.query).mock.calls[0] as unknown as [string, unknown[]];
    const [sql, params] = args;
    expect(sql).toContain('income_ledger');
    expect(params).toEqual([null, null, 'reconcile']);
  });

  it('returns 0 when rowCount is null', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: null, rows: [] } as never);
    const count = await reconcileIncomeLedger();
    expect(count).toBe(0);
  });
});
