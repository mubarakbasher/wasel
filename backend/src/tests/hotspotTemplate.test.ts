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

vi.mock('fs', () => {
  // Explicit factory so fs.promises.readFile is a proper vi.fn().
  // Vitest's auto-mock cannot traverse Node.js getter-defined properties
  // (fs.promises is a lazy getter in Node ≥ 14), so we define them manually.
  const readFileFn = vi.fn();
  const existsSyncFn = vi.fn();
  const createReadStreamFn = vi.fn();
  const mockModule = {
    default: {
      existsSync: existsSyncFn,
      createReadStream: createReadStreamFn,
      promises: { readFile: readFileFn },
    },
    existsSync: existsSyncFn,
    createReadStream: createReadStreamFn,
    promises: { readFile: readFileFn },
  };
  return mockModule;
});

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
  hotspot_accent_color: null,
};

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
  vi.mocked(connectToRouter).mockReset();

  // Default fs mock: existsSync always returns true, createReadStream returns a
  // readable with minimal HTML content, and promises.readFile returns plain HTML.
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.createReadStream).mockImplementation(() => {
    const readable = new Readable({ read() {} });
    readable.push(Buffer.from('<html>ok</html>'));
    readable.push(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return readable as any;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fs.promises.readFile as any).mockResolvedValue('<html>ok</html>');
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

// ─── HTML token substitution via ?router=<uuid> ───────────────────────────────

describe('GET /api/v1/public/hotspot-templates/:key/:file — HTML token substitution', () => {
  // Fixture HTML containing all three WASEL tokens (mirrors src/tests/fixtures/clean/login.html)
  const FIXTURE_HTML = [
    '<!DOCTYPE html>',
    '<html lang="ar" dir="rtl">',
    '<head><title>%WASEL_NAME%</title>',
    '<style>:root{--accent:%WASEL_ACCENT%;--rgb:%WASEL_ACCENT_RGB%;}</style>',
    '</head>',
    '<body>',
    '<h1>%WASEL_NAME%</h1>',
    '<form action="$(link-login-only)" method="post">',
    '$(if chap-id)<input name="$(chap-id)">$(endif)',
    '<input name="username">',
    '</form></body></html>',
  ].join('\n');

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fs.promises.readFile as any).mockResolvedValue(FIXTURE_HTML);
  });

  it('substitutes tokens using router context when ?router=<valid-uuid>', async () => {
    // The public route has no auth/subscription middleware — set up exactly one
    // mock for the router context SELECT.
    mockQuery.mockResolvedValueOnce({
      rows: [{ name: 'My Café & Lounge', hotspot_accent_color: '#0f766e' }],
    });

    const res = await request(app)
      .get(`/api/v1/public/hotspot-templates/clean/login.html?router=${TEST_ROUTER_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('no-store');

    // Name should be HTML-escaped — & becomes &amp;, é passes through (not in escape set)
    expect(res.text).toContain('My Café &amp; Lounge');
    expect(res.text).not.toContain('My Café & Lounge');

    // Accent substitution
    expect(res.text).toContain('#0f766e');
    expect(res.text).toContain('15,118,110');

    // MikroTik placeholders pass through unchanged
    expect(res.text).toContain('$(link-login-only)');
    expect(res.text).toContain('$(if chap-id)');
    expect(res.text).toContain('$(chap-id)');
    expect(res.text).toContain('$(endif)');

    // Raw token markers must be gone
    expect(res.text).not.toContain('%WASEL_NAME%');
    expect(res.text).not.toContain('%WASEL_ACCENT%');
    expect(res.text).not.toContain('%WASEL_ACCENT_RGB%');
  });

  it('uses Guest Wi-Fi defaults when ?router is absent', async () => {
    const callsBefore = mockQuery.mock.calls.length;

    const res = await request(app)
      .get('/api/v1/public/hotspot-templates/clean/login.html');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');

    // Must use default name
    expect(res.text).toContain('Guest Wi-Fi');

    // No new DB calls should have been made (no ?router param)
    expect(mockQuery.mock.calls.length).toBe(callsBefore);
  });

  it('uses Guest Wi-Fi defaults and makes NO DB call for malformed ?router=abc', async () => {
    const callsBefore = mockQuery.mock.calls.length;

    const res = await request(app)
      .get('/api/v1/public/hotspot-templates/clean/login.html?router=abc');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Guest Wi-Fi');

    // UUID regex must reject 'abc' BEFORE any pool.query call
    expect(mockQuery.mock.calls.length).toBe(callsBefore);
  });

  it('uses template defaultAccent when DB has no row for the router UUID', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no row

    const res = await request(app)
      .get(`/api/v1/public/hotspot-templates/clean/login.html?router=${TEST_ROUTER_ID}`);

    expect(res.status).toBe(200);
    // Guest Wi-Fi + clean defaultAccent (#0f766e → 15,118,110)
    expect(res.text).toContain('Guest Wi-Fi');
    expect(res.text).toContain('#0f766e');
    expect(res.text).toContain('15,118,110');
  });

  it('uses defaults and does NOT propagate DB errors as 5xx', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app)
      .get(`/api/v1/public/hotspot-templates/clean/login.html?router=${TEST_ROUTER_ID}`);

    // Must be 200 with defaults — never a 500
    expect(res.status).toBe(200);
    expect(res.text).toContain('Guest Wi-Fi');
  });
});

// ─── Non-HTML cache headers ───────────────────────────────────────────────────

describe('GET /api/v1/public/hotspot-templates/:key/:file — non-HTML cache headers', () => {
  it('serves md5.js with Cache-Control: public, max-age=86400', async () => {
    const res = await request(app)
      .get('/api/v1/public/hotspot-templates/clean/md5.js');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
  });

  it('serves plus-jakarta-sans.woff2 with Cache-Control: public, max-age=86400', async () => {
    const res = await request(app)
      .get('/api/v1/public/hotspot-templates/clean/plus-jakarta-sans.woff2');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
  });

  it('serves preview.png with Cache-Control: public, max-age=300', async () => {
    const res = await request(app)
      .get('/api/v1/public/hotspot-templates/clean/preview.png');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });
});

// ─── PUT accentColor validation ───────────────────────────────────────────────

describe('PUT /api/v1/routers/:id/hotspot-template — accentColor validation', () => {
  it('returns 400 VALIDATION_ERROR for an invalid accentColor hex', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
      .set(authHeader())
      .send({ templateId: 'clean', accentColor: '#123456' }); // not a preset

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid preset accentColor', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] }); // ownership
    mockQuery.mockResolvedValueOnce({ rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'pending' }] }); // pending
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'failed', hotspot_template_error: 'offline' }],
    }); // failed (router offline)

    vi.mocked(connectToRouter).mockRejectedValueOnce(new Error('offline'));

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
      .set(authHeader())
      .send({ templateId: 'clean', accentColor: '#0f766e' });

    // 200 means Zod accepted it; actual outcome is failed (router offline)
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
  });
});

// ─── PUT accentColor persistence (before first exec) ─────────────────────────

describe('PUT /api/v1/routers/:id/hotspot-template — accentColor persistence', () => {
  const buildMenuChain = (fetchStatus = 'finished') => {
    const chain = {
      get: vi.fn().mockResolvedValue([{ id: '*1', name: 'hsprof1', 'use-radius': 'yes' }]),
      exec: vi.fn().mockResolvedValue([{ status: fetchStatus }]),
      where: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    };
    chain.where.mockReturnValue(chain);
    return chain;
  };

  it('persists accentColor in the pending UPDATE before the first exec("fetch")', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] }); // ownership
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'pending', hotspot_accent_color: '#4f46e5' }],
    }); // pending UPDATE

    // Hotspot server list (for profile query)
    const mockServers = [{ id: '*1', name: 'hs1', profile: 'hsprof1' }];
    const mockProfiles = [{ id: '*1', name: 'hsprof1' }];
    const chain = buildMenuChain();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const menuMock = vi.fn((path: string): any => {
      if (path === '/tool') return chain;
      if (path === '/ip/hotspot') return { get: vi.fn().mockResolvedValue(mockServers) };
      if (path === '/ip/hotspot/profile') {
        return { get: vi.fn().mockResolvedValue(mockProfiles), where: chain.where, update: chain.update };
      }
      return chain;
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'applied', hotspot_accent_color: '#4f46e5' }],
    }); // applied UPDATE

    vi.mocked(connectToRouter).mockResolvedValueOnce({
      client: { disconnect: vi.fn().mockResolvedValue(undefined) } as unknown as import('routeros-client').RouterOSClient,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api: { menu: menuMock } as any,
    });

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
      .set(authHeader())
      .send({ templateId: 'clean', accentColor: '#4f46e5' });

    expect(res.status).toBe(200);

    // Find the pending UPDATE call — it must include hotspot_accent_color
    const pendingUpdateCall = mockQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('hotspot_accent_color'),
    );
    expect(pendingUpdateCall).toBeDefined();
    // The values array must contain the accent hex
    expect(pendingUpdateCall![1]).toContain('#4f46e5');

    // The pending UPDATE must come BEFORE any exec('fetch') call.
    // invocationCallOrder is a global sequence across all mocks, so it can
    // order calls on pool.query against calls on the menu chain's exec.
    const pendingCallIndex = mockQuery.mock.calls.indexOf(pendingUpdateCall!);
    const firstExecCall = chain.exec.mock.calls.findIndex((c) => c[0] === 'fetch');
    expect(pendingCallIndex).toBeGreaterThanOrEqual(0);
    expect(firstExecCall).toBeGreaterThanOrEqual(0);
    expect(mockQuery.mock.invocationCallOrder[pendingCallIndex]).toBeLessThan(
      chain.exec.mock.invocationCallOrder[firstExecCall],
    );
  });

  it('fetch URLs include ?router=<routerId>', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] }); // ownership
    mockQuery.mockResolvedValueOnce({ rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'pending' }] }); // pending
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'applied', hotspot_template_applied_at: now }],
    }); // applied

    const execMock = vi.fn().mockResolvedValue([{ status: 'finished' }]);
    const mockServers = [{ id: '*1', name: 'hs1', profile: 'hsprof1' }];
    const mockProfiles = [{ id: '*2', name: 'hsprof1' }];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const menuMock = vi.fn((path: string): any => {
      if (path === '/tool') return { exec: execMock };
      if (path === '/ip/hotspot') return { get: vi.fn().mockResolvedValue(mockServers) };
      if (path === '/ip/hotspot/profile') {
        const chain = { get: vi.fn().mockResolvedValue(mockProfiles), where: vi.fn(), update: vi.fn().mockResolvedValue(undefined) };
        chain.where.mockReturnValue(chain);
        return chain;
      }
      return { get: vi.fn().mockResolvedValue([]), exec: execMock, where: vi.fn().mockReturnThis(), update: vi.fn() };
    });

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

    // Every fetch call must have a URL ending with ?router=<TEST_ROUTER_ID>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchCalls = execMock.mock.calls.filter((c: any[]) => c[0] === 'fetch');
    expect(fetchCalls.length).toBeGreaterThan(0);
    for (const call of fetchCalls) {
      const url = String(call[1]?.url ?? '');
      expect(url).toContain(`?router=${TEST_ROUTER_ID}`);
    }
  });

  it('omitting accentColor leaves hotspot_accent_color out of the pending UPDATE', async () => {
    mockSubscriptionQuery(mockQuery);
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROUTER_ROW] }); // ownership
    mockQuery.mockResolvedValueOnce({ rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'pending' }] }); // pending
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...MOCK_ROUTER_ROW, hotspot_template_status: 'failed', hotspot_template_error: 'offline' }],
    }); // failed

    vi.mocked(connectToRouter).mockRejectedValueOnce(new Error('offline'));

    const res = await request(app)
      .put(`/api/v1/routers/${TEST_ROUTER_ID}/hotspot-template`)
      .set(authHeader())
      .send({ templateId: 'clean' }); // no accentColor

    expect(res.status).toBe(200);

    // No pool.query call should include hotspot_accent_color in the SQL
    const accentUpdateCall = mockQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('hotspot_accent_color'),
    );
    expect(accentUpdateCall).toBeUndefined();
  });
});

// ─── listHotspotTemplates shape (extended) ────────────────────────────────────

describe('GET /api/v1/routers/hotspot-templates — extended shape', () => {
  it('each template item includes defaultAccent and accentPresets', async () => {
    mockSubscriptionQuery(mockQuery);

    const res = await request(app)
      .get('/api/v1/routers/hotspot-templates')
      .set(authHeader());

    expect(res.status).toBe(200);

    for (const t of res.body.data) {
      expect(t).toHaveProperty('defaultAccent');
      expect(typeof t.defaultAccent).toBe('string');
      expect(t.defaultAccent).toMatch(/^#[0-9a-f]{6}$/i);

      expect(t).toHaveProperty('accentPresets');
      expect(Array.isArray(t.accentPresets)).toBe(true);
      expect(t.accentPresets.length).toBeGreaterThan(0);

      for (const preset of t.accentPresets) {
        expect(preset).toHaveProperty('id');
        expect(preset).toHaveProperty('hex');
        expect(preset).toHaveProperty('nameEn');
        expect(preset).toHaveProperty('nameAr');
        expect(preset.hex).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
