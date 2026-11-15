import type { PoolClient } from 'pg';
import { pool } from '../config/database';
import { config } from '../config';
import logger from '../config/logger';

export type Queryable = Pick<PoolClient, 'query'>;

export async function withGuardedClient<T>(
  fn: (client: PoolClient) => Promise<T>,
  opts?: { statementTimeoutMs?: number; allowHashJoin?: boolean },
): Promise<T> {
  const timeoutSec = opts?.statementTimeoutMs
    ? `${Math.ceil(opts.statementTimeoutMs / 1000)}s`
    : '15s';

  const client = (await pool.connect()) as PoolClient;
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '${timeoutSec}'`);
    await client.query('SET LOCAL enable_seqscan = off');
    if (!opts?.allowHashJoin) {
      await client.query('SET LOCAL enable_hashjoin = off');
      await client.query('SET LOCAL enable_mergejoin = off');
    }
    const result = await fn(client);
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release(true);
    throw err;
  }
}

export async function getAnalyticsState(
  key: string,
  db?: Queryable,
): Promise<string | null> {
  const q = db ?? pool;
  const result = await q.query<{ value: string | null }>(
    `SELECT value FROM analytics_state WHERE key = $1`,
    [key],
  );
  return result.rows[0]?.value ?? null;
}

export async function setAnalyticsState(
  key: string,
  value: string,
  db?: Queryable,
): Promise<void> {
  const q = db ?? pool;
  await q.query(
    `INSERT INTO analytics_state (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value],
  );
}

export function analyticsJobsEnabled(): boolean {
  return config.ANALYTICS_JOBS_ENABLED === 'true';
}

export async function seedRadacctCursor(): Promise<void> {
  try {
    await pool.query(
      `UPDATE analytics_state
          SET value = (SELECT COALESCE(MAX(radacctid), 0)::text FROM radacct),
              updated_at = NOW()
        WHERE key = 'radacct_cursor' AND value IS NULL`,
    );
  } catch (err) {
    logger.warn('analytics: failed to seed radacct cursor', { err });
  }
}
