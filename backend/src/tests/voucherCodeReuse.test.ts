/**
 * Unit tests for the voucherCodeReuse classifier.
 *
 * Table-driven: one scenario per verdict / flag combination. These run under
 * vitest with the global pg mock in place; the classifier has no pg import so
 * the mock is irrelevant here — tests are fully synchronous.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyCard,
  REUSE_CUTOVER,
  RETIRED_SUFFIX,
  type ClassifyInput,
  type RadacctRow,
} from '../utils/voucherCodeReuse';
import { formatRadiusExpiration } from '../utils/radius';

// ---- helpers ----

/** A card created well after REUSE_CUTOVER */
const AFTER = new Date('2026-10-28T10:00:00Z');
/** A card created before REUSE_CUTOVER */
const BEFORE = new Date('2026-10-15T12:00:00Z');

/** Build a closed foreign row: starts before createdAt, stops after */
function foreignRow(overrides: Partial<RadacctRow> = {}): RadacctRow {
  return {
    radacctid: 1n,
    acctstarttime: new Date('2026-10-20T08:00:00Z'), // before AFTER card
    acctstoptime: new Date('2026-10-20T09:00:00Z'),
    acctsessiontime: 3600,
    acctinputoctets: 1000n,
    acctoutputoctets: 500n,
    ...overrides,
  };
}

/** Build a native row: starts at or after createdAt */
function nativeRow(overrides: Partial<RadacctRow> = {}): RadacctRow {
  return {
    radacctid: 2n,
    acctstarttime: new Date('2026-10-29T08:00:00Z'), // after AFTER card
    acctstoptime: new Date('2026-10-29T09:30:00Z'),
    acctsessiontime: 5400,
    acctinputoctets: 2000n,
    acctoutputoctets: 1000n,
    ...overrides,
  };
}

function base(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    createdAt: AFTER,
    status: 'unused',
    limitType: null,
    limitValue: null,
    validitySeconds: 0,
    expiration: null,
    hasReject: false,
    rows: [],
    ...overrides,
  };
}

// ---- tests ----

