import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../app';
import { authHeader, TEST_USER } from './helpers';
import { SPEED_LIMIT_OPTIONS, DEFAULT_SPEED_LIMIT } from '../validators/cardSpeed.validators';
import { buildSymmetricRateLimit } from '../utils/radius';
import { DEFAULT_PRINT_SETTINGS, DEFAULT_CODE_LENGTH } from '../validators/printSettings.validators';
import { getCardCreationSettings, CARD_CREATION_SETTINGS_SQL } from '../services/cardSettings.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
});

// ─── buildSymmetricRateLimit ──────────────────────────────────────────────────

describe('buildSymmetricRateLimit', () => {
  it.each([
    ['1M', '1M/1M'],
    ['256k', '256k/256k'],
    ['10M', '10M/10M'],
  ])('%s -> %s', (s, out) => {
    expect(buildSymmetricRateLimit(s)).toBe(out);
  });

  it.each(['256K', '1M/1M', '0M', '', '1m', '12345M'])('throws on %s', (s) => {
    expect(() => buildSymmetricRateLimit(s)).toThrow();
  });
});

// ─── GET /api/v1/settings/card-speed ─────────────────────────────────────────

describe('GET /api/v1/settings/card-speed', () => {
  it('401 without auth', async () => {
    const res = await request(app).get('/api/v1/settings/card-speed');
    expect(res.status).toBe(401);
  });

  it('returns off, 2M and the eight options when no row exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v1/settings/card-speed').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      enabled: false,
      speed: DEFAULT_SPEED_LIMIT,
      options: [...SPEED_LIMIT_OPTIONS],
    });
  });

  it('returns the stored row', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ speed_limit_enabled: true, speed_limit: '1M' }],
    });

    const res = await request(app).get('/api/v1/settings/card-speed').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.speed).toBe('1M');
  });

  it('returns a stored speed that is not in the option list unchanged', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ speed_limit_enabled: true, speed_limit: '8M' }],
    });

    const res = await request(app).get('/api/v1/settings/card-speed').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.speed).toBe('8M');
  });

  it('selects by the authenticated user id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/v1/settings/card-speed').set(authHeader());

    expect(mockQuery).toHaveBeenCalledOnce();
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(TEST_USER.userId);
  });
});

// ─── PUT /api/v1/settings/card-speed ─────────────────────────────────────────

