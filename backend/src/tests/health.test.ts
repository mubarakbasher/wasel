import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
});

describe('GET /api/v1/health', () => {
  it('returns 200 with status ok when both DB and Redis are healthy', async () => {
    // Pool.connect() returns a client whose query is mockClientQuery;
    // the health handler uses pool.connect() + client.query('SELECT 1').
    // The setup mock returns a client with mockClientQuery.
    const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<typeof vi.fn>;
    mockClientQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.checks.db).toBe('ok');
    expect(res.body.data.checks.redis).toBe('ok');
    expect(res.body.data.timestamp).toBeDefined();
  });

  it('returns 503 with status degraded when DB check fails', async () => {
    // Override pool.connect to throw so DB check fails
    const { pool } = await import('../config/database');
    const connectSpy = vi.spyOn(pool, 'connect').mockRejectedValueOnce(new Error('DB unavailable'));

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.checks.db).toBe('fail');
    expect(res.body.data.checks.redis).toBe('ok');

    connectSpy.mockRestore();
  });

  it('returns 503 with status degraded when Redis ping fails', async () => {
    const { redis } = await import('../config/redis');
    const pingSpy = vi.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('Redis unavailable'));

    const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<typeof vi.fn>;
    mockClientQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.checks.db).toBe('ok');
    expect(res.body.data.checks.redis).toBe('fail');

    pingSpy.mockRestore();
  });
});

describe('GET /api/v1/readyz', () => {
  it('is a synonym for /health and returns 200 when healthy', async () => {
    const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<typeof vi.fn>;
    mockClientQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/api/v1/readyz');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });
});