describe('classifyCard', () => {
  it('RETIRED_SUFFIX is -old', () => {
    expect(RETIRED_SUFFIX).toBe('-old');
  });

  it('REUSE_CUTOVER is 2026-10-19T19:10:00Z', () => {
    expect(REUSE_CUTOVER.toISOString()).toBe('2026-10-19T19:10:00.000Z');
  });

  it('clean — no rows at all', () => {
    const r = classifyCard(base());
    expect(r.verdict).toBe('clean');
    expect(r.renameRowIds).toHaveLength(0);
    expect(r.deleteExpiration).toBe(false);
    expect(r.deleteReject).toBe(false);
    expect(r.resetStatus).toBe(false);
  });

  it('clean — only native rows (acctstarttime >= createdAt)', () => {
    const r = classifyCard(base({ rows: [nativeRow()] }));
    expect(r.verdict).toBe('clean');
  });

  it('clean — NULL acctstarttime row is not foreign', () => {
    const row: RadacctRow = {
      radacctid: 9n,
      acctstarttime: null,
      acctstoptime: null,
      acctsessiontime: null,
      acctinputoctets: null,
      acctoutputoctets: null,
    };
    const r = classifyCard(base({ rows: [row] }));
    expect(r.verdict).toBe('clean');
  });

  it('pre_cutover — card created before REUSE_CUTOVER with foreign rows — report only, no actions', () => {
    const r = classifyCard(
      base({
        createdAt: BEFORE,
        rows: [
          {
            radacctid: 3n,
            acctstarttime: new Date('2026-10-10T06:00:00Z'),
            acctstoptime: new Date('2026-10-10T07:00:00Z'),
            acctsessiontime: 3600,
            acctinputoctets: 500n,
            acctoutputoctets: 500n,
          },
        ],
      }),
    );
    expect(r.verdict).toBe('pre_cutover');
    expect(r.renameRowIds).toHaveLength(0);
    expect(r.deleteExpiration).toBe(false);
    expect(r.deleteReject).toBe(false);
  });

  it('deferred_open_row — foreign row with acctstoptime NULL', () => {
    const openForeign: RadacctRow = {
      ...foreignRow({ radacctid: 10n }),
      acctstoptime: null,
    };
    const r = classifyCard(base({ rows: [openForeign] }));
    expect(r.verdict).toBe('deferred_open_row');
    expect(r.renameRowIds).toHaveLength(0);
  });

  it('repair — fully foreign unsold card: rename, no reject/expiration to clean', () => {
    const r = classifyCard(
      base({
        status: 'unused',
        rows: [foreignRow({ radacctid: 5n }), foreignRow({ radacctid: 6n })],
      }),
    );
    expect(r.verdict).toBe('repair');
    expect(r.renameRowIds).toEqual([5n, 6n]);
    expect(r.deleteExpiration).toBe(false);
    expect(r.deleteReject).toBe(false);
    expect(r.resetStatus).toBe(false);
  });

  it('repair — mixed card: only foreign rows get renamed, native row id not included', () => {
    const fr = foreignRow({ radacctid: 7n });
    const nr = nativeRow({ radacctid: 8n });
    const r = classifyCard(base({ rows: [fr, nr] }));
    expect(r.verdict).toBe('repair');
    expect(r.renameRowIds).toEqual([7n]);
  });

  it('repair — Expiration matches job formula: deleteExpiration=true', () => {
    const validitySeconds = 86400; // 1 day
    const foreignStart = new Date('2026-10-20T08:00:00Z');
    const expectedExp = formatRadiusExpiration(
      new Date(foreignStart.getTime() + validitySeconds * 1000),
    );
    const r = classifyCard(
      base({
        status: 'expired',
        limitType: 'time',
        limitValue: 7200n,
        validitySeconds,
        expiration: expectedExp,
        hasReject: false,
        rows: [foreignRow({ radacctid: 11n, acctstarttime: foreignStart, acctsessiontime: 7200 })],
      }),
    );
    expect(r.verdict).toBe('repair');
    expect(r.deleteExpiration).toBe(true);
    expect(r.expirationKept).toBe(false);
  });

  it('repair — operator-set Expiration (value does not match job formula): expirationKept=true', () => {
    const r = classifyCard(
      base({
        validitySeconds: 86400,
        expiration: 'January 01 2027 00:00:00', // operator-set, not job-computed
        rows: [foreignRow({ radacctid: 12n })],
      }),
    );
    expect(r.verdict).toBe('repair');
    expect(r.deleteExpiration).toBe(false);
    expect(r.expirationKept).toBe(true);
  });

  it('repair — disabled card: rows renamed, reject and status never touched', () => {
    const r = classifyCard(
      base({
        status: 'disabled',
        hasReject: true,
        limitType: 'time',
        limitValue: 3600n,
        rows: [foreignRow({ radacctid: 13n, acctsessiontime: 3600 })],
      }),
    );
    expect(r.verdict).toBe('repair');
    expect(r.renameRowIds).toEqual([13n]);
    expect(r.deleteReject).toBe(false);
    expect(r.resetStatus).toBe(false);
    // rejectKept should also be false since disabled cards skip the whole block
    expect(r.rejectKept).toBe(false);
  });

  it('repair — genuinely exhausted card: real usage alone meets limit, rejectKept=true', () => {
    // limitValue = 3600s; native row = 4000s; even without foreign row it is over limit.
    const r = classifyCard(
      base({
        status: 'expired',
        limitType: 'time',
        limitValue: 3600n,
        hasReject: true,
        rows: [
          foreignRow({ radacctid: 20n, acctsessiontime: 1800 }),
          nativeRow({ radacctid: 21n, acctsessiontime: 4000 }),
        ],
      }),
    );
    expect(r.verdict).toBe('repair');
    expect(r.deleteReject).toBe(false);
    expect(r.rejectKept).toBe(true);
    expect(r.renameRowIds).toEqual([20n]);
  });

  it('repair — usage-burned by foreign rows only: deleteReject=true, resetStatus=true', () => {
    // limitValue = 3600s; foreign contributes 3700s, native 0s.
    const r = classifyCard(
      base({
        status: 'expired',
        limitType: 'time',
        limitValue: 3600n,
        hasReject: true,
        rows: [foreignRow({ radacctid: 30n, acctsessiontime: 3700 })],
      }),
    );
    expect(r.verdict).toBe('repair');
    expect(r.deleteReject).toBe(true);
    expect(r.resetStatus).toBe(true);
    expect(r.renameRowIds).toEqual([30n]);
  });

  it('repair — data limit with NULL octets: NULL row contributes 0', () => {
    // limitValue = 1000 bytes; foreign null-octet row contributes 0; native 500 bytes.
    const nullOctetForeign: RadacctRow = {
      ...foreignRow({ radacctid: 40n }),
      acctinputoctets: null,
      acctoutputoctets: null,
    };
    const r = classifyCard(
      base({
        status: 'expired',
        limitType: 'data',
        limitValue: 1000n,
        hasReject: true,
        rows: [
          nullOctetForeign,
          nativeRow({ radacctid: 41n, acctinputoctets: 500n, acctoutputoctets: 100n }),
        ],
      }),
    );
    expect(r.verdict).toBe('repair');
    // native usage = 600, foreign = 0, total = 600 < 1000 → not over limit with foreign
    // deleteReject stays false, rejectKept true
    expect(r.deleteReject).toBe(false);
    expect(r.rejectKept).toBe(true);
  });

  it('repair — data limit burned by foreign rows: deleteReject=true', () => {
    // limitValue = 1000 bytes; foreign = 1500 bytes; native = 0.
    const r = classifyCard(
      base({
        status: 'expired',
        limitType: 'data',
        limitValue: 1000n,
        hasReject: true,
        rows: [foreignRow({ radacctid: 50n, acctinputoctets: 800n, acctoutputoctets: 700n })],
      }),
    );
    expect(r.verdict).toBe('repair');
    expect(r.deleteReject).toBe(true);
    expect(r.resetStatus).toBe(true);
  });

  it('repair — no expiration and validitySeconds=0 means no expiration work', () => {
    const r = classifyCard(
      base({
        validitySeconds: 0,
        expiration: null,
        rows: [foreignRow({ radacctid: 60n })],
      }),
    );
    expect(r.verdict).toBe('repair');
    expect(r.deleteExpiration).toBe(false);
    expect(r.expirationKept).toBe(false);
  });
});

describe('classifyCard boundaries', () => {
  it('keeps the Reject on a card exhausted exactly at its limit by its own sessions', () => {
    const r = classifyCard(base({
      status: 'expired',
      limitType: 'time',
      limitValue: 5400n,
      hasReject: true,
      rows: [foreignRow(), nativeRow()],
    }));

    expect(r.verdict).toBe('repair');
    expect(r.deleteReject).toBe(false);
    expect(r.rejectKept).toBe(true);
  });

  it('treats a row stamped exactly at created_at as the card\'s own', () => {
    const r = classifyCard(base({ rows: [foreignRow({ acctstarttime: AFTER })] }));

    expect(r.verdict).toBe('clean');
  });

  it('repairs a card created exactly at the cutover', () => {
    const r = classifyCard(base({
      createdAt: REUSE_CUTOVER,
      rows: [foreignRow({ acctstarttime: new Date('2026-10-19T18:00:00Z') })],
    }));

    expect(r.verdict).toBe('repair');
  });
});
