import { pool } from '../config/database';
import logger from '../config/logger';

export interface BankInfo {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  instructions: string;
}

/**
 * Get all settings, optionally filtered to keys starting with `prefix`.
 * Returns a `key -> value` map. Values are decoded from JSONB as unknown.
 */
export async function getSettings(prefix?: string): Promise<Record<string, unknown>> {
  const params: unknown[] = [];
  let where = '';
  if (prefix) {
    where = 'WHERE key LIKE $1';
    params.push(`${prefix}%`);
  }

  const result = await pool.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM system_settings ${where}`,
    params,
  );

  const out: Record<string, unknown> = {};
  for (const row of result.rows) {
    out[row.key] = row.value;
  }
  return out;
}

/**
 * Read the four `bank.*` keys and coerce missing/non-string values to empty strings.
 */
export async function getBankInfo(): Promise<BankInfo> {
  const settings = await getSettings('bank.');
  const toStr = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    bankName: toStr(settings['bank.name']),
    accountNumber: toStr(settings['bank.accountNumber']),
    accountHolder: toStr(settings['bank.accountHolder']),
    instructions: toStr(settings['bank.instructions']),
  };
}

/**
 * Upsert each key in `updates` with `updated_by=adminId`.
 * Values are stored as JSONB.
 */
export async function updateSettings(
  updates: Record<string, unknown>,
  adminId: string,
): Promise<void> {
  const entries = Object.entries(updates);
  if (entries.length === 0) return;

  for (const [key, value] of entries) {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at, updated_by)
       VALUES ($1, $2::jsonb, NOW(), $3)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by`,
      [key, JSON.stringify(value ?? null), adminId],
    );
  }

  logger.info('System settings updated', { adminId, keys: entries.map(([k]) => k) });
}
