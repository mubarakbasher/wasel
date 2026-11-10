import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../app';
import { authHeader, authHeaderFor, TEST_USER, TEST_USER_2 } from './helpers';
import { DEFAULT_PRINT_SETTINGS, DEFAULT_CODE_LENGTH } from '../validators/printSettings.validators';
import { getCodeLength } from '../services/printSettings.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
});

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe('GET /api/v1/settings/print — auth guard', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/v1/settings/print');
    expect(res.status).toBe(401);
  });

  it('returns 401 without auth token on PUT', async () => {
    const res = await request(app)
      .put('/api/v1/settings/print')
      .send(DEFAULT_PRINT_SETTINGS);
    expect(res.status).toBe(401);
  });
});

// ─── GET defaults ─────────────────────────────────────────────────────────────

describe('GET /api/v1/settings/print — defaults when no row exists', () => {
  it('returns DEFAULT_PRINT_SETTINGS when no row in DB', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no print settings row

    const res = await request(app)
      .get('/api/v1/settings/print')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      codeLength: DEFAULT_PRINT_SETTINGS.codeLength,
      templateId: DEFAULT_PRINT_SETTINGS.templateId,
      defaultColumns: DEFAULT_PRINT_SETTINGS.defaultColumns,
      knobs: DEFAULT_PRINT_SETTINGS.knobs,
    });
  });

  it('returns saved settings when row exists', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          code_length: 10,
          template_id: 'detailed',
          default_columns: 3,
          knobs: { showPrice: true, showBatch: false },
        },
      ],
    });

    const res = await request(app)
      .get('/api/v1/settings/print')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.codeLength).toBe(10);
    expect(res.body.data.templateId).toBe('detailed');
    expect(res.body.data.defaultColumns).toBe(3);
    expect(res.body.data.knobs.showPrice).toBe(true);
  });
});

// ─── PUT validation rejections ────────────────────────────────────────────────

describe('PUT /api/v1/settings/print — validation rejections', () => {
  it('rejects codeLength 5 (below minimum) with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send({ ...DEFAULT_PRINT_SETTINGS, codeLength: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects codeLength 13 (above maximum) with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send({ ...DEFAULT_PRINT_SETTINGS, codeLength: 13 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects unknown templateId with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send({ ...DEFAULT_PRINT_SETTINGS, templateId: 'unknown-template' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects defaultColumns 1 (below minimum) with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send({ ...DEFAULT_PRINT_SETTINGS, defaultColumns: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects defaultColumns 10 (above maximum) with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send({ ...DEFAULT_PRINT_SETTINGS, defaultColumns: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects unknown knob key (.strict()) with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send({
        ...DEFAULT_PRINT_SETTINGS,
        knobs: { ...DEFAULT_PRINT_SETTINGS.knobs, unknownKey: 'oops' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects stripsPerPage 3 (below minimum 4) with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send({
        ...DEFAULT_PRINT_SETTINGS,
        knobs: { ...DEFAULT_PRINT_SETTINGS.knobs, stripsPerPage: 3 },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects unknown top-level key (.strict()) with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send({ ...DEFAULT_PRINT_SETTINGS, unexpectedField: true });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ─── PUT acceptance ───────────────────────────────────────────────────────────

describe('PUT /api/v1/settings/print — acceptance', () => {
  function makeUpsertRow(overrides: Partial<{
    code_length: number;
    template_id: string;
    default_columns: number;
    knobs: Record<string, unknown>;
  }> = {}) {
    return {
      code_length: 8,
      template_id: 'classic',
      default_columns: 4,
      knobs: {},
      ...overrides,
    };
  }

  it('accepts codeLength 6 and echoes normalized doc', async () => {
    const payload = { ...DEFAULT_PRINT_SETTINGS, codeLength: 6 };
    mockQuery.mockResolvedValueOnce({ rows: [makeUpsertRow({ code_length: 6 })] });

    const res = await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.codeLength).toBe(6);

    // Verify the SQL used ON CONFLICT (user_id)
    const sqlCall = mockQuery.mock.calls[0];
    const sql: string = typeof sqlCall[0] === 'string' ? sqlCall[0] : '';
    expect(sql).toMatch(/ON CONFLICT \(user_id\)/i);
  });

  it('accepts codeLength 12 and echoes normalized doc', async () => {
    const payload = { ...DEFAULT_PRINT_SETTINGS, codeLength: 12 };
    mockQuery.mockResolvedValueOnce({ rows: [makeUpsertRow({ code_length: 12 })] });

    const res = await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.codeLength).toBe(12);
  });

  it('accepts full detailed settings and echoes normalized doc', async () => {
    const payload = {
      codeLength: 10,
      templateId: 'detailed',
      defaultColumns: 3,
      knobs: {
        headerText: 'My Hotspot',
        footerText: 'Connect at login.example.com',
        hotspotAddress: 'login.example.com',
        showPrice: true,
        showQr: true,
        showBatch: true,
        stripsPerPage: 8,
      },
    };

    mockQuery.mockResolvedValueOnce({
      rows: [
        makeUpsertRow({
          code_length: 10,
          template_id: 'detailed',
          default_columns: 3,
          knobs: payload.knobs,
        }),
      ],
    });

    const res = await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.data.templateId).toBe('detailed');
    expect(res.body.data.knobs.hotspotAddress).toBe('login.example.com');
  });
});

// ─── getCodeLength unit tests ─────────────────────────────────────────────────

describe('getCodeLength service — unit tests', () => {
  it('returns DEFAULT_CODE_LENGTH when no row exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getCodeLength('test-user-id');

    expect(result).toBe(DEFAULT_CODE_LENGTH);
    expect(result).toBe(8);
  });

  it('returns the stored code_length from the row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ code_length: 10 }] });

    const result = await getCodeLength('test-user-id');

    expect(result).toBe(10);
  });

  it('returns DEFAULT_CODE_LENGTH (fail-open) when pool.query rejects', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await getCodeLength('test-user-id');

    expect(result).toBe(DEFAULT_CODE_LENGTH);
  });
});