describe('PUT /api/v1/settings/card-speed', () => {
  it('401 without auth', async () => {
    const res = await request(app)
      .put('/api/v1/settings/card-speed')
      .send({ enabled: true, speed: '1M' });
    expect(res.status).toBe(401);
  });

  it('upserts only the speed columns and returns the saved value', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ speed_limit_enabled: true, speed_limit: '1M' }] });

    const res = await request(app)
      .put('/api/v1/settings/card-speed')
      .set(authHeader())
      .send({ enabled: true, speed: '1M' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.speed).toBe('1M');
    expect(res.body.data.options).toEqual([...SPEED_LIMIT_OPTIONS]);

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/ON CONFLICT \(user_id\)/);
    expect(sql).toMatch(/RETURNING\s+speed_limit_enabled,\s*speed_limit/);
    expect(sql).not.toMatch(/code_length|template_id|default_columns|knobs/);
    expect(params).toEqual([TEST_USER.userId, true, '1M']);
  });

  it('stores the speed when switching off, so it is remembered', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ speed_limit_enabled: false, speed_limit: '5M' }] });

    const res = await request(app)
      .put('/api/v1/settings/card-speed')
      .set(authHeader())
      .send({ enabled: false, speed: '5M' });

    expect(res.status).toBe(200);
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([TEST_USER.userId, false, '5M']);
  });

  it('{ enabled: false, speed: "8M" } returns 200 and stores [userId, false, "8M"]', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ speed_limit_enabled: false, speed_limit: '8M' }] });

    const res = await request(app)
      .put('/api/v1/settings/card-speed')
      .set(authHeader())
      .send({ enabled: false, speed: '8M' });

    expect(res.status).toBe(200);
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([TEST_USER.userId, false, '8M']);
  });

  it.each([
    { enabled: true, speed: '8M' },
    { enabled: true, speed: '9M' },
    { enabled: true, speed: '256K' },
    { enabled: true, speed: '1M/1M' },
    { enabled: false, speed: '256K' },
    { enabled: false, speed: '1M/1M' },
    { enabled: true, speed: null },
    { enabled: true },
    { speed: '1M' },
    { enabled: 'yes', speed: '1M' },
    { enabled: true, speed: '1M', extra: 1 },
  ])('400 VALIDATION_ERROR for %j and issues no query', async (body) => {
    const res = await request(app)
      .put('/api/v1/settings/card-speed')
      .set(authHeader())
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ─── getCardCreationSettings ──────────────────────────────────────────────────

describe('getCardCreationSettings', () => {
  it('no row -> { codeLength: 8, speedLimit: null }', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getCardCreationSettings('u');
    expect(result).toEqual({ codeLength: DEFAULT_CODE_LENGTH, speedLimit: null });
  });

  it('limit off -> speedLimit null', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ code_length: 10, speed_limit_enabled: false, speed_limit: '1M' }],
    });
    const result = await getCardCreationSettings('u');
    expect(result).toEqual({ codeLength: 10, speedLimit: null });
  });

  it('limit on -> the stored speed', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ code_length: 8, speed_limit_enabled: true, speed_limit: '1M' }],
    });
    const result = await getCardCreationSettings('u');
    expect(result).toEqual({ codeLength: 8, speedLimit: '1M' });
  });

  it('limit on with a speed outside the option list still applies it', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ code_length: 8, speed_limit_enabled: true, speed_limit: '8M' }],
    });
    const result = await getCardCreationSettings('u');
    expect(result.speedLimit).toBe('8M');
  });

  it('row without the speed columns throws 503 CARD_SETTINGS_UNAVAILABLE', async () => {
    // A row missing speed_limit_enabled is unexpected (NOT NULL column); the service
    // must fail closed rather than silently treating it as limit-off.
    mockQuery.mockResolvedValueOnce({
      rows: [{ code_length: 8 }],
    });
    await expect(getCardCreationSettings('u')).rejects.toMatchObject({
      statusCode: 503,
      code: 'CARD_SETTINGS_UNAVAILABLE',
    });
  });

  it('limit on with a malformed stored speed throws 503 CARD_SETTINGS_UNAVAILABLE', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ code_length: 8, speed_limit_enabled: true, speed_limit: '1M/1M' }],
    });
    await expect(getCardCreationSettings('u')).rejects.toMatchObject({
      statusCode: 503,
      code: 'CARD_SETTINGS_UNAVAILABLE',
    });
  });

  it('query error throws 503 CARD_SETTINGS_UNAVAILABLE', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    await expect(getCardCreationSettings('u')).rejects.toMatchObject({
      statusCode: 503,
      code: 'CARD_SETTINGS_UNAVAILABLE',
    });
  });

  it('is one query that selects all three columns and passes the userId as param', async () => {
    expect(CARD_CREATION_SETTINGS_SQL).toMatch(/code_length/);
    expect(CARD_CREATION_SETTINGS_SQL).toMatch(/speed_limit_enabled/);
    expect(CARD_CREATION_SETTINGS_SQL).toMatch(/speed_limit\b/);

    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getCardCreationSettings('u');
    expect(mockQuery).toHaveBeenCalledOnce();
    // Verify the SQL and the userId param are passed correctly.
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe(CARD_CREATION_SETTINGS_SQL);
    expect(params).toEqual(['u']);
  });
});

// ─── print settings stay separate ────────────────────────────────────────────

describe('print settings stay separate', () => {
  it('PUT /settings/print never names the speed columns', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ code_length: 8, template_id: 'classic', default_columns: 4, knobs: {} }],
    });

    await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send(DEFAULT_PRINT_SETTINGS);

    expect(mockQuery.mock.calls[0][0]).not.toMatch(/speed_limit/);
  });
});
