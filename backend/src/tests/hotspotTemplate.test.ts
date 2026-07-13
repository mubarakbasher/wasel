/**
 * Tests for hotspot template feature:
 *  - GET  /api/v1/public/hotspot-templates/:key/:file   (whitelist / traversal)
 *  - GET  /api/v1/routers/hotspot-templates             (list endpoint shape)
 *  - PUT  /api/v1/routers/:id/hotspot-template          (Zod validation)
 *  - applyHotspotTemplate service                       (status transitions)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { Readable } from 'stream';

// ---------------------------------------------------------------------------
// fs mock — must be declared before any import that pulls in the route under
// test, so vi.mock hoisting takes effect.
// ---------------------------------------------------------------------------

vi.mock('fs');

// ---------------------------------------------------------------------------
// RouterOS mock
// ---------------------------------------------------------------------------

vi.mock('../services/routerOs.service', () => ({
  connectToRouter: vi.fn(),
  getSystemInfo: vi.fn().mockRejectedValue(new Error('Router offline')),
  getActiveHotspotUsers: vi.fn(),
  disconnectHotspotUser: vi.fn(),
  testConnection: vi.fn(),
  ensureHotspotRadiusSettings: vi.fn().mockResolvedValue(true),
}));

// ─── Other mocks needed by app-level imports ─────────────────────────────────

vi.mock('../utils/wireguard', () => ({
  generateKeyPair: vi.fn().mockReturnValue({ privateKey: 'pk', publicKey: 'pub' }),
  generatePresharedKey: vi.fn().mockReturnValue('psk'),
}));

vi.mock('../services/wireguardPeer', () => ({
  addPeer: vi.fn().mockResolvedValue(undefined),
  removePeer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/ipAllocation', () => ({
  allocateNextTunnelIp: vi.fn().mockResolvedValue({ serverIp: '10.10.0.1', routerIp: '10.10.0.2', subnet: '10.10.0.0/30' }),
  releaseTunnelSubnet: vi.fn().mockResolvedValue(undefined),
  parseTunnelSubnet: vi.fn().mockReturnValue({ serverIp: '10.10.0.1', routerIp: '10.10.0.2', subnet: '10.10.0.0/30' }),
}));

vi.mock('../services/wireguardConfig', () => ({
  generateMikrotikConfigText: vi.fn().mockReturnValue('# config'),
  generateSetupSteps: vi.fn().mockReturnValue([]),
}));

vi.mock('../services/freeradius.service', () => ({
  showFreeradiusClients: vi.fn().mockResolvedValue(''),
}));

vi.mock('../services/routerHealth.service', () => ({
  runHealthCheck: vi.fn().mockResolvedValue({ routerId: 'stub', ranAt: new Date().toISOString(), overall: 'healthy', probes: [] }),
}));

// ---------------------------------------------------------------------------
// Imports that depend on mocks above
// ---------------------------------------------------------------------------

import app from '../app';
import {
  TEST_USER,
  authHeader,
  mockSubscriptionQuery,
  TEST_ROUTER_ID,
} from './helpers';
import { HOTSPOT_TEMPLATES, HOTSPOT_TEMPLATE_DIR } from '../hotspot-templates/manifest';
import { connectToRouter } from '../services/routerOs.service';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Shared router DB row
// ---------------------------------------------------------------------------

const now = new Date();
const MOCK_ROUTER_ROW = {
  id: TEST_ROUTER_ID,
  user_id: TEST_USER.userId,
  name: 'Test Router',
  model: null,
  ros_version: null,
  api_user: 'wasel_auto',
  api_pass_enc: 'enc-pass',
  wg_public_key: 'pub',
  wg_private_key_enc: null,
  wg_preshared_key_enc: null,
  wg_endpoint: null,
  tunnel_ip: '10.10.0.2',
  radius_secret_enc: null,
  nas_identifier: 'nas-id',
  status: 'online',
  last_seen: null,
  last_health_check_at: null,
  last_health_report: null,
  created_at: now,
  updated_at: now,
  hotspot_template_id: null,
  hotspot_template_status: null,
  hotspot_template_applied_at: null,
  hotspot_template_error: null,
};

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
  vi.mocked(connectToRouter).mockReset();

  // Default fs mock: existsSync always returns true, createReadStream returns a
  // readable with minimal HTML content.
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.createReadStream).mockImplementation(() => {
    const readable = new Readable({ read() {} });
    readable.push(Buffer.from('<html>ok</html>'));
    readable.push(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return readable as any;
  });
});

// ─── Public static serving ───────────────────────────────────────────────────

describe('GET /api/v1/public/hotspot-templates/:key/:file', () => {
  it('returns 200 + content-type for a valid key and whitelisted file', async () => {
    const res = await request(app)
      .get('/api/v1/public/hotspot-templates/clean/login.html');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('returns 200 for preview.png (extra-allowed file not in template.files)', async () => {
    const res = await request(app)
      .get('/api/v1/public/hotspot-templates/clean/preview.png');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });

  it('returns 200 for preview.html (extra-allowed file)', async () => {
    const res = await request(app)
      .get('/api/v1/public/hotspot-templates/dark/preview.html');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('returns 200 for md5.js with correct content-type', async () => {
    const res = await request(app)
      .get('/api/v1/public/hotspot-templates/warm/md5.js');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/javascript/);
  });

  it('returns 404 for an unknown template key', async () => {
    const res = await request(app)
      .get('/api/v1/public/hotspot-templates/nonexistent/login.html');

    expect(res.status).toBe(404);
  });

  it('returns 404 for a file not in the whitelist', async () => {
    const res = await request(app)
      .get('/api/v1/public/hotspot-templates/clean/secret.php');

    expect(res.status).toBe(404);
  });

  it('returns 404 and rejects URL-encoded path traversal (%2F..%2F)', async () => {
    const res = await request(app)
      .get('/api/v1/public/hotspot-templates/clean/..%2F..%2Fetc%2Fpasswd');

    expect(res.status).toBe(404);
  });

  it('returns 404 when the file does not exist on disk', async () => {
    // Override fs mock: file is whitelisted but missing from disk
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const res = await request(app)
      .get('/api/v1/public/hotspot-templates/clean/login.html');

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/v1/routers/hotspot-templates ───────────────────────────────────

describe('GET /api/v1/routers/hotspot-templates', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/routers/hotspot-templates');
    expect(res.status).toBe(401);
  });

  it('returns 403 without active subscription', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no subscription
    const res = await request(app)
      .get('/api/v1/routers/hotspot-templates')
      .set(authHeader());

    expect(res.status).toBe(403);
  });

  it('returns list of templates with correct shape', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .get('/api/v1/routers/hotspot-templates')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(HOTSPOT_TEMPLATES.length);

    for (const t of res.body.data) {
      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('description');
      expect(t).toHaveProperty('previewUrl');
      expect(t.previewUrl).toMatch(/\/api\/v1\/public\/hotspot-templates\/.+\/preview\.png$/);
    }
  });

  it('does not confuse /hotspot-templates with /:id (UUID validation does not fire)', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .get('/api/v1/routers/hotspot-templates')
      .set(authHeader());

    // If Express matched /:id instead, validate(routerIdParamSchema) would return
    // 400 because "hotspot-templates" is not a UUID.
    expect(res.status).toBe(200);
  });
});

// ─── PUT /api/v1/routers/:id/hotspot-template — Zod validation ───────────────

describe('PUT /api/v1/routers/:id/hotspot-template — schema validation', () => {
  it('returns 400 for an unknown templateId', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
      .set(authHeader())
      .send({ templateId: 'unicorn' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when templateId is missing', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
      .set(authHeader())
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid router UUID in params', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .put('/api/v1/routers/not-a-uuid/hotspot-template')
      .set(authHeader())
      .send({ templateId: 'clean' });

    expect(res.status).toBe(400);
  });

  it('accepts all valid template ids from the manifest', async () => {
    for (const template of HOTSPOT_TEMPLATES) {
      mockSubscriptionQuery(mockQuery);
      // Ownership check
      mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] });
      // UPDATE → pending
      mockQuery.mockResolvedValueOnce({ rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'pending' }] });
      // UPDATE → failed (connectToRouter throws — doesn't matter for this test)
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'failed', hotspot_template_error: 'offline' }],
      });

      vi.mocked(connectToRouter).mockRejectedValueOnce(new Error('offline'));

      const res = await request(app)
        .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
        .set(authHeader())
        .send({ templateId: template.id });

      // 200 (not 400) confirms Zod accepted the id
      expect(res.status).toBe(200);
    }
  });
});

// ─── applyHotspotTemplate service — status transitions ───────────────────────

describe('PUT /api/v1/routers/:id/hotspot-template — service status transitions', () => {
  const VALID_BODY = { templateId: 'clean' };

  it('returns status=applied on full success', async () => {
    mockSubscriptionQuery(mockQuery);

    // Ownership check
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] });
    // UPDATE → pending
    mockQuery.mockResolvedValueOnce({ rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'pending' }] });
    // UPDATE → applied
    mockQuery.mockResolvedValueOnce({
      rows: [{
        ...MOCK_ROUTER_ROW,
        hotspot_template_id: 'clean',
        hotspot_template_status: 'applied',
        hotspot_template_applied_at: now,
        hotspot_template_error: null,
      }],
    });

    const mockMenuChain = {
      get: vi.fn().mockResolvedValue([{ '.id': '*1', name: 'default', 'use-radius': 'yes' }]),
      exec: vi.fn().mockResolvedValue([{ status: 'downloaded' }]),
      where: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    };
    mockMenuChain.where.mockReturnValue(mockMenuChain);

    vi.mocked(connectToRouter).mockResolvedValueOnce({
      client: { disconnect: vi.fn().mockResolvedValue(undefined) } as unknown as import('routeros-client').RouterOSClient,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api: { menu: vi.fn().mockReturnValue(mockMenuChain) } as any,
    });

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
      .set(authHeader())
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.hotspotTemplateStatus).toBe('applied');
    expect(res.body.data.hotspotTemplateId).toBe('clean');
  });

  it('issues the fetch as menu("/tool").exec("fetch", …) — never /tool/fetch/run (regression: "no such command")', async () => {
    mockSubscriptionQuery(mockQuery);

    // Ownership check
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] });
    // UPDATE → pending
    mockQuery.mockResolvedValueOnce({ rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'pending' }] });
    // UPDATE → applied
    mockQuery.mockResolvedValueOnce({
      rows: [{
        ...MOCK_ROUTER_ROW,
        hotspot_template_id: 'clean',
        hotspot_template_status: 'applied',
        hotspot_template_applied_at: now,
        hotspot_template_error: null,
      }],
    });

    const menuMock = vi.fn();
    const mockMenuChain = {
      get: vi.fn().mockResolvedValue([{ '.id': '*1', name: 'default', 'use-radius': 'yes' }]),
      exec: vi.fn().mockResolvedValue([{ status: 'finished' }]),
      where: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    };
    mockMenuChain.where.mockReturnValue(mockMenuChain);
    menuMock.mockReturnValue(mockMenuChain);

    vi.mocked(connectToRouter).mockResolvedValueOnce({
      client: { disconnect: vi.fn().mockResolvedValue(undefined) } as unknown as import('routeros-client').RouterOSClient,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api: { menu: menuMock } as any,
    });

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
      .set(authHeader())
      .send({ templateId: 'clean' });

    expect(res.status).toBe(200);
    expect(res.body.data.hotspotTemplateStatus).toBe('applied');

    // routeros-client builds the API command word by appending the exec() verb to
    // the menu path. The fetch MUST target the '/tool' menu with the 'fetch' verb
    // (→ command word '/tool/fetch'). The old '/tool/fetch' menu + 'run' verb built
    // '/tool/fetch/run', which RouterOS rejects with "no such command".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const menuPaths = menuMock.mock.calls.map((c: any[]) => c[0]);
    expect(menuPaths).toContain('/tool');
    expect(menuPaths).not.toContain('/tool/fetch');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const execVerbs = mockMenuChain.exec.mock.calls.map((c: any[]) => c[0]);
    expect(execVerbs).toContain('fetch');
    expect(execVerbs).not.toContain('run');

    // One exec('fetch', …) per template file, each pulling a public template URL
    // into the router's hotspot html-directory over the WireGuard tunnel.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchCalls = mockMenuChain.exec.mock.calls.filter((c: any[]) => c[0] === 'fetch');
    const clean = HOTSPOT_TEMPLATES.find((t) => t.id === 'clean')!;
    expect(fetchCalls).toHaveLength(clean.files.length);
    for (const call of fetchCalls) {
      const params = call[1];
      expect(params.mode).toBe('http');
      expect(String(params['dst-path'])).toMatch(new RegExp(`^${HOTSPOT_TEMPLATE_DIR}/`));
      expect(String(params.url)).toContain('/public/hotspot-templates/clean/');
    }
  });

  it('themes the profile the hotspot server uses (hsprof1), not default, reading the dot-stripped id', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] }); // ownership
    mockQuery.mockResolvedValueOnce({ rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'pending' }] }); // pending
    mockQuery.mockResolvedValueOnce({
      rows: [{
        ...MOCK_ROUTER_ROW,
        hotspot_template_id: 'clean',
        hotspot_template_status: 'applied',
        hotspot_template_applied_at: now,
        hotspot_template_error: null,
      }],
    }); // applied

    // routeros-client strips the leading dot from returned keys, so real rows
    // expose `id` (no dot). Mirror that here — a mock returning `.id` would hide
    // the exact bug this guards against.
    const profileUpdates: Array<{ id: unknown; payload: Record<string, unknown> }> = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = {
      menu: vi.fn((path: string) => {
        if (path === '/tool') {
          return { exec: vi.fn().mockResolvedValue([{ status: 'finished' }]) };
        }
        if (path === '/ip/hotspot') {
          // One server running on the hsprof1 profile (like `/ip hotspot print`).
          return {
            get: vi.fn().mockResolvedValue([
              { id: '*1', name: 'hotspot1', profile: 'hsprof1', interface: 'wifi1' },
            ]),
          };
        }
        if (path === '/ip/hotspot/profile') {
          let capturedId: unknown;
          const chain: Record<string, unknown> = {
            get: vi.fn().mockResolvedValue([
              { id: '*0', name: 'default' },
              { id: '*2', name: 'hsprof1' },
            ]),
          };
          chain.where = vi.fn((_key: string, value: unknown) => {
            capturedId = value;
            return chain;
          });
          chain.update = vi.fn(async (payload: Record<string, unknown>) => {
            profileUpdates.push({ id: capturedId, payload });
          });
          return chain;
        }
        // ensureHotspotRadiusSettings is module-mocked; nothing else is hit.
        return {
          get: vi.fn().mockResolvedValue([]),
          where: vi.fn().mockReturnThis(),
          update: vi.fn(),
          exec: vi.fn().mockResolvedValue([]),
        };
      }),
    };

    vi.mocked(connectToRouter).mockResolvedValueOnce({
      client: { disconnect: vi.fn().mockResolvedValue(undefined) } as unknown as import('routeros-client').RouterOSClient,
      api,
    });

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
      .set(authHeader())
      .send({ templateId: 'clean' });

    expect(res.status).toBe(200);
    expect(res.body.data.hotspotTemplateStatus).toBe('applied');

    // html-directory must be set on hsprof1 (id *2), never default (*0).
    const dirUpdates = profileUpdates.filter(
      (u) => u.payload && u.payload['html-directory'] !== undefined,
    );
    expect(dirUpdates.length).toBeGreaterThan(0);
    for (const u of dirUpdates) {
      expect(u.id).toBe('*2');
      expect(u.payload['html-directory']).toBe(HOTSPOT_TEMPLATE_DIR);
    }
  });

  it('returns status=failed + error when /tool/fetch returns status=failed, does not throw 500', async () => {
    mockSubscriptionQuery(mockQuery);

    // Ownership check
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] });
    // UPDATE → pending
    mockQuery.mockResolvedValueOnce({ rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'pending' }] });
    // UPDATE → failed
    mockQuery.mockResolvedValueOnce({
      rows: [{
        ...MOCK_ROUTER_ROW,
        hotspot_template_id: 'clean',
        hotspot_template_status: 'failed',
        hotspot_template_applied_at: null,
        hotspot_template_error: '/tool/fetch failed for login.html (status=failed)',
      }],
    });

    const mockMenuChain = {
      get: vi.fn(),
      exec: vi.fn().mockResolvedValue([{ status: 'failed' }]),
      where: vi.fn(),
      update: vi.fn(),
    };
    mockMenuChain.where.mockReturnValue(mockMenuChain);

    vi.mocked(connectToRouter).mockResolvedValueOnce({
      client: { disconnect: vi.fn().mockResolvedValue(undefined) } as unknown as import('routeros-client').RouterOSClient,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api: { menu: vi.fn().mockReturnValue(mockMenuChain) } as any,
    });

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
      .set(authHeader())
      .send(VALID_BODY);

    // Must be 200 with failed status — NOT a 500
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.hotspotTemplateStatus).toBe('failed');
    expect(res.body.data.hotspotTemplateError).toMatch(/status=failed/);
  });

  it('returns status=failed when router is unreachable (connectToRouter throws)', async () => {
    mockSubscriptionQuery(mockQuery);

    // Ownership check
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] });
    // UPDATE → pending
    mockQuery.mockResolvedValueOnce({ rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'pending' }] });
    // UPDATE → failed
    mockQuery.mockResolvedValueOnce({
      rows: [{
        ...MOCK_ROUTER_ROW,
        hotspot_template_id: 'clean',
        hotspot_template_status: 'failed',
        hotspot_template_error: 'Unable to reach the router',
      }],
    });

    vi.mocked(connectToRouter).mockRejectedValueOnce(new Error('Unable to reach the router'));

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
      .set(authHeader())
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.data.hotspotTemplateStatus).toBe('failed');
    expect(res.body.data.hotspotTemplateError).toMatch(/reach/i);
  });

  it('returns 404 when router belongs to a different user', async () => {
    mockSubscriptionQuery(mockQuery);

    // Ownership check returns empty (wrong user)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
      .set(authHeader())
      .send(VALID_BODY);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTER_NOT_FOUND');
  });

  it('returns status=failed when no hotspot profile is configured on the router', async () => {
    mockSubscriptionQuery(mockQuery);

    // Ownership check
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] });
    // UPDATE → pending
    mockQuery.mockResolvedValueOnce({ rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'pending' }] });
    // UPDATE → failed
    mockQuery.mockResolvedValueOnce({
      rows: [{
        ...MOCK_ROUTER_ROW,
        hotspot_template_status: 'failed',
        hotspot_template_error: 'No hotspot configured on this router',
      }],
    });

    const mockMenuChain = {
      get: vi.fn().mockResolvedValue([]),   // empty profile list
      exec: vi.fn().mockResolvedValue([{ status: 'downloaded' }]),
      where: vi.fn(),
      update: vi.fn(),
    };
    mockMenuChain.where.mockReturnValue(mockMenuChain);

    vi.mocked(connectToRouter).mockResolvedValueOnce({
      client: { disconnect: vi.fn().mockResolvedValue(undefined) } as unknown as import('routeros-client').RouterOSClient,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api: { menu: vi.fn().mockReturnValue(mockMenuChain) } as any,
    });

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
      .set(authHeader())
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.data.hotspotTemplateStatus).toBe('failed');
    expect(res.body.data.hotspotTemplateError).toMatch(/No hotspot configured/);
  });
});
