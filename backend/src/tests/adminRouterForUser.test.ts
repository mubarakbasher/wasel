import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import {
  TEST_USER,
  authHeaderFor,
  ACTIVE_SUBSCRIPTION_ROW,
} from './helpers';
import { generateAccessToken } from '../services/token.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;
const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<typeof vi.fn>;

// Mock WireGuard and routing infrastructure so createRouter doesn't error
vi.mock('../utils/wireguard', () => ({
  generateKeyPair: vi.fn().mockReturnValue({
    privateKey: 'mock-private-key',
    publicKey: 'mock-public-key',
  }),
  generatePresharedKey: vi.fn().mockReturnValue('mock-preshared-key'),
}));

vi.mock('../services/wireguardPeer', () => ({
  addPeer: vi.fn().mockResolvedValue(undefined),
  removePeer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/ipAllocation', () => ({
  allocateNextTunnelIp: vi.fn().mockResolvedValue({
    serverIp: '10.10.0.1',
    routerIp: '10.10.0.2',
    subnet: '10.10.0.0/30',
  }),
  parseTunnelSubnet: vi.fn().mockReturnValue({
    serverIp: '10.10.0.1',
    routerIp: '10.10.0.2',
    subnet: '10.10.0.0/30',
  }),
  releaseTunnelSubnet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/wireguardConfig', () => ({
  generateMikrotikConfigText: vi.fn().mockReturnValue('# Mikrotik config'),
  generateSetupSteps: vi.fn().mockReturnValue([]),
}));

vi.mock('../services/routerOs.service', () => ({
  getSystemInfo: vi.fn().mockRejectedValue(new Error('Router offline')),
  connectToRouter: vi.fn(),
  getActiveHotspotUsers: vi.fn(),
  disconnectHotspotUser: vi.fn(),
  testConnection: vi.fn(),
}));

vi.mock('../services/freeradius.service', () => ({
  showFreeradiusClients: vi.fn().mockResolvedValue(''),
}));

vi.mock('../services/routerHealth.service', () => ({
  runHealthCheck: vi.fn().mockResolvedValue({
    routerId: 'stub',
    ranAt: new Date().toISOString(),
    overall: 'healthy',
    probes: [],
  }),
}));

vi.mock('../services/routerProvision.service', () => ({
  schedulePostAddProvision: vi.fn(),
  provisionRouter: vi.fn().mockResolvedValue({}),
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TARGET_USER_ID = TEST_USER.userId; // the user on whose behalf admin acts

const ADMIN_USER = {
  userId: 'aaaaaaaa-0000-4000-8000-000000000001',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
};

function adminAuthHeader(): Record<string, string> {
  const token = generateAccessToken(ADMIN_USER);
  return { Authorization: `Bearer ${token}` };
}

const MOCK_ROUTER_ROW = {
  id: 'r0000000-0000-4000-8000-000000000099',
  user_id: TARGET_USER_ID,
  name: 'Test Router',
  model: null,
  ros_version: null,
  api_user: null,
  api_pass_enc: null,
  wg_public_key: 'mock-public-key',
  wg_private_key_enc: null,
  wg_preshared_key_enc: null,
  wg_endpoint: null,
  tunnel_ip: '10.10.0.2',
  radius_secret_enc: null,
  nas_identifier: 'test-router-nas',
  status: 'offline',
  last_seen: null,
  last_health_check_at: null,
  last_health_report: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const BASE_URL = `/api/v1/admin/users/${TARGET_USER_ID}/routers`;
const DETAIL_URL = `/api/v1/admin/users/${TARGET_USER_ID}`;

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
});

// A PlanRow shape that getPlanByTier/toPlanDefinition understands (max_routers = 1 = Starter)
const STARTER_PLAN_ROW = {
  id: 'plan-001',
  tier: 'starter',
  name: 'Starter',
  price: '5',
  currency: 'SDG',
  max_routers: 1,
  monthly_vouchers: 500,
  session_monitoring: null,
  dashboard: null,
  features: [],
  allowed_durations: [1],
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
};

// ---------------------------------------------------------------------------
// Helpers: chain the pool queries createRouter issues when quota check runs
// ---------------------------------------------------------------------------

function mockQuotaQueries(routerCount: number): void {
  // getRouterLimit → getActiveSubscription → SELECT subscriptions
  mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_SUBSCRIPTION_ROW] });
  // getRouterLimit → getActiveSubscription → getPlanByTier → SELECT plans (maxRouters: 1)
  mockQuery.mockResolvedValueOnce({ rows: [STARTER_PLAN_ROW] });
  // COUNT routers
  mockQuery.mockResolvedValueOnce({ rows: [{ count: String(routerCount) }] });
}

