import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the encryption module (needed by routerOs.service, imported transitively)
vi.mock('../../utils/encryption', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace('enc:', ''),
}));

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;
const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<typeof vi.fn>;

import { updateVoucher } from '../voucher.service';

// Minimal VoucherMetaRow returned from the initial SELECT
function makeVoucherRow(status: string) {
  return {
    id: 'voucher-1',
    user_id: 'user-1',
    router_id: 'router-1',
    radius_username: 'testuser123',
    group_profile: null,
    comment: null,
    status,
    limit_type: 'time',
    limit_value: '3600',
    limit_unit: 'seconds',
    validity_seconds: 86400,
    price: '5.00',
    created_at: new Date(),
    updated_at: new Date(),
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
});

describe('updateVoucher – reactivation recovery path', () => {
  it('reactivating a disabled voucher deletes Auth-Type Reject and sets status active', async () => {
    // pool.query — ownership check (verifyRouterOwnership)
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    // pool.query — fetch existing voucher
    mockQuery.mockResolvedValueOnce({ rows: [makeVoucherRow('disabled')] });
    // pool.query — FIX 4 usage guard: usage=0 < limit=3600, no throw
    mockQuery.mockResolvedValueOnce({ rows: [{ total_used: '0' }] });
    // pool.query — batchFetchRadcheck (called by toVoucherInfo after commit)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // pool.query — batchFetchRadacct
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // client.query calls: BEGIN, UPDATE voucher_meta, DELETE Auth-Type, COMMIT
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeVoucherRow('active')], rowCount: 1 }) // UPDATE voucher_meta
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE Auth-Type
      .mockResolvedValueOnce({}); // COMMIT

    const result = await updateVoucher('user-1', 'router-1', 'voucher-1', { status: 'active' });
    expect(result.status).toBe('unused'); // status is re-computed by assembleVoucherInfo from radacct

    const calls = mockClientQuery.mock.calls as Array<[string, ...unknown[]]>;
    const deleteSql = calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('DELETE FROM radcheck') &&
        sql.includes("attribute = 'Auth-Type'"),
    );
    expect(deleteSql).toBeDefined();
  });

  it('reactivating an EXPIRED voucher also deletes Auth-Type Reject (previously blocked)', async () => {
    // pool.query — ownership check
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    // pool.query — fetch existing voucher with status=expired
    mockQuery.mockResolvedValueOnce({ rows: [makeVoucherRow('expired')] });
    // pool.query — FIX 4 usage guard: usage=0 < limit=3600, no throw
    mockQuery.mockResolvedValueOnce({ rows: [{ total_used: '0' }] });
    // pool.query — batchFetchRadcheck
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // pool.query — batchFetchRadacct
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // client.query calls: BEGIN, UPDATE voucher_meta, DELETE Auth-Type, COMMIT
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeVoucherRow('active')], rowCount: 1 }) // UPDATE voucher_meta
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE Auth-Type
      .mockResolvedValueOnce({}); // COMMIT

    await updateVoucher('user-1', 'router-1', 'voucher-1', { status: 'active' });

    const calls = mockClientQuery.mock.calls as Array<[string, ...unknown[]]>;
    const deleteSql = calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('DELETE FROM radcheck') &&
        sql.includes("attribute = 'Auth-Type'"),
    );
    // This assertion would have FAILED before the fix (expired was not handled)
    expect(deleteSql).toBeDefined();
  });

  it('disabling a voucher inserts Auth-Type := Reject', async () => {
    // pool.query — ownership check
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    // pool.query — fetch existing voucher
    mockQuery.mockResolvedValueOnce({ rows: [makeVoucherRow('active')] });
    // pool.query — FIX 3: sendCoaDisconnect router lookup (return empty → early exit)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // pool.query — batchFetchRadcheck
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // pool.query — batchFetchRadacct
    mockQuery.mockResolvedValueOnce({ rows: [] });

    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeVoucherRow('disabled')], rowCount: 1 }) // UPDATE voucher_meta
      .mockResolvedValueOnce({ rowCount: 0 }) // DELETE existing Auth-Type (cleanup)
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT Auth-Type := Reject
      .mockResolvedValueOnce({}); // COMMIT

    const result = await updateVoucher('user-1', 'router-1', 'voucher-1', { status: 'disabled' });
    expect(result.status).toBe('disabled');

    const calls = mockClientQuery.mock.calls as Array<[string, unknown[]]>;
    const insertSql = calls.find(
      ([sql, params]) =>
        typeof sql === 'string' &&
        sql.includes('INSERT INTO radcheck') &&
        Array.isArray(params) &&
        (params as string[]).includes('Auth-Type') &&
        (params as string[]).includes('Reject'),
    );
    expect(insertSql).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// FIX 4 — exhaustion guard on reactivation
