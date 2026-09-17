/**
 * Focused tests for:
 *  - GET  /api/v1/admin/freeradius/status  (includes `data.radius` after 2026-09-15 fix)
 *  - DELETE /api/v1/admin/users/:id        (removes each router's WireGuard peer, then
 *                                           evicts its tunnel IP, after COMMIT)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { generateAccessToken } from '../services/token.service';
import { evictDynamicClient } from '../services/freeradius.service';
import { removePeer } from '../services/wireguardPeer';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;
const mockClientQuery = (globalThis as Record<string, unknown>)
  .__mockClientQuery as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Mocks — must be declared before app import (vi.mock is hoisted).
// ---------------------------------------------------------------------------

vi.mock('../services/freeradius.service', () => ({
  getRadminSocketPath: vi.fn().mockReturnValue('/var/run/freeradius/radmin.sock'),
  showFreeradiusClients: vi.fn().mockResolvedValue(''),
  evictDynamicClient: vi.fn().mockResolvedValue('evicted'),
}));

vi.mock('../services/wireguardPeer', () => ({
  addPeer: vi.fn().mockResolvedValue(undefined),
  removePeer: vi.fn().mockResolvedValue(undefined),
}));

const mockSendStatusServer = vi.fn();
vi.mock('../services/radclient.service', () => ({
  sendStatusServer: (...args: unknown[]) => mockSendStatusServer(...args),
  sendAccessRequest: vi.fn().mockResolvedValue('accept'),
  sendDisconnectRequest: vi.fn().mockResolvedValue('ack'),
}));

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  userId: 'aaaa0001-0000-4000-8000-000000000f01',
  email: 'admin-fr@example.com',
  name: 'Admin FR',
  role: 'admin',
};

function adminAuth(): Record<string, string> {
  return { Authorization: `Bearer ${generateAccessToken(ADMIN_USER)}` };
}

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  vi.mocked(evictDynamicClient).mockReset();
  vi.mocked(evictDynamicClient).mockResolvedValue('evicted');
  vi.mocked(removePeer).mockReset();
  vi.mocked(removePeer).mockResolvedValue(undefined);
  mockSendStatusServer.mockReset();
  mockSendStatusServer.mockResolvedValue({
    responding: true,
    outcome: 'accept',
    latencyMs: 4,
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/freeradius/status
// ---------------------------------------------------------------------------
describe('GET /api/v1/admin/freeradius/status', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/freeradius/status');
    expect(res.status).toBe(401);
  });

  it('includes radius field with responding=true when Status-Server answers', async () => {
    // access() calls in socketReachability() succeed by default (no fs mock needed
    // for success — the function catches ENOENT and returns exists=false).
    const res = await request(app)
      .get('/api/v1/admin/freeradius/status')
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.radius).toBeDefined();
    expect(res.body.data.radius.responding).toBe(true);
    expect(res.body.data.radius.outcome).toBe('accept');
    expect(typeof res.body.data.radius.latencyMs).toBe('number');
  });

  it('includes radius.responding=false when FreeRADIUS is not answering', async () => {
    mockSendStatusServer.mockResolvedValue({
      responding: false,
      outcome: 'timeout',
      latencyMs: 3001,
    });

    const res = await request(app)
      .get('/api/v1/admin/freeradius/status')
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.data.radius.responding).toBe(false);
    expect(res.body.data.radius.outcome).toBe('timeout');
  });

  it('passes timeoutMs: 2000 to sendStatusServer', async () => {
    await request(app)
      .get('/api/v1/admin/freeradius/status')
      .set(adminAuth());

    expect(mockSendStatusServer).toHaveBeenCalledWith({ timeoutMs: 2_000 });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/admin/users/:id — eviction
// ---------------------------------------------------------------------------
describe('DELETE /api/v1/admin/users/:id eviction', () => {
  const TARGET_USER_ID = 'cccc0001-0000-4000-8000-000000000c01';

  it('removes each WireGuard peer, then evicts each tunnel IP, after COMMIT', async () => {
    // Transaction sequence:
    // BEGIN → SELECT user (non-admin) → SELECT voucher_meta (empty) →
    // DELETE radcheck/reply/radusergroup (skipped since no vouchers) →
    // DELETE nas RETURNING nasname → SELECT routers wg_public_key →
    // DELETE user → COMMIT
    const order: string[] = [];
    mockClientQuery.mockImplementation((sql: unknown) => {
      if (sql === 'COMMIT') order.push('COMMIT');
      return Promise.resolve(undefined);
    });
    vi.mocked(removePeer).mockImplementation(async (key: string) => {
      order.push(`removePeer:${key}`);
    });
    vi.mocked(evictDynamicClient).mockImplementation(async (ip: string) => {
      order.push(`evict:${ip}`);
      return 'evicted';
    });
    mockClientQuery
      .mockResolvedValueOnce(undefined)                        // BEGIN
      .mockResolvedValueOnce({                                 // SELECT user
        rowCount: 1,
        rows: [{ id: TARGET_USER_ID, role: 'user' }],
      })
      .mockResolvedValueOnce({ rows: [] })                     // SELECT voucher_meta (no vouchers)
      .mockResolvedValueOnce({                                 // DELETE nas RETURNING nasname
        rows: [{ nasname: '10.10.0.2' }, { nasname: '10.10.0.6' }],
      })
      .mockResolvedValueOnce({                                 // SELECT wg_public_key
        rows: [{ wg_public_key: 'peer-key-a' }, { wg_public_key: 'peer-key-b' }],
      })
      .mockResolvedValueOnce({ rowCount: 1 });                 // DELETE user
    // COMMIT falls through to the implementation above.

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_USER_ID}`)
      .set(adminAuth());

    expect(res.status).toBe(200);

    const peerSelect = mockClientQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && /SELECT wg_public_key FROM routers/.test(c[0]),
    );
    expect(peerSelect?.[1]).toEqual([TARGET_USER_ID]);

    // Peers come off wg0 before any eviction, and everything runs after COMMIT:
    // `del client` frees the client on the next packet from that IP, so the
    // deleted router must not be able to send one.
    expect(order).toEqual([
      'COMMIT',
      'removePeer:peer-key-a',
      'removePeer:peer-key-b',
      'evict:10.10.0.2',
      'evict:10.10.0.6',
    ]);
  });

  it('evicts nothing (and does not throw) when the user had no routers', async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TARGET_USER_ID, role: 'user' }] })
      .mockResolvedValueOnce({ rows: [] })  // no vouchers
      .mockResolvedValueOnce({ rows: [] })  // DELETE nas RETURNING → zero rows
      .mockResolvedValueOnce({ rows: [] })  // SELECT wg_public_key → zero rows
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce(undefined);

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_USER_ID}`)
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(vi.mocked(removePeer)).not.toHaveBeenCalled();
    expect(vi.mocked(evictDynamicClient)).not.toHaveBeenCalled();
  });

  it('succeeds even if evictDynamicClient returns error', async () => {
    vi.mocked(evictDynamicClient).mockResolvedValue('error');

    mockClientQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TARGET_USER_ID, role: 'user' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ nasname: '10.10.0.2' }] })
      .mockResolvedValueOnce({ rows: [{ wg_public_key: 'peer-key-a' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce(undefined);

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_USER_ID}`)
      .set(adminAuth());

    expect(res.status).toBe(200);
  });

  it('still evicts and succeeds when removing a WireGuard peer fails', async () => {
    vi.mocked(removePeer).mockRejectedValue(new Error('wg: not available'));

    mockClientQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TARGET_USER_ID, role: 'user' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ nasname: '10.10.0.2' }] })
      .mockResolvedValueOnce({ rows: [{ wg_public_key: 'peer-key-a' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce(undefined);

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_USER_ID}`)
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(vi.mocked(removePeer)).toHaveBeenCalledWith('peer-key-a');
    expect(vi.mocked(evictDynamicClient)).toHaveBeenCalledWith('10.10.0.2');
  });
});
