import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { generateAccessToken } from '../services/token.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

const BOM = '﻿';

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  userId: 'aaaaaaaa-0000-4000-8000-0000000000aa',
  email: 'admin-export@example.com',
  name: 'Admin Export',
  role: 'admin',
};

const REGULAR_USER = {
  userId: 'bbbbbbbb-0000-4000-8000-0000000000bb',
  email: 'user-export@example.com',
  name: 'Regular User',
  role: 'user',
};

function adminAuth(): Record<string, string> {
  return { Authorization: `Bearer ${generateAccessToken(ADMIN_USER)}` };
}

function userAuth(): Record<string, string> {
  return { Authorization: `Bearer ${generateAccessToken(REGULAR_USER)}` };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'cccccccc-0000-4000-8000-0000000000c1';

const USER_ROW = {
  id: USER_ID,
  name: 'Alice',
  email: 'alice@example.com',
  phone: null,
  business_name: 'Acme Wi-Fi',
  is_verified: true,
  is_active: true,
  role: 'user',
  created_at: '2026-07-01T00:00:00.000Z',
};

const SUB_ROW = {
  id: 'dddddddd-0000-4000-8000-0000000000d1',
  user_id: USER_ID,
  plan_tier: 'professional',
  status: 'active',
  start_date: '2026-06-01T00:00:00.000Z',
  end_date: '2026-07-01T00:00:00.000Z',
  voucher_quota: 2000,
  vouchers_used: 15,
  created_at: '2026-06-01T00:00:00.000Z',
  user_name: 'Alice',
  user_email: 'alice@example.com',
};

const PAYMENT_ROW = {
  id: 'eeeeeeee-0000-4000-8000-0000000000e1',
  user_id: USER_ID,
  amount: 5000,
  status: 'approved',
  plan_tier: 'professional',
  currency: 'SDG',
  reference_code: 'REF-123',
  receipt_url: 'https://example.com/receipt.png',
  rejection_reason: null,
  reviewed_by: null,
  reviewed_at: null,
  created_at: '2026-06-15T00:00:00.000Z',
  user_name: 'Alice',
  user_email: 'alice@example.com',
  plan_name: 'Professional',
};

const AUDIT_ROW = {
  id: 'ffffffff-0000-4000-8000-0000000000f1',
  admin_id: ADMIN_USER.userId,
  action: 'user.update',
  target_entity: 'user',
  target_id: USER_ID,
  details: { field: 'name', to: 'Bob' },
  ip_address: '10.0.0.1',
  created_at: '2026-06-20T00:00:00.000Z',
  admin_name: 'Admin Export',
  admin_email: 'admin@example.com',
};

/** Queue the [data, count] pair every list service issues via Promise.all. */
function queueList(dataRows: unknown[], total: number): void {
  mockQuery.mockResolvedValueOnce({ rows: dataRows }); // data
  mockQuery.mockResolvedValueOnce({ rows: [{ count: String(total) }] }); // count
}

/** The audit_logs INSERT the export controllers write after streaming. */
function findExportAudit(): [string, unknown[]] | undefined {
  return mockQuery.mock.calls.find(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO audit_logs'),
  ) as [string, unknown[]] | undefined;
}

/** The list "data" query — the one that carries the LIMIT/OFFSET bound params. */
function findRowCapCall(): [string, unknown[]] | undefined {
  return mockQuery.mock.calls.find(
    (c) => Array.isArray(c[1]) && (c[1] as unknown[]).includes(10000),
  ) as [string, unknown[]] | undefined;
}

beforeEach(() => {
  mockQuery.mockReset();
});

// ---------------------------------------------------------------------------
// Auth / RBAC
// ---------------------------------------------------------------------------

describe('CSV export auth', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/users/export');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await request(app).get('/api/v1/admin/users/export').set(userAuth());
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/users/export
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/users/export', () => {
  it('returns a CSV attachment with the correct headers, BOM, and columns', async () => {
    queueList([USER_ROW], 1);

    const res = await request(app).get('/api/v1/admin/users/export').set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="wasel-users-\d{4}-\d{2}-\d{2}\.csv"$/,
    );

    // Body leads with the UTF-8 BOM so Excel autodetects encoding.
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text.startsWith(BOM)).toBe(true);

    const withoutBom = res.text.slice(BOM.length);
    expect(withoutBom.startsWith('ID,Name,Email,Business Name,Verified,Active,Created At\r\n')).toBe(true);
    expect(res.text).toContain('Alice');
    expect(res.text).toContain('alice@example.com');
    expect(res.text).toContain('Acme Wi-Fi');
  });

  it('does NOT hit the /users/:id handler (literal path must not 400 on uuid validation)', async () => {
    queueList([], 0);

    const res = await request(app).get('/api/v1/admin/users/export').set(adminAuth());

    // If routing matched /users/:id, userIdParamSchema would 400 "export".
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(400);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.text.startsWith(BOM)).toBe(true);
  });

  it('passes the 10000 row cap to the list service', async () => {
    queueList([], 0);

    await request(app).get('/api/v1/admin/users/export').set(adminAuth());

    expect(findRowCapCall()).toBeDefined();
  });

  it('forwards search + status filters as bound params', async () => {
    queueList([], 0);

    await request(app)
      .get('/api/v1/admin/users/export?search=foo&status=active')
      .set(adminAuth());

    const dataCall = findRowCapCall();
    expect(dataCall).toBeDefined();
    expect(dataCall![0]).toContain('ILIKE');
    expect(dataCall![1]).toContain('%foo%');
  });

  it('writes a users.export_csv audit row with filters + rowCount', async () => {
    queueList([USER_ROW], 1);

    await request(app).get('/api/v1/admin/users/export?search=foo').set(adminAuth());

    const audit = findExportAudit();
    expect(audit).toBeDefined();
    expect(audit![1]).toEqual(
      expect.arrayContaining([ADMIN_USER.userId, 'users.export_csv', 'users', 'export']),
    );
    // details (5th param) is JSON-stringified {filters, rowCount}.
    const details = JSON.parse(audit![1][4] as string) as { filters: unknown; rowCount: number };
    expect(details.rowCount).toBe(1);
    expect(details.filters).toMatchObject({ search: 'foo' });
  });
});

