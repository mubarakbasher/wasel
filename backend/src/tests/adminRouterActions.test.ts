import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { generateAccessToken } from '../services/token.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;

// ---------------------------------------------------------------------------
// Service mocks — the admin router actions delegate the heavy device I/O to the
// operator services. We stub those so the tests exercise the admin
// controller/service orchestration (owner resolution + audit) deterministically,
// without spawning RouterOS / WireGuard side effects. Both use partial mocks so
// the rest of each module (loaded by app.ts) keeps its real exports.
// ---------------------------------------------------------------------------

const mockApplyHotspotTemplate = vi.fn();
vi.mock('../services/hotspotTemplate.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/hotspotTemplate.service')>();
  return {
    ...actual,
    applyHotspotTemplate: (...args: unknown[]) => mockApplyHotspotTemplate(...args),
  };
});

const mockDeleteRouter = vi.fn();
vi.mock('../services/router.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/router.service')>();
  return {
    ...actual,
    deleteRouter: (...args: unknown[]) => mockDeleteRouter(...args),
  };
});

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  userId: 'aaaaaaaa-0000-4000-8000-0000000000a3',
  email: 'admin-routers@example.com',
  name: 'Admin Routers',
  role: 'admin',
};

const REGULAR_USER = {
  userId: 'bbbbbbbb-0000-4000-8000-0000000000b3',
  email: 'user-routers@example.com',
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

const ROUTER_ID = 'eeeeeeee-0000-4000-8000-0000000000e3';
const OWNER_ID = 'cccccccc-0000-4000-8000-0000000000c3';

/** Row returned by adminService.getRouterAdminMeta's SELECT. */
function metaRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: OWNER_ID,
    name: 'Router One',
    hotspot_template_id: 'dark',
    ...overrides,
  };
}

/** RouterInfo-shaped object as returned by applyHotspotTemplate. */
function routerInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROUTER_ID,
    userId: OWNER_ID,
    name: 'Router One',
    hotspotTemplateId: 'dark',
    hotspotTemplateStatus: 'applied',
    hotspotTemplateError: null,
    ...overrides,
  };
}

