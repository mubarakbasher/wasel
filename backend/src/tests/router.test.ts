import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import {
  TEST_USER,
  authHeader,
  mockSubscriptionQuery,
  mockNoSubscriptionQuery,
  ACTIVE_SUBSCRIPTION_ROW,
  TEST_ROUTER_ID,
} from './helpers';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;
const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<typeof vi.fn>;

// Mock external dependencies
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
  releaseTunnelSubnet: vi.fn().mockResolvedValue(undefined),
  parseTunnelSubnet: vi.fn().mockReturnValue({
    serverIp: '10.10.0.1',
    routerIp: '10.10.0.2',
    subnet: '10.10.0.0/30',
  }),
}));

vi.mock('../services/wireguardConfig', () => ({
  generateMikrotikConfigText: vi.fn().mockReturnValue('# Mikrotik Setup Commands\n/interface wireguard add ...'),
  generateSetupSteps: vi.fn().mockReturnValue([
    { step: 1, title: 'Step 1', commands: ['/interface wireguard add ...'] },
  ]),
}));

vi.mock('../services/routerOs.service', () => ({
  getSystemInfo: vi.fn().mockRejectedValue(new Error('Router offline')),
  connectToRouter: vi.fn(),
  getActiveHotspotUsers: vi.fn(),
  disconnectHotspotUser: vi.fn(),
  testConnection: vi.fn(),
}));

vi.mock('../services/freeradius.service', () => ({
  reloadFreeradiusClients: vi.fn().mockResolvedValue(undefined),
  showFreeradiusClients: vi.fn().mockResolvedValue(''),
}));

const now = new Date();

const MOCK_ROUTER_ROW = {
  id: TEST_ROUTER_ID,
  user_id: TEST_USER.userId,
  name: 'Office Router',
  model: 'RB750Gr3',
  ros_version: '7.10',
  api_user: 'admin',
  api_pass_enc: null,
  wg_public_key: 'mock-public-key',
  wg_private_key_enc: null,
  wg_endpoint: null,
  tunnel_ip: '10.10.0.2',
  radius_secret_enc: null,
  nas_identifier: 'office-router-aaa',
  status: 'offline',
  last_seen: null,
  created_at: now,
  updated_at: now,
};

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
});

// ─── POST /api/v1/routers ────────────────────────────────────────────────────

describe('POST /api/v1/routers', () => {
  const validBody = { name: 'My Router', model: 'RB750Gr3', apiUser: 'admin' };

  it('should return 401 without auth', async () => {
    const res = await request(app).post('/api/v1/routers').send(validBody);
    expect(res.status).toBe(401);
  });

  it('should return 403 without active subscription', async () => {
    mockNoSubscriptionQuery(mockQuery);

    const res = await request(app)
      .post('/api/v1/routers')
      .set(authHeader())
      .send(validBody);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('should return 400 for missing name', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .post('/api/v1/routers')
      .set(authHeader())
      .send({ model: 'RB750Gr3' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for name too short', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .post('/api/v1/routers')
      .set(authHeader())
      .send({ name: 'A' });

    expect(res.status).toBe(400);
  });

  it('should return 403 when router limit reached', async () => {
    mockSubscriptionQuery(mockQuery);
    // getRouterLimit → getActiveSubscription → SELECT subscriptions
    mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_SUBSCRIPTION_ROW] });
    // getRouterLimit → getActiveSubscription → toSubscriptionInfo → getPlanByTier → SELECT plans
    mockQuery.mockResolvedValueOnce({ rows: [] }); // null plan → maxRouters = 0
    // COUNT routers = 0 which is >= 0 → triggers 403 ROUTER_LIMIT_REACHED
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await request(app)
      .post('/api/v1/routers')
      .set(authHeader())
      .send(validBody);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROUTER_LIMIT_REACHED');
  });

  it('should create router successfully', async () => {
    mockSubscriptionQuery(mockQuery);
    // getRouterLimit → getActiveSubscription → SELECT subscriptions
    mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_SUBSCRIPTION_ROW] });
    // getRouterLimit → getActiveSubscription → toSubscriptionInfo → getPlanByTier → SELECT plans
    // Return a plan row so maxRouters comes back as a real number (≥ 1)
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 'plan-starter', tier: 'starter', name: 'Starter', price: '5',
      currency: 'SDG', max_routers: 1, monthly_vouchers: 500,
      session_monitoring: null, dashboard: null, features: [],
      allowed_durations: [1], is_active: true,
      created_at: new Date(), updated_at: new Date(),
    }] });
    // COUNT routers = 0
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    // Transaction queries
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] }) // INSERT router RETURNING *
      .mockResolvedValueOnce(undefined) // UPDATE nas_identifier
      .mockResolvedValueOnce(undefined) // INSERT nas
      .mockResolvedValueOnce(undefined); // COMMIT

    const res = await request(app)
      .post('/api/v1/routers')
      .set(authHeader())
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Office Router');
    expect(res.body.data.tunnelIp).toBe('10.10.0.2');
  });
});

// ─── GET /api/v1/routers ─────────────────────────────────────────────────────

