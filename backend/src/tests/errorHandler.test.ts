import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import logger from '../config/logger';
import { errorHandler } from '../middleware/errorHandler';

/**
 * Malformed request bodies are the client's fault: body-parser errors must map
 * to 4xx VALIDATION_ERROR, not a logged "Unhandled error" 500 that also goes to
 * Sentry. Plain thrown errors stay 500 INTERNAL_ERROR.
 */
describe('errorHandler: malformed request bodies', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('truncated JSON gets 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('JSON over the 10mb limit gets 413 VALIDATION_ERROR', async () => {
    const oversized = JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(11 * 1024 * 1024) });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(oversized);

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Request body too large');
  });

  it('client errors log at warn, not as "Unhandled error"', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const error = vi.spyOn(logger, 'error');

    await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(warn).toHaveBeenCalledWith(
      'Client request error',
      expect.objectContaining({ status: 400, method: 'POST', url: '/api/v1/auth/login' })
    );
    const unhandled = error.mock.calls.filter((c) => (c as unknown[])[0] === 'Unhandled error');
    expect(unhandled).toHaveLength(0);
  });

  it('a plain thrown Error is still a 500 INTERNAL_ERROR', () => {
    const req = { method: 'GET', originalUrl: '/boom', headers: {} } as never;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();
    vi.spyOn(logger, 'error').mockImplementation(() => logger);

    errorHandler(new Error('boom'), req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
      })
    );
  });

  it('an upstream error carrying status 404 without expose is still a 500 INTERNAL_ERROR', () => {
    const req = { method: 'POST', originalUrl: '/upstream', headers: {} } as never;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();
    vi.spyOn(logger, 'error').mockImplementation(() => logger);

    errorHandler(Object.assign(new Error('upstream'), { status: 404 }), req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
      })
    );
  });
});
