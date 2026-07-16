import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { generateAccessToken } from '../services/token.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;
const mockClientQuery = (globalThis as Record<string, unknown>)
  .__mockClientQuery as ReturnType<typeof vi.fn>;

// Mock radclient.service so the CoA disconnect path never spawns a child process.
const mockSendDisconnectRequest = vi.fn().mockResolvedValue('ack');
vi.mock('../services/radclient.service', () => ({
  sendDisconnectRequest: (...args: unknown[]) => mockSendDisconnectRequest(...args),
  sendAccessRequest: vi.fn().mockResolvedValue('accept'),
}));

// Mock encryption so tests never require a real ENCRYPTION_KEY / decrypt.
vi.mock('../utils/encryption', () => ({
  decrypt: vi.fn().mockReturnValue('test-radius-secret'),
  encrypt: vi.fn().mockReturnValue('encrypted-value'),
  generateRadiusSecret: vi.fn().mockReturnValue('random-secret'),
  generateNasIdentifier: vi.fn().mockReturnValue('router-id'),
}));

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  userId: 'aaaaaaaa-0000-4000-8000-0000000000aa',
  email: 'admin-vouchers@example.com',
  name: 'Admin Vouchers',
  role: 'admin',
};

const REGULAR_USER = {
  userId: 'bbbbbbbb-0000-4000-8000-0000000000bb',
  email: 'user-vouchers@example.com',
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

const VOUCHER_ID = 'dddddddd-0000-4000-8000-0000000000d1';
const OWNER_ID = 'cccccccc-0000-4000-8000-0000000000c1';
const ROUTER_ID = 'eeeeeeee-0000-4000-8000-0000000000e1';

const now = new Date();

// voucher_meta row extended with the owner/router JOIN columns getAllVouchers selects.
const MOCK_JOIN_ROW = {
  id: VOUCHER_ID,
  user_id: OWNER_ID,
  router_id: ROUTER_ID,
  radius_username: '12345678',
  group_profile: null, // null → batchToVoucherInfo skips the radius_profiles query
  comment: null,
  status: 'unused',
  limit_type: 'time',
  limit_value: '3600',
  limit_unit: 'minutes',
  validity_seconds: 86400,
  price: '5',
  created_at: now,
  updated_at: now,
  owner_name: 'Owner One',
  owner_email: 'owner@example.com',
  router_name: 'Router One',
};

// A plain voucher_meta row (no JOIN columns) as returned by the owner-scoped services.
const MOCK_VOUCHER_ROW = {
  id: VOUCHER_ID,
  user_id: OWNER_ID,
  router_id: ROUTER_ID,
  radius_username: '12345678',
  group_profile: null,
  comment: null,
  status: 'active',
  limit_type: null,
  limit_value: null,
  limit_unit: null,
  validity_seconds: null,
  price: null,
  created_at: now,
  updated_at: now,
};

/**
 * Queue the two radcheck/radacct batch queries that batchToVoucherInfo issues
 * for a single username. The radius_profiles query is skipped because our rows
 * have group_profile = null.
 */
function queueBatchEnrichment(username = '12345678'): void {
  // 1. radcheck batch
  mockQuery.mockResolvedValueOnce({
    rows: [{ username, attribute: 'Cleartext-Password', value: username }],
  });
  // 2. radacct batch (no sessions)
  mockQuery.mockResolvedValueOnce({ rows: [] });
}

/** Find the getAllVouchers data query (contains owner_email; the count query does not). */
function findDataCall(calls: unknown[][]): [string, unknown[]] | undefined {
  return calls.find(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes('owner_email'),
  ) as [string, unknown[]] | undefined;
}

/** Find the getAllVouchers count query. */
function findCountCall(calls: unknown[][]): [string, unknown[]] | undefined {
  return calls.find(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes('COUNT(*)'),
  ) as [string, unknown[]] | undefined;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockSendDisconnectRequest.mockReset();
  mockSendDisconnectRequest.mockResolvedValue('ack');
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/vouchers
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/vouchers', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/vouchers');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await request(app).get('/api/v1/admin/vouchers').set(userAuth());
    expect(res.status).toBe(403);
  });

  it('lists vouchers with owner + router refs and pagination meta', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_JOIN_ROW] }); // data
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] }); // count
    queueBatchEnrichment();

    const res = await request(app).get('/api/v1/admin/vouchers').set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);

    const item = res.body.data[0];
    expect(item.id).toBe(VOUCHER_ID);
    expect(item.code).toBe('12345678');
    expect(item.status).toBe('unused'); // derived via the shared enrichment path
    expect(item.owner).toEqual({ id: OWNER_ID, name: 'Owner One', email: 'owner@example.com' });
    expect(item.router).toEqual({ id: ROUTER_ID, name: 'Router One' });

    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
  });

  it('data query JOINs users + routers and orders by created_at desc', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // data (empty → no batch queries)
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // count

    const res = await request(app).get('/api/v1/admin/vouchers').set(adminAuth());
    expect(res.status).toBe(200);

    const dataCall = findDataCall(mockQuery.mock.calls);
    expect(dataCall).toBeDefined();
    const sql = dataCall![0];
    expect(sql).toContain('JOIN users u ON vm.user_id = u.id');
    expect(sql).toContain('JOIN routers r ON vm.router_id = r.id');
    expect(sql).toContain('ORDER BY vm.created_at DESC');
  });

  it('status=active injects the derived-status EXISTS fragment (identical to operator SQL)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // data
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // count

    const res = await request(app)
      .get('/api/v1/admin/vouchers?status=active')
      .set(adminAuth());
    expect(res.status).toBe(200);

    const dataCall = findDataCall(mockQuery.mock.calls);
    expect(dataCall![0]).toContain(
      "EXISTS (SELECT 1 FROM radacct ra WHERE ra.username = vm.radius_username AND ra.acctstoptime IS NULL)",
    );
  });

  it('search filters across code/owner/router with a single bound ILIKE param', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // data
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // count

    const res = await request(app)
      .get('/api/v1/admin/vouchers?search=foo')
      .set(adminAuth());
    expect(res.status).toBe(200);

    const dataCall = findDataCall(mockQuery.mock.calls);
    const sql = dataCall![0];
    const params = dataCall![1];
    expect(sql).toContain('vm.radius_username ILIKE');
    expect(sql).toContain('u.name ILIKE');
    expect(sql).toContain('u.email ILIKE');
    expect(sql).toContain('r.name ILIKE');
    expect(params).toContain('%foo%');
  });

  it('routerId + userId filters are bound parameters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // data
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // count

    const res = await request(app)
      .get(`/api/v1/admin/vouchers?routerId=${ROUTER_ID}&userId=${OWNER_ID}`)
      .set(adminAuth());
    expect(res.status).toBe(200);

    const dataCall = findDataCall(mockQuery.mock.calls);
    const params = dataCall![1];
    expect(dataCall![0]).toContain('vm.router_id = $');
    expect(dataCall![0]).toContain('vm.user_id = $');
    expect(params).toContain(ROUTER_ID);
    expect(params).toContain(OWNER_ID);
  });

  it('count query does not select the display columns', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // data
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // count

    await request(app).get('/api/v1/admin/vouchers').set(adminAuth());

    const countCall = findCountCall(mockQuery.mock.calls);
    expect(countCall).toBeDefined();
    expect(countCall![0]).not.toContain('owner_email');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/vouchers/:id
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/vouchers/:id', () => {
  it('returns 404 when the voucher is unknown', async () => {
    // getVoucherContext SELECT → empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/v1/admin/vouchers/${VOUCHER_ID}`)
      .set(adminAuth());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('VOUCHER_NOT_FOUND');
  });

  it('returns the operator voucher detail plus owner + router', async () => {
    // getVoucherContext SELECT
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          user_id: OWNER_ID,
          router_id: ROUTER_ID,
          owner_name: 'Owner One',
          owner_email: 'owner@example.com',
          router_name: 'Router One',
        },
      ],
    });
    // getVoucherById → verifyRouterOwnership SELECT tunnel_ip
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    // getVoucherById → SELECT voucher_meta
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_VOUCHER_ROW] });
    // batchToVoucherInfo (radcheck, radacct)
    queueBatchEnrichment();

    const res = await request(app)
      .get(`/api/v1/admin/vouchers/${VOUCHER_ID}`)
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(VOUCHER_ID);
    expect(res.body.data.username).toBe('12345678');
    expect(res.body.data.owner).toEqual({ id: OWNER_ID, name: 'Owner One', email: 'owner@example.com' });
    expect(res.body.data.router).toEqual({ id: ROUTER_ID, name: 'Router One' });
  });
});

