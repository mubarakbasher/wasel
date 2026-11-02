/**
 * Integration tests for voucherCodeReuse — requires a real PostgreSQL instance.
 *
 * Skipped by default. Opt in with:
 *
 *   VOUCHER_PG_INTEGRATION=1 \
 *   INTEGRATION_DATABASE_URL=postgres://user:pass@localhost:5436/waseldb \
 *   npx vitest run src/tests/voucherCodeReuse.integration.test.ts
 *
 * Safety rules enforced here:
 *   • Only connects to localhost / 127.0.0.1 — refuses any other host.
 *   • Every object is created in a run-unique schema (never public).
 *   • The schema is dropped in afterAll.
 *   • Never issues TRUNCATE or DROP on any other schema.
 *
 * What is covered:
 *   1. VOUCHER_CODE_TAKEN_SQL — radcheck-only, radacct-only, both, neither.
 *   2. runRepair dry run — writes nothing, including no ledger table.
 *   3. runRepair confirm — repairs the seeded card.
 *   4. Rerun after repair — finds nothing to do.
 *   5. Discovery across pages, including a batch sharing one microsecond.
 *   6. Post-checks: an Expiration or Reject the jobs write after the rename.
 *   7. Failed batches, deferred cards, the maintenance window, ACK_COUNT, maxCards.
 *   8. ROLLBACK_SQL — restores every mutated row, skips cards in service or gone,
 *      and survives a second repair and rollback cycle.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Pool } from 'pg';

const enabled =
  process.env.VOUCHER_PG_INTEGRATION === '1' &&
  Boolean(process.env.INTEGRATION_DATABASE_URL);

function safeHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

describe.skipIf(!enabled)('voucherCodeReuse integration tests', { timeout: 30000 }, () => {
  // Use vi.importActual because setup.ts replaces pg.Pool globally.
  let pool: Pool;
  let schema: string;

  // ---- Setup helpers ----

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

    schema = `test_vcr_${Date.now()}`;

    // Create isolated schema with the tables we need, cloning structure from public.
    await q(`CREATE SCHEMA ${schema}`);
    await q(`
      CREATE TABLE ${schema}.radcheck (
        id        bigserial PRIMARY KEY,
        username  varchar(64) NOT NULL,
        attribute varchar(64) NOT NULL,
        op        varchar(2)  NOT NULL,
        value     varchar(253) NOT NULL
      )
    `);
    await q(`
      CREATE TABLE ${schema}.radacct (
        radacctid        bigserial PRIMARY KEY,
        acctuniqueid     varchar(64) NOT NULL UNIQUE,
        username         varchar(64) NOT NULL,
        acctstarttime    timestamptz,
        acctstoptime     timestamptz,
        acctsessiontime  integer,
        acctinputoctets  bigint,
        acctoutputoctets bigint
      )
    `);
    await q(`CREATE INDEX ON ${schema}.radacct (username)`);
    await q(`
      CREATE TABLE ${schema}.routers (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL DEFAULT gen_random_uuid(),
        name       text NOT NULL DEFAULT 'test-router',
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q(`
      CREATE TABLE ${schema}.voucher_meta (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        router_id        uuid NOT NULL,
        user_id          uuid NOT NULL DEFAULT gen_random_uuid(),
        radius_username  varchar(64) NOT NULL UNIQUE,
        status           varchar(32) NOT NULL DEFAULT 'unused',
        limit_type       varchar(16),
        limit_value      numeric,
        validity_seconds integer NOT NULL DEFAULT 0,
        created_at       timestamptz NOT NULL DEFAULT now()
      )
    `);
  });

  afterAll(async () => {
    if (pool) {
      await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.end();
    }
  });

  // ---- Helper to run VOUCHER_CODE_TAKEN_SQL against test schema ----

  async function codesTaken(candidates: string[]): Promise<string[]> {
    const { VOUCHER_CODE_TAKEN_SQL } = await import('../services/voucher.service');
    // The SQL references radcheck and radacct in the search_path. We set it per-query.
    const client = await (pool as unknown as { connect: () => Promise<import('pg').PoolClient> }).connect();
    try {
      await client.query(`SET search_path = ${schema}, public`);
      const res = await client.query<{ username: string }>(VOUCHER_CODE_TAKEN_SQL, [candidates]);
      return res.rows.map((r) => r.username);
    } finally {
      client.release();
    }
  }

  it('VOUCHER_CODE_TAKEN_SQL: neither table has the code', async () => {
    const taken = await codesTaken(['zzz99999']);
    expect(taken).toEqual([]);
  });

  it('VOUCHER_CODE_TAKEN_SQL: radcheck-only', async () => {
    await q(`INSERT INTO ${schema}.radcheck (username, attribute, op, value) VALUES ('rconly01', 'Cleartext-Password', ':=', 'pw')`);
    const taken = await codesTaken(['rconly01', 'zzz00000']);
    expect(taken).toContain('rconly01');
    expect(taken).not.toContain('zzz00000');
  });

  it('VOUCHER_CODE_TAKEN_SQL: radacct-only (no radcheck row)', async () => {
    await q(`INSERT INTO ${schema}.radacct (acctuniqueid, username, acctstarttime, acctstoptime, acctsessiontime)
             VALUES ('uid-ra-only-1', 'raonly01', now() - interval '1 hour', now(), 3600)`);
    const taken = await codesTaken(['raonly01']);
    expect(taken).toContain('raonly01');
  });

  it('VOUCHER_CODE_TAKEN_SQL: both tables have the code — returned once', async () => {
    await q(`INSERT INTO ${schema}.radcheck (username, attribute, op, value) VALUES ('both01', 'Cleartext-Password', ':=', 'pw')`);
    await q(`INSERT INTO ${schema}.radacct (acctuniqueid, username, acctstarttime, acctstoptime, acctsessiontime)
             VALUES ('uid-both-1', 'both01', now() - interval '2 hours', now(), 7200)`);
    const taken = await codesTaken(['both01']);
    // UNION deduplicates
    expect(taken.filter((u) => u === 'both01').length).toBe(1);
  });

  // ---- repairReusedVoucherCodes integration ----

  async function seedRepairScenario(): Promise<{
    routerId: string;
    voucherId: string;
    code: string;
    foreignAcctId: string;
    expirationValue: string;
  }> {
    const code = `seed${Date.now().toString().slice(-6)}`;
    const routerRes = await q(`INSERT INTO ${schema}.routers DEFAULT VALUES RETURNING id`);
    const routerId = routerRes.rows[0].id as string;

    // Card created after REUSE_CUTOVER
    const createdAt = new Date('2026-10-28T10:00:00Z');
    const validitySeconds = 86400;

    const metaRes = await q(
      `INSERT INTO ${schema}.voucher_meta
         (router_id, radius_username, status, limit_type, limit_value, validity_seconds, created_at)
       VALUES ($1, $2, 'expired', 'time', 3700, $3, $4) RETURNING id`,
      [routerId, code, validitySeconds, createdAt],
    );
    const voucherId = metaRes.rows[0].id as string;

    // Foreign radacct row (started before card was created)
    const foreignStart = new Date('2026-10-20T08:00:00Z');
    const foreignStop = new Date(foreignStart.getTime() + 3700 * 1000);
    const acctRes = await q(
      `INSERT INTO ${schema}.radacct
         (acctuniqueid, username, acctstarttime, acctstoptime, acctsessiontime, acctinputoctets, acctoutputoctets)
       VALUES ($1, $2, $3, $4, 3700, 1000, 500) RETURNING radacctid`,
      [`uid-seed-${code}`, code, foreignStart, foreignStop],
    );
    const foreignAcctId = String(acctRes.rows[0].radacctid);

    // Compute Expiration the job would have written
    const { formatRadiusExpiration: fmt } = await import('../utils/radius');
    const expirationValue = fmt(new Date(foreignStart.getTime() + validitySeconds * 1000));

    // Seed radcheck rows
    await q(`INSERT INTO ${schema}.radcheck (username, attribute, op, value) VALUES ($1, 'Cleartext-Password', ':=', 'pw')`, [code]);
    await q(`INSERT INTO ${schema}.radcheck (username, attribute, op, value) VALUES ($1, 'Expiration', ':=', $2)`, [code, expirationValue]);
    await q(`INSERT INTO ${schema}.radcheck (username, attribute, op, value) VALUES ($1, 'Auth-Type', ':=', 'Reject')`, [code]);

    return { routerId, voucherId, code, foreignAcctId, expirationValue };
  }

  let seeded: {
    routerId: string;
    voucherId: string;
    code: string;
    foreignAcctId: string;
    expirationValue: string;
  };

  it('dry run writes nothing, including no ledger table', async () => {
    seeded = await seedRepairScenario();

    // Build a pool-like wrapper that routes queries to the test schema
    const schemaPool = buildSchemaPool(pool, schema);

    const { runRepair } = await import('../scripts/repairReusedVoucherCodes');
    const fastSleep = () => Promise.resolve();

    await runRepair(schemaPool, { confirm: false, sleep: fastSleep, postCheckDelayMs: 0 });

    // Ledger table must NOT exist
    const tbl = await q(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name = 'voucher_code_reuse_repair_2026_10'`,
      [schema],
    );
    expect(tbl.rows.length).toBe(0);

    // radacct row unchanged
    const ra = await q(`SELECT username FROM ${schema}.radacct WHERE radacctid = $1`, [seeded.foreignAcctId]);
    expect(ra.rows[0].username).toBe(seeded.code);

    // voucher_meta status unchanged
    const vm = await q(`SELECT status FROM ${schema}.voucher_meta WHERE id = $1`, [seeded.voucherId]);
    expect(vm.rows[0].status).toBe('expired');
  });

  it('confirm run repairs the seeded card', async () => {
    const schemaPool = buildSchemaPool(pool, schema);
    const { runRepair } = await import('../scripts/repairReusedVoucherCodes');
    const fastSleep = () => Promise.resolve();

    // Use a fixed "now" well outside the maintenance window
    const safeNow = new Date('2026-10-30T14:00:00Z');

    await runRepair(schemaPool, {
      confirm: true,
      clock: () => safeNow,
      sleep: fastSleep,
      postCheckDelayMs: 0,
    });

    // radacct row renamed
    const ra = await q(`SELECT username FROM ${schema}.radacct WHERE radacctid = $1`, [seeded.foreignAcctId]);
    expect(ra.rows[0].username).toBe(seeded.code + '-old');

    // Expiration deleted
    const exp = await q(
      `SELECT 1 FROM ${schema}.radcheck WHERE username = $1 AND attribute = 'Expiration'`,
      [seeded.code],
    );
    expect(exp.rows.length).toBe(0);

    // Auth-Type Reject deleted
    const rej = await q(
      `SELECT 1 FROM ${schema}.radcheck WHERE username = $1 AND attribute = 'Auth-Type'`,
      [seeded.code],
    );
    expect(rej.rows.length).toBe(0);

    // voucher_meta status reset to unused
    const vm = await q(`SELECT status FROM ${schema}.voucher_meta WHERE id = $1`, [seeded.voucherId]);
    expect(vm.rows[0].status).toBe('unused');

    // Ledger row exists
    const led = await q(
      `SELECT * FROM ${schema}.voucher_code_reuse_repair_2026_10 WHERE voucher_id = $1`,
      [seeded.voucherId],
    );
    expect(led.rows.length).toBe(1);
    expect(led.rows[0].removed_expiration).toBe(true);
    expect(led.rows[0].removed_reject).toBe(true);
  });

  it('rerun after repair finds nothing to repair', async () => {
    const schemaPool = buildSchemaPool(pool, schema);
    const { runRepair } = await import('../scripts/repairReusedVoucherCodes');
    const fastSleep = () => Promise.resolve();
    const safeNow = new Date('2026-10-30T15:00:00Z');

    // Should complete without error — no repair cards
    await runRepair(schemaPool, {
      confirm: true,
      clock: () => safeNow,
      sleep: fastSleep,
      postCheckDelayMs: 0,
    });

    // Ledger still has only 1 row (no new rows added)
    const led = await q(
      `SELECT COUNT(*) AS cnt FROM ${schema}.voucher_code_reuse_repair_2026_10`,
    );
    expect(Number(led.rows[0].cnt)).toBe(1);
  });

  // ---- Microsecond cursor pagination (finding 2) ----
  //
  // Verify that fetchPage uses a microsecond-precision cursor so that cards
  // sharing a sub-millisecond created_at are not silently dropped at a page
  // boundary.  We use pageSize=2 and seed 3 cards with explicitly the same
  // created_at; all three must be discovered in two pages.  The value is seeded
  // as text: a JS Date would cut it to milliseconds and hide the bug.

  it('microsecond cursor: all cards in a same-timestamp batch are discovered across pages', async () => {
    // Use a router created just for this test
    const rRes = await q(`INSERT INTO ${schema}.routers DEFAULT VALUES RETURNING id`);
    const testRouterId = rRes.rows[0].id as string;
    const sharedCreatedAt = '2026-10-28T10:00:00.123456Z';

    // Seed 3 cards with the same created_at and a foreign radacct row each
    const codes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const code = `pg${Date.now().toString().slice(-5)}${i}`;
      codes.push(code);
      await q(
        `INSERT INTO ${schema}.voucher_meta
           (router_id, radius_username, status, limit_type, limit_value, validity_seconds, created_at)
         VALUES ($1, $2, 'unused', NULL, NULL, 0, $3::timestamptz)`,
        [testRouterId, code, sharedCreatedAt],
      );
      // Foreign radacct row started before sharedCreatedAt
      await q(
        `INSERT INTO ${schema}.radacct
           (acctuniqueid, username, acctstarttime, acctstoptime, acctsessiontime)
         VALUES ($1, $2, $3::timestamptz - interval '1 hour', $3::timestamptz, 3600)`,
        [`uid-pg-${code}`, code, sharedCreatedAt],
      );
      await q(
        `INSERT INTO ${schema}.radcheck (username, attribute, op, value)
         VALUES ($1, 'Cleartext-Password', ':=', 'pw')`,
        [code],
      );
    }

    const schemaPool = buildSchemaPool(pool, schema);
    const { runRepair } = await import('../scripts/repairReusedVoucherCodes');
    const fastSleep = () => Promise.resolve();

    // pageSize=2 forces a page split in the middle of the 3-card batch
    const safeNow = new Date('2026-10-30T16:00:00Z');
    await runRepair(schemaPool, {
      confirm: true,
      clock: () => safeNow,
      sleep: fastSleep,
      postCheckDelayMs: 0,
      pageSize: 2,
    });

    // All foreign radacct rows should be renamed to code + '-old'
    for (const code of codes) {
      const renamed = await q(
        `SELECT username FROM ${schema}.radacct WHERE username = $1`,
        [code + '-old'],
      );
      expect(renamed.rows.length, `foreign row for ${code} not renamed`).toBe(1);
    }
  });

  // ---- Post-check covers cards with no Expiration at repair time (finding 3) ----

  it('post-check re-deletes Expiration written by job after repair when none existed at repair time', async () => {
    const rRes = await q(`INSERT INTO ${schema}.routers DEFAULT VALUES RETURNING id`);
    const pcRouterId = rRes.rows[0].id as string;

    const code = `pc3${Date.now().toString().slice(-5)}`;
    const createdAt = new Date('2026-10-28T11:00:00Z');
    const validitySeconds = 86400;
    const foreignStart = new Date('2026-10-20T09:00:00Z');
    const foreignStop  = new Date(foreignStart.getTime() + 3600 * 1000);

    await q(
      `INSERT INTO ${schema}.voucher_meta
         (router_id, radius_username, status, limit_type, limit_value, validity_seconds, created_at)
       VALUES ($1, $2, 'unused', NULL, NULL, $3, $4)`,
      [pcRouterId, code, validitySeconds, createdAt],
    );
    const acctRes = await q(
      `INSERT INTO ${schema}.radacct
         (acctuniqueid, username, acctstarttime, acctstoptime, acctsessiontime)
       VALUES ($1, $2, $3, $4, 3600) RETURNING radacctid`,
      [`uid-pc3-${code}`, code, foreignStart, foreignStop],
    );
    const foreignAcctId = String(acctRes.rows[0].radacctid);
    await q(
      `INSERT INTO ${schema}.radcheck (username, attribute, op, value)
       VALUES ($1, 'Cleartext-Password', ':=', 'pw')`,
      [code],
    );
    // No Expiration at repair time (removed_expiration will be false in ledger)

    const schemaPool = buildSchemaPool(pool, schema);
    const { runRepair } = await import('../scripts/repairReusedVoucherCodes');
    const fastSleep = () => Promise.resolve();
    const safeNow = new Date('2026-10-30T17:00:00Z');

    await runRepair(schemaPool, { confirm: true, clock: () => safeNow, sleep: fastSleep, postCheckDelayMs: 0 });

    // Verify repair: radacct renamed
    const ra = await q(`SELECT username FROM ${schema}.radacct WHERE radacctid = $1`, [foreignAcctId]);
    expect(ra.rows[0].username).toBe(code + '-old');

    // Simulate: job writes Expiration after repair (using earliest renamed row + validity)
    const { formatRadiusExpiration: fmt } = await import('../utils/radius');
    const jobWouldWrite = fmt(new Date(foreignStart.getTime() + validitySeconds * 1000));
    await q(
      `INSERT INTO ${schema}.radcheck (username, attribute, op, value) VALUES ($1, 'Expiration', ':=', $2)`,
      [code, jobWouldWrite],
    );

    // Run post-check directly (simulate the post-check running after the delay)
    // We do this by running a second confirm pass with postCheckDelayMs=0
    await runRepair(schemaPool, { confirm: true, clock: () => safeNow, sleep: fastSleep, postCheckDelayMs: 0 });

    // Stale Expiration should have been removed by post-check
    const exp = await q(
      `SELECT 1 FROM ${schema}.radcheck WHERE username = $1 AND attribute = 'Expiration'`,
      [code],
    );
    expect(exp.rows.length).toBe(0);
  });

  // ---- Helpers for the scenarios below ----

  const SAFE_CLOCK = () => new Date('2026-10-30T18:00:00Z');
  const IN_WINDOW = new Date('2026-10-30T02:06:00Z');

  async function run(opts: Partial<import('../scripts/repairReusedVoucherCodes').RepairOpts> = {}) {
    const { runRepair } = await import('../scripts/repairReusedVoucherCodes');
    return runRepair(buildSchemaPool(pool, schema), {
      confirm: true,
      clock: SAFE_CLOCK,
      sleep: () => Promise.resolve(),
      postCheckDelayMs: 0,
      ...opts,
    });
  }

  let seq = 0;

  /** A card created after the cutover, holding one closed foreign row. */
  async function seedCard(card: {
    limitType: 'time' | 'data';
    limitValue: number;
    foreignUsage: number;
    reject?: boolean;
  }): Promise<{ id: string; code: string; foreignId: string }> {
    const code = `card${Date.now().toString().slice(-5)}${seq++}`;
    const routerRes = await q(`INSERT INTO ${schema}.routers DEFAULT VALUES RETURNING id`);
    const meta = await q(
      `INSERT INTO ${schema}.voucher_meta
         (router_id, radius_username, status, limit_type, limit_value, validity_seconds, created_at)
       VALUES ($1, $2, 'unused', $3, $4, 0, '2026-10-28T12:00:00Z') RETURNING id`,
      [routerRes.rows[0].id, code, card.limitType, card.limitValue],
    );
    const seconds = card.limitType === 'time' ? card.foreignUsage : 60;
    const octets = card.limitType === 'data' ? card.foreignUsage : 0;
    const acct = await q(
      `INSERT INTO ${schema}.radacct
         (acctuniqueid, username, acctstarttime, acctstoptime, acctsessiontime, acctinputoctets, acctoutputoctets)
       VALUES ($1, $2, '2026-10-21T08:00:00Z', '2026-10-21T09:00:00Z', $3, $4, 0) RETURNING radacctid`,
      [`uid-${code}`, code, seconds, octets],
    );
    await q(
      `INSERT INTO ${schema}.radcheck (username, attribute, op, value)
       VALUES ($1, 'Cleartext-Password', ':=', 'pw')`,
      [code],
    );
    if (card.reject) await latchReject(code);
    return { id: meta.rows[0].id as string, code, foreignId: String(acct.rows[0].radacctid) };
  }

  /** A session of the card's own: started after created_at, closed unless told otherwise. */
  async function addSession(
    code: string,
    session: { octets?: number; open?: boolean } = {},
  ): Promise<void> {
    await q(
      `INSERT INTO ${schema}.radacct
         (acctuniqueid, username, acctstarttime, acctstoptime, acctsessiontime, acctinputoctets, acctoutputoctets)
       VALUES ($1, $2, '2026-10-29T08:00:00Z', $3::timestamptz, 3600, $4, 0)`,
      [
        `uid-own-${code}-${seq++}`,
        code,
        session.open ? null : '2026-10-29T09:00:00Z',
        session.octets ?? 0,
      ],
    );
  }

  /** What enforceLimit writes: Reject plus status 'expired'. */
  async function latchReject(code: string): Promise<void> {
    await q(
      `INSERT INTO ${schema}.radcheck (username, attribute, op, value)
       VALUES ($1, 'Auth-Type', ':=', 'Reject')`,
      [code],
    );
    await q(`UPDATE ${schema}.voucher_meta SET status = 'expired' WHERE radius_username = $1`, [code]);
  }

  async function rejectCount(code: string): Promise<number> {
    const res = await q(
      `SELECT 1 FROM ${schema}.radcheck WHERE username = $1 AND attribute = 'Auth-Type'`,
      [code],
    );
    return res.rows.length;
  }

  async function statusOf(code: string): Promise<string> {
    const res = await q(`SELECT status FROM ${schema}.voucher_meta WHERE radius_username = $1`, [code]);
    return res.rows[0].status as string;
  }

  async function acctNameOf(id: string): Promise<string> {
    const res = await q(`SELECT username FROM ${schema}.radacct WHERE radacctid = $1`, [id]);
    return res.rows[0].username as string;
  }

  async function ledgerRowsFor(id: string): Promise<number> {
    const res = await q(
      `SELECT 1 FROM ${schema}.voucher_code_reuse_repair_2026_10 WHERE voucher_id = $1`,
      [id],
    );
    return res.rows.length;
  }

  // ---- Post-check B: Reject latched by a job that read usage before the rename ----

  it('post-check clears a Reject latched after repair on a card that had none at repair time', async () => {
    const card = await seedCard({ limitType: 'data', limitValue: 1000, foreignUsage: 1500 });

    await run();
    expect(await acctNameOf(card.foreignId)).toBe(card.code + '-old');

    // enforceLimit read 1500 used before the rename and writes after the commit.
    await latchReject(card.code);

    await run();

    expect(await rejectCount(card.code)).toBe(0);
    expect(await statusOf(card.code)).toBe('unused');
  });

  it('post-check leaves a Reject on a card exhausted by its own sessions', async () => {
    const card = await seedCard({ limitType: 'data', limitValue: 1000, foreignUsage: 1500 });

    await run();

    // Sold and used up for real: usage under the code alone reaches the limit.
    await addSession(card.code, { octets: 1200 });
    await latchReject(card.code);

    await run();

    expect(await rejectCount(card.code)).toBe(1);
    expect(await statusOf(card.code)).toBe('expired');
  });

  it('post-check leaves a Reject the repair kept, even if a session then passes the limit', async () => {
    // Under the limit with the foreign row, so the repair cannot prove the Reject false.
    const card = await seedCard({ limitType: 'data', limitValue: 10000, foreignUsage: 9000, reject: true });

    await run();

    // Under the limit alone and over it with the renamed rows: not proof of anything here.
    await addSession(card.code, { octets: 4500, open: true });
    await run();

    expect(await acctNameOf(card.foreignId)).toBe(card.code + '-old');
    expect(await rejectCount(card.code)).toBe(1);
    expect(await statusOf(card.code)).toBe('expired');
  });

  it('post-check leaves a Reject the renamed rows cannot explain', async () => {
    const card = await seedCard({ limitType: 'data', limitValue: 10000, foreignUsage: 100 });

    await run();
    await latchReject(card.code);
    await run();

    expect(await rejectCount(card.code)).toBe(1);
    expect(await statusOf(card.code)).toBe('expired');
  });

  // ---- Reporting must match what committed ----

  it('a failed batch rejects the run, writes nothing for that batch, and a rerun finishes it', async () => {
    const card = await seedCard({ limitType: 'time', limitValue: 3600, foreignUsage: 4000 });

    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT 1 FROM ${schema}.voucher_meta WHERE id = $1 FOR UPDATE`, [card.id]);
      await expect(run()).rejects.toThrow(/incomplete/i);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }

    expect(await acctNameOf(card.foreignId)).toBe(card.code);
    expect(await ledgerRowsFor(card.id)).toBe(0);

    await run();

    expect(await acctNameOf(card.foreignId)).toBe(card.code + '-old');
    expect(await ledgerRowsFor(card.id)).toBe(1);
  }, 20000);

  it('stops writing when the maintenance window opens after the pre-flight check', async () => {
    const card = await seedCard({ limitType: 'time', limitValue: 3600, foreignUsage: 4000 });

    const times = [SAFE_CLOCK()];
    await expect(run({ clock: () => times.shift() ?? IN_WINDOW })).rejects.toThrow(/incomplete/i);

    expect(await acctNameOf(card.foreignId)).toBe(card.code);
    expect(await ledgerRowsFor(card.id)).toBe(0);

    await run();
    expect(await acctNameOf(card.foreignId)).toBe(card.code + '-old');
  });

  it('refuses to write when ACK_COUNT differs from the repair count', async () => {
    const card = await seedCard({ limitType: 'time', limitValue: 3600, foreignUsage: 4000 });

    await expect(run({ ackCount: 99 })).rejects.toThrow(/ACK_COUNT/);

    expect(await acctNameOf(card.foreignId)).toBe(card.code);
    expect(await ledgerRowsFor(card.id)).toBe(0);

    await run({ ackCount: 1 });
    expect(await acctNameOf(card.foreignId)).toBe(card.code + '-old');
  });

  it('refuses to start inside the maintenance window', async () => {
    const card = await seedCard({ limitType: 'time', limitValue: 3600, foreignUsage: 4000 });

    await expect(run({ clock: () => IN_WINDOW })).rejects.toThrow(/Refusing to run/);

    expect(await acctNameOf(card.foreignId)).toBe(card.code);
    await run();
  });

  it('refuses when the repair count exceeds maxCards', async () => {
    const card = await seedCard({ limitType: 'time', limitValue: 3600, foreignUsage: 4000 });

    await expect(run({ maxCards: 0 })).rejects.toThrow(/exceeds maxCards/);

    expect(await acctNameOf(card.foreignId)).toBe(card.code);
    await run();
  });

  it('a card deferred on an open foreign row fails the run until it can be repaired', async () => {
    const card = await seedCard({ limitType: 'time', limitValue: 3600, foreignUsage: 4000 });
    await q(`UPDATE ${schema}.radacct SET acctstoptime = NULL WHERE radacctid = $1`, [card.foreignId]);

    await expect(run()).rejects.toThrow(/incomplete/i);
    expect(await acctNameOf(card.foreignId)).toBe(card.code);

    await q(
      `UPDATE ${schema}.radacct SET acctstoptime = acctstarttime + interval '1 hour' WHERE radacctid = $1`,
      [card.foreignId],
    );
    await run();
    expect(await acctNameOf(card.foreignId)).toBe(card.code + '-old');
  });

  it('ROLLBACK_SQL restores every row exactly', async () => {
    await rollback();

    // radacct username restored
    const ra = await q(`SELECT username FROM ${schema}.radacct WHERE radacctid = $1`, [seeded.foreignAcctId]);
    expect(ra.rows[0].username).toBe(seeded.code);

    // Expiration reinserted
    const exp = await q(
      `SELECT value FROM ${schema}.radcheck WHERE username = $1 AND attribute = 'Expiration'`,
      [seeded.code],
    );
    expect(exp.rows.length).toBe(1);
    expect(exp.rows[0].value).toBe(seeded.expirationValue);

    // Auth-Type Reject reinserted
    const rej = await q(
      `SELECT value FROM ${schema}.radcheck WHERE username = $1 AND attribute = 'Auth-Type'`,
      [seeded.code],
    );
    expect(rej.rows.length).toBe(1);
    expect(rej.rows[0].value).toBe('Reject');

    // voucher_meta status restored to expired
    const vm = await q(`SELECT status FROM ${schema}.voucher_meta WHERE id = $1`, [seeded.voucherId]);
    expect(vm.rows[0].status).toBe('expired');
  });

  it('a second repair and rollback cycle leaves no duplicate radcheck rows', async () => {
    await run();
    await rollback();

    const rows = await q(
      `SELECT attribute FROM ${schema}.radcheck
        WHERE username = $1 AND attribute IN ('Expiration', 'Auth-Type')
        ORDER BY attribute`,
      [seeded.code],
    );
    expect(rows.rows.map((r) => r.attribute)).toEqual(['Auth-Type', 'Expiration']);
  });

  it('rollback skips a card that has been used since the repair, and reports it', async () => {
    const card = await seedCard({ limitType: 'data', limitValue: 1000, foreignUsage: 1500, reject: true });

    await run();
    expect(await statusOf(card.code)).toBe('unused');

    // Sold after the repair: a real session under the code, started after repaired_at.
    await q(
      `INSERT INTO ${schema}.radacct (acctuniqueid, username, acctstarttime, acctsessiontime, acctinputoctets, acctoutputoctets)
       VALUES ($1, $2, now() + interval '1 minute', 60, 10, 10)`,
      [`uid-live-${card.code}`, card.code],
    );

    const results = await rollback();

    expect(await acctNameOf(card.foreignId)).toBe(card.code + '-old');
    expect(await rejectCount(card.code)).toBe(0);
    expect(await statusOf(card.code)).toBe('unused');

    const report = results.find((r) => r.rows?.[0]?.skipped_in_service !== undefined);
    expect(Number(report?.rows[0].skipped_in_service)).toBeGreaterThanOrEqual(1);
  });

  it('rollback leaves a card whose session was already open at repair time', async () => {
    const card = await seedCard({ limitType: 'data', limitValue: 1000, foreignUsage: 1500, reject: true });
    await addSession(card.code, { octets: 10, open: true });

    await run();
    await rollback();

    expect(await acctNameOf(card.foreignId)).toBe(card.code + '-old');
    expect(await rejectCount(card.code)).toBe(0);
    expect(await statusOf(card.code)).toBe('unused');
  });

  it('rollback leaves a card the operator reactivated since the repair', async () => {
    const card = await seedCard({ limitType: 'data', limitValue: 1000, foreignUsage: 1500, reject: true });

    await run();
    await q(`UPDATE ${schema}.voucher_meta SET status = 'active' WHERE id = $1`, [card.id]);
    await rollback();

    expect(await acctNameOf(card.foreignId)).toBe(card.code + '-old');
    expect(await rejectCount(card.code)).toBe(0);
    expect(await statusOf(card.code)).toBe('active');
  });

  it('rollback writes nothing for a card deleted since the repair', async () => {
    const card = await seedCard({ limitType: 'data', limitValue: 1000, foreignUsage: 1500, reject: true });

    await run();
    await q(`DELETE FROM ${schema}.voucher_meta WHERE id = $1`, [card.id]);
    await q(`DELETE FROM ${schema}.radcheck WHERE username = $1`, [card.code]);
    await rollback();

    expect(await rejectCount(card.code)).toBe(0);
  });

  it('a second rollback changes nothing', async () => {
    const card = await seedCard({ limitType: 'data', limitValue: 1000, foreignUsage: 1500, reject: true });

    await run();
    await rollback();
    await rollback();

    expect(await acctNameOf(card.foreignId)).toBe(card.code);
    expect(await rejectCount(card.code)).toBe(1);
    expect(await statusOf(card.code)).toBe('expired');
  });

  it('rollback restores the Expiration the latest repair removed when two repairs differ', async () => {
    const card = await seedRepairScenario();

    await run();
    await rollback();

    // The job recomputes from a longer validity, then the card is repaired again.
    const { formatRadiusExpiration: fmt } = await import('../utils/radius');
    const later = fmt(new Date(new Date('2026-10-20T08:00:00Z').getTime() + 172800 * 1000));
    await q(`UPDATE ${schema}.voucher_meta SET validity_seconds = 172800 WHERE id = $1`, [card.voucherId]);
    await q(
      `UPDATE ${schema}.radcheck SET value = $2 WHERE username = $1 AND attribute = 'Expiration'`,
      [card.code, later],
    );

    await run();
    await rollback();

    const exp = await q(
      `SELECT value FROM ${schema}.radcheck WHERE username = $1 AND attribute = 'Expiration'`,
      [card.code],
    );
    expect(exp.rows.map((r) => r.value)).toEqual([later]);
  });

  async function rollback(): Promise<{ rows: Record<string, unknown>[] }[]> {
    const { ROLLBACK_SQL } = await import('../scripts/repairReusedVoucherCodes');
    // Replace the public-schema table references with test schema ones
    const sql = ROLLBACK_SQL
      .replace(/\bradacct\b/g, `${schema}.radacct`)
      .replace(/\bradcheck\b/g, `${schema}.radcheck`)
      .replace(/\bvoucher_meta\b/g, `${schema}.voucher_meta`)
      .replace(/\bvoucher_code_reuse_repair_2026_10\b/g, `${schema}.voucher_code_reuse_repair_2026_10`);
    return (await q(sql)) as unknown as { rows: Record<string, unknown>[] }[];
  }
});

// ---- Schema-routing Pool wrapper ----

/**
 * Wraps a real pg.Pool so every query runs with search_path set to the test
 * schema. This lets the repair script call pool.query() and pool.connect()
 * without knowing about the schema prefix, while all table references land in
 * the isolated test schema.
 */
function buildSchemaPool(realPool: Pool, schema: string): Pool {
  const wrap = (query: Pool['query']): Pool['query'] => {
    return (async (...args: Parameters<Pool['query']>) => {
      const client = await realPool.connect();
      try {
        await client.query(`SET search_path = ${schema}, public`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (client.query as any)(...args);
      } finally {
        client.release();
      }
    }) as Pool['query'];
  };

  const proxy = Object.create(realPool) as Pool & { connect: () => Promise<import('pg').PoolClient> };
  proxy.query = wrap(realPool.query.bind(realPool));
  proxy.connect = async () => {
    const client = await realPool.connect();
    await client.query(`SET search_path = ${schema}, public`);
    return client;
  };
  return proxy;
}
