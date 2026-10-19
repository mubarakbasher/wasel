import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the encryption module (needed by routerOs.service, imported transitively)
vi.mock('../../utils/encryption', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace('enc:', ''),
}));

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

import { getVoucherSalesReport } from '../report.service';

const OPEN_SESSION = 'ra.acctstoptime IS NULL';
const EXPIRATION_PASSED =
  "rc.attribute = 'Expiration' AND to_timestamp(rc.value, 'Month DD YYYY HH24:MI:SS') < NOW()";

/** Return the WHERE text of the `COUNT(*) FILTER (WHERE …)::int AS <alias>` clause. */
function filterClause(sql: string, alias: string): string {
  const clause = sql
    .split('COUNT(*) FILTER')
    .find((part) => part.includes(`AS ${alias}`));
  if (!clause) throw new Error(`no FILTER clause for ${alias}`);
  return clause.slice(0, clause.indexOf(`AS ${alias}`));
}

async function runReport() {
  mockQuery.mockResolvedValueOnce({
    rows: [
      { date: new Date('2026-10-18T00:00:00Z'), created: 10, used: 3, expired: 4, remaining: 2 },
      { date: new Date('2026-10-19T00:00:00Z'), created: 5, used: 1, expired: 0, remaining: 3 },
    ],
  });
  const report = await getVoucherSalesReport('user-1', '2026-10-18', '2026-10-19', 'router-1');
  const sql = mockQuery.mock.calls[0][0] as string;
  return { report, sql };
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe('getVoucherSalesReport – status counts', () => {
  it('does not count active/used from the stored status column', async () => {
    // voucher_meta.status is never advanced to 'active' or 'used' by any job,
    // so counting it showed Active ≈ 0 and Used = 0 on every router.
    const { sql } = await runReport();
    expect(sql).not.toContain("vm.status = 'active'");
    expect(sql).not.toContain("vm.status = 'used'");
  });

  it('counts Active (remaining) as an open session on a voucher that is not expired', async () => {
    const { sql } = await runReport();
    const active = filterClause(sql, 'remaining');
    expect(active).toContain(OPEN_SESSION);
    expect(active).toContain("vm.status != 'disabled'");
    expect(active).toContain("vm.status <> 'expired'");
    expect(active).toMatch(/NOT \(.*Expiration/s);
  });

  it('counts Used as sessions, none open, not expired', async () => {
    const { sql } = await runReport();
    const used = filterClause(sql, 'used');
    expect(used).toContain(`NOT EXISTS (SELECT 1 FROM radacct ra WHERE ra.username = vm.radius_username AND ${OPEN_SESSION})`);
    expect(used).toContain('EXISTS (SELECT 1 FROM radacct ra WHERE ra.username = vm.radius_username)');
    expect(used).toContain(`NOT EXISTS (SELECT 1 FROM radcheck rc WHERE rc.username = vm.radius_username AND ${EXPIRATION_PASSED})`);
    expect(used).toContain("vm.status <> 'expired'");
  });

  it('counts Expired as a passed validity window OR a used-up data/time limit', async () => {
    const { sql } = await runReport();
    const expired = filterClause(sql, 'expired');
    expect(expired).toContain(EXPIRATION_PASSED);
    expect(expired).toContain("vm.status = 'expired'");
    expect(expired).toMatch(/\) OR \(?vm\.status = 'expired'/);
  });

  it('keeps the response shape and sums totals', async () => {
    const { report } = await runReport();
    expect(report.rows).toEqual([
      { date: '2026-10-18', created: 10, used: 3, expired: 4, remaining: 2 },
      { date: '2026-10-19', created: 5, used: 1, expired: 0, remaining: 3 },
    ]);
    expect(report.totals).toEqual({ created: 15, used: 4, expired: 4, remaining: 5 });
  });
});
