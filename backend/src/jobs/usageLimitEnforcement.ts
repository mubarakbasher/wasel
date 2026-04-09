import cron from 'node-cron';
import { pool } from '../config/database';
import logger from '../config/logger';

/**
 * Usage-limit enforcement job.
 *
 * For vouchers with a time or data limit, this job checks cumulative usage
 * (from radacct) against the limit stored in voucher_meta. When usage >= limit,
 * it inserts Auth-Type := Reject in radcheck to block further authentication
 * and marks the voucher as expired.
 *
 * Runs every 30 seconds.
 */
export function startUsageLimitEnforcementJob(): void {
  cron.schedule('*/30 * * * * *', async () => {
    try {
      // --- Time-limited vouchers ---
      const timeResult = await pool.query<{
        radius_username: string;
        limit_value: string;
        total_used: string;
      }>(`
        SELECT vm.radius_username, vm.limit_value,
               COALESCE(SUM(ra.acctsessiontime), 0)::bigint AS total_used
        FROM voucher_meta vm
        JOIN radacct ra ON ra.username = vm.radius_username
        WHERE vm.limit_type = 'time'
          AND vm.limit_value IS NOT NULL
          AND vm.status NOT IN ('disabled', 'expired')
          AND NOT EXISTS (
            SELECT 1 FROM radcheck rc
            WHERE rc.username = vm.radius_username
              AND rc.attribute = 'Auth-Type'
              AND rc.value = 'Reject'
          )
        GROUP BY vm.radius_username, vm.limit_value
        HAVING COALESCE(SUM(ra.acctsessiontime), 0) >= vm.limit_value::bigint
      `);

      for (const row of timeResult.rows) {
        await enforceLimit(row.radius_username, 'time', row.limit_value, row.total_used);
      }

      // --- Data-limited vouchers ---
      const dataResult = await pool.query<{
        radius_username: string;
        limit_value: string;
        total_used: string;
      }>(`
        SELECT vm.radius_username, vm.limit_value,
               COALESCE(SUM(ra.acctinputoctets + ra.acctoutputoctets), 0)::bigint AS total_used
        FROM voucher_meta vm
        JOIN radacct ra ON ra.username = vm.radius_username
        WHERE vm.limit_type = 'data'
          AND vm.limit_value IS NOT NULL
          AND vm.status NOT IN ('disabled', 'expired')
          AND NOT EXISTS (
            SELECT 1 FROM radcheck rc
            WHERE rc.username = vm.radius_username
              AND rc.attribute = 'Auth-Type'
              AND rc.value = 'Reject'
          )
        GROUP BY vm.radius_username, vm.limit_value
        HAVING COALESCE(SUM(ra.acctinputoctets + ra.acctoutputoctets), 0) >= vm.limit_value::bigint
      `);

      for (const row of dataResult.rows) {
        await enforceLimit(row.radius_username, 'data', row.limit_value, row.total_used);
      }
    } catch (error) {
      logger.error('Usage limit enforcement job failed', { error });
    }
  });

  logger.info('Usage limit enforcement job scheduled (every 30s)');
}

async function enforceLimit(
  username: string,
  limitType: string,
  limitValue: string,
  totalUsed: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert Auth-Type := Reject (delete first to avoid duplicates)
    await client.query(
      `DELETE FROM radcheck WHERE username = $1 AND attribute = 'Auth-Type'`,
      [username],
    );
    await client.query(
      `INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)`,
      [username, 'Auth-Type', ':=', 'Reject'],
    );

    // Update voucher_meta status to expired
    await client.query(
      `UPDATE voucher_meta SET status = 'expired' WHERE radius_username = $1`,
      [username],
    );

    await client.query('COMMIT');

    logger.info('Usage limit enforced', {
      username,
      limitType,
      limitValue,
      totalUsed,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
