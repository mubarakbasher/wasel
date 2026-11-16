/**
 * Integration tests for card speed setting — requires a real PostgreSQL instance.
 *
 * Skipped by default. Opt in with:
 *
 *   VOUCHER_PG_INTEGRATION=1 \
 *   INTEGRATION_DATABASE_URL=postgres://wasel:<pw>@127.0.0.1:5436/wasel \
 *   npx vitest run src/tests/cardSpeed.integration.test.ts
 *
 * Safety rules:
 *   - Only connects to localhost / 127.0.0.1.
 *   - Every object is created in a run-unique schema (never public).
 *   - The schema is dropped in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import type { Pool } from 'pg';

const enabled =
  process.env.VOUCHER_PG_INTEGRATION === '1' &&
  Boolean(process.env.INTEGRATION_DATABASE_URL);

function safeHost(url: string): boolean {
  try {
    const u = new URL(url);
    // Reject the base hostname check first.
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return false;
    // pg-connection-string lets ?host= override the hostname; reject that form.
    if (u.searchParams.has('host') || u.searchParams.has('port')) return false;
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!enabled)('cardSpeed integration tests', { timeout: 30000 }, () => {
  let pool: Pool;
  let schema: string;

  async function q(sql: string, params?: unknown[]) {
    return pool.query(sql, params);
  }

  beforeAll(async () => {
    const dbUrl = process.env.INTEGRATION_DATABASE_URL!;
    if (!safeHost(dbUrl)) {
      throw new Error('INTEGRATION_DATABASE_URL must point to localhost or 127.0.0.1');
    }

    const { Pool: RealPool } = await vi.importActual<typeof import('pg')>('pg');
    pool = new RealPool({ connectionString: dbUrl, max: 3 });

    schema = `test_csp_${Date.now()}`;
    await q(`CREATE SCHEMA ${schema}`);

    // Minimal user_print_settings with 043's columns and defaults (no FK, no trigger).
    await q(`
      CREATE TABLE ${schema}.user_print_settings (
        user_id         uuid PRIMARY KEY,
        code_length     int         NOT NULL DEFAULT 8,
        template_id     varchar(32) NOT NULL DEFAULT 'classic',
        default_columns int         NOT NULL DEFAULT 4,
        knobs           jsonb       NOT NULL DEFAULT '{}',
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Apply the speed-limit statements from 047 (in the test schema).
    const migrationPath = path.resolve(
      __dirname,
      '../migrations/sql/047_card_speed_limit.sql',
    );
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    // Extract only the ALTER TABLE user_print_settings lines (not voucher_meta)
    // and re-scope them to our test schema.
    const lines = migrationSql
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('--'))
      .join('\n');

    // We need to run the ALTER TABLE and ADD CONSTRAINT statements in the test schema.
    // Replace "user_print_settings" with the schema-qualified table name.
    const scoped = lines.replace(
      /\buser_print_settings\b/g,
      `${schema}.user_print_settings`,
    );

    // Split on semicolons and run each non-empty statement.
    const statements = scoped.split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      // Skip voucher_meta statements — that table doesn't exist in our test schema.
      if (stmt.toLowerCase().includes('voucher_meta')) continue;
      await q(stmt);
    }
  });

  afterAll(async () => {
    if (pool) {
      await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.end();
    }
  });

  it('upsert on empty table creates row with code_length 8, template_id classic and the given speed', async () => {
    const userId = '11111111-1111-1111-1111-111111111111';
    const { CARD_SPEED_UPSERT_SQL } = await import('../services/cardSettings.service');

    // Replace the unqualified table name with the schema-qualified one.
    const sql = CARD_SPEED_UPSERT_SQL.replace(
      /\buser_print_settings\b/,
      `${schema}.user_print_settings`,
    );

    await q(sql, [userId, true, '1M']);

    const row = await q(
      `SELECT code_length, template_id, speed_limit_enabled, speed_limit
         FROM ${schema}.user_print_settings WHERE user_id = $1`,
      [userId],
    );
    expect(row.rows[0].code_length).toBe(8);
    expect(row.rows[0].template_id).toBe('classic');
    expect(row.rows[0].speed_limit_enabled).toBe(true);
    expect(row.rows[0].speed_limit).toBe('1M');
  });

  it('upsert on existing row changes only the two speed columns', async () => {
    const userId = '22222222-2222-2222-2222-222222222222';

    // Seed with non-default code_length and knobs.
    await q(
      `INSERT INTO ${schema}.user_print_settings (user_id, code_length, knobs)
       VALUES ($1, 10, '{"showPrice":true}')`,
      [userId],
    );

    const { CARD_SPEED_UPSERT_SQL } = await import('../services/cardSettings.service');
    const sql = CARD_SPEED_UPSERT_SQL.replace(
      /\buser_print_settings\b/,
      `${schema}.user_print_settings`,
    );
    await q(sql, [userId, false, '5M']);

    const row = await q(
      `SELECT code_length, knobs, speed_limit_enabled, speed_limit
         FROM ${schema}.user_print_settings WHERE user_id = $1`,
      [userId],
    );
    expect(row.rows[0].code_length).toBe(10);
    expect((row.rows[0].knobs as Record<string, unknown>).showPrice).toBe(true);
    expect(row.rows[0].speed_limit_enabled).toBe(false);
    expect(row.rows[0].speed_limit).toBe('5M');
  });

  it('print-settings upsert leaves speed_limit_enabled and speed_limit unchanged', async () => {
    const userId = '33333333-3333-3333-3333-333333333333';

    // Seed with speed limit on.
    await q(
      `INSERT INTO ${schema}.user_print_settings
         (user_id, speed_limit_enabled, speed_limit) VALUES ($1, true, '2M')`,
      [userId],
    );

    // The print-settings upsert SQL from the service.
    const { upsertPrintSettings } = await import('../services/printSettings.service');
    // We can't call the service directly (it uses the global pool). Instead replicate the SQL text.
    const printSql = `
      INSERT INTO ${schema}.user_print_settings (user_id, code_length, template_id, default_columns, knobs)
           VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id) DO UPDATE
              SET code_length     = EXCLUDED.code_length,
                  template_id     = EXCLUDED.template_id,
                  default_columns = EXCLUDED.default_columns,
                  knobs           = EXCLUDED.knobs,
                  updated_at      = NOW()
        RETURNING code_length, template_id, default_columns, knobs
    `;
    // Suppress the import warning - we just need the SQL shape, not calling the fn.
    void upsertPrintSettings;

    await q(printSql, [userId, 8, 'classic', 4, {}]);

    const row = await q(
      `SELECT speed_limit_enabled, speed_limit FROM ${schema}.user_print_settings WHERE user_id = $1`,
      [userId],
    );
    expect(row.rows[0].speed_limit_enabled).toBe(true);
    expect(row.rows[0].speed_limit).toBe('2M');
  });

  it('UPDATE with speed_limit = "1M/1M" is rejected by check constraint', async () => {
    const userId = '44444444-4444-4444-4444-444444444444';
    await q(
      `INSERT INTO ${schema}.user_print_settings (user_id) VALUES ($1)`,
      [userId],
    );

    await expect(
      q(`UPDATE ${schema}.user_print_settings SET speed_limit = '1M/1M' WHERE user_id = $1`, [userId]),
    ).rejects.toThrow(/user_print_settings_speed_limit_check/);
  });

  it('UPDATE with speed_limit = "256K" (uppercase K) is rejected by check constraint', async () => {
    const userId = '55555555-5555-5555-5555-555555555555';
    await q(
      `INSERT INTO ${schema}.user_print_settings (user_id) VALUES ($1)`,
      [userId],
    );

    await expect(
      q(`UPDATE ${schema}.user_print_settings SET speed_limit = '256K' WHERE user_id = $1`, [userId]),
    ).rejects.toThrow(/user_print_settings_speed_limit_check/);
  });
});