describe('GET /api/v1/routers', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).get('/api/v1/routers');
    expect(res.status).toBe(401);
  });

  it('should return list of routers', async () => {
    mockSubscriptionQuery(mockQuery);
    // SELECT routers
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] });

    const res = await request(app)
      .get('/api/v1/routers')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Office Router');
  });

  it('should return empty array when no routers', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/v1/routers')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ─── GET /api/v1/routers/:id ─────────────────────────────────────────────────

describe('GET /api/v1/routers/:id', () => {
  it('should return 400 for invalid UUID', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .get('/api/v1/routers/not-a-uuid')
      .set(authHeader());

    expect(res.status).toBe(400);
  });

  it('should return 404 when router not found', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/v1/routers/${TEST_ROUTER_ID}`)
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTER_NOT_FOUND');
  });

  it('should return router on success', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] });

    const res = await request(app)
      .get(`/api/v1/routers/${TEST_ROUTER_ID}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(TEST_ROUTER_ID);
    expect(res.body.data.name).toBe('Office Router');
  });
});

// ─── PUT /api/v1/routers/:id ─────────────────────────────────────────────────

describe('PUT /api/v1/routers/:id', () => {
  it('should return 400 for invalid UUID', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .put('/api/v1/routers/not-a-uuid')
      .set(authHeader())
      .send({ name: 'Updated' });

    expect(res.status).toBe(400);
  });

  it('should return 400 when no fields provided', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}`)
      .set(authHeader())
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return 404 when router not found', async () => {
    mockSubscriptionQuery(mockQuery);
    // Ownership check
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}`)
      .set(authHeader())
      .send({ name: 'Updated Router' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTER_NOT_FOUND');
  });

  it('should update router on success', async () => {
    mockSubscriptionQuery(mockQuery);
    // Ownership check
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] });
    // UPDATE RETURNING *
    const updated = { ...MOCK_ROUTER_ROW, name: 'Updated Router' };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });
    // UPDATE nas (name changed)
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}`)
      .set(authHeader())
      .send({ name: 'Updated Router' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Router');
  });
});

// ─── DELETE /api/v1/routers/:id ──────────────────────────────────────────────

describe('DELETE /api/v1/routers/:id', () => {
  it('should return 404 when router not found', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete(`/api/v1/routers/${TEST_ROUTER_ID}`)
      .set(authHeader());

    expect(res.status).toBe(404);
  });

  it('should delete router on success', async () => {
    mockSubscriptionQuery(mockQuery);
    // SELECT router
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] });
    // DELETE nas
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // DELETE router
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .delete(`/api/v1/routers/${TEST_ROUTER_ID}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /api/v1/routers/:id/status ──────────────────────────────────────────

describe('GET /api/v1/routers/:id/status', () => {
  it('should return 404 when router not found', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/v1/routers/${TEST_ROUTER_ID}/status`)
      .set(authHeader());

    expect(res.status).toBe(404);
  });

  it('should return status for offline router', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] });

    const res = await request(app)
      .get(`/api/v1/routers/${TEST_ROUTER_ID}/status`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('offline');
    expect(res.body.data.name).toBe('Office Router');
  });

  it('should handle failed live data fetch for online router', async () => {
    mockSubscriptionQuery(mockQuery);
    const onlineRouter = { ...MOCK_ROUTER_ROW, status: 'online' };
    mockQuery.mockResolvedValueOnce({ rows: [onlineRouter] });

    const res = await request(app)
      .get(`/api/v1/routers/${TEST_ROUTER_ID}/status`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('online');
    expect(res.body.data.liveDataAvailable).toBe(false);
  });
});

// ─── GET /api/v1/routers/:id/setup-guide ─────────────────────────────────────

describe('GET /api/v1/routers/:id/setup-guide', () => {
  it('should return 404 when router not found', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/v1/routers/${TEST_ROUTER_ID}/setup-guide`)
      .set(authHeader());

    expect(res.status).toBe(404);
  });

  it('should return 400 when router missing WG config', async () => {
    mockSubscriptionQuery(mockQuery);
    const unconfigured = {
      ...MOCK_ROUTER_ROW,
      wg_private_key_enc: null,
      radius_secret_enc: null,
      tunnel_ip: null,
    };
    mockQuery.mockResolvedValueOnce({ rows: [unconfigured] });

    const res = await request(app)
      .get(`/api/v1/routers/${TEST_ROUTER_ID}/setup-guide`)
      .set(authHeader());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ROUTER_NOT_CONFIGURED');
  });

  it('should return setup guide on success', async () => {
    mockSubscriptionQuery(mockQuery);
    // Need encrypted fields for decrypt to work
    const { encrypt } = await import('../utils/encryption');
    const configured = {
      ...MOCK_ROUTER_ROW,
      wg_private_key_enc: encrypt('test-private-key'),
      radius_secret_enc: encrypt('test-radius-secret'),
      tunnel_ip: '10.10.0.2',
    };
    mockQuery.mockResolvedValueOnce({ rows: [configured] });

    const res = await request(app)
      .get(`/api/v1/routers/${TEST_ROUTER_ID}/setup-guide`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.setupGuide).toBeDefined();
    expect(res.body.data.routerName).toBe('Office Router');
    expect(res.body.data.tunnelIp).toBe('10.10.0.2');
  });
});
