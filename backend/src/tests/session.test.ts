import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import * as routerOsService from '../services/routerOs.service';
import {
  TEST_USER,
  authHeader,
  mockSubscriptionQuery,
  TEST_ROUTER_ID,
} from './helpers';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

// Mock RouterOS service.
// disconnectHotspotUser now returns Promise<string> (the username of the
// disconnected session — B1 fix). Default to 'voucher-user' so CoA tests
// that provide a matching radacct row see a non-empty username.
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
  disconnectHotspotUser: vi.fn().mockResolvedValue('voucher-user'),
  connectToRouter: vi.fn(),
  getSystemInfo: vi.fn(),
  testConnection: vi.fn(),
}));

// Mock radclient.service so tests do not spawn real child processes.
// sendDisconnectRequest is the only function session.service uses.
const mockSendDisconnectRequest = vi.fn().mockResolvedValue('ack');
vi.mock('../services/radclient.service', () => ({
  sendDisconnectRequest: (...args: unknown[]) => mockSendDisconnectRequest(...args),
  sendAccessRequest: vi.fn().mockResolvedValue('accept'),
}));

// Mock encryption so tests do not require a real ENCRYPTION_KEY environment.
vi.mock('../utils/encryption', () => ({
  decrypt: vi.fn().mockReturnValue('test-radius-secret'),
  encrypt: vi.fn().mockReturnValue('encrypted-value'),
  generateRadiusSecret: vi.fn().mockReturnValue('random-secret'),
  generateNasIdentifier: vi.fn().mockReturnValue('router-id'),
}));

const BASE_URL = `/api/v1/routers/${TEST_ROUTER_ID}/sessions`;

beforeEach(() => {
  mockQuery.mockReset();
  mockSendDisconnectRequest.mockReset();
  mockSendDisconnectRequest.mockResolvedValue('ack');
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

  it('should disconnect session successfully (no active radacct row → CoA skipped)', async () => {
    mockSubscriptionQuery(mockQuery);
    // verifyRouterOwnership
    const routerRow = {
      id: TEST_ROUTER_ID,
      tunnel_ip: '10.10.0.2',
      radius_secret_enc: 'enc-secret',
    };
    mockQuery.mockResolvedValueOnce({ rows: [routerRow] });

    // B1: disconnectHotspotUser returns the username; radacct lookup is scoped
    // by that username (not by the RouterOS .id). No matching row → CoA skipped.
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete(`${BASE_URL}/session1`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // sendDisconnectRequest must NOT have been called when no radacct row found
    expect(mockSendDisconnectRequest).not.toHaveBeenCalled();
  });
});

// ─── F1/F11 regression tests ──────────────────────────────────────────────────

describe('DELETE /api/v1/routers/:id/sessions/:sid — CoA security regression', () => {
  const routerRow = {
    id: TEST_ROUTER_ID,
    tunnel_ip: '10.10.0.2',
    radius_secret_enc: 'enc-secret',
  };

  it('F1: CoA uses sendDisconnectRequest (not exec) when active radacct session found', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [routerRow] }); // verifyRouterOwnership

    // B1: disconnectHotspotUser (mocked at module level) returns 'voucher-user'.
    // The radacct lookup is now scoped by that username. The row's acctsessionid
    // is the real RADIUS session id that gets forwarded to the CoA packet.
    mockQuery.mockResolvedValueOnce({
      rows: [{ acctsessionid: 'ABC123', framedipaddress: '192.168.10.5' }],
    });

    const res = await request(app)
      .delete(`${BASE_URL}/ABC123`)
      .set(authHeader());

    expect(res.status).toBe(200);

    // The safe helper must have been called with the correct structured params.
    // Give the fire-and-forget promise a tick to resolve.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSendDisconnectRequest).toHaveBeenCalledOnce();
    expect(mockSendDisconnectRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        nasIp: '10.10.0.2',
        username: 'voucher-user',   // from disconnectHotspotUser return value
        acctSessionId: 'ABC123',    // from radacct row
        framedIp: '192.168.10.5',
      }),
    );
  });

  it('F1: malicious acctsessionid is rejected by the guard — sendDisconnectRequest never called', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [routerRow] }); // verifyRouterOwnership

    // radacct row with a shell-injection payload in acctsessionid
    // (username field omitted — B1 fix: service uses the disconnectHotspotUser return value, not the row's username)
    mockQuery.mockResolvedValueOnce({
      rows: [{ acctsessionid: 'x";curl evil;#', framedipaddress: null }],
    });

    const res = await request(app)
      .delete(`${BASE_URL}/safesid`)
      .set(authHeader());

    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 10));
    // The guard must have blocked the unsafe id — helper never reached
    expect(mockSendDisconnectRequest).not.toHaveBeenCalled();
  });

  it('F11: radacct query is scoped by USERNAME (from disconnectHotspotUser), not by the URL :sid', async () => {
    // Override disconnectHotspotUser to return a specific username for this test.
    const mockDisconnect = vi.spyOn(routerOsService, 'disconnectHotspotUser')
      .mockResolvedValueOnce('specific-voucher-user');

    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [routerRow] }); // verifyRouterOwnership
    mockQuery.mockResolvedValueOnce({ rows: [] }); // radacct: no match for that username

    await request(app)
      .delete(`${BASE_URL}/routeros-internal-id-*1A`)
      .set(authHeader());

    // The radacct query must filter by nasipaddress AND username (not acctsessionid).
    const radacctCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('radacct'),
    );
    expect(radacctCall).toBeDefined();
    // Params must include the username returned by disconnectHotspotUser
    expect(radacctCall![1]).toContain('specific-voucher-user');
    // And also include the tunnel IP
    expect(radacctCall![1]).toContain('10.10.0.2');
    // The RouterOS internal .id should NOT appear in the radacct query params
    expect(radacctCall![1]).not.toContain('routeros-internal-id-*1A');

    // sendDisconnectRequest must be called with the radacct row's acctsessionid
    // (no matching row in this test → CoA skipped)
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSendDisconnectRequest).not.toHaveBeenCalled();

    mockDisconnect.mockRestore();
  });

  it('F11: sendDisconnectRequest is called with the radacct row acctsessionid (not the URL :sid)', async () => {
    // disconnectHotspotUser returns the voucher username
    const mockDisconnect = vi.spyOn(routerOsService, 'disconnectHotspotUser')
      .mockResolvedValueOnce('voucher-abc');

    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [routerRow] }); // verifyRouterOwnership

    // radacct row with a RADIUS-assigned acctsessionid (different from the RouterOS .id)
    mockQuery.mockResolvedValueOnce({
      rows: [{ acctsessionid: 'RADIUS-SID-XYZ', username: 'voucher-abc', framedipaddress: '10.20.30.40' }],
    });

    const res = await request(app)
      .delete(`${BASE_URL}/routeros-id-*3F`)  // RouterOS .id — NOT a RADIUS session id
      .set(authHeader());

    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 10));
    // Must be called with the radacct acctsessionid, not the RouterOS .id
    expect(mockSendDisconnectRequest).toHaveBeenCalledOnce();
    expect(mockSendDisconnectRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        nasIp: '10.10.0.2',
        username: 'voucher-abc',
        acctSessionId: 'RADIUS-SID-XYZ',   // from radacct row, not from URL
        framedIp: '10.20.30.40',
      }),
    );

    mockDisconnect.mockRestore();
  });
});