// ---------------------------------------------------------------------------
// PUT /api/v1/admin/vouchers/:id
// ---------------------------------------------------------------------------

describe('PUT /api/v1/admin/vouchers/:id', () => {
  it('rejects an invalid status value (Zod)', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/vouchers/${VOUCHER_ID}`)
      .set(adminAuth())
      .send({ status: 'bogus' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when the voucher is unknown', async () => {
    // resolveVoucherOwner SELECT → empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put(`/api/v1/admin/vouchers/${VOUCHER_ID}`)
      .set(adminAuth())
      .send({ status: 'disabled' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('VOUCHER_NOT_FOUND');
  });

  it('disabling writes the Auth-Type := Reject RADIUS mutation + a voucher.update audit row', async () => {
    // resolveVoucherOwner SELECT
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, router_id: ROUTER_ID }] });
    // updateVoucher → verifyRouterOwnership SELECT tunnel_ip
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    // updateVoucher → SELECT voucher_meta (currently active)
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_VOUCHER_ROW] });

    // Transaction
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ ...MOCK_VOUCHER_ROW, status: 'disabled' }] }) // UPDATE voucher_meta
      .mockResolvedValueOnce(undefined) // DELETE Auth-Type
      .mockResolvedValueOnce(undefined) // INSERT Auth-Type := Reject
      .mockResolvedValueOnce(undefined); // COMMIT

    // sendCoaDisconnect router lookup → empty → early return
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // toVoucherInfo enrichment (radcheck, radacct)
    queueBatchEnrichment();
    // audit_logs INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put(`/api/v1/admin/vouchers/${VOUCHER_ID}`)
      .set(adminAuth())
      .send({ status: 'disabled' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('disabled');

    // RADIUS mutation: INSERT Auth-Type := Reject
    const insertAuthType = mockClientQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('INSERT INTO radcheck') &&
        (c[1] as unknown[]).includes('Auth-Type'),
    );
    expect(insertAuthType).toBeDefined();
    expect(insertAuthType![1] as unknown[]).toContain('Reject');

    // Audit row
    const auditCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('audit_logs'),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toEqual(
      expect.arrayContaining([ADMIN_USER.userId, 'voucher.update', 'voucher', VOUCHER_ID]),
    );
  });

  it('surfaces the service 409 when reactivating an exhausted voucher', async () => {
    // resolveVoucherOwner SELECT
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, router_id: ROUTER_ID }] });
    // updateVoucher → verifyRouterOwnership SELECT tunnel_ip
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    // updateVoucher → SELECT voucher_meta: disabled, time-limited, has a limit_value
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...MOCK_VOUCHER_ROW, status: 'disabled', limit_type: 'time', limit_value: '3600' }],
    });
    // reactivation guard usage SELECT → already over the limit
    mockQuery.mockResolvedValueOnce({ rows: [{ total_used: '7200' }] });

    const res = await request(app)
      .put(`/api/v1/admin/vouchers/${VOUCHER_ID}`)
      .set(adminAuth())
      .send({ status: 'active' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VOUCHER_LIMIT_REACHED');

    // No audit row on failure
    const auditCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('audit_logs'),
    );
    expect(auditCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/admin/vouchers/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/admin/vouchers/:id', () => {
  it('returns 404 when the voucher is unknown', async () => {
    // resolveVoucherOwner SELECT → empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete(`/api/v1/admin/vouchers/${VOUCHER_ID}`)
      .set(adminAuth());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('VOUCHER_NOT_FOUND');
  });

  it('purges RADIUS rows + voucher_meta and writes a voucher.delete audit row', async () => {
    // resolveVoucherOwner SELECT
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, router_id: ROUTER_ID }] });
    // deleteVoucher → verifyRouterOwnership SELECT tunnel_ip
    mockQuery.mockResolvedValueOnce({ rows: [{ tunnel_ip: '10.10.0.2' }] });
    // deleteVoucher → SELECT voucher_meta
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_VOUCHER_ROW] });

    // Transaction
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // DELETE radcheck
      .mockResolvedValueOnce(undefined) // DELETE radreply
      .mockResolvedValueOnce(undefined) // DELETE radusergroup
      .mockResolvedValueOnce(undefined) // DELETE voucher_meta
      .mockResolvedValueOnce(undefined); // COMMIT

    // sendCoaDisconnect router lookup → empty → early return
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // audit_logs INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete(`/api/v1/admin/vouchers/${VOUCHER_ID}`)
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const clientSql = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(clientSql.some((q) => q.includes('DELETE FROM radcheck'))).toBe(true);
    expect(clientSql.some((q) => q.includes('DELETE FROM radreply'))).toBe(true);
    expect(clientSql.some((q) => q.includes('DELETE FROM radusergroup'))).toBe(true);
    expect(clientSql.some((q) => q.includes('DELETE FROM voucher_meta'))).toBe(true);

    const auditCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('audit_logs'),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toEqual(
      expect.arrayContaining([ADMIN_USER.userId, 'voucher.delete', 'voucher', VOUCHER_ID]),
    );
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).delete(`/api/v1/admin/vouchers/${VOUCHER_ID}`);
    expect(res.status).toBe(401);
  });
});