// ---------------------------------------------------------------------------
// GET /admin/subscriptions/export
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/subscriptions/export', () => {
  it('returns the subscriptions CSV with usage + quota columns', async () => {
    queueList([SUB_ROW], 1);

    const res = await request(app).get('/api/v1/admin/subscriptions/export').set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="wasel-subscriptions-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const header = res.text.slice(BOM.length).split('\r\n')[0];
    expect(header).toBe(
      'ID,User Name,User Email,Plan Tier,Status,Start Date,End Date,Vouchers Used,Voucher Quota',
    );
    expect(res.text).toContain('professional');
    expect(res.text).toContain('15'); // vouchers_used
    expect(res.text).toContain('2000'); // voucher_quota
  });

  it('forwards the userId filter as a bound param and writes the audit row', async () => {
    queueList([], 0);

    await request(app)
      .get(`/api/v1/admin/subscriptions/export?userId=${USER_ID}`)
      .set(adminAuth());

    const dataCall = findRowCapCall();
    expect(dataCall![1]).toContain(USER_ID);

    const audit = findExportAudit();
    expect(audit![1]).toEqual(
      expect.arrayContaining([ADMIN_USER.userId, 'subscriptions.export_csv', 'subscriptions', 'export']),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /admin/payments/export
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/payments/export', () => {
  it('returns the payments CSV with the resolved plan name', async () => {
    queueList([PAYMENT_ROW], 1);

    const res = await request(app).get('/api/v1/admin/payments/export').set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="wasel-payments-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const header = res.text.slice(BOM.length).split('\r\n')[0];
    expect(header).toBe(
      'ID,User Name,User Email,Plan,Amount,Currency,Reference Code,Status,Rejection Reason,Created At',
    );
    expect(res.text).toContain('Professional'); // plan_name
    expect(res.text).toContain('REF-123');
    expect(res.text).toContain('5000');
  });

  it('forwards the status filter and writes a payments.export_csv audit row', async () => {
    queueList([], 0);

    await request(app).get('/api/v1/admin/payments/export?status=approved').set(adminAuth());

    const dataCall = findRowCapCall();
    expect(dataCall![1]).toContain('approved');

    const audit = findExportAudit();
    expect(audit![1]).toEqual(
      expect.arrayContaining([ADMIN_USER.userId, 'payments.export_csv', 'payments', 'export']),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /admin/audit-logs/export
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/audit-logs/export', () => {
  it('returns the audit-logs CSV with JSON-stringified details', async () => {
    queueList([AUDIT_ROW], 1);

    const res = await request(app).get('/api/v1/admin/audit-logs/export').set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="wasel-audit-logs-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const header = res.text.slice(BOM.length).split('\r\n')[0];
    expect(header).toBe(
      'Created At,Admin Name,Admin Email,Action,Target Entity,Target ID,IP Address,Details',
    );
    // details serialized as JSON and quote-escaped ("" for embedded quotes).
    expect(res.text).toContain('""field"":""name""');
    expect(res.text).toContain('user.update');
  });

  it('forwards action + targetEntity filters and writes an audit_logs.export_csv row', async () => {
    queueList([], 0);

    await request(app)
      .get('/api/v1/admin/audit-logs/export?action=login&targetEntity=user')
      .set(adminAuth());

    const audit = findExportAudit();
    expect(audit).toBeDefined();
    expect(audit![1]).toEqual(
      expect.arrayContaining([ADMIN_USER.userId, 'audit_logs.export_csv', 'audit_logs', 'export']),
    );
    const details = JSON.parse(audit![1][4] as string) as { filters: Record<string, unknown> };
    expect(details.filters).toMatchObject({ action: 'login', targetEntity: 'user' });
  });
});

// ---------------------------------------------------------------------------
// Audit-log date filters — date-only <input type="date"> vs full ISO datetime
// (Fix 1: `.datetime()` alone 400'd on YYYY-MM-DD; both list + export widen it)
// ---------------------------------------------------------------------------

/** Any query over audit_logs (data or count) carrying bound params. */
function findAuditParamsCall(): [string, unknown[]] | undefined {
  return mockQuery.mock.calls.find(
    (c) =>
      typeof c[0] === 'string' &&
      (c[0] as string).includes('FROM audit_logs') &&
      Array.isArray(c[1]),
  ) as [string, unknown[]] | undefined;
}

describe('GET /api/v1/admin/audit-logs/export — date filters', () => {
  it('widens a single-day date-only from==to range to an inclusive day boundary', async () => {
    queueList([AUDIT_ROW], 1);

    const res = await request(app)
      .get('/api/v1/admin/audit-logs/export?from=2026-07-01&to=2026-07-01')
      .set(adminAuth());

    expect(res.status).toBe(200);
    const dataCall = findRowCapCall();
    expect(dataCall).toBeDefined();
    // from → start of day, to → end of day, so a same-day range is inclusive.
    expect(dataCall![1]).toContain('2026-07-01T00:00:00.000Z');
    expect(dataCall![1]).toContain('2026-07-01T23:59:59.999Z');
  });

  it('passes a full ISO datetime through unchanged', async () => {
    queueList([], 0);

    await request(app)
      .get('/api/v1/admin/audit-logs/export?from=2026-07-01T08:30:00.000Z')
      .set(adminAuth());

    const dataCall = findRowCapCall();
    expect(dataCall![1]).toContain('2026-07-01T08:30:00.000Z');
  });

  it('rejects a garbage date string with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .get('/api/v1/admin/audit-logs/export?from=not-a-date')
      .set(adminAuth());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/admin/audit-logs — date filters (list)', () => {
  it('widens date-only from/to and forwards the transformed values as bound params', async () => {
    queueList([AUDIT_ROW], 1);

    const res = await request(app)
      .get('/api/v1/admin/audit-logs?from=2026-07-01&to=2026-07-15')
      .set(adminAuth());

    expect(res.status).toBe(200);
    const dataCall = findAuditParamsCall();
    expect(dataCall).toBeDefined();
    expect(dataCall![1]).toContain('2026-07-01T00:00:00.000Z');
    expect(dataCall![1]).toContain('2026-07-15T23:59:59.999Z');
  });

  it('rejects a garbage date string with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .get('/api/v1/admin/audit-logs?to=13/07/2026')
      .set(adminAuth());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Users status filter — 'suspended' must map to is_active = false
// (Fix 5: getUsers only handled 'active'/'inactive', so 'suspended' was a no-op)
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/users/export — suspended status filter', () => {
  it('maps status=suspended to the is_active = false predicate', async () => {
    queueList([], 0);

    await request(app).get('/api/v1/admin/users/export?status=suspended').set(adminAuth());

    const dataCall = findRowCapCall();
    expect(dataCall).toBeDefined();
    expect(dataCall![0]).toContain('is_active = false');
  });
});
