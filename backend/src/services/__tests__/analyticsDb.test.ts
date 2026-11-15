import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PoolClient } from 'pg';

// We need to control the pool mock at the module level.
// pool is imported inside analyticsDb so we mock pg here.
const mockRelease = vi.fn();
const mockClientQuery = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock('pg', () => {
  class Pool {
    async connect(): Promise<Partial<PoolClient>> {
      return { query: mockClientQuery, release: mockRelease };
    }
    on() {}
    query = mockPoolQuery;
  }
  return { Pool };
});

// Mock config so we can control ANALYTICS_JOBS_ENABLED
vi.mock('../../config', () => ({
  config: {
    ANALYTICS_JOBS_ENABLED: 'true',
    ANALYTICS_TZ: 'Africa/Khartoum',
    ANALYTICS_USAGE_START_DATE: '2026-10-20',
    ANALYTICS_QUIET_MIN_BASE: 20,
    DB_HOST: 'localhost',
    DB_PORT: 5436,
    DB_NAME: 'wasel',
    DB_USER: 'postgres',
    DB_PASSWORD: 'test',
  },
}));

describe('withGuardedClient', () => {
  beforeEach(() => {
    mockClientQuery.mockReset();
    mockRelease.mockReset();
  });

  it('runs BEGIN, the SET LOCALs, the callback, then COMMIT', async () => {
    const { withGuardedClient } = await import('../analyticsDb');

    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const calls: string[] = [];
    mockClientQuery.mockImplementation((sql: string) => {
      calls.push(typeof sql === 'string' ? sql : (sql as { text: string }).text ?? String(sql));
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await withGuardedClient(async (client) => {
      await client.query('SELECT 1');
    });

    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toContain("SET LOCAL statement_timeout = '15s'");
    expect(calls[2]).toContain('SET LOCAL enable_seqscan = off');
    expect(calls[3]).toContain('SET LOCAL enable_hashjoin = off');
    expect(calls[4]).toContain('SET LOCAL enable_mergejoin = off');
    expect(calls[5]).toBe('SELECT 1');
    expect(calls[6]).toBe('COMMIT');
    expect(mockRelease).toHaveBeenCalledWith();
  });

  it('allowHashJoin leaves hash and merge joins on', async () => {
    // Re-import to get a fresh module; since vitest caches we just re-call
    const { withGuardedClient } = await import('../analyticsDb');

    const sqls: string[] = [];
    mockClientQuery.mockImplementation((sql: string) => {
      sqls.push(typeof sql === 'string' ? sql : (sql as { text: string }).text ?? String(sql));
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await withGuardedClient(async () => {}, { allowHashJoin: true });

    expect(sqls.some((s) => s.includes('enable_hashjoin'))).toBe(false);
    expect(sqls.some((s) => s.includes('enable_mergejoin'))).toBe(false);
  });

  it('destroys the client when the callback throws', async () => {
    const { withGuardedClient } = await import('../analyticsDb');

    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(
      withGuardedClient(async () => {
        throw new Error('cb error');
      }),
    ).rejects.toThrow('cb error');

    const rollbackCall = mockClientQuery.mock.calls.find(
      (c) => c[0] === 'ROLLBACK',
    );
    expect(rollbackCall).toBeDefined();
    expect(mockRelease).toHaveBeenCalledWith(true);
  });

  it('seedRadacctCursor only fills a NULL cursor', async () => {
    const { seedRadacctCursor } = await import('../analyticsDb');

    const sqls: string[] = [];
    mockPoolQuery.mockImplementation((sql: string | { text: string }) => {
      const text = typeof sql === 'string' ? sql : sql.text;
      sqls.push(text);
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await seedRadacctCursor();

    const seed = sqls.find((s) => s.includes('radacct_cursor'));
    expect(seed).toBeDefined();
    expect(seed).toContain("key = 'radacct_cursor'");
    expect(seed).toContain('value IS NULL');
    expect(seed).toContain('MAX(radacctid)');
  });

  it('analyticsJobsEnabled is true for the string "true"', async () => {
    const { analyticsJobsEnabled } = await import('../analyticsDb');
    // config is mocked to 'true' at the top of this file
    expect(analyticsJobsEnabled()).toBe(true);
  });

  it('analyticsJobsEnabled is false for the string "false"', async () => {
    vi.resetModules();
    vi.doMock('../../config', () => ({
      config: {
        ANALYTICS_JOBS_ENABLED: 'false',
        ANALYTICS_TZ: 'Africa/Khartoum',
        ANALYTICS_USAGE_START_DATE: '2026-10-20',
        ANALYTICS_QUIET_MIN_BASE: 20,
        DB_HOST: 'localhost',
        DB_PORT: 5436,
        DB_NAME: 'wasel',
        DB_USER: 'wasel',
        DB_PASSWORD: 'password',
      },
    }));
    vi.doMock('pg', () => {
      class Pool {
        async connect() { return { query: vi.fn(), release: vi.fn() }; }
        on() {}
        query = vi.fn();
      }
      return { Pool };
    });
    const { analyticsJobsEnabled } = await import('../analyticsDb');
    expect(analyticsJobsEnabled()).toBe(false);
    vi.resetModules();
  });
});
