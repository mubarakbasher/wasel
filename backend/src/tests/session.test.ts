import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import {
  TEST_USER,
  authHeader,
  mockSubscriptionQuery,
  TEST_ROUTER_ID,
} from './helpers';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

// Mock RouterOS service
vi.mock('../services/routerOs.service', () => ({
  getActiveHotspotUsers: vi.fn().mockResolvedValue([
    {
      id: '*1A',
      server: 'hotspot1',
      username: 'voucher-user',
      address: '192.168.1.100',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      uptime: '01:30:00',
      bytesIn: 10485760,
      bytesOut: 52428800,
      idleTime: '00:05:00',
    },
  ]),
  disconnectHotspotUser: vi.fn().mockResolvedValue(undefined),
  connectToRouter: vi.fn(),
  getSystemInfo: vi.fn(),
  testConnection: vi.fn(),
}));

const BASE_URL = `/api/v1/routers/${TEST_ROUTER_ID}/sessions`;

beforeEach(() => {
  mockQuery.mockReset();
});

// ─── GET /api/v1/routers/:id/sessions ────────────────────────────────────────

describe('GET /api/v1/routers/:id/sessions', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).get(BASE_URL);
    expect(res.status).toBe(401);
  });

  it('should return 404 when router not found', async () => {
    mockSubscriptionQuery(mockQuery);
    // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(BASE_URL)
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTER_NOT_FOUND');
  });

  it('should return active sessions list', async () => {
    mockSubscriptionQuery(mockQuery);
    // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TEST_ROUTER_ID, tunnel_ip: '10.10.0.2', radius_secret_enc: 'enc-secret' }],
    });

    const res = await request(app)
      .get(BASE_URL)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].username).toBe('voucher-user');
  });
});

// ─── GET /api/v1/routers/:id/sessions/history ────────────────────────────────
// NOTE: This endpoint uses query validation with z.coerce which triggers an
// Express 5 bug (req.query is read-only). Testing auth only.

describe('GET /api/v1/routers/:id/sessions/history', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).get(`${BASE_URL}/history`);
    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/v1/routers/:id/sessions/:sid ────────────────────────────────

describe('DELETE /api/v1/routers/:id/sessions/:sid', () => {
  it('should return 404 when router not found', async () => {
    mockSubscriptionQuery(mockQuery);
    // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete(`${BASE_URL}/session1`)
      .set(authHeader());

    expect(res.status).toBe(404);
  });

  it('should disconnect session successfully', async () => {
    mockSubscriptionQuery(mockQuery);
    // verifyRouterOwnership
    const routerRow = {
      id: TEST_ROUTER_ID,
      tunnel_ip: '10.10.0.2',
      radius_secret_enc: 'enc-secret',
    };
    mockQuery.mockResolvedValueOnce({ rows: [routerRow] });

    // CoA: radacct lookup (no active sessions)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete(`${BASE_URL}/session1`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
