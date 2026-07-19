import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import * as notificationPrefsService from '../services/notificationPrefs.service';
import { MAX_NOTIFICATION_PREFERENCES } from '../validators/notification.validators';
import { authHeader, TEST_USER } from './helpers';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;
const mockClientQuery = (globalThis as Record<string, unknown>).__mockClientQuery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
});

describe('PUT /api/v1/notifications/preferences — validation (GAP-7)', () => {
  it('rejects an array that exceeds the category cap with 400 VALIDATION_ERROR', async () => {
    // The DoS payload: far more entries than there are categories (duplicates
    // were previously allowed with no upper bound).
    const oversized = Array.from({ length: 500 }, () => ({
      category: 'router_online',
      enabled: true,
    }));

    const res = await request(app)
      .put('/api/v1/notifications/preferences')
      .set(authHeader())
      .send({ preferences: oversized });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // No DB work happens — validation short-circuits before the service.
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('rejects exactly one entry over the cap with 400', async () => {
    const justOver = Array.from({ length: MAX_NOTIFICATION_PREFERENCES + 1 }, () => ({
      category: 'router_online',
      enabled: true,
    }));

    const res = await request(app)
      .put('/api/v1/notifications/preferences')
      .set(authHeader())
      .send({ preferences: justOver });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty array with 400 (min still enforced)', async () => {
    const res = await request(app)
      .put('/api/v1/notifications/preferences')
      .set(authHeader())
      .send({ preferences: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid within-cap update and returns 200', async () => {
    mockClientQuery.mockResolvedValue({ rows: [] }); // BEGIN / INSERT / COMMIT

    const res = await request(app)
      .put('/api/v1/notifications/preferences')
      .set(authHeader())
      .send({
        preferences: [
          { category: 'router_offline', enabled: false },
          { category: 'support_reply', enabled: true },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('notificationPrefs.updatePreferences — dedup (GAP-7)', () => {
  function insertCalls(): unknown[][] {
    return mockClientQuery.mock.calls
      .map((c) => c as unknown[])
      .filter((c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO notification_preferences'));
  }

  it('collapses duplicate categories to one INSERT each, last occurrence wins', async () => {
    mockClientQuery.mockResolvedValue({ rows: [] });

    await notificationPrefsService.updatePreferences(TEST_USER.userId, [
      { category: 'router_online', enabled: true },
      { category: 'router_online', enabled: false }, // later value must win
      { category: 'router_offline', enabled: true },
    ]);

    const inserts = insertCalls();
    // 2 distinct categories → 2 inserts, not 3.
    expect(inserts).toHaveLength(2);

    const params = inserts.map((c) => c[1] as unknown[]);
    const routerOnline = params.find((p) => p[1] === 'router_online');
    expect(routerOnline).toBeDefined();
    // Last occurrence (enabled=false) wins.
    expect(routerOnline![2]).toBe(false);
  });

  it('does not alter a fully-distinct set', async () => {
    mockClientQuery.mockResolvedValue({ rows: [] });

    await notificationPrefsService.updatePreferences(TEST_USER.userId, [
      { category: 'router_online', enabled: true },
      { category: 'router_offline', enabled: false },
      { category: 'support_reply', enabled: true },
    ]);

    expect(insertCalls()).toHaveLength(3);
  });
});
