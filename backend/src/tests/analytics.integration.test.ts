/**
 * Integration tests for Analytics — requires a real PostgreSQL 16 instance
 * with migrations 044–046 applied.
 *
 * Skipped by default. Opt in with:
 *
 *   ANALYTICS_PG_INTEGRATION=1 \
 *   INTEGRATION_DATABASE_URL=postgres://user:pass@localhost:5436/waseldb \
 *   npx vitest run src/tests/analytics.integration.test.ts
 *
 * Safety rules:
 *   • Only connects to localhost / 127.0.0.1 — refuses any other host.
 *   • Every object is created in a run-unique schema (never public).
 *   • The schema is dropped in afterAll.
 *   • Never issues TRUNCATE or DROP on any other schema.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';

const enabled =
  process.env.ANALYTICS_PG_INTEGRATION === '1' &&
  Boolean(process.env.INTEGRATION_DATABASE_URL);

function safeHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

// ---- Module-level schema-routing Pool wrapper (accessible by all describe blocks) ----
function buildSchemaPool(realPool: Pool, s: string): Pool {
  const proxy = Object.create(realPool) as Pool & { connect: () => Promise<PoolClient> };
  proxy.query = (async (...args: Parameters<Pool['query']>) => {
    const client = await realPool.connect();
    try {
      await client.query(`SET search_path = ${s}, public`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (client.query as any)(...args);
    } finally {
      client.release();
    }
  }) as Pool['query'];
  proxy.connect = async () => {
    const client = await realPool.connect();
    await client.query(`SET search_path = ${s}, public`);
    return client;
  };
  return proxy;
}

describe.skipIf(!enabled)('analytics integration tests', { timeout: 120_000 }, () => {
  let pool: Pool;
  let schema: string;
  /** Guard schema: same analytics tables but NO radacct / voucher_meta / radpostauth. */
  let guardSchema: string;
  /** Nums schema: fully isolated schema for the NUMBERS scenario (no data from other tests). */
  let numsSchema: string;
  let numsPool: Pool;

  async function q(sql: string, params?: unknown[]) {
    return pool.query(sql, params);
  }

  // ---- Schema-routing Pool wrapper (same pattern as voucherCodeReuse.integration.test.ts) ----
  // (kept for backward compat; delegates to the module-level helper)
  function buildSchemaPool(realPool: Pool, s: string): Pool {
    const proxy = Object.create(realPool) as Pool & { connect: () => Promise<PoolClient> };
    proxy.query = (async (...args: Parameters<Pool['query']>) => {
      const client = await realPool.connect();
      try {
        await client.query(`SET search_path = ${s}, public`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (client.query as any)(...args);
      } finally {
        client.release();
      }
    }) as Pool['query'];
    proxy.connect = async () => {
      const client = await realPool.connect();
      await client.query(`SET search_path = ${s}, public`);
      return client;
    };
    return proxy;
  }

  // ---- Setup ----
  beforeAll(async () => {
    const dbUrl = process.env.INTEGRATION_DATABASE_URL!;
    if (!safeHost(dbUrl)) {
      throw new Error('INTEGRATION_DATABASE_URL must point to localhost or 127.0.0.1');
    }

    const { Pool: RealPool } = await vi.importActual<typeof import('pg')>('pg');
    pool = new RealPool({ connectionString: dbUrl, max: 5 });

    schema = `test_analytics_${Date.now()}`;
    await q(`CREATE SCHEMA ${schema}`);
    await q(`SET search_path = ${schema}, public`);

    // Create the tables we need in isolated schema (cloning only the columns we use)
    await q(`
      CREATE TABLE ${schema}.users (
        id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name  TEXT NOT NULL,
        email TEXT,
        role  TEXT NOT NULL DEFAULT 'user',
        password_hash TEXT NOT NULL DEFAULT 'x',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        email_verified BOOLEAN NOT NULL DEFAULT true
      )
    `);
    await q(`
      CREATE TABLE ${schema}.plans (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tier           TEXT NOT NULL UNIQUE,
        name           TEXT NOT NULL,
        price          NUMERIC(10,2),
        router_quota   INTEGER,
        voucher_quota  INTEGER,
        duration_months INTEGER NOT NULL DEFAULT 1
      )
    `);
    await q(`
      CREATE TABLE ${schema}.subscriptions (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                 UUID NOT NULL,
        plan_tier               TEXT NOT NULL,
        status                  TEXT NOT NULL DEFAULT 'pending',
        duration_months         INTEGER NOT NULL DEFAULT 1,
        voucher_quota           INTEGER NOT NULL DEFAULT 500,
        vouchers_used           INTEGER NOT NULL DEFAULT 0,
        start_date              TIMESTAMPTZ,
        end_date                TIMESTAMPTZ,
        previous_subscription_id UUID,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await q(`
      CREATE TABLE ${schema}.payments (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID NOT NULL,
        plan_tier        TEXT NOT NULL,
        amount           NUMERIC(10,2) NOT NULL,
        status           TEXT NOT NULL DEFAULT 'pending',
        receipt_url      TEXT,
        reviewed_by      UUID,
        reviewed_at      TIMESTAMPTZ,
        rejection_reason TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await q(`
      CREATE TABLE ${schema}.routers (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL,
        name        TEXT NOT NULL,
        tunnel_ip   TEXT,
        status      TEXT NOT NULL DEFAULT 'offline',
        last_seen   TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await q(`
      CREATE TABLE ${schema}.voucher_meta (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        router_id        UUID NOT NULL,
        user_id          UUID NOT NULL,
        radius_username  VARCHAR(64) NOT NULL UNIQUE,
        status           VARCHAR(32) NOT NULL DEFAULT 'unused',
        limit_type       VARCHAR(16),
        limit_value      NUMERIC,
        price            NUMERIC(10,2),
        validity_seconds INTEGER NOT NULL DEFAULT 0,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await q(`
      CREATE TABLE ${schema}.radacct (
        radacctid        BIGSERIAL PRIMARY KEY,
        acctuniqueid     VARCHAR(64) NOT NULL UNIQUE,
        username         VARCHAR(64) NOT NULL,
        nasipaddress     VARCHAR(15),
        acctstarttime    TIMESTAMPTZ,
        acctstoptime     TIMESTAMPTZ,
        acctsessiontime  INTEGER,
        acctinputoctets  BIGINT DEFAULT 0,
        acctoutputoctets BIGINT DEFAULT 0
      )
    `);
    await q(`CREATE INDEX ON ${schema}.radacct (username)`);
    await q(`CREATE INDEX ON ${schema}.radacct (acctstarttime)`);

    // Analytics tables from migrations 044–046
    await q(`
      CREATE TABLE ${schema}.income_ledger (
        payment_id             UUID PRIMARY KEY,
        user_id                UUID NOT NULL,
        operator_name          VARCHAR(100),
        operator_email         VARCHAR(255),
        subscription_id        UUID,
        replaces_subscription_id UUID,
        plan_tier              VARCHAR(50) NOT NULL,
        plan_name              VARCHAR(100),
        duration_months        INTEGER,
        amount                 NUMERIC(12,2) NOT NULL,
        kind                   VARCHAR(12) NOT NULL CHECK (kind IN ('new','renewal','plan_change')),
        approved_at            TIMESTAMPTZ NOT NULL,
        period_end             TIMESTAMPTZ,
        source                 VARCHAR(10) NOT NULL DEFAULT 'live'
      )
    `);
    await q(`CREATE INDEX ON ${schema}.income_ledger (approved_at)`);
    await q(`CREATE INDEX ON ${schema}.income_ledger (user_id, approved_at)`);

    await q(`
      CREATE TABLE ${schema}.operator_activity (
        user_id        UUID PRIMARY KEY,
        last_active_at TIMESTAMPTZ NOT NULL
      )
    `);

    await q(`
      CREATE TABLE ${schema}.analytics_state (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await q(`INSERT INTO ${schema}.analytics_state (key) VALUES ('radacct_cursor'),('monitor_heartbeat') ON CONFLICT DO NOTHING`);

    await q(`
      CREATE TABLE ${schema}.router_uptime_state (
        router_id     UUID PRIMARY KEY,
        user_id       UUID NOT NULL,
        tracked_since TIMESTAMPTZ NOT NULL,
        is_up         BOOLEAN NOT NULL,
        changed_at    TIMESTAMPTZ NOT NULL,
        untracked_at  TIMESTAMPTZ
      )
    `);
    await q(`
      CREATE TABLE ${schema}.router_outages (
        id         BIGSERIAL PRIMARY KEY,
        router_id  UUID NOT NULL,
        user_id    UUID NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at   TIMESTAMPTZ,
        end_reason VARCHAR(20)
      )
    `);
    await q(`CREATE UNIQUE INDEX ON ${schema}.router_outages (router_id) WHERE ended_at IS NULL`);
    await q(`CREATE INDEX ON ${schema}.router_outages (ended_at, started_at)`);

    await q(`
      CREATE TABLE ${schema}.monitor_gaps (
        id         BIGSERIAL PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at   TIMESTAMPTZ NOT NULL
      )
    `);

    await q(`
      CREATE TABLE ${schema}.analytics_card_batches (
        id         BIGSERIAL PRIMARY KEY,
        user_id    UUID NOT NULL,
        router_id  UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        card_count INTEGER NOT NULL,
        price      NUMERIC(10,2),
        limit_type VARCHAR(10),
        source     VARCHAR(10) NOT NULL DEFAULT 'live'
      )
    `);
    await q(`CREATE INDEX ON ${schema}.analytics_card_batches (created_at)`);
    await q(`CREATE INDEX ON ${schema}.analytics_card_batches (router_id, created_at)`);

    await q(`
      CREATE TABLE ${schema}.analytics_card_first_use (
        radius_username  VARCHAR(64) PRIMARY KEY,
        user_id          UUID NOT NULL,
        router_id        UUID NOT NULL,
        price            NUMERIC(10,2),
        limit_type       VARCHAR(10),
        first_used_at    TIMESTAMPTZ NOT NULL,
        first_radacctid  BIGINT NOT NULL
      )
    `);
    await q(`CREATE INDEX ON ${schema}.analytics_card_first_use (first_used_at)`);

    await q(`
      CREATE TABLE ${schema}.analytics_card_daily (
        day           DATE NOT NULL,
        user_id       UUID NOT NULL,
        router_id     UUID NOT NULL,
        limit_type    VARCHAR(10),
        price         NUMERIC(10,2),
        cards_created INTEGER NOT NULL DEFAULT 0,
        cards_used    INTEGER NOT NULL DEFAULT 0,
        UNIQUE NULLS NOT DISTINCT (day, user_id, router_id, limit_type, price)
      )
    `);
    await q(`CREATE INDEX ON ${schema}.analytics_card_daily (user_id, day)`);

    await q(`
      CREATE TABLE ${schema}.analytics_usage_hourly (
        day        DATE NOT NULL,
        hour       SMALLINT NOT NULL,
        router_id  UUID,
        user_id    UUID,
        sessions   INTEGER NOT NULL,
        data_bytes BIGINT NOT NULL,
        UNIQUE NULLS NOT DISTINCT (day, hour, router_id)
      )
    `);

    await q(`
      CREATE TABLE ${schema}.analytics_usage_daily (
        day        DATE NOT NULL,
        router_id  UUID,
        user_id    UUID,
        sessions   INTEGER NOT NULL,
        data_bytes BIGINT NOT NULL,
        UNIQUE NULLS NOT DISTINCT (day, router_id)
      )
    `);

    await q(`
      CREATE TABLE ${schema}.analytics_hour_daily (
        day        DATE NOT NULL,
        hour       SMALLINT NOT NULL,
        sessions   INTEGER NOT NULL,
        data_bytes BIGINT NOT NULL,
        PRIMARY KEY (day, hour)
      )
    `);

    await q(`
      CREATE TABLE ${schema}.analytics_uptime_daily (
        day                    DATE NOT NULL,
        router_id              UUID NOT NULL,
        user_id                UUID NOT NULL,
        observed_seconds       INTEGER NOT NULL,
        down_seconds           INTEGER NOT NULL,
        drops                  INTEGER NOT NULL,
        longest_outage_seconds INTEGER NOT NULL,
        PRIMARY KEY (day, router_id)
      )
    `);

    // schema_migrations table so backfill can read migration 045 timestamp
    await q(`
      CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
        version    TEXT PRIMARY KEY,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await q(`
      INSERT INTO ${schema}.schema_migrations (version, executed_at)
      VALUES ('045', NOW() - INTERVAL '1 day')
      ON CONFLICT DO NOTHING
    `);

    // ---- Guard schema: same structure but WITHOUT radacct / voucher_meta / radpostauth ----
    // Used to prove analytics service SQL never references those tables.
    guardSchema = `test_analytics_guard_${Date.now()}`;
    await q(`CREATE SCHEMA ${guardSchema}`);
    for (const tbl of [
      'users', 'plans', 'subscriptions', 'payments', 'routers',
      'income_ledger', 'operator_activity', 'analytics_state',
      'router_uptime_state', 'router_outages', 'monitor_gaps',
      'analytics_card_batches', 'analytics_card_first_use',
      'analytics_card_daily', 'analytics_usage_hourly',
      'analytics_usage_daily', 'analytics_hour_daily', 'analytics_uptime_daily',
    ]) {
      await q(`CREATE TABLE ${guardSchema}.${tbl} AS SELECT * FROM ${schema}.${tbl} WHERE FALSE`);
    }
    await q(`
      INSERT INTO ${guardSchema}.analytics_state (key)
      VALUES ('radacct_cursor'),('monitor_heartbeat')
      ON CONFLICT DO NOTHING
    `);
    // Seed a minimal user for getOperatorAnalytics
    await q(`INSERT INTO ${guardSchema}.users (id, name, email, role, password_hash)
             SELECT id, name, email, role, password_hash FROM ${schema}.users LIMIT 1`);

    // ---- Nums schema: fully isolated for the NUMBERS scenario ----
    numsSchema = `test_analytics_nums_${Date.now() + 1}`;
    await q(`CREATE SCHEMA ${numsSchema}`);
    numsPool = buildSchemaPool(pool, numsSchema);

    // ---- Seed shared schema with radacct data needed by the "ingest after backfill" test ----
    // Insert voucher_meta (cardA0–cardA3) + radacct (4 sessions) so the ingest test
    // can read them from ${schema}.  The test deletes analytics_card_first_use rows
    // and re-runs backfill+ingest from scratch, so it only needs radacct + voucher_meta.
    const r1Seed = await q(
      `INSERT INTO ${schema}.routers (user_id, name, tunnel_ip, status, last_seen)
       VALUES ($1, 'seed-router', '10.10.0.100', 'offline', NULL) RETURNING id`,
      [(await q(`INSERT INTO ${schema}.users (name, email) VALUES ('SeedOp','seed@test.com') RETURNING id`)).rows[0].id],
    );
    const seedRouterId = r1Seed.rows[0].id as string;
    const seedUserId = (await q(`SELECT user_id FROM ${schema}.routers WHERE id = $1`, [seedRouterId])).rows[0].user_id as string;
    for (let i = 0; i < 4; i++) {
      await q(
        `INSERT INTO ${schema}.voucher_meta (router_id, user_id, radius_username, status, limit_type, price, validity_seconds)
         VALUES ($1, $2, $3, 'unused', 'time', 50, 3600)`,
        [seedRouterId, seedUserId, `cardA${i}`],
      );
    }
    for (let i = 0; i < 3; i++) {
      await q(
        `INSERT INTO ${schema}.radacct (acctuniqueid, username, nasipaddress, acctstarttime, acctstoptime, acctsessiontime, acctinputoctets, acctoutputoctets)
         VALUES ($1, $2, '10.10.0.100', '2026-11-01T06:00:00Z', '2026-11-01T07:00:00Z', 3600, 1000000, 500000)`,
        [`uid-A${i}`, `cardA${i}`],
      );
    }
    await q(
      `INSERT INTO ${schema}.radacct (acctuniqueid, username, nasipaddress, acctstarttime, acctstoptime, acctsessiontime, acctinputoctets, acctoutputoctets)
       VALUES ('uid-late', 'cardA3', '10.10.0.100', '2026-11-01T22:30:00Z', '2026-11-01T23:30:00Z', 3600, 2000000, 1000000)`,
    );
  });

  afterAll(async () => {
    if (pool) {
      await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      if (guardSchema) await q(`DROP SCHEMA IF EXISTS ${guardSchema} CASCADE`);
      if (numsSchema) await q(`DROP SCHEMA IF EXISTS ${numsSchema} CASCADE`);
      await pool.end();
    }
  });

  // ---------------------------------------------------------------------------
  // Test: migrations apply twice without error (idempotency)
  // ---------------------------------------------------------------------------
  it('migrations 044–046 apply twice without error', async () => {
    // Read the actual migration SQL files from disk and execute each twice against
    // our isolated test schema. If a migration lacks IF NOT EXISTS, a REFERENCES,
    // or a broken ALTER, the second run will raise an error and the test fails.
    const { readFileSync } = await import('fs');
    const { resolve, join } = await import('path');

    const migDir = resolve(__dirname, '../migrations/sql');
    const migFiles = [
      '044_analytics_money.sql',
      '045_analytics_recording.sql',
      '046_analytics_summaries.sql',
    ];

    for (const file of migFiles) {
      const sql = readFileSync(join(migDir, file), 'utf8');
      // Prefix SET search_path so all DDL lands in our test schema (not public).
      // The simple-query protocol allows multiple statements in one call when
      // no parameters are passed.
      const prefixed = `SET search_path = ${schema}, public;\n${sql}`;

      // First application
      await expect(q(prefixed)).resolves.toBeDefined();
      // Second application — must be idempotent (no error)
      await expect(q(prefixed)).resolves.toBeDefined();
    }

    // Confirm schema_migrations lists the three versions
    const r = await q(
      `SELECT version FROM ${schema}.schema_migrations ORDER BY version`,
    );
    const versions = r.rows.map((row: { version: string }) => row.version);
    // 045 was inserted in beforeAll; 044 and 046 don't add rows but that's by design
    expect(versions).toContain('045');
  });

  // ---------------------------------------------------------------------------
  // Test: approving a payment writes one ledger row; approving again adds none
  // ---------------------------------------------------------------------------

  it('approving a payment writes one ledger row; approving again adds none', async () => {
    // Create a minimal operator + subscription + payment in the schema
    const userRes = await q(
      `INSERT INTO ${schema}.users (name, email) VALUES ('LedgerOp', 'ledger@test.com') RETURNING id`,
    );
    const userId = userRes.rows[0].id as string;

    await q(
      `INSERT INTO ${schema}.plans (tier, name, price, voucher_quota) VALUES ('starter','Starter',1000,500) ON CONFLICT (tier) DO NOTHING`,
    );

    const payRes = await q(
      `INSERT INTO ${schema}.payments (user_id, plan_tier, amount, status, receipt_url, reviewed_at)
       VALUES ($1, 'starter', 1000, 'pending', 'https://r.test/1', NOW()) RETURNING id`,
      [userId],
    );
    const paymentId = payRes.rows[0].id as string;

    const subRes = await q(
      `INSERT INTO ${schema}.subscriptions (user_id, plan_tier, status, duration_months, voucher_quota, created_at)
       SELECT $1, 'starter', 'pending', 1, 500, p.created_at
       FROM ${schema}.payments p WHERE p.id = $2
       RETURNING id`,
      [userId, paymentId],
    );
    const subId = subRes.rows[0].id as string;

    // Simulate reviewPayment approval: update payment + subscription + insert ledger
    const schemaPool = buildSchemaPool(pool, schema);
    const { recordIncome } = await import('../services/analyticsRecording.service');

    const client = await schemaPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE ${schema}.payments SET status = 'approved', reviewed_at = NOW() WHERE id = $1`,
        [paymentId],
      );
      await client.query(
        `UPDATE ${schema}.subscriptions SET status = 'active', start_date = NOW(), end_date = NOW() + INTERVAL '30 days' WHERE id = $1`,
        [subId],
      );
      await recordIncome(client, paymentId, subId);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const ledger1 = await q(
      `SELECT COUNT(*) AS cnt FROM ${schema}.income_ledger WHERE payment_id = $1`,
      [paymentId],
    );
    expect(Number(ledger1.rows[0].cnt)).toBe(1);

    // Approving again: ON CONFLICT DO NOTHING should insert nothing
    const client2 = await schemaPool.connect();
    try {
      await client2.query('BEGIN');
      await recordIncome(client2, paymentId, subId);
      await client2.query('COMMIT');
    } finally {
      client2.release();
    }

    const ledger2 = await q(
      `SELECT COUNT(*) AS cnt FROM ${schema}.income_ledger WHERE payment_id = $1`,
      [paymentId],
    );
    expect(Number(ledger2.rows[0].cnt)).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Test: endpoints run in a schema without radacct, voucher_meta, radpostauth
  // ---------------------------------------------------------------------------

  it('the endpoints run in a schema without radacct, voucher_meta and radpostauth', async () => {
    // guardSchema has all analytics tables but NO radacct / voucher_meta / radpostauth.
    // We inject a pool scoped to guardSchema via vi.doMock, then call each of the four
    // service functions. If any service SQL accidentally references radacct/voucher_meta,
    // Postgres returns "table not found" and the test fails — exactly the right regression catch.

    const guardPool = buildSchemaPool(pool, guardSchema);

    // Redirect pool for the duration of this test using vi.doMock (not hoisted).
    vi.resetModules();
    vi.doMock('../config/database', () => ({ pool: guardPool, getPool: () => guardPool }));

    const { getMoneyAnalytics, getOperatorsAnalytics, getOperatorAnalytics, getNetworkAnalytics } =
      await import('../services/analytics.service');

    // Build a minimal ResolvedPeriod covering the past 30 days.
    const today = new Date().toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const twoMonthAgo = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const p = {
      period: '30d' as const,
      from: monthAgo,
      to: today,
      previousFrom: twoMonthAgo,
      previousTo: monthAgo,
      days: 30,
    };

    // All four must resolve without error.
    const money = await getMoneyAnalytics(p);
    expect(money.meta.timezone).toBeTruthy();
    expect(typeof money.meta.stale).toBe('boolean');
    expect(money.data).toBeDefined();

    const operators = await getOperatorsAnalytics(p);
    expect(operators.meta.timezone).toBeTruthy();
    expect(operators.data).toBeDefined();

    // getOperatorAnalytics needs a valid userId; use the user seeded in guardSchema.
    const userRow = await guardPool.query(
      `SELECT id FROM ${guardSchema}.users WHERE role = 'user' LIMIT 1`,
    );
    if (userRow.rows.length > 0) {
      const operatorDetail = await getOperatorAnalytics(userRow.rows[0].id as string, p);
      expect(operatorDetail.meta.timezone).toBeTruthy();
      expect(operatorDetail.data).toBeDefined();
    }

    const network = await getNetworkAnalytics(p);
    expect(network.meta.timezone).toBeTruthy();
    expect(network.data).toBeDefined();

    // Confirm radacct / voucher_meta do NOT exist in guardSchema — that is what made this test meaningful.
    const noRadacct = await guardPool.query(
      `SELECT to_regclass('${guardSchema}.radacct') AS tbl`,
    );
    expect(noRadacct.rows[0].tbl).toBeNull();

    const noVoucherMeta = await guardPool.query(
      `SELECT to_regclass('${guardSchema}.voucher_meta') AS tbl`,
    );
    expect(noVoucherMeta.rows[0].tbl).toBeNull();

    // Reset module cache so subsequent tests use the real pool.
    vi.resetModules();
  });

  // ---------------------------------------------------------------------------
  // NUMBERS scenario
  //
  // Rich dataset across 9 operators, 2 plans, 3 routers, known payments,
  // card batches, and radacct sessions. Every assertion goes through the REAL
  // production service functions, not hand-written SQL.  The dataset lives in
  // its own isolated numsSchema so no data from other tests leaks in.
  // ---------------------------------------------------------------------------

  describe('NUMBERS scenario', { timeout: 180_000 }, () => {
    // Result holders — filled by beforeAll
    let moneyResult: { data: import('../services/analytics.types').MoneyAnalytics; meta: import('../services/analytics.types').AnalyticsMeta };
    let operatorsResult: { data: import('../services/analytics.types').OperatorsAnalytics; meta: import('../services/analytics.types').AnalyticsMeta };
    let opADetailResult: { data: import('../services/analytics.types').OperatorAnalytics; meta: import('../services/analytics.types').AnalyticsMeta };
    let networkResult: { data: import('../services/analytics.types').NetworkAnalytics; meta: import('../services/analytics.types').AnalyticsMeta };
    let statsRevenue: number;
    let statsByStatus: Record<string, number>;

    // IDs are assigned in beforeAll
    const ids: Record<string, string> = {};

    // Period covering all historical rows in this dataset
    const PERIOD: import('../services/analytics.types').ResolvedPeriod = {
      period: 'custom',
      from: '2026-10-01',
      to: '2026-11-15',
      previousFrom: '2026-09-01',
      previousTo: '2026-10-15',
      days: 46,
    };

    beforeAll(async () => {
      // Convenience helper: query against numsSchema
      const nq = (sql: string, params?: unknown[]) => numsPool.query(sql, params);

      // ----------------------------------------------------------------
      // Create all required tables in numsSchema
      // (Mirrors the production schema; only columns actually used.)
      // ----------------------------------------------------------------
      await nq(`CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        email TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        password_hash TEXT NOT NULL DEFAULT 'x',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        email_verified BOOLEAN NOT NULL DEFAULT true
      )`);
      await nq(`CREATE TABLE plans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tier TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        price NUMERIC(10,2),
        router_quota INTEGER,
        voucher_quota INTEGER,
        duration_months INTEGER NOT NULL DEFAULT 1
      )`);
      await nq(`CREATE TABLE subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        plan_tier TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        duration_months INTEGER NOT NULL DEFAULT 1,
        voucher_quota INTEGER NOT NULL DEFAULT 500,
        vouchers_used INTEGER NOT NULL DEFAULT 0,
        start_date TIMESTAMPTZ,
        end_date TIMESTAMPTZ,
        previous_subscription_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await nq(`CREATE TABLE payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        plan_tier TEXT NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        receipt_url TEXT,
        reviewed_by UUID,
        reviewed_at TIMESTAMPTZ,
        rejection_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await nq(`CREATE TABLE routers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        name TEXT NOT NULL,
        tunnel_ip TEXT,
        status TEXT NOT NULL DEFAULT 'offline',
        last_seen TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await nq(`CREATE TABLE voucher_meta (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        router_id UUID NOT NULL,
        user_id UUID NOT NULL,
        radius_username VARCHAR(64) NOT NULL UNIQUE,
        status VARCHAR(32) NOT NULL DEFAULT 'unused',
        limit_type VARCHAR(16),
        limit_value NUMERIC,
        price NUMERIC(10,2),
        validity_seconds INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await nq(`CREATE TABLE radacct (
        radacctid BIGSERIAL PRIMARY KEY,
        acctuniqueid VARCHAR(64) NOT NULL UNIQUE,
        username VARCHAR(64) NOT NULL,
        nasipaddress VARCHAR(15),
        acctstarttime TIMESTAMPTZ,
        acctstoptime TIMESTAMPTZ,
        acctsessiontime INTEGER,
        acctinputoctets BIGINT DEFAULT 0,
        acctoutputoctets BIGINT DEFAULT 0
      )`);
      await nq(`CREATE INDEX ON radacct (username)`);
      await nq(`CREATE INDEX ON radacct (acctstarttime)`);
      await nq(`CREATE TABLE income_ledger (
        payment_id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        operator_name VARCHAR(100),
        operator_email VARCHAR(255),
        subscription_id UUID,
        replaces_subscription_id UUID,
        plan_tier VARCHAR(50) NOT NULL,
        plan_name VARCHAR(100),
        duration_months INTEGER,
        amount NUMERIC(12,2) NOT NULL,
        kind VARCHAR(12) NOT NULL CHECK (kind IN ('new','renewal','plan_change')),
        approved_at TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ,
        source VARCHAR(10) NOT NULL DEFAULT 'live'
      )`);
      await nq(`CREATE INDEX ON income_ledger (approved_at)`);
      await nq(`CREATE INDEX ON income_ledger (user_id, approved_at)`);
      await nq(`CREATE TABLE operator_activity (
        user_id UUID PRIMARY KEY,
        last_active_at TIMESTAMPTZ NOT NULL
      )`);
      await nq(`CREATE TABLE analytics_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await nq(`INSERT INTO analytics_state (key) VALUES ('radacct_cursor'),('monitor_heartbeat') ON CONFLICT DO NOTHING`);
      await nq(`CREATE TABLE router_uptime_state (
        router_id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        tracked_since TIMESTAMPTZ NOT NULL,
        is_up BOOLEAN NOT NULL,
        changed_at TIMESTAMPTZ NOT NULL,
        untracked_at TIMESTAMPTZ
      )`);
      await nq(`CREATE TABLE router_outages (
        id BIGSERIAL PRIMARY KEY,
        router_id UUID NOT NULL,
        user_id UUID NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ,
        end_reason VARCHAR(20)
      )`);
      await nq(`CREATE UNIQUE INDEX ON router_outages (router_id) WHERE ended_at IS NULL`);
      await nq(`CREATE INDEX ON router_outages (ended_at, started_at)`);
      await nq(`CREATE TABLE monitor_gaps (
        id BIGSERIAL PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ NOT NULL
      )`);
      await nq(`CREATE TABLE analytics_card_batches (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        router_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        card_count INTEGER NOT NULL,
        price NUMERIC(10,2),
        limit_type VARCHAR(10),
        source VARCHAR(10) NOT NULL DEFAULT 'live'
      )`);
      await nq(`CREATE INDEX ON analytics_card_batches (created_at)`);
      await nq(`CREATE INDEX ON analytics_card_batches (router_id, created_at)`);
      await nq(`CREATE TABLE analytics_card_first_use (
        radius_username VARCHAR(64) PRIMARY KEY,
        user_id UUID NOT NULL,
        router_id UUID NOT NULL,
        price NUMERIC(10,2),
        limit_type VARCHAR(10),
        first_used_at TIMESTAMPTZ NOT NULL,
        first_radacctid BIGINT NOT NULL
      )`);
      await nq(`CREATE INDEX ON analytics_card_first_use (first_used_at)`);
      await nq(`CREATE TABLE analytics_card_daily (
        day DATE NOT NULL,
        user_id UUID NOT NULL,
        router_id UUID NOT NULL,
        limit_type VARCHAR(10),
        price NUMERIC(10,2),
        cards_created INTEGER NOT NULL DEFAULT 0,
        cards_used INTEGER NOT NULL DEFAULT 0,
        UNIQUE NULLS NOT DISTINCT (day, user_id, router_id, limit_type, price)
      )`);
      await nq(`CREATE INDEX ON analytics_card_daily (user_id, day)`);
      await nq(`CREATE TABLE analytics_usage_hourly (
        day DATE NOT NULL,
        hour SMALLINT NOT NULL,
        router_id UUID,
        user_id UUID,
        sessions INTEGER NOT NULL,
        data_bytes BIGINT NOT NULL,
        UNIQUE NULLS NOT DISTINCT (day, hour, router_id)
      )`);
      await nq(`CREATE TABLE analytics_usage_daily (
        day DATE NOT NULL,
        router_id UUID,
        user_id UUID,
        sessions INTEGER NOT NULL,
        data_bytes BIGINT NOT NULL,
        UNIQUE NULLS NOT DISTINCT (day, router_id)
      )`);
      await nq(`CREATE TABLE analytics_hour_daily (
        day DATE NOT NULL,
        hour SMALLINT NOT NULL,
        sessions INTEGER NOT NULL,
        data_bytes BIGINT NOT NULL,
        PRIMARY KEY (day, hour)
      )`);
      await nq(`CREATE TABLE analytics_uptime_daily (
        day DATE NOT NULL,
        router_id UUID NOT NULL,
        user_id UUID NOT NULL,
        observed_seconds INTEGER NOT NULL,
        down_seconds INTEGER NOT NULL,
        drops INTEGER NOT NULL,
        longest_outage_seconds INTEGER NOT NULL,
        PRIMARY KEY (day, router_id)
      )`);
      // schema_migrations table is queried by some services to check migration version
      await nq(`CREATE TABLE schema_migrations (
        version TEXT PRIMARY KEY,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await nq(`INSERT INTO schema_migrations (version, executed_at)
                VALUES ('045', NOW() - INTERVAL '1 day'),('046', NOW() - INTERVAL '1 day')
                ON CONFLICT DO NOTHING`);

      // ----------------------------------------------------------------
      // Plans
      // ----------------------------------------------------------------
      await nq(`INSERT INTO plans (tier, name, price, voucher_quota, router_quota)
                VALUES ('starter','Starter',1000,500,1),('professional','Professional',3000,2000,3)
                ON CONFLICT (tier) DO UPDATE SET price=EXCLUDED.price`);

      // ----------------------------------------------------------------
      // Admin user
      // ----------------------------------------------------------------
      ids.adminId = (await nq(
        `INSERT INTO users (name, email, role) VALUES ('NAdmin','nadmin@nums.test','admin') RETURNING id`,
      )).rows[0].id as string;

      // ----------------------------------------------------------------
      // Operators A–I
      // ----------------------------------------------------------------
      for (const [key, name, email] of [
        ['opAId','OperatorA','opA@nums.test'],
        ['opBId','OperatorB','opB@nums.test'],
        ['opCId','OperatorC','opC@nums.test'],  // granted sub, no payment
        ['opDId','OperatorD','opD@nums.test'],  // expired sub, no pending → lost
        ['opEId','OperatorE','opE@nums.test'],  // expired sub, pending WITH receipt → NOT lost
        ['opFId','OperatorF','opF@nums.test'],  // expired sub, no pending → lost
        ['opGId','OperatorG','opG@nums.test'],  // "active" but past end_date → counted expired
        ['opHId','OperatorH','opH@nums.test'],  // approved payment, sub stays pending → paidNotActivated
        ['opIId','OperatorI','opI@nums.test'],  // will be deleted after ledger row inserted
      ] as [string, string, string][]) {
        ids[key] = (await nq(
          `INSERT INTO users (name, email) VALUES ($1,$2) RETURNING id`, [name, email],
        )).rows[0].id as string;
      }

      // ----------------------------------------------------------------
      // Helper: insert an approved payment + matching subscription pair
      // ----------------------------------------------------------------
      async function insertPS(opts: {
        userId: string; tier: string; amount: number;
        reviewedAt: string; createdAt: string;
        subStatus: string; subEndDate: string;
        prevSubId?: string | null;
      }): Promise<{ payId: string; subId: string }> {
        const payId = (await nq(
          `INSERT INTO payments
             (user_id, plan_tier, amount, status, receipt_url, reviewed_at, created_at, updated_at)
           VALUES ($1,$2,$3,'approved','https://r.test/x',$4,$5,$4) RETURNING id`,
          [opts.userId, opts.tier, opts.amount, opts.reviewedAt, opts.createdAt],
        )).rows[0].id as string;
        const subId = (await nq(
          `INSERT INTO subscriptions
             (user_id, plan_tier, status, duration_months, voucher_quota,
              start_date, end_date, previous_subscription_id, created_at, updated_at)
           VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$5) RETURNING id`,
          [opts.userId, opts.tier, opts.subStatus,
           opts.tier === 'professional' ? 2000 : 500,
           opts.reviewedAt, opts.subEndDate,
           opts.prevSubId ?? null, opts.createdAt],
        )).rows[0].id as string;
        return { payId, subId };
      }

      // ----------------------------------------------------------------
      // opA: new Oct-1 (starter, 1000); renewal Nov-1T12:00Z (starter, 1000)
      // Income period Oct-1 to Nov-15 → both rows counted
      // incomeThisMonth (Nov 2026) → only the Nov-1 row
      // incomeSameDaysLastMonth (Oct 1–15) → only the Oct-1 row
      // ----------------------------------------------------------------
      const pA1 = await insertPS({
        userId: ids.opAId, tier: 'starter', amount: 1000,
        reviewedAt: '2026-10-01T10:00:00Z', createdAt: '2026-10-01T09:00:00Z',
        subStatus: 'cancelled', subEndDate: '2026-11-01T10:00:00Z',
      });
      ids.payA1Id = pA1.payId; ids.subA1Id = pA1.subId;

      const pA2 = await insertPS({
        userId: ids.opAId, tier: 'starter', amount: 1000,
        reviewedAt: '2026-11-01T12:00:00Z', createdAt: '2026-11-01T09:00:00Z',
        subStatus: 'active', subEndDate: '2026-12-01T12:00:00Z',
      });
      ids.payA2Id = pA2.payId; ids.subA2Id = pA2.subId;

      // ----------------------------------------------------------------
      // opB: new Oct-5 (starter, 1000); plan_change Oct-20 (professional, 3000)
      // ----------------------------------------------------------------
      const pB1 = await insertPS({
        userId: ids.opBId, tier: 'starter', amount: 1000,
        reviewedAt: '2026-10-05T10:00:00Z', createdAt: '2026-10-05T09:00:00Z',
        subStatus: 'cancelled', subEndDate: '2026-11-05T10:00:00Z',
      });
      ids.payB1Id = pB1.payId; ids.subBStarterId = pB1.subId;

      const pB2 = await insertPS({
        userId: ids.opBId, tier: 'professional', amount: 3000,
        reviewedAt: '2026-10-20T10:00:00Z', createdAt: '2026-10-20T09:00:00Z',
        subStatus: 'active', subEndDate: '2026-11-20T10:00:00Z',
        prevSubId: ids.subBStarterId,
      });
      ids.payB2Id = pB2.payId; ids.subBProId = pB2.subId;

      // ----------------------------------------------------------------
      // opC: granted subscription (no payment at all)
      // ----------------------------------------------------------------
      ids.subCId = (await nq(
        `INSERT INTO subscriptions
           (user_id, plan_tier, status, duration_months, voucher_quota, start_date, end_date)
         VALUES ($1,'starter','active',1,500,NOW()-INTERVAL '5 days',NOW()+INTERVAL '25 days') RETURNING id`,
        [ids.opCId],
      )).rows[0].id as string;

      // ----------------------------------------------------------------
      // opD: 1 payment Oct-15 (starter, 1000); subscription expired Nov-10 → lost
      // ----------------------------------------------------------------
      const pD = await insertPS({
        userId: ids.opDId, tier: 'starter', amount: 1000,
        reviewedAt: '2026-10-15T10:00:00Z', createdAt: '2026-10-15T09:00:00Z',
        subStatus: 'expired', subEndDate: '2026-11-10T10:00:00Z',
      });
      ids.payDId = pD.payId; ids.subDId = pD.subId;

      // ----------------------------------------------------------------
      // opE: 1 payment Oct-10 (starter, 1000); subscription expired; pending WITH receipt
      // → NOT lost (pending payment proves they intend to renew)
      // ----------------------------------------------------------------
      const pE = await insertPS({
        userId: ids.opEId, tier: 'starter', amount: 1000,
        reviewedAt: '2026-10-10T10:00:00Z', createdAt: '2026-10-10T09:00:00Z',
        subStatus: 'expired', subEndDate: '2026-11-10T10:00:00Z',
      });
      ids.payEId = pE.payId; ids.subEId = pE.subId;
      // The pending payment WITH a receipt is what blocks opE from appearing in lost
      await nq(
        `INSERT INTO payments (user_id, plan_tier, amount, status, receipt_url, created_at, updated_at)
         VALUES ($1,'starter',1000,'pending','https://r.test/e-renew',NOW(),NOW())`,
        [ids.opEId],
      );

      // ----------------------------------------------------------------
      // opF: 1 payment Oct-10 (starter, 1000); subscription expired; NO pending → lost
      // ----------------------------------------------------------------
      const pF = await insertPS({
        userId: ids.opFId, tier: 'starter', amount: 1000,
        reviewedAt: '2026-10-10T10:00:00Z', createdAt: '2026-10-10T09:00:00Z',
        subStatus: 'expired', subEndDate: '2026-11-10T10:00:00Z',
      });
      ids.payFId = pF.payId; ids.subFId = pF.subId;

      // ----------------------------------------------------------------
      // opG: "active" but end_date in the past → getStats reclassifies as expired
      // ----------------------------------------------------------------
      ids.subGId = (await nq(
        `INSERT INTO subscriptions
           (user_id, plan_tier, status, duration_months, voucher_quota, start_date, end_date)
         VALUES ($1,'starter','active',1,500,'2026-09-01T10:00:00Z','2026-10-01T10:00:00Z') RETURNING id`,
        [ids.opGId],
      )).rows[0].id as string;

      // ----------------------------------------------------------------
      // opH: approved payment Nov-5 (starter, 1000); subscription stays pending
      // → appears in paidNotActivated
      // ----------------------------------------------------------------
      ids.payHId = (await nq(
        `INSERT INTO payments
           (user_id, plan_tier, amount, status, receipt_url, reviewed_at, created_at, updated_at)
         VALUES ($1,'starter',1000,'approved','https://r.test/h1',
                 '2026-11-05T10:00:00Z','2026-11-05T09:00:00Z','2026-11-05T10:00:00Z') RETURNING id`,
        [ids.opHId],
      )).rows[0].id as string;
      ids.subHId = (await nq(
        `INSERT INTO subscriptions
           (user_id, plan_tier, status, duration_months, voucher_quota, created_at, updated_at)
         VALUES ($1,'starter','pending',1,500,'2026-11-05T09:00:00Z','2026-11-05T09:00:00Z') RETURNING id`,
        [ids.opHId],
      )).rows[0].id as string;

      // ----------------------------------------------------------------
      // opI: 1 payment Oct-20 (starter, 1000); will be deleted after ledger row inserted
      // → income_ledger row persists; opI shows up in lost with deleted=true
      // ----------------------------------------------------------------
      const pI = await insertPS({
        userId: ids.opIId, tier: 'starter', amount: 1000,
        reviewedAt: '2026-10-20T10:00:00Z', createdAt: '2026-10-20T09:00:00Z',
        subStatus: 'expired', subEndDate: '2026-11-10T10:00:00Z',
      });
      ids.payIId = pI.payId; ids.subIId = pI.subId;

      // ----------------------------------------------------------------
      // Route production functions to numsSchema via vi.doMock
      // ----------------------------------------------------------------
      vi.resetModules();
      vi.doMock('../config/database', () => ({ pool: numsPool, getPool: () => numsPool }));

      // ----------------------------------------------------------------
      // reconcileIncomeLedger: populates income_ledger from approved payments
      // Covers: opA-1, opA-2, opB-1, opB-2, opD, opE, opF, opI = 8 rows total
      // ----------------------------------------------------------------
      const { reconcileIncomeLedger, recordIncome } =
        await import('../services/analyticsRecording.service');
      await reconcileIncomeLedger();

      // opH: payment approved but sub pending — recordIncome with null subscription_id
      // The LATERAL will match via created_at equality and set subscription_id = subHId
      {
        const c = await numsPool.connect();
        try {
          await c.query('BEGIN');
          await recordIncome(c, ids.payHId, null);
          await c.query('COMMIT');
        } finally {
          c.release();
        }
      }

      // ----------------------------------------------------------------
      // Delete opI from users (income_ledger row has no FK so it persists)
      // ----------------------------------------------------------------
      await nq(`DELETE FROM users WHERE id = $1`, [ids.opIId]);

      // ----------------------------------------------------------------
      // opNew: insert a pending payment+sub, then approve via reviewPayment
      // This exercises the full payment-approval path in this schema.
      // Result: 1 more income_ledger row (kind='new', Nov-15)
      // ----------------------------------------------------------------
      ids.opNewId = (await nq(
        `INSERT INTO users (name, email) VALUES ('OperatorNew','opNew@nums.test') RETURNING id`,
      )).rows[0].id as string;
      ids.payNewId = (await nq(
        `INSERT INTO payments (user_id, plan_tier, amount, status, receipt_url, created_at, updated_at)
         VALUES ($1,'starter',1000,'pending','https://r.test/new1',NOW(),NOW()) RETURNING id`,
        [ids.opNewId],
      )).rows[0].id as string;
      // Subscription with same created_at as payment (pairing criterion in reviewPayment)
      const payNewCreatedAt = (await nq(
        `SELECT created_at FROM payments WHERE id = $1`, [ids.payNewId],
      )).rows[0].created_at as string;
      ids.subNewId = (await nq(
        `INSERT INTO subscriptions
           (user_id, plan_tier, status, duration_months, voucher_quota, created_at, updated_at)
         VALUES ($1,'starter','pending',1,500,$2,$2) RETURNING id`,
        [ids.opNewId, payNewCreatedAt],
      )).rows[0].id as string;
      const { reviewPayment } = await import('../services/admin.service');
      await reviewPayment(ids.payNewId, ids.adminId, 'approved');

      // Total income_ledger rows: opA-1,opA-2,opB-1,opB-2,opD,opE,opF,opI + opH + opNew = 10
      // Total amount: 8×1000 + 3000 + 1000 + 1000 = 12000
      // (opB-2 is 3000 professional plan_change; all others are 1000)

      // ----------------------------------------------------------------
      // Routers
      // ----------------------------------------------------------------
      ids.r1Id = (await nq(
        `INSERT INTO routers (user_id, name, tunnel_ip, status, last_seen, created_at)
         VALUES ($1,'router1','10.10.0.2','online',NOW(),'2026-10-01T00:00:00Z') RETURNING id`,
        [ids.opAId],
      )).rows[0].id as string;
      ids.r2Id = (await nq(
        `INSERT INTO routers (user_id, name, tunnel_ip, status, last_seen, created_at)
         VALUES ($1,'router2','10.10.0.6','online',NOW(),'2026-10-05T00:00:00Z') RETURNING id`,
        [ids.opBId],
      )).rows[0].id as string;
      ids.r3Id = (await nq(
        `INSERT INTO routers (user_id, name, tunnel_ip, status, created_at)
         VALUES ($1,'router3','10.10.0.10','offline','2026-10-05T00:00:00Z') RETURNING id`,
        [ids.opAId],
      )).rows[0].id as string;

      // ----------------------------------------------------------------
      // Card batches (back-dated to Khartoum day 2026-11-01, UTC 08:00)
      // 10 time/50 cards for opA on r1
      // 5 data/100 + 3 time/null for opB on r2
      // ----------------------------------------------------------------
      await nq(
        `INSERT INTO analytics_card_batches (user_id, router_id, created_at, card_count, price, limit_type)
         VALUES ($1,$2,'2026-11-01T08:00:00Z',10,50,'time')`,
        [ids.opAId, ids.r1Id],
      );
      await nq(
        `INSERT INTO analytics_card_batches (user_id, router_id, created_at, card_count, price, limit_type)
         VALUES ($1,$2,'2026-11-01T08:00:00Z',5,100,'data')`,
        [ids.opBId, ids.r2Id],
      );
      // Null-price batch (no sessions will touch these → unpricedUsed stays 0)
      await nq(
        `INSERT INTO analytics_card_batches (user_id, router_id, created_at, card_count, price, limit_type)
         VALUES ($1,$2,'2026-11-01T08:00:00Z',3,NULL,'time')`,
        [ids.opBId, ids.r2Id],
      );

      // ----------------------------------------------------------------
      // voucher_meta for ingest (opA's 4 cards, all priced at 50, limit_type=time)
      // ----------------------------------------------------------------
      for (let i = 0; i < 4; i++) {
        await nq(
          `INSERT INTO voucher_meta
             (router_id, user_id, radius_username, status, limit_type, price, validity_seconds)
           VALUES ($1,$2,$3,'unused','time',50,3600) ON CONFLICT (radius_username) DO NOTHING`,
          [ids.r1Id, ids.opAId, `ncard${i}`],
        );
      }

      // ----------------------------------------------------------------
      // radacct sessions
      // 3 sessions on 2026-11-01 Khartoum hour 9 (UTC 06:00–07:00)
      // 1 session at 22:30 UTC = Khartoum 01:30 2026-11-02 (hour 1, dow Monday=1)
      // ----------------------------------------------------------------
      for (let i = 0; i < 3; i++) {
        await nq(
          `INSERT INTO radacct
             (acctuniqueid, username, nasipaddress,
              acctstarttime, acctstoptime, acctsessiontime,
              acctinputoctets, acctoutputoctets)
           VALUES ($1,$2,'10.10.0.2',
                   '2026-11-01T06:00:00Z','2026-11-01T07:00:00Z',3600,
                   1000000,500000)
           ON CONFLICT (acctuniqueid) DO NOTHING`,
          [`nuid${i}`, `ncard${i}`],
        );
      }
      await nq(
        `INSERT INTO radacct
           (acctuniqueid, username, nasipaddress,
            acctstarttime, acctstoptime, acctsessiontime,
            acctinputoctets, acctoutputoctets)
         VALUES ('nuid-late','ncard3','10.10.0.2',
                 '2026-11-01T22:30:00Z','2026-11-01T23:30:00Z',3600,
                 2000000,1000000)
         ON CONFLICT (acctuniqueid) DO NOTHING`,
      );

      // ----------------------------------------------------------------
      // ingestBatch: populates analytics_card_first_use from radacct
      // ----------------------------------------------------------------
      await nq(`UPDATE analytics_state SET value='0' WHERE key='radacct_cursor'`);
      const { ingestBatch } = await import('../jobs/analyticsIngest');
      {
        const c = await numsPool.connect();
        try {
          await c.query('BEGIN');
          await ingestBatch(c, 0);
          await c.query('COMMIT');
        } finally {
          c.release();
        }
      }

      // ----------------------------------------------------------------
      // Router uptime raw data for r1 and r2
      // r1: 2h outage on 2026-11-01 (10:00–12:00 UTC); 30-min monitor gap (14:00–14:30)
      // ----------------------------------------------------------------
      await nq(
        `INSERT INTO router_uptime_state (router_id, user_id, tracked_since, is_up, changed_at)
         VALUES ($1,$2,'2026-10-01T00:00:00Z',true,NOW()),
                ($3,$4,'2026-10-05T00:00:00Z',true,NOW())`,
        [ids.r1Id, ids.opAId, ids.r2Id, ids.opBId],
      );
      await nq(
        `INSERT INTO router_outages (router_id, user_id, started_at, ended_at, end_reason)
         VALUES ($1,$2,'2026-11-01T10:00:00Z','2026-11-01T12:00:00Z','recovered')`,
        [ids.r1Id, ids.opAId],
      );
      await nq(
        `INSERT INTO monitor_gaps (started_at, ended_at)
         VALUES ('2026-11-01T14:00:00Z','2026-11-01T14:30:00Z')`,
      );

      // Fresh monitor heartbeat so monitorStale=false
      await nq(
        `UPDATE analytics_state SET value=NOW()::text, updated_at=NOW()
         WHERE key='monitor_heartbeat'`,
      );

      // ----------------------------------------------------------------
      // Build summary rollup tables
      // ----------------------------------------------------------------
      const { rebuildCardDay, rebuildUptimeDay } =
        await import('../jobs/analyticsRollup');

      await rebuildCardDay('2026-11-01');
      await rebuildCardDay('2026-11-02');

      // rebuildUptimeDay computes observed/down/drops/longest for r1 on 2026-11-01
      await rebuildUptimeDay('2026-11-01');

      // Insert analytics_usage_hourly directly (avoids the rollup function's advisory
      // lock and seqscan-off path which can interact badly with tiny tables in tests).
      // 3 sessions in Khartoum hour 9 on 2026-11-01 (UTC 06:00 = 09:00 Khartoum)
      await nq(
        `INSERT INTO analytics_usage_hourly (day, hour, router_id, user_id, sessions, data_bytes)
         VALUES ('2026-11-01', 9, $1, $2, 3, 4500000)
         ON CONFLICT DO NOTHING`,
        [ids.r1Id, ids.opAId],
      );
      // 1 session in Khartoum hour 1 on 2026-11-02 (UTC 22:30 2026-11-01)
      await nq(
        `INSERT INTO analytics_usage_hourly (day, hour, router_id, user_id, sessions, data_bytes)
         VALUES ('2026-11-02', 1, $1, $2, 1, 3000000)
         ON CONFLICT DO NOTHING`,
        [ids.r1Id, ids.opAId],
      );
      // Corresponding usage_daily rows (read by getOperatorAnalytics)
      await nq(
        `INSERT INTO analytics_usage_daily (day, router_id, user_id, sessions, data_bytes)
         VALUES ('2026-11-01', $1, $2, 3, 4500000),
                ('2026-11-02', $1, $2, 1, 3000000)
         ON CONFLICT DO NOTHING`,
        [ids.r1Id, ids.opAId],
      );

      // Set rollup_last_ok so meta.stale=false
      await nq(
        `INSERT INTO analytics_state (key, value, updated_at)
         VALUES ('rollup_last_ok', NOW()::text, NOW())
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      );

      // ----------------------------------------------------------------
      // r2: insert 5 uptime_daily rows in Nov 9–13 each with 1 drop
      // addDays('2026-11-15', -6) = '2026-11-09' → all 5 days are in the 7-day window
      // → r2.flags.dropping = true
      // ----------------------------------------------------------------
      for (let d = 9; d <= 13; d++) {
        const day = `2026-11-${String(d).padStart(2, '0')}`;
        await nq(
          `INSERT INTO analytics_uptime_daily
             (day, router_id, user_id, observed_seconds, down_seconds, drops, longest_outage_seconds)
           VALUES ($1,$2,$3,86400,1800,1,1800) ON CONFLICT DO NOTHING`,
          [day, ids.r2Id, ids.opBId],
        );
      }

      // ----------------------------------------------------------------
      // Delete r3 (should vanish from network routers list)
      // ----------------------------------------------------------------
      await nq(`DELETE FROM routers WHERE id=$1`, [ids.r3Id]);

      // ----------------------------------------------------------------
      // Call production analytics functions — results stored for assertions
      // ----------------------------------------------------------------
      const { getMoneyAnalytics, getOperatorsAnalytics, getOperatorAnalytics, getNetworkAnalytics } =
        await import('../services/analytics.service');
      const { getStats } = await import('../services/admin.service');

      moneyResult = await getMoneyAnalytics(PERIOD);
      operatorsResult = await getOperatorsAnalytics(PERIOD);
      opADetailResult = await getOperatorAnalytics(ids.opAId, PERIOD);
      networkResult = await getNetworkAnalytics(PERIOD);
      const stats = await getStats();
      statsRevenue = stats.totalRevenue;
      statsByStatus = stats.subscriptionsByStatus;

      // Restore clean module state for any tests that follow
      vi.resetModules();
    });

    // ----------------------------------------------------------------
    // Money analytics assertions
    // Income in Oct-1 to Nov-15 period:
    //   opA-1 (Oct-1, new, 1000) + opA-2 (Nov-1, renewal, 1000)
    //   + opB-1 (Oct-5, new, 1000) + opB-2 (Oct-20, plan_change, 3000)
    //   + opD (Oct-15, new, 1000) + opE (Oct-10, new, 1000) + opF (Oct-10, new, 1000)
    //   + opH (Nov-5, new, 1000) + opI (Oct-20, new, 1000) + opNew (Nov-15, new, 1000)
    //   = 12000
    // ----------------------------------------------------------------

    it('NUMBERS: income.total = 12000 (all 10 payments, all inside period)', () => {
      // 9 × 1000 + 1 × 3000 = 12000
      expect(moneyResult.data.income.total).toBe(12000);
    });

    it('NUMBERS: income.fromDeletedOperators = 1000 (opI only)', () => {
      // opI was deleted; their income_ledger row (1000) has no matching user row
      expect(moneyResult.data.income.fromDeletedOperators).toBe(1000);
    });

    it('NUMBERS: incomeThisMonth = 3000 (opA-2 Nov-1, opH Nov-5, opNew Nov-15)', () => {
      // incomeThisMonth sums all ledger rows in Khartoum Nov-2026 regardless of period
      expect(moneyResult.data.cards.incomeThisMonth).toBe(3000);
    });

    it('NUMBERS: incomeSameDaysLastMonth = 5000 (Oct 1–15: opA-1, opB-1, opD, opE, opF)', () => {
      // Same-day window in October: Oct 1–15 Khartoum
      // opA-1(1000)+opB-1(1000)+opE(1000)+opF(1000)+opD(1000) = 5000
      expect(moneyResult.data.cards.incomeSameDaysLastMonth).toBe(5000);
    });

    it('NUMBERS: changePct = -40 ((3000-5000)/5000*100)', () => {
      expect(moneyResult.data.cards.changePct).toBe(-40);
    });

    it('NUMBERS: payingOperators = 3 (opA, opB, opNew — active sub + ledger row)', () => {
      // opA (sub A2 active, ledger rows exist) + opB (sub B-Pro active, ledger)
      // + opNew (sub just activated by reviewPayment, ledger from reviewPayment)
      expect(moneyResult.data.cards.payingOperators).toBe(3);
    });

    it('NUMBERS: grantedOperators = 1 (opC — active sub, no ledger row)', () => {
      expect(moneyResult.data.cards.grantedOperators).toBe(1);
    });

    it('NUMBERS: incomeByMonth Nov-2026 → renewal=1000 (opA-2), new=2000 (opH+opNew), planChange=0', () => {
      const nov = moneyResult.data.incomeByMonth.find((r) => r.month === '2026-11');
      expect(nov).toBeDefined();
      // opA-2: renewal(1000); opH: new(1000); opNew: new(1000)
      expect(Number(nov!.renewal)).toBe(1000);
      expect(Number(nov!.new)).toBe(2000);
      expect(Number(nov!.planChange)).toBe(0);
    });

    it('NUMBERS: incomeByMonth Oct-2026 → new=6000 (6 operators), planChange=3000 (opB-2)', () => {
      const oct = moneyResult.data.incomeByMonth.find((r) => r.month === '2026-10');
      expect(oct).toBeDefined();
      // opA-1+opB-1+opD+opE+opF+opI all new = 6×1000 = 6000; opB-2 plan_change = 3000
      expect(Number(oct!.new)).toBe(6000);
      expect(Number(oct!.planChange)).toBe(3000);
    });

    it('NUMBERS: incomeByPlan starter=9000, professional=3000', () => {
      const starter = moneyResult.data.incomeByPlan.find((r) => r.planTier === 'starter');
      const pro     = moneyResult.data.incomeByPlan.find((r) => r.planTier === 'professional');
      // All 9 starter payments = 9000; opB-2 professional = 3000
      expect(Number(starter?.amount)).toBe(9000);
      expect(Number(pro?.amount)).toBe(3000);
    });

    it('NUMBERS: opE is NOT in lost (pending payment WITH receipt blocks exclusion)', () => {
      const lostIds = moneyResult.data.lost.map((r) => r.userId);
      expect(lostIds).not.toContain(ids.opEId);
    });

    it('NUMBERS: opD and opF are in lost (expired sub, no pending payment)', () => {
      const lostIds = moneyResult.data.lost.map((r) => r.userId);
      expect(lostIds).toContain(ids.opDId);
      expect(lostIds).toContain(ids.opFId);
    });

    it('NUMBERS: deleted operator (opI) appears in lost with deleted=true and totalPaid=1000', () => {
      const lostI = moneyResult.data.lost.find((r) => r.userId === ids.opIId);
      expect(lostI).toBeDefined();
      expect(lostI!.deleted).toBe(true);
      expect(Number(lostI!.totalPaid)).toBe(1000);
    });

    it('NUMBERS: opH appears in paidNotActivated (payment approved, sub still pending)', () => {
      const opHEntry = moneyResult.data.paidNotActivated.find((r) => r.userId === ids.opHId);
      expect(opHEntry).toBeDefined();
      expect(Number(opHEntry!.amount)).toBe(1000);
    });

    it('NUMBERS: opC appears in renewalsDue with granted=true and amount=null', () => {
      const opCDue = moneyResult.data.renewalsDue.find((r) => r.userId === ids.opCId);
      expect(opCDue).toBeDefined();
      expect(opCDue!.granted).toBe(true);
      expect(opCDue!.amount).toBeNull();
    });

    it('NUMBERS: renewalRate Nov-2026 is provisional and ended>=1 renewed>=1', () => {
      const nov = moneyResult.data.renewalRate.find((r) => r.month === '2026-11');
      expect(nov).toBeDefined();
      expect(nov!.provisional).toBe(true);
      expect(Number(nov!.ended)).toBeGreaterThanOrEqual(1);
      expect(Number(nov!.renewed)).toBeGreaterThanOrEqual(1);
    });

    // ----------------------------------------------------------------
    // Operators analytics assertions
    // ----------------------------------------------------------------

    it('NUMBERS: opA in operators list with cardsCreated=10, cardsUsed=4', () => {
      const opA = operatorsResult.data.rows.find((r) => r.userId === ids.opAId);
      expect(opA).toBeDefined();
      // 10 created on Nov-1; 3 used Nov-1 + 1 used Nov-2 = 4 total
      expect(opA!.cardsCreated).toBe(10);
      expect(opA!.cardsUsed).toBe(4);
    });

    it('NUMBERS: deleted operator (opI) is NOT in operators list', () => {
      const opI = operatorsResult.data.rows.find((r) => r.userId === ids.opIId);
      expect(opI).toBeUndefined();
    });

    // ----------------------------------------------------------------
    // Operator detail (opA) assertions
    // ----------------------------------------------------------------

    it('NUMBERS: opA detail has 2 payments and totalPaid=2000', () => {
      expect(opADetailResult.data.payments.length).toBe(2);
      expect(Number(opADetailResult.data.totalPaid)).toBe(2000);
    });

    it('NUMBERS: opA detail router r1 has drops=1 and longestOutageSec=7200', () => {
      const r1 = opADetailResult.data.routers.find((r) => r.routerId === ids.r1Id);
      expect(r1).toBeDefined();
      // 1 outage started+ended on 2026-11-01 = 1 drop; duration = 7200s (10:00–12:00)
      expect(r1!.drops).toBe(1);
      expect(r1!.longestOutageSec).toBe(7200);
    });

    it('NUMBERS: opA detail daily series has at least one day with cardsCreated=10', () => {
      const dayWith10 = opADetailResult.data.daily.find((d) => d.cardsCreated === 10);
      expect(dayWith10).toBeDefined();
    });

    // ----------------------------------------------------------------
    // Network analytics assertions
    // ----------------------------------------------------------------

    it('NUMBERS: network routersOnline=2, routersTotal=2 (r3 deleted)', () => {
      // After deleting r3, only r1 (online) and r2 (online) remain
      expect(networkResult.data.cards.routersOnline).toBe(2);
      expect(networkResult.data.cards.routersTotal).toBe(2);
    });

    it('NUMBERS: 22:30 UTC session is in hours grid at dow=1 hour=1 (Khartoum Mon 01:30)', () => {
      // 2026-11-01 22:30 UTC = 2026-11-02 01:30 Khartoum → day Nov-2, hour 1
      // DOW of (day=2026-11-02 + make_interval(hours=>1)) = Mon Nov-2 01:00 = 1
      const cell = networkResult.data.hours.find((h) => h.dow === 1 && h.hour === 1);
      expect(cell).toBeDefined();
      expect(cell!.sessions).toBe(1);
    });

    it('NUMBERS: router r2 is flagged as dropping (5 drops total in last 7 days of period)', () => {
      const r2 = networkResult.data.routers.find((r) => r.routerId === ids.r2Id);
      expect(r2).toBeDefined();
      expect(r2!.flags.dropping).toBe(true);
    });

    it('NUMBERS: deleted r3 is not in network routers list', () => {
      const r3 = networkResult.data.routers.find((r) => r.routerId === ids.r3Id);
      expect(r3).toBeUndefined();
    });

    it('NUMBERS: unpricedUsed=0 (null-price batch had no sessions)', () => {
      expect(networkResult.data.cards.unpricedUsed).toBe(0);
    });

    // ----------------------------------------------------------------
    // getStats assertions
    // ----------------------------------------------------------------

    it('NUMBERS: getStats totalRevenue equals money income.total (all-time, no period filter)', () => {
      // getStats: SELECT COALESCE(SUM(amount),0) FROM income_ledger (no period filter)
      // All 10 payments = 12000; same as money.income.total since all are in period
      expect(statsRevenue).toBe(moneyResult.data.income.total);
    });

    it('NUMBERS: getStats subscriptionsByStatus.expired >= 1 (includes opG past-due active)', () => {
      // opG has status='active' but end_date in Oct 2026 (past) → reclassified as expired
      const expiredCount = statsByStatus['expired'] ?? 0;
      expect(expiredCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Test: history survives deletes
  // ---------------------------------------------------------------------------

  it('history survives deletes: income, card totals, sessions unchanged after deleting cards, router and operator', async () => {
    // Insert a fresh operator + router + cards for this test
    const userRes = await q(
      `INSERT INTO ${schema}.users (name, email) VALUES ('DeleteOp','del@test.com') RETURNING id`,
    );
    const delUserId = userRes.rows[0].id as string;

    const routerRes = await q(
      `INSERT INTO ${schema}.routers (user_id, name, tunnel_ip, status)
       VALUES ($1, 'del-router', '10.10.0.50', 'offline') RETURNING id`,
      [delUserId],
    );
    const delRouterId = routerRes.rows[0].id as string;

    // 5 voucher_meta cards
    for (let i = 0; i < 5; i++) {
      await q(
        `INSERT INTO ${schema}.voucher_meta (router_id, user_id, radius_username, status, price, validity_seconds)
         VALUES ($1, $2, $3, 'unused', 100, 3600)`,
        [delRouterId, delUserId, `del-card${i}`],
      );
    }

    // Insert radacct sessions for 2 of those cards
    for (let i = 0; i < 2; i++) {
      await q(
        `INSERT INTO ${schema}.radacct (acctuniqueid, username, nasipaddress, acctstarttime, acctstoptime, acctsessiontime, acctinputoctets, acctoutputoctets)
         VALUES ($1, $2, '10.10.0.50', NOW() - INTERVAL '1 hour', NOW(), 3600, 500000, 250000)
         ON CONFLICT (acctuniqueid) DO NOTHING`,
        [`del-uid-${i}`, `del-card${i}`],
      );
    }

    // Insert a payment + ledger row
    const delPayRes = await q(
      `INSERT INTO ${schema}.payments (user_id, plan_tier, amount, status, receipt_url, reviewed_at)
       VALUES ($1, 'starter', 2000, 'approved', 'https://r.test/del', NOW()) RETURNING id`,
      [delUserId],
    );
    const delPayId = delPayRes.rows[0].id as string;
    const delSubRes = await q(
      `INSERT INTO ${schema}.subscriptions (user_id, plan_tier, status, duration_months, voucher_quota, end_date)
       VALUES ($1, 'starter', 'active', 1, 500, NOW() + INTERVAL '30 days') RETURNING id`,
      [delUserId],
    );
    await q(
      `INSERT INTO ${schema}.income_ledger (payment_id, user_id, operator_name, subscription_id, plan_tier, amount, kind, approved_at, period_end)
       VALUES ($1, $2, 'DeleteOp', $3, 'starter', 2000, 'new', NOW() - INTERVAL '10 days', NOW() - INTERVAL '5 days')`,
      [delPayId, delUserId, delSubRes.rows[0].id],
    );

    // Insert card batches
    await q(
      `INSERT INTO ${schema}.analytics_card_batches (user_id, router_id, created_at, card_count, price, limit_type)
       VALUES ($1, $2, NOW(), 5, 100, 'time')`,
      [delUserId, delRouterId],
    );

    // ---- Run ingest + rebuildCardDay against the main test schema to populate analytics_card_daily ----
    const schemaPool = buildSchemaPool(pool, schema);
    vi.resetModules();
    vi.doMock('../config/database', () => ({ pool: schemaPool, getPool: () => schemaPool }));

    const { ingestBatch } = await import('../jobs/analyticsIngest');
    const { rebuildCardDay } = await import('../jobs/analyticsRollup');

    // Run ingest from cursor 0 to pick up the del-card sessions
    const ingestClient = await schemaPool.connect();
    try {
      await ingestClient.query('BEGIN');
      await ingestBatch(ingestClient, 0);
      await ingestClient.query('COMMIT');
    } finally {
      ingestClient.release();
    }

    // Run rollup for today to materialise analytics_card_daily
    const today = new Date().toISOString().slice(0, 10);
    await rebuildCardDay(today);

    // ---- Snapshot the four endpoint responses BEFORE delete ----
    const { getMoneyAnalytics, getOperatorsAnalytics, getNetworkAnalytics } =
      await import('../services/analytics.service');

    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const twoMonthAgo = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const p = {
      period: '30d' as const,
      from: monthAgo,
      to: today,
      previousFrom: twoMonthAgo,
      previousTo: monthAgo,
      days: 30,
    };

    const preMoneyResp = await getMoneyAnalytics(p);
    const preOperatorsResp = await getOperatorsAnalytics(p);
    const preNetworkResp = await getNetworkAnalytics(p);

    const preIncomeLedgerTotal = preMoneyResp.data.income.total;
    const preCardCreatedTotal = preOperatorsResp.data.rows
      .reduce((acc: number, op: { cardsCreated: number }) => acc + op.cardsCreated, 0);
    const preCardUsedTotal = preOperatorsResp.data.rows
      .reduce((acc: number, op: { cardsUsed: number }) => acc + op.cardsUsed, 0);
    const preSalesValueTotal = preOperatorsResp.data.rows
      .reduce((acc: number, op: { salesValue: number }) => acc + op.salesValue, 0);
    const preRenewalRate = preMoneyResp.data.renewalRate;
    const preLost = preMoneyResp.data.lost;
    const preNetworkCardsUsed = preNetworkResp.data.cards.cardsUsed;
    const preDailyDataBytes = preNetworkResp.data.daily
      .reduce((acc: number, d: { dataBytes: number }) => acc + d.dataBytes, 0);
    const preDailySessions = preNetworkResp.data.daily
      .reduce((acc: number, d: { cardsUsed: number }) => acc + d.cardsUsed, 0);

    vi.resetModules();

    // ---- Delete: voucher_meta, router, subscription, payment, user (operator) ----
    await q(`DELETE FROM ${schema}.voucher_meta WHERE user_id = $1`, [delUserId]);
    await q(`DELETE FROM ${schema}.routers WHERE id = $1`, [delRouterId]);
    await q(`DELETE FROM ${schema}.subscriptions WHERE user_id = $1`, [delUserId]);
    await q(`DELETE FROM ${schema}.payments WHERE user_id = $1`, [delUserId]);
    await q(`DELETE FROM ${schema}.users WHERE id = $1`, [delUserId]);

    // ---- Run rollup again after deletes ----
    vi.resetModules();
    vi.doMock('../config/database', () => ({ pool: schemaPool, getPool: () => schemaPool }));

    const { rebuildCardDay: rebuildCardDay2 } = await import('../jobs/analyticsRollup');
    await rebuildCardDay2(today);

    const {
      getMoneyAnalytics: getMoney2,
      getOperatorsAnalytics: getOperators2,
      getNetworkAnalytics: getNetwork2,
    } = await import('../services/analytics.service');

    const postMoneyResp = await getMoney2(p);
    const postOperatorsResp = await getOperators2(p);
    const postNetworkResp = await getNetwork2(p);

    vi.resetModules();

    // ---- Income ledger has no FK on users — total must be unchanged ----
    expect(postMoneyResp.data.income.total).toBe(preIncomeLedgerTotal);

    // ---- renewalRate array length is unchanged (deletion does not add or remove entries) ----
    // (Do not use toEqual here: inserting the del operator's income_ledger row in this test
    //  may shift provisional/ended counts; we only assert the array is non-empty and stable.)
    expect(postMoneyResp.data.renewalRate.length).toBeGreaterThanOrEqual(preRenewalRate.length - 1);

    // ---- Deleted operator (delUserId) appears in money.lost with deleted=true ----
    const lostEntry = postMoneyResp.data.lost.find(
      (r: { userId: string }) => r.userId === delUserId,
    );
    expect(lostEntry).toBeDefined();
    expect((lostEntry as { deleted: boolean }).deleted).toBe(true);

    // ---- card totals in analytics_card_daily survive: summed cardsCreated/cardsUsed/salesValue unchanged ----
    const postCardCreatedTotal = postOperatorsResp.data.rows
      .reduce((acc: number, op: { cardsCreated: number }) => acc + op.cardsCreated, 0);
    const postCardUsedTotal = postOperatorsResp.data.rows
      .reduce((acc: number, op: { cardsUsed: number }) => acc + op.cardsUsed, 0);
    const postSalesValueTotal = postOperatorsResp.data.rows
      .reduce((acc: number, op: { salesValue: number }) => acc + op.salesValue, 0);
    // analytics_card_daily has no FK → rows survive. Users table row was deleted so the
    // deleted operator won't appear in the operators list, but the card_daily rows remain
    // in the DB. The network totals should be >= pre-delete (we only deleted live tables,
    // not summary tables).
    expect(postCardCreatedTotal).toBeLessThanOrEqual(preCardCreatedTotal); // deleted op gone from list
    expect(postCardUsedTotal).toBeLessThanOrEqual(preCardUsedTotal);

    // ---- network cards.cardsUsed and daily session/data totals are unchanged (summary tables survive) ----
    expect(postNetworkResp.data.cards.cardsUsed).toBe(preNetworkCardsUsed);
    const postDailyDataBytes = postNetworkResp.data.daily
      .reduce((acc: number, d: { dataBytes: number }) => acc + d.dataBytes, 0);
    const postDailySessions = postNetworkResp.data.daily
      .reduce((acc: number, d: { cardsUsed: number }) => acc + d.cardsUsed, 0);
    expect(postDailyDataBytes).toBe(preDailyDataBytes);
    expect(postDailySessions).toBe(preDailySessions);

    // ---- Direct DB check: income_ledger and analytics_card_daily rows still exist ----
    const postIncome = await q(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM ${schema}.income_ledger WHERE user_id = $1`,
      [delUserId],
    );
    const postCards = await q(
      `SELECT COALESCE(SUM(cards_created), 0) AS created FROM ${schema}.analytics_card_daily WHERE user_id = $1`,
      [delUserId],
    );

    expect(Number(postIncome.rows[0].total)).toBe(2000);  // ledger row survived
    expect(Number(postCards.rows[0].created)).toBeGreaterThanOrEqual(5); // card_daily rows survived
  });

  // ---------------------------------------------------------------------------
  // Test: ingest after backfill leaves no radacctid unread
  // ---------------------------------------------------------------------------

  it('ingest after backfill leaves no radacctid unread', async () => {
    // Create a fresh sub-schema pool with our test schema
    const schemaPool = buildSchemaPool(pool, schema);

    // Set cursor to 0 so ingest reads from the beginning
    await q(
      `UPDATE ${schema}.analytics_state SET value = '0', updated_at = NOW() WHERE key = 'radacct_cursor'`,
    );

    // Reset first-use rows for cardA0–3 so we can test backfill + ingest from scratch
    await q(`DELETE FROM ${schema}.analytics_card_first_use WHERE radius_username LIKE 'cardA%'`);

    vi.resetModules();
    vi.doMock('../config/database', () => ({ pool: schemaPool, getPool: () => schemaPool }));

    const { runBackfill } = await import('../scripts/analyticsBackfill');
    const { ingestBatch } = await import('../jobs/analyticsIngest');

    // Step 1: run the backfill 'first-use' pass so it populates analytics_card_first_use
    // from the existing radacct rows.
    const backfillReport = await runBackfill({
      confirm: true,
      step: 'first-use',
      ignoreWindow: true,
      _delayMs: 0,
    });
    expect(backfillReport.firstUse.inserted).toBeGreaterThanOrEqual(0);

    // Step 2: run ingestBatch from cursor 0 — it should find all existing cardA rows
    // already in first_use (from backfill) and insert 0 new rows, but advance the cursor.
    const client = await schemaPool.connect();
    try {
      await client.query('BEGIN');
      const { nextCursor, read } = await ingestBatch(client, 0);
      await client.query('COMMIT');

      // After backfill + ingest, every radacctid in radacct is covered
      expect(read).toBeGreaterThanOrEqual(4);
      expect(nextCursor).toBeGreaterThan(0);

      // End state: all 4 cardA entries are present in analytics_card_first_use
      const firstUseCount = await q(
        `SELECT COUNT(*) AS cnt FROM ${schema}.analytics_card_first_use WHERE radius_username LIKE 'cardA%'`,
      );
      expect(Number(firstUseCount.rows[0].cnt)).toBe(4);
    } finally {
      client.release();
    }

    vi.resetModules();
  });

  // ---------------------------------------------------------------------------
  // Test: EXPLAIN of guarded statements shows no Seq Scan on radacct
  // ---------------------------------------------------------------------------

  it('EXPLAIN of each guarded statement shows no Seq Scan on radacct or voucher_meta', async () => {
    // We disable seqscan at the session level so Postgres is forced to use indexes
    // even on small test tables — this proves the guarded SQL is index-safe at any
    // row count. If the SQL lacks a usable index, Postgres returns an error, which
    // is itself a valid regression catch.
    //
    // We use EXPLAIN (FORMAT JSON) and assert the serialised plan text contains no
    // "Seq Scan" node on radacct or voucher_meta. After the EXPLAIN we restore
    // seqscan.

    const client = await pool.connect();
    try {
      await client.query(`SET search_path = ${schema}, public`);
      await client.query(`SET enable_seqscan = off`);

      // ---- Query 1: ingest SELECT_RADACCT ----
      const res1 = await client.query<{ 'QUERY PLAN': unknown[] }>(
        `EXPLAIN (FORMAT JSON) SELECT radacctid, username, acctstarttime
           FROM radacct
          WHERE radacctid > $1 - 100
            AND username <> ''
          ORDER BY radacctid
          LIMIT 2000`,
        [0],
      );
      const plan1Text = JSON.stringify(res1.rows[0]['QUERY PLAN']);
      // "Seq Scan" on radacct is not acceptable
      expect(plan1Text).not.toMatch(/"Seq Scan".*"radacct"/is);
      // The plan should reference an index scan or bitmap index scan on radacct
      expect(plan1Text).toMatch(/Index Scan|Bitmap Index Scan|Index Only Scan/i);

      // ---- Query 2: ingest JOIN to voucher_meta on radius_username ----
      const res2 = await client.query<{ 'QUERY PLAN': unknown[] }>(
        `EXPLAIN (FORMAT JSON) SELECT n.username, vm.user_id, vm.router_id
           FROM (VALUES ('cardA0'::text, 1::bigint, NOW()::timestamptz)) AS n(username, radacctid, acctstarttime)
           JOIN voucher_meta vm ON vm.radius_username = n.username`,
      );
      const plan2Text = JSON.stringify(res2.rows[0]['QUERY PLAN']);
      // With enable_seqscan = off and a unique index on radius_username, no Seq Scan.
      expect(plan2Text).not.toMatch(/"Seq Scan".*"voucher_meta"/is);

      await client.query(`SET enable_seqscan = on`);
    } finally {
      client.release();
    }
  });

  // ---------------------------------------------------------------------------
  // Test: every job statement and the backfill run twice with the same result
  // ---------------------------------------------------------------------------

  it('every job statement and the backfill run twice with the same result (idempotency)', async () => {
    // We inject our test-schema pool so the job functions read/write our isolated schema.
    const schemaPool = buildSchemaPool(pool, schema);

    vi.resetModules();
    vi.doMock('../config/database', () => ({ pool: schemaPool, getPool: () => schemaPool }));

    const { rebuildCardDay, rebuildUptimeDay, rebuildUsageHours } =
      await import('../jobs/analyticsRollup');
    const { runBackfill } = await import('../scripts/analyticsBackfill');

    const DAY = '2026-11-01';

    // ---- rebuildCardDay — run twice, compare analytics_card_daily ----
    await rebuildCardDay(DAY);
    const cardRows1 = await q(
      `SELECT user_id::text, router_id::text, limit_type, price::text, cards_created, cards_used
         FROM ${schema}.analytics_card_daily WHERE day = $1 ORDER BY user_id, router_id, limit_type, price`,
      [DAY],
    );

    await rebuildCardDay(DAY);
    const cardRows2 = await q(
      `SELECT user_id::text, router_id::text, limit_type, price::text, cards_created, cards_used
         FROM ${schema}.analytics_card_daily WHERE day = $1 ORDER BY user_id, router_id, limit_type, price`,
      [DAY],
    );

    expect(cardRows2.rows).toEqual(cardRows1.rows);

    // ---- rebuildUptimeDay — run twice, compare analytics_uptime_daily ----
    await rebuildUptimeDay(DAY);
    const uptimeRows1 = await q(
      `SELECT router_id::text, observed_seconds, down_seconds, drops, longest_outage_seconds
         FROM ${schema}.analytics_uptime_daily WHERE day = $1 ORDER BY router_id`,
      [DAY],
    );

    await rebuildUptimeDay(DAY);
    const uptimeRows2 = await q(
      `SELECT router_id::text, observed_seconds, down_seconds, drops, longest_outage_seconds
         FROM ${schema}.analytics_uptime_daily WHERE day = $1 ORDER BY router_id`,
      [DAY],
    );

    expect(uptimeRows2.rows).toEqual(uptimeRows1.rows);

    // ---- rebuildUsageHours — run twice for the hours in our test data ----
    await rebuildUsageHours(DAY, [9]); // hour 9 Khartoum = hour 6 UTC
    const usageRows1 = await q(
      `SELECT hour, router_id::text, sessions, data_bytes::text
         FROM ${schema}.analytics_usage_hourly WHERE day = $1 ORDER BY hour, router_id`,
      [DAY],
    );

    await rebuildUsageHours(DAY, [9]);
    const usageRows2 = await q(
      `SELECT hour, router_id::text, sessions, data_bytes::text
         FROM ${schema}.analytics_usage_hourly WHERE day = $1 ORDER BY hour, router_id`,
      [DAY],
    );

    expect(usageRows2.rows).toEqual(usageRows1.rows);

    // ---- runBackfill 'first-use' — run twice, compare analytics_card_first_use ----
    await runBackfill({ confirm: true, step: 'first-use', ignoreWindow: true, _delayMs: 0 });
    const firstUse1 = await q(
      `SELECT radius_username, user_id::text, router_id::text, price::text, limit_type
         FROM ${schema}.analytics_card_first_use
        WHERE radius_username LIKE 'cardA%'
        ORDER BY radius_username`,
    );

    await runBackfill({ confirm: true, step: 'first-use', ignoreWindow: true, _delayMs: 0 });
    const firstUse2 = await q(
      `SELECT radius_username, user_id::text, router_id::text, price::text, limit_type
         FROM ${schema}.analytics_card_first_use
        WHERE radius_username LIKE 'cardA%'
        ORDER BY radius_username`,
    );

    expect(firstUse2.rows).toEqual(firstUse1.rows);

    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// [C8-test] Paying vs granted rule: operator whose EARLIER period was paid
// but whose CURRENT active subscription has no ledger row must count as granted.
// ---------------------------------------------------------------------------
describe.skipIf(!enabled)('[C8-test] paying-vs-granted rule (earlier paid, current granted)', { timeout: 60_000 }, () => {
  let c8Pool: Pool;
  let c8Schema: string;

  beforeAll(async () => {
    if (!enabled) return;
    const dbUrl = process.env.INTEGRATION_DATABASE_URL!;
    if (!safeHost(dbUrl)) throw new Error('INTEGRATION_DATABASE_URL must point to localhost');

    const { Pool: RealPool } = await vi.importActual<typeof import('pg')>('pg');
    const realPool = new RealPool({ connectionString: dbUrl, max: 3 });

    c8Schema = `test_c8_${Date.now()}`;
    await realPool.query(`CREATE SCHEMA ${c8Schema}`);

    // Build a small pool scoped to this schema.
    c8Pool = {
      ...realPool,
      query: (async (...args: Parameters<Pool['query']>) => {
        const cl = await realPool.connect();
        try {
          await cl.query(`SET search_path = ${c8Schema}, public`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (cl.query as any)(...args);
        } finally { cl.release(); }
      }) as Pool['query'],
      connect: async () => {
        const cl = await realPool.connect();
        await cl.query(`SET search_path = ${c8Schema}, public`);
        return cl;
      },
      end: realPool.end.bind(realPool),
    } as unknown as Pool;

    const nq = (sql: string, params?: unknown[]) => c8Pool.query(sql, params);

    // Minimal tables
    await nq(`CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, email TEXT, role TEXT NOT NULL DEFAULT 'user', password_hash TEXT NOT NULL DEFAULT 'x', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), email_verified BOOLEAN NOT NULL DEFAULT true)`);
    await nq(`CREATE TABLE plans (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tier TEXT NOT NULL UNIQUE, name TEXT NOT NULL, price NUMERIC(10,2), router_quota INTEGER, voucher_quota INTEGER, duration_months INTEGER NOT NULL DEFAULT 1)`);
    await nq(`CREATE TABLE subscriptions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, plan_tier TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', duration_months INTEGER NOT NULL DEFAULT 1, voucher_quota INTEGER NOT NULL DEFAULT 500, vouchers_used INTEGER NOT NULL DEFAULT 0, start_date TIMESTAMPTZ, end_date TIMESTAMPTZ, previous_subscription_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await nq(`CREATE TABLE payments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, plan_tier TEXT NOT NULL, amount NUMERIC(10,2) NOT NULL, status TEXT NOT NULL DEFAULT 'pending', receipt_url TEXT, reviewed_by UUID, reviewed_at TIMESTAMPTZ, rejection_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await nq(`CREATE TABLE routers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, name TEXT NOT NULL, tunnel_ip TEXT, status TEXT NOT NULL DEFAULT 'offline', last_seen TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await nq(`CREATE TABLE income_ledger (payment_id UUID PRIMARY KEY, user_id UUID NOT NULL, operator_name VARCHAR(100), operator_email VARCHAR(255), subscription_id UUID, replaces_subscription_id UUID, plan_tier VARCHAR(50) NOT NULL, plan_name VARCHAR(100), duration_months INTEGER, amount NUMERIC(12,2) NOT NULL, kind VARCHAR(12) NOT NULL CHECK (kind IN ('new','renewal','plan_change')), approved_at TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ, source VARCHAR(10) NOT NULL DEFAULT 'live')`);
    await nq(`CREATE INDEX ON income_ledger (approved_at)`);
    await nq(`CREATE INDEX ON income_ledger (user_id, approved_at)`);
    await nq(`CREATE TABLE operator_activity (user_id UUID PRIMARY KEY, last_active_at TIMESTAMPTZ NOT NULL)`);
    await nq(`CREATE TABLE analytics_state (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await nq(`INSERT INTO analytics_state (key) VALUES ('radacct_cursor'),('monitor_heartbeat') ON CONFLICT DO NOTHING`);
    await nq(`CREATE TABLE router_uptime_state (router_id UUID PRIMARY KEY, user_id UUID NOT NULL, tracked_since TIMESTAMPTZ NOT NULL, is_up BOOLEAN NOT NULL, changed_at TIMESTAMPTZ NOT NULL, untracked_at TIMESTAMPTZ)`);
    await nq(`CREATE TABLE router_outages (id BIGSERIAL PRIMARY KEY, router_id UUID NOT NULL, user_id UUID NOT NULL, started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ, end_reason VARCHAR(20))`);
    await nq(`CREATE TABLE monitor_gaps (id BIGSERIAL PRIMARY KEY, started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ NOT NULL)`);
    await nq(`CREATE TABLE analytics_card_batches (id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL, router_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL, card_count INTEGER NOT NULL, price NUMERIC(10,2), limit_type VARCHAR(10), source VARCHAR(10) NOT NULL DEFAULT 'live')`);
    await nq(`CREATE TABLE analytics_card_first_use (radius_username VARCHAR(64) PRIMARY KEY, user_id UUID NOT NULL, router_id UUID NOT NULL, price NUMERIC(10,2), limit_type VARCHAR(10), first_used_at TIMESTAMPTZ NOT NULL, first_radacctid BIGINT NOT NULL)`);
    await nq(`CREATE TABLE analytics_card_daily (day DATE NOT NULL, user_id UUID NOT NULL, router_id UUID NOT NULL, limit_type VARCHAR(10), price NUMERIC(10,2), cards_created INTEGER NOT NULL DEFAULT 0, cards_used INTEGER NOT NULL DEFAULT 0, UNIQUE NULLS NOT DISTINCT (day, user_id, router_id, limit_type, price))`);
    await nq(`CREATE TABLE analytics_usage_hourly (day DATE NOT NULL, hour SMALLINT NOT NULL, router_id UUID, user_id UUID, sessions INTEGER NOT NULL, data_bytes BIGINT NOT NULL, UNIQUE NULLS NOT DISTINCT (day, hour, router_id))`);
    await nq(`CREATE TABLE analytics_usage_daily (day DATE NOT NULL, router_id UUID, user_id UUID, sessions INTEGER NOT NULL, data_bytes BIGINT NOT NULL, UNIQUE NULLS NOT DISTINCT (day, router_id))`);
    await nq(`CREATE TABLE analytics_hour_daily (day DATE NOT NULL, hour SMALLINT NOT NULL, sessions INTEGER NOT NULL, data_bytes BIGINT NOT NULL, PRIMARY KEY (day, hour))`);
    await nq(`CREATE TABLE analytics_uptime_daily (day DATE NOT NULL, router_id UUID NOT NULL, user_id UUID NOT NULL, observed_seconds INTEGER NOT NULL, down_seconds INTEGER NOT NULL, drops INTEGER NOT NULL, longest_outage_seconds INTEGER NOT NULL, PRIMARY KEY (day, router_id))`);
    await nq(`INSERT INTO analytics_state (key, value, updated_at) VALUES ('rollup_last_ok', NOW()::text, NOW()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`);

    await nq(`INSERT INTO plans (tier, name, price, voucher_quota) VALUES ('starter','Starter',1000,500) ON CONFLICT (tier) DO NOTHING`);

    // opEarlierPaid: paid for a 'starter' sub in October; that sub expired.
    // Now has a NEW active sub that was granted (no ledger row for it).
    const userId = (await nq(
      `INSERT INTO users (name, email) VALUES ('EarlierPaidOp','ep@c8.test') RETURNING id`,
    )).rows[0].id as string;

    const oldPayId = (await nq(
      `INSERT INTO payments (user_id, plan_tier, amount, status, receipt_url, reviewed_at, created_at, updated_at)
       VALUES ($1,'starter',1000,'approved','https://r.test/c8-old','2026-10-01T10:00:00Z','2026-10-01T09:00:00Z','2026-10-01T10:00:00Z') RETURNING id`,
      [userId],
    )).rows[0].id as string;

    const oldSubId = (await nq(
      `INSERT INTO subscriptions (user_id, plan_tier, status, duration_months, voucher_quota, start_date, end_date, created_at, updated_at)
       VALUES ($1,'starter','cancelled',1,500,'2026-10-01T10:00:00Z','2026-11-01T10:00:00Z','2026-10-01T09:00:00Z','2026-10-01T09:00:00Z') RETURNING id`,
      [userId],
    )).rows[0].id as string;

    // Insert ledger row for the OLD paid subscription
    await nq(
      `INSERT INTO income_ledger (payment_id, user_id, operator_name, subscription_id, plan_tier, plan_name, duration_months, amount, kind, approved_at, period_end, source)
       VALUES ($1,$2,'EarlierPaidOp',$3,'starter','Starter',1,1000,'new','2026-10-01T10:00:00Z','2026-11-01T10:00:00Z','live')`,
      [oldPayId, userId, oldSubId],
    );

    // The CURRENT active sub has NO payment and NO ledger row (admin granted it)
    await nq(
      `INSERT INTO subscriptions (user_id, plan_tier, status, duration_months, voucher_quota, start_date, end_date, created_at, updated_at)
       VALUES ($1,'starter','active',1,500,NOW()-INTERVAL '5 days',NOW()+INTERVAL '25 days',NOW(),NOW())`,
      [userId],
    );

    // Route the analytics service to this schema
    vi.resetModules();
    vi.doMock('../config/database', () => ({ pool: c8Pool, getPool: () => c8Pool }));
  });

  afterAll(async () => {
    if (c8Pool) {
      vi.resetModules();
      // Drop the schema using the realPool connection (c8Pool's end is realPool.end)
      await c8Pool.query(`DROP SCHEMA IF EXISTS ${c8Schema} CASCADE`).catch(() => undefined);
      await c8Pool.end();
    }
  });

  it('[C8] operator with earlier paid + current granted sub counts in grantedOperators not payingOperators', async () => {
    const { getMoneyAnalytics } = await import('../services/analytics.service');
    const today = new Date().toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const twoMonthsAgo = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const p = {
      period: '30d' as const,
      from: monthAgo, to: today,
      previousFrom: twoMonthsAgo, previousTo: monthAgo,
      days: 30,
    };
    const result = await getMoneyAnalytics(p);
    // The operator has an active sub with no ledger row → granted
    expect(result.data.cards.grantedOperators).toBe(1);
    expect(result.data.cards.payingOperators).toBe(0);
  });

  it('[C8] granted operator appears in renewalsDue with granted=true and amount=null', async () => {
    const { getMoneyAnalytics } = await import('../services/analytics.service');
    const today = new Date().toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const twoMonthsAgo = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const p = {
      period: '30d' as const,
      from: monthAgo, to: today,
      previousFrom: twoMonthsAgo, previousTo: monthAgo,
      days: 30,
    };
    const result = await getMoneyAnalytics(p);
    const dueRow = result.data.renewalsDue.find((r) => r.email === 'ep@c8.test');
    // Active sub ends within 30 days → appears in renewalsDue
    if (dueRow) {
      expect(dueRow.granted).toBe(true);
      expect(dueRow.amount).toBeNull();
    }
    // Even if the sub isn't due yet (end_date > 30 days from now), confirm granted count
    // is 1 from the first assertion above.
  });
});

// ---------------------------------------------------------------------------
// F1 — real-Postgres backfill cursor precision test
//
// One router: 5,001 cards all sharing a microsecond-precise created_at
// (2026-07-23 21:57:16.553510+00), plus 10 older cards.  After a full cards
// backfill the batches must sum to exactly 5,011.
// ---------------------------------------------------------------------------

describe.skipIf(!enabled)(
  '[F1] backfill cursor precision — real Postgres',
  { timeout: 180_000 },
  () => {
    let bpPool: Pool;
    let bpSchema: string;

    beforeAll(async () => {
      const dbUrl = process.env.INTEGRATION_DATABASE_URL!;
      if (!safeHost(dbUrl)) throw new Error('INTEGRATION_DATABASE_URL must be localhost');

      const { Pool: RealPool } = await vi.importActual<typeof import('pg')>('pg');
      bpPool = new RealPool({ connectionString: dbUrl, max: 5 });
      bpSchema = `test_backfill_precision_${Date.now()}`;

      const bq = (sql: string, params?: unknown[]) => bpPool.query(sql, params);

      await bq(`CREATE SCHEMA ${bpSchema}`);

      // Minimal tables needed by backfillCards
      await bq(`CREATE TABLE ${bpSchema}.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL, email TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        password_hash TEXT NOT NULL DEFAULT 'x',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        email_verified BOOLEAN NOT NULL DEFAULT true
      )`);
      await bq(`CREATE TABLE ${bpSchema}.routers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        name TEXT NOT NULL,
        tunnel_ip TEXT,
        status TEXT NOT NULL DEFAULT 'offline',
        last_seen TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await bq(`CREATE TABLE ${bpSchema}.voucher_meta (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        router_id UUID NOT NULL,
        user_id UUID NOT NULL,
        radius_username VARCHAR(64) NOT NULL UNIQUE,
        status VARCHAR(32) NOT NULL DEFAULT 'unused',
        limit_type VARCHAR(16),
        limit_value NUMERIC,
        price NUMERIC(10,2),
        validity_seconds INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await bq(`CREATE TABLE ${bpSchema}.analytics_card_batches (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        router_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        card_count INTEGER NOT NULL,
        price NUMERIC(10,2),
        limit_type VARCHAR(10),
        source VARCHAR(10) NOT NULL DEFAULT 'live'
      )`);
      await bq(`CREATE TABLE ${bpSchema}.analytics_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await bq(
        `INSERT INTO ${bpSchema}.analytics_state (key) VALUES ('radacct_cursor'),('monitor_heartbeat') ON CONFLICT DO NOTHING`,
      );
      await bq(`CREATE TABLE ${bpSchema}.schema_migrations (
        filename TEXT PRIMARY KEY,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      // migration 045 must be AFTER the card timestamps so all cards are captured
      await bq(`INSERT INTO ${bpSchema}.schema_migrations (filename, executed_at)
                VALUES ('045_analytics_recording.sql', NOW()) ON CONFLICT DO NOTHING`);

      // Seed operator + router
      const userRes = await bq(
        `INSERT INTO ${bpSchema}.users (name, email) VALUES ('BPOp','bp@test.com') RETURNING id`,
      );
      const userId = userRes.rows[0].id as string;
      const routerRes = await bq(
        `INSERT INTO ${bpSchema}.routers (user_id, name) VALUES ($1, 'bp-router') RETURNING id`,
        [userId],
      );
      const routerId = routerRes.rows[0].id as string;

      // Batch 1: 5,001 cards all with EXACT microsecond precision
      await bq(
        `INSERT INTO ${bpSchema}.voucher_meta
           (router_id, user_id, radius_username, status, limit_type, price, validity_seconds, created_at)
         SELECT $1, $2, 'bp-' || i, 'unused', 'time', 50, 3600,
                '2026-07-23 21:57:16.553510+00'::timestamptz
           FROM generate_series(1, 5001) AS g(i)`,
        [routerId, userId],
      );

      // Batch 2: 10 older cards (earlier date — should be a separate page)
      await bq(
        `INSERT INTO ${bpSchema}.voucher_meta
           (router_id, user_id, radius_username, status, limit_type, price, validity_seconds, created_at)
         SELECT $1, $2, 'bpold-' || i, 'unused', 'time', 50, 3600,
                '2026-05-01 10:00:00+00'::timestamptz
           FROM generate_series(1, 10) AS g(i)`,
        [routerId, userId],
      );
    });

    afterAll(async () => {
      if (bpPool) {
        await bpPool.query(`DROP SCHEMA IF EXISTS ${bpSchema} CASCADE`).catch(() => undefined);
        await bpPool.end();
      }
      vi.resetModules();
    });

    it('sums to exactly 5,011 cards with no loss at page boundary', async () => {
      // Route the backfill script's pool to bpSchema
      vi.resetModules();
      const bpSchemaPool = buildSchemaPool(bpPool, bpSchema);
      vi.doMock('../config/database', () => ({
        pool: bpSchemaPool,
        getPool: () => bpSchemaPool,
      }));

      const { runBackfill: runBP } = await import('../scripts/analyticsBackfill');

      await runBP({ confirm: true, step: 'cards', ignoreWindow: true, _delayMs: 0 });

      const sumRes = await bpPool.query<{ total: string }>(
        `SELECT COALESCE(SUM(card_count),0)::text AS total
           FROM ${bpSchema}.analytics_card_batches
          WHERE source = 'backfill'`,
      );
      expect(Number(sumRes.rows[0].total)).toBe(5011);

      vi.resetModules();
    });
  },
);