// ---------------------------------------------------------------------------

describe('updateVoucher – FIX 4: exhaustion guard on reactivation', () => {
  it('(a) reactivating a time-limited expired voucher with usage >= limit throws VOUCHER_LIMIT_REACHED', async () => {
    // pool.query — ownership check
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    // pool.query — fetch existing voucher (expired, time limit 3600 s)
    mockQuery.mockResolvedValueOnce({ rows: [makeVoucherRow('expired')] });
    // pool.query — FIX 4 usage query: usage == limit (fully exhausted)
    mockQuery.mockResolvedValueOnce({ rows: [{ total_used: '3600' }] });

    await expect(
      updateVoucher('user-1', 'router-1', 'voucher-1', { status: 'active' }),
    ).rejects.toMatchObject({ code: 'VOUCHER_LIMIT_REACHED' });

    // No DB transaction should have been opened
    expect(mockClientQuery.mock.calls).toHaveLength(0);
  });

  it('(b) reactivating an expired voucher with usage < limit succeeds and deletes Auth-Type Reject', async () => {
    // pool.query — ownership check
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    // pool.query — fetch existing voucher (expired, time limit 3600 s)
    mockQuery.mockResolvedValueOnce({ rows: [makeVoucherRow('expired')] });
    // pool.query — FIX 4 usage query: usage < limit (false latch — safe to reactivate)
    mockQuery.mockResolvedValueOnce({ rows: [{ total_used: '100' }] });
    // pool.query — batchFetchRadcheck
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // pool.query — batchFetchRadacct
    mockQuery.mockResolvedValueOnce({ rows: [] });

    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeVoucherRow('active')], rowCount: 1 }) // UPDATE voucher_meta
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE Auth-Type
      .mockResolvedValueOnce({}); // COMMIT

    await updateVoucher('user-1', 'router-1', 'voucher-1', { status: 'active' });

    const calls = mockClientQuery.mock.calls as Array<[string, ...unknown[]]>;
    const deleteSql = calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('DELETE FROM radcheck') &&
        sql.includes("attribute = 'Auth-Type'"),
    );
    expect(deleteSql).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// FIX 5 — unused → active no-op
// ---------------------------------------------------------------------------

describe('updateVoucher – FIX 5: unused → active runs DELETE harmlessly', () => {
  it('status unused → active does not throw and runs the DELETE Auth-Type branch', async () => {
    // pool.query — ownership check
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    // pool.query — fetch existing voucher with status=unused (has a time limit)
    mockQuery.mockResolvedValueOnce({ rows: [makeVoucherRow('unused')] });
    // pool.query — FIX 4 usage guard: no usage yet, 0 < 3600, no throw
    mockQuery.mockResolvedValueOnce({ rows: [{ total_used: '0' }] });
    // pool.query — batchFetchRadcheck
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // pool.query — batchFetchRadacct
    mockQuery.mockResolvedValueOnce({ rows: [] });

    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeVoucherRow('active')], rowCount: 1 }) // UPDATE voucher_meta
      .mockResolvedValueOnce({ rowCount: 0 }) // DELETE Auth-Type (0 rows — harmless)
      .mockResolvedValueOnce({}); // COMMIT

    await expect(
      updateVoucher('user-1', 'router-1', 'voucher-1', { status: 'active' }),
    ).resolves.toBeDefined();

    // The DELETE Auth-Type branch must have run
    const calls = mockClientQuery.mock.calls as Array<[string, ...unknown[]]>;
    const deleteSql = calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('DELETE FROM radcheck') &&
        sql.includes("attribute = 'Auth-Type'"),
    );
    expect(deleteSql).toBeDefined();
  });
});