// ─── Cross-user isolation ─────────────────────────────────────────────────────

describe('GET /api/v1/settings/print — cross-user isolation', () => {
  it('passes user-a id as the SQL parameter for GET', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get('/api/v1/settings/print')
      .set(authHeaderFor(TEST_USER));

    expect(mockQuery).toHaveBeenCalledOnce();
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(TEST_USER.userId);
  });

  it('passes user-b id as the SQL parameter for GET', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get('/api/v1/settings/print')
      .set(authHeaderFor(TEST_USER_2));

    expect(mockQuery).toHaveBeenCalledOnce();
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(TEST_USER_2.userId);
  });

  it('passes user-a id as the SQL parameter for PUT', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ code_length: 8, template_id: 'classic', default_columns: 4, knobs: {} }],
    });

    await request(app)
      .put('/api/v1/settings/print')
      .set(authHeaderFor(TEST_USER))
      .send(DEFAULT_PRINT_SETTINGS);

    expect(mockQuery).toHaveBeenCalledOnce();
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(TEST_USER.userId);
  });

  it('passes user-b id as the SQL parameter for PUT', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ code_length: 8, template_id: 'classic', default_columns: 4, knobs: {} }],
    });

    await request(app)
      .put('/api/v1/settings/print')
      .set(authHeaderFor(TEST_USER_2))
      .send(DEFAULT_PRINT_SETTINGS);

    expect(mockQuery).toHaveBeenCalledOnce();
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(TEST_USER_2.userId);
  });
});

// ─── Knobs validation — bidi/control characters and newlines ──────────────────

describe('PUT /api/v1/settings/print — bidi and control character rejections', () => {
  it('rejects headerText containing a U+202E bidi override', async () => {
    const res = await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send({
        ...DEFAULT_PRINT_SETTINGS,
        knobs: { ...DEFAULT_PRINT_SETTINGS.knobs, headerText: 'Hello‮World' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects footerText containing a newline character', async () => {
    const res = await request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send({
        ...DEFAULT_PRINT_SETTINGS,
        knobs: { ...DEFAULT_PRINT_SETTINGS.knobs, footerText: 'line1\nline2' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ─── hotspotAddress validation ────────────────────────────────────────────────

describe('PUT /api/v1/settings/print — hotspotAddress validation', () => {
  async function putAddress(hotspotAddress: string) {
    return request(app)
      .put('/api/v1/settings/print')
      .set(authHeader())
      .send({
        ...DEFAULT_PRINT_SETTINGS,
        knobs: { ...DEFAULT_PRINT_SETTINGS.knobs, hotspotAddress },
      });
  }

  it('rejects ":::"', async () => {
    const res = await putAddress(':::');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects "/../x"', async () => {
    const res = await putAddress('/../x');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects "a..b"', async () => {
    const res = await putAddress('a..b');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects "-bad.com"', async () => {
    const res = await putAddress('-bad.com');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts "wifi.myshop.net"', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ code_length: 8, template_id: 'classic', default_columns: 4, knobs: { hotspotAddress: 'wifi.myshop.net' } }],
    });
    const res = await putAddress('wifi.myshop.net');
    expect(res.status).toBe(200);
  });

  it('accepts "hotspot.local:8080"', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ code_length: 8, template_id: 'classic', default_columns: 4, knobs: { hotspotAddress: 'hotspot.local:8080' } }],
    });
    const res = await putAddress('hotspot.local:8080');
    expect(res.status).toBe(200);
  });

  it('accepts "wifi.shop.net/login"', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ code_length: 8, template_id: 'classic', default_columns: 4, knobs: { hotspotAddress: 'wifi.shop.net/login' } }],
    });
    const res = await putAddress('wifi.shop.net/login');
    expect(res.status).toBe(200);
  });

  it('accepts empty string ""', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ code_length: 8, template_id: 'classic', default_columns: 4, knobs: { hotspotAddress: '' } }],
    });
    const res = await putAddress('');
    expect(res.status).toBe(200);
  });
});