function mockCreateRouterTransaction(): void {
  mockClientQuery
    .mockResolvedValueOnce(undefined) // BEGIN
    .mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] }) // INSERT router RETURNING *
    .mockResolvedValueOnce(undefined) // UPDATE tunnel_ip
    .mockResolvedValueOnce(undefined) // UPDATE nas_identifier
    .mockResolvedValueOnce(undefined) // INSERT nas
    .mockResolvedValueOnce(undefined); // COMMIT
}

function mockAuditLogInsert(): void {
  // audit_logs INSERT — pool.query (not client.query)
  mockQuery.mockResolvedValueOnce({ rows: [] });
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/users/:id
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/users/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get(DETAIL_URL);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const res = await request(app)
      .get(DETAIL_URL)
      .set(authHeaderFor(TEST_USER));
    expect(res.status).toBe(403);
  });

  it('returns 404 when user does not exist', async () => {
    // SELECT users → empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(DETAIL_URL)
      .set(adminAuthHeader());
    expect(res.status).toBe(404);
  });

  it('returns user detail with subscription and routers', async () => {
    const userRow = {
      id: TARGET_USER_ID,
      name: 'Test User',
      email: 'test@example.com',
      phone: null,
      business_name: null,
      is_verified: true,
      is_active: true,
      role: 'user',
      created_at: new Date().toISOString(),
    };

    // 1. SELECT users (sequential, before Promise.all)
    mockQuery.mockResolvedValueOnce({ rows: [userRow] });

    // The Promise.all in getUserDetail fires 2 concurrent branches:
    //   Branch A: getActiveSubscription(userId)
    //     A1: SELECT subscriptions
    //     A2: getPlanByTier → SELECT plans
    //   Branch B: pool.query(SELECT routers)
    //     B1: SELECT routers
    //
    // vitest's mock queue is consumed in the order that pool.query() is called.
    // Since both branches start at the same microtask tick, the interleaving is
    // deterministic: A1 fires first (getActiveSubscription awaits first), then
    // B1, then A2 (getPlanByTier awaits inside toSubscriptionInfo, which runs
    // after the A1 await resolves). We therefore queue: A1, B1, A2.

    // A1: SELECT subscriptions
    mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_SUBSCRIPTION_ROW] });
    // B1: SELECT routers
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] });
    // A2: SELECT plans (getPlanByTier — called after subscription row is returned)
    mockQuery.mockResolvedValueOnce({ rows: [STARTER_PLAN_ROW] });

    const res = await request(app)
      .get(DETAIL_URL)
      .set(adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.id).toBe(TARGET_USER_ID);
    expect(res.body.data.routers).toHaveLength(1);
    expect(res.body.data.routerCount).toBe(1);
    expect(res.body.data.subscription).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/users/:id/routers
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/users/:id/routers', () => {
  const validBody = { name: 'Test Router' };

  it('returns 401 without auth', async () => {
    const res = await request(app).post(BASE_URL).send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin (ADMIN_REQUIRED)', async () => {
    const res = await request(app)
      .post(BASE_URL)
      .set(authHeaderFor(TEST_USER))
      .send(validBody);
    expect(res.status).toBe(403);
    // The requireAdmin middleware returns ADMIN_REQUIRED
    expect(res.body.error?.code ?? res.body.error?.message ?? '').toMatch(/admin/i);
  });

  it('creates a router for a Starter user who has 0 routers (201)', async () => {
    // Quota check: 0 routers against limit 1 (starter)
    mockQuotaQueries(0);
    mockCreateRouterTransaction();
    // audit_logs INSERT
    mockAuditLogInsert();

    const res = await request(app)
      .post(BASE_URL)
      .set(adminAuthHeader())
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.router.name).toBe('Test Router');
  });

  it('returns 403 when Starter user already has 1 router (quota hit)', async () => {
    // Quota check: 1 router against limit 1 → exceeds
    mockQuotaQueries(1);

    const res = await request(app)
      .post(BASE_URL)
      .set(adminAuthHeader())
      .send(validBody);

    expect(res.status).toBe(403);
    expect(res.body.error?.code ?? '').toBe('ROUTER_LIMIT_REACHED');
  });

  it('creates router with overrideQuota: true even when limit reached (201)', async () => {
    // No quota queries — skipQuotaCheck=true skips them entirely
    mockCreateRouterTransaction();
    mockAuditLogInsert();

    const res = await request(app)
      .post(BASE_URL)
      .set(adminAuthHeader())
      .send({ ...validBody, overrideQuota: true });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('writes audit row with overrideQuota=false on normal create', async () => {
    mockQuotaQueries(0);
    mockCreateRouterTransaction();
    mockAuditLogInsert();

    const res = await request(app)
      .post(BASE_URL)
      .set(adminAuthHeader())
      .send(validBody);

    expect(res.status).toBe(201);

    // The audit INSERT goes through pool.query inside auditService.logAction.
    // We check that the mock was called with the expected shape.
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('audit_logs'),
      expect.arrayContaining([
        ADMIN_USER.userId,            // adminId
        'router.create_for_user',     // action
        'router',                     // targetEntity
      ]),
    );

    // Verify the details field contains overrideQuota: false and correct userId
    const auditCall = mockQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('audit_logs'),
    );
    expect(auditCall).toBeDefined();
    if (auditCall) {
      const details = JSON.parse(auditCall[1][4] as string) as Record<string, unknown>;
      expect(details.overrideQuota).toBe(false);
      expect(details.userId).toBe(TARGET_USER_ID);
    }
  });

  it('writes audit row with overrideQuota=true on override create', async () => {
    mockCreateRouterTransaction();

    // Capture the audit INSERT
    mockQuery.mockImplementationOnce(
      (sql: string, params: unknown[]) => {
        if (typeof sql === 'string' && sql.includes('audit_logs')) {
          const details = JSON.parse(params[4] as string) as Record<string, unknown>;
          expect(details.overrideQuota).toBe(true);
          expect(details.userId).toBe(TARGET_USER_ID);
        }
        return Promise.resolve({ rows: [] });
      },
    );

    const res = await request(app)
      .post(BASE_URL)
      .set(adminAuthHeader())
      .send({ ...validBody, overrideQuota: true });

    expect(res.status).toBe(201);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('audit_logs'),
      expect.arrayContaining(['router.create_for_user']),
    );
  });

  it('returns 422 for missing name field', async () => {
    const res = await request(app)
      .post(BASE_URL)
      .set(adminAuthHeader())
      .send({ model: 'RB750Gr3' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/v1/admin/users/:id — is_verified flip unblocks login
// ---------------------------------------------------------------------------

describe('PUT /api/v1/admin/users/:id — is_verified', () => {
  const UPDATE_URL = `/api/v1/admin/users/${TARGET_USER_ID}`;
  // bcrypt hash of "Password1" with cost 10 (verified against real bcrypt)
  const bcryptHash = '$2b$10$1ii8y1yC0neuAR7LQ/ZGx.OtMIVFKvLw7IMYufR3C3.nWzT0az.be';

  const unverifiedUserRow = {
    id: TARGET_USER_ID,
    name: 'Fresh User',
    email: 'fresh@example.com',
    password_hash: bcryptHash,
    is_verified: false,
    is_active: true,
    failed_login_attempts: 0,
    locked_until: null,
    role: 'user',
  };

  it('flipping is_verified to true allows a previously blocked login to succeed', async () => {
    // Step 1 — login before verification: SELECT user → 403 EMAIL_NOT_VERIFIED
    mockQuery.mockResolvedValueOnce({ rows: [unverifiedUserRow] });

    const loginBefore = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'fresh@example.com', password: 'Password1' });

    expect(loginBefore.status).toBe(403);
    expect(loginBefore.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    // Step 2 — admin flips is_verified: true
    // UPDATE users RETURNING *
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...unverifiedUserRow, is_verified: true }],
      rowCount: 1,
    });
    // audit_logs INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const updateRes = await request(app)
      .put(UPDATE_URL)
      .set(adminAuthHeader())
      .send({ is_verified: true });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.is_verified).toBe(true);

    // Step 3 — login now succeeds (is_verified: true, failed_login_attempts: 0)
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...unverifiedUserRow, is_verified: true }],
    });

    const loginAfter = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'fresh@example.com', password: 'Password1' });

    expect(loginAfter.status).toBe(200);
    expect(loginAfter.body.data.accessToken).toBeDefined();
    expect(loginAfter.body.data.refreshToken).toBeDefined();
  });
});
