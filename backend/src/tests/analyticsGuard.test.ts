/**
 * Guard test: no analytics endpoint SQL may mention radacct, voucher_meta, or radpostauth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { generateAccessToken } from '../services/token.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

const ADMIN_USER = {
  userId: 'aaaaaaaa-0000-4000-8000-00000000aa02',
  email: 'admin-guard@example.com',
  name: 'Admin Guard',
  role: 'admin',
};

const OP_ID = 'cccccccc-0000-4000-8000-00000000cc02';

function adminAuth() { return { Authorization: `Bearer ${generateAccessToken(ADMIN_USER)}` }; }

function queueEmpty(n: number) {
  for (let i = 0; i < n; i++) mockQuery.mockResolvedValueOnce({ rows: [] });
}

const FORBIDDEN = ['radacct', 'voucher_meta', 'radpostauth'];

function collectSql(): string[] {
  return mockQuery.mock.calls
    .filter((c: unknown[]) => typeof c[0] === 'string')
    .map((c: unknown[]) => c[0] as string);
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe('analyticsGuard: no forbidden tables in analytics SQL', () => {
  it('GET /analytics/money uses no forbidden tables', async () => {
    queueEmpty(20);
    mockQuery.mockResolvedValue({ rows: [{ count: '0', amount: '0', oldest_since: null }] });
    await request(app).get('/api/v1/admin/analytics/money').set(adminAuth());
    const sql = collectSql().join('\n');
    for (const forbidden of FORBIDDEN) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('GET /analytics/operators uses no forbidden tables', async () => {
    queueEmpty(20);
    await request(app).get('/api/v1/admin/analytics/operators').set(adminAuth());
    const sql = collectSql().join('\n');
    for (const forbidden of FORBIDDEN) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('GET /analytics/operators/:id uses no forbidden tables', async () => {
    // userCheck, then buildMeta, then data
    queueEmpty(20);
    await request(app)
      .get(`/api/v1/admin/analytics/operators/${OP_ID}`)
      .set(adminAuth());
    const sql = collectSql().join('\n');
    for (const forbidden of FORBIDDEN) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('GET /analytics/network uses no forbidden tables', async () => {
    queueEmpty(20);
    await request(app).get('/api/v1/admin/analytics/network').set(adminAuth());
    const sql = collectSql().join('\n');
    for (const forbidden of FORBIDDEN) {
      expect(sql).not.toContain(forbidden);
    }
  });
});