function findAuditCall(calls: unknown[][]): [string, unknown[]] | undefined {
  return calls.find(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes('audit_logs'),
  ) as [string, unknown[]] | undefined;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockApplyHotspotTemplate.mockReset();
  mockDeleteRouter.mockReset();
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/routers/:id/reprovision
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/routers/:id/reprovision', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post(`/api/v1/admin/routers/${ROUTER_ID}/reprovision`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/routers/${ROUTER_ID}/reprovision`)
      .set(userAuth())
      .send({ templateId: 'dark' });
    expect(res.status).toBe(403);
  });

  it('rejects an unknown templateId value (Zod)', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/routers/${ROUTER_ID}/reprovision`)
      .set(adminAuth())
      .send({ templateId: 'not-a-real-template' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockApplyHotspotTemplate).not.toHaveBeenCalled();
  });

  it('returns 404 ROUTER_NOT_FOUND when the router is unknown', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getRouterAdminMeta → empty

    const res = await request(app)
      .post(`/api/v1/admin/routers/${ROUTER_ID}/reprovision`)
      .set(adminAuth())
      .send({ templateId: 'dark' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTER_NOT_FOUND');
    expect(mockApplyHotspotTemplate).not.toHaveBeenCalled();
  });

  it('applies an explicit templateId on the resolved owner and writes a router.reprovision audit row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [metaRow({ hotspot_template_id: null })] }); // meta
    mockApplyHotspotTemplate.mockResolvedValueOnce(routerInfo({ hotspotTemplateId: 'clean' }));
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT

    const res = await request(app)
      .post(`/api/v1/admin/routers/${ROUTER_ID}/reprovision`)
      .set(adminAuth())
      .send({ templateId: 'clean' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.hotspotTemplateStatus).toBe('applied');

    // Delegated to the operator service with the RESOLVED owner id + explicit template.
    expect(mockApplyHotspotTemplate).toHaveBeenCalledWith(OWNER_ID, ROUTER_ID, 'clean');

    const auditCall = findAuditCall(mockQuery.mock.calls);
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toEqual(
      expect.arrayContaining([ADMIN_USER.userId, 'router.reprovision', 'router', ROUTER_ID]),
    );
    // Details carry the templateId + owner id.
    expect(String(auditCall![1][4])).toContain('clean');
    expect(String(auditCall![1][4])).toContain(OWNER_ID);
  });

  it('falls back to the stored hotspot_template_id when no templateId is provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [metaRow({ hotspot_template_id: 'dark' })] }); // meta
    mockApplyHotspotTemplate.mockResolvedValueOnce(routerInfo());
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT

    const res = await request(app)
      .post(`/api/v1/admin/routers/${ROUTER_ID}/reprovision`)
      .set(adminAuth())
      .send({});

    expect(res.status).toBe(200);
    expect(mockApplyHotspotTemplate).toHaveBeenCalledWith(OWNER_ID, ROUTER_ID, 'dark');
  });

  it('returns 400 NO_TEMPLATE when neither a body templateId nor a stored one exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [metaRow({ hotspot_template_id: null })] }); // meta

    const res = await request(app)
      .post(`/api/v1/admin/routers/${ROUTER_ID}/reprovision`)
      .set(adminAuth())
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_TEMPLATE');
    expect(mockApplyHotspotTemplate).not.toHaveBeenCalled();

    // No audit row written on the guard failure.
    expect(findAuditCall(mockQuery.mock.calls)).toBeUndefined();
  });

  it('returns 200 with data.hotspotTemplateStatus === "failed" when the device apply failed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [metaRow()] }); // meta
    mockApplyHotspotTemplate.mockResolvedValueOnce(
      routerInfo({ hotspotTemplateStatus: 'failed', hotspotTemplateError: 'no such command' }),
    );
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT

    const res = await request(app)
      .post(`/api/v1/admin/routers/${ROUTER_ID}/reprovision`)
      .set(adminAuth())
      .send({ templateId: 'dark' });

    // Mirrors the operator endpoint: a device-level failure is a 200 with a
    // 'failed' status body, NOT a 5xx — the UI surfaces the failed state.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.hotspotTemplateStatus).toBe('failed');
    expect(res.body.data.hotspotTemplateError).toBe('no such command');

    // Still audited — the admin did trigger the action.
    expect(findAuditCall(mockQuery.mock.calls)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/admin/routers/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/admin/routers/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).delete(`/api/v1/admin/routers/${ROUTER_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await request(app)
      .delete(`/api/v1/admin/routers/${ROUTER_ID}`)
      .set(userAuth());
    expect(res.status).toBe(403);
  });

  it('returns 404 ROUTER_NOT_FOUND when the router is unknown', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getRouterAdminMeta → empty

    const res = await request(app)
      .delete(`/api/v1/admin/routers/${ROUTER_ID}`)
      .set(adminAuth());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTER_NOT_FOUND');
    expect(mockDeleteRouter).not.toHaveBeenCalled();
  });

  it('cascades via the operator service and writes a router.delete audit row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [metaRow({ name: 'Cafe Router' })] }); // meta
    mockDeleteRouter.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT

    const res = await request(app)
      .delete(`/api/v1/admin/routers/${ROUTER_ID}`)
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Delegated to the operator cascade with the RESOLVED owner id.
    expect(mockDeleteRouter).toHaveBeenCalledWith(OWNER_ID, ROUTER_ID);

    const auditCall = findAuditCall(mockQuery.mock.calls);
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toEqual(
      expect.arrayContaining([ADMIN_USER.userId, 'router.delete', 'router', ROUTER_ID]),
    );
    // Details snapshot the owner id + router name (fetched before delete).
    expect(String(auditCall![1][4])).toContain('Cafe Router');
    expect(String(auditCall![1][4])).toContain(OWNER_ID);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/routers — projection excludes encrypted/secret columns
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/routers (projection safety)', () => {
  const SAFE_ROUTER_ROW = {
    id: ROUTER_ID,
    user_id: OWNER_ID,
    name: 'Router One',
    model: 'hAP ac2',
    ros_version: '7.14',
    status: 'online',
    last_seen: new Date().toISOString(),
    last_health_check_at: new Date().toISOString(),
    tunnel_ip: '10.10.0.2',
    hotspot_template_id: 'dark',
    hotspot_template_status: 'applied',
    hotspot_template_applied_at: new Date().toISOString(),
    hotspot_template_error: null,
    hotspot_accent_color: '#1d4ed8',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    owner_name: 'Owner One',
    owner_email: 'owner@example.com',
  };

  it('the data query never selects encrypted/secret columns nor r.*', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SAFE_ROUTER_ROW] }); // data
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] }); // count

    const res = await request(app).get('/api/v1/admin/routers').set(adminAuth());
    expect(res.status).toBe(200);

    const dataCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('hotspot_template_id'),
    );
    expect(dataCall).toBeDefined();
    const sql = dataCall![0] as string;

    // The real projection guard: no wildcard, no encrypted columns.
    expect(sql).not.toMatch(/r\.\*/);
    expect(sql).not.toContain('api_pass_enc');
    expect(sql).not.toContain('radius_secret_enc');
    expect(sql).not.toContain('wg_private_key_enc');
    expect(sql).not.toContain('wg_preshared_key_enc');
    // Includes hotspot_template_id (new UI decides Reprovision availability from it).
    expect(sql).toContain('r.hotspot_template_id');
  });

  it('the response items carry no *_enc / encrypted / secret / private_key keys', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SAFE_ROUTER_ROW] }); // data
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] }); // count

    const res = await request(app).get('/api/v1/admin/routers').set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);

    const keys = Object.keys(res.body.data[0]);
    for (const key of keys) {
      expect(key).not.toMatch(/_enc$|encrypted|secret|private_key/i);
    }
    // Sanity: the columns the UI relies on are present.
    expect(keys).toEqual(
      expect.arrayContaining([
        'id',
        'user_id',
        'name',
        'status',
        'tunnel_ip',
        'last_seen',
        'created_at',
        'hotspot_template_id',
        'owner_name',
        'owner_email',
      ]),
    );
  });
});
