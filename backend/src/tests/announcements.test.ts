import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { generateAccessToken } from '../services/token.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;
const mockClientQuery = (globalThis as Record<string, unknown>)
  .__mockClientQuery as ReturnType<typeof vi.fn>;

// Partial-mock the notification service so we can drive the fire-and-forget push
// path deterministically without touching Firebase. Everything else stays real.
const { mockIsFcmAvailable, mockSendMulticast } = vi.hoisted(() => ({
  mockIsFcmAvailable: vi.fn().mockReturnValue(false),
  mockSendMulticast: vi.fn().mockResolvedValue({ successCount: 0, failureCount: 0 }),
}));

vi.mock('../services/notification.service', async (importActual) => {
  const actual = await importActual<typeof import('../services/notification.service')>();
  return {
    ...actual,
    isFcmAvailable: () => mockIsFcmAvailable(),
    sendMulticast: (...args: unknown[]) => mockSendMulticast(...args),
  };
});

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  userId: 'aaaaaaaa-0000-4000-8000-0000000000aa',
  email: 'admin-ann@example.com',
  name: 'Admin Ann',
  role: 'admin',
};

const REGULAR_USER = {
  userId: 'bbbbbbbb-0000-4000-8000-0000000000bb',
  email: 'user-ann@example.com',
  name: 'Regular User',
  role: 'user',
};

function adminAuth(): Record<string, string> {
  return { Authorization: `Bearer ${generateAccessToken(ADMIN_USER)}` };
}

function userAuth(): Record<string, string> {
  return { Authorization: `Bearer ${generateAccessToken(REGULAR_USER)}` };
}

const ANNOUNCEMENT_ID = 'ffffffff-0000-4000-8000-0000000000f1';

const VALID_BODY = {
  titleEn: 'Scheduled maintenance',
  titleAr: 'صيانة مجدولة',
  bodyEn: 'The service will be briefly unavailable tonight.',
  bodyAr: 'ستكون الخدمة غير متاحة لفترة وجيزة الليلة.',
};

/** Queue the 5 client-side transaction statements for a successful fan-out. */
function queueTransaction(recipientCount: number): void {
  mockClientQuery
    .mockResolvedValueOnce(undefined) // BEGIN
    .mockResolvedValueOnce({ rows: [{ id: ANNOUNCEMENT_ID }] }) // INSERT announcements RETURNING id
    .mockResolvedValueOnce({ rows: [], rowCount: recipientCount }) // fan-out INSERT ... SELECT
    .mockResolvedValueOnce(undefined) // UPDATE recipient_count
    .mockResolvedValueOnce(undefined); // COMMIT
}

function findClientCall(fragment: string): [string, unknown[]] | undefined {
  return mockClientQuery.mock.calls.find(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes(fragment),
  ) as [string, unknown[]] | undefined;
}

function findPoolCall(fragment: string): [string, unknown[]] | undefined {
  return mockQuery.mock.calls.find(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes(fragment),
  ) as [string, unknown[]] | undefined;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockIsFcmAvailable.mockReset().mockReturnValue(false);
  mockSendMulticast.mockReset().mockResolvedValue({ successCount: 0, failureCount: 0 });
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/announcements
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/announcements', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/v1/admin/announcements').send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await request(app)
      .post('/api/v1/admin/announcements')
      .set(userAuth())
      .send(VALID_BODY);
    expect(res.status).toBe(403);
  });

  it('inserts + fans out in a transaction and returns 201 with { id, recipientCount }', async () => {
    queueTransaction(7);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit_logs INSERT

    const res = await request(app)
      .post('/api/v1/admin/announcements')
      .set(adminAuth())
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ id: ANNOUNCEMENT_ID, recipientCount: 7 });

    // Transaction boundaries
    expect(String(mockClientQuery.mock.calls[0][0])).toContain('BEGIN');
    expect(
      mockClientQuery.mock.calls.some((c) => String(c[0]).includes('COMMIT')),
    ).toBe(true);
  });

  it('fan-out SQL carries the language CASE, prefs LEFT JOIN and role/is_active predicate', async () => {
    queueTransaction(3);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit_logs

    await request(app).post('/api/v1/admin/announcements').set(adminAuth()).send(VALID_BODY);

    const fanout = findClientCall("CASE WHEN u.language = 'ar'");
    expect(fanout).toBeDefined();
    const sql = fanout![0];
    expect(sql).toContain('INSERT INTO notifications');
    expect(sql).toContain("'announcement'");
    expect(sql).toContain('LEFT JOIN notification_preferences np ON np.user_id = u.id');
    expect(sql).toContain("np.category = 'announcement'");
    expect(sql).toContain("u.role = 'user'");
    expect(sql).toContain('u.is_active = TRUE');
    expect(sql).toContain('COALESCE(np.enabled, TRUE) = TRUE');
    expect(sql).toContain('jsonb_build_object');

    // Bound params: [titleAr, titleEn, bodyAr, bodyEn, announcementId]
    expect(fanout![1]).toEqual([
      VALID_BODY.titleAr,
      VALID_BODY.titleEn,
      VALID_BODY.bodyAr,
      VALID_BODY.bodyEn,
      ANNOUNCEMENT_ID,
    ]);
  });

  it('updates recipient_count from the fan-out rowCount inside the transaction', async () => {
    queueTransaction(5);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit_logs

    await request(app).post('/api/v1/admin/announcements').set(adminAuth()).send(VALID_BODY);

    const update = findClientCall('UPDATE announcements SET recipient_count');
    expect(update).toBeDefined();
    expect(update![1]).toEqual([5, ANNOUNCEMENT_ID]);
  });

  it('writes an announcement.send audit row', async () => {
    queueTransaction(2);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit_logs

    await request(app).post('/api/v1/admin/announcements').set(adminAuth()).send(VALID_BODY);

    const audit = findPoolCall('audit_logs');
    expect(audit).toBeDefined();
    expect(audit![1]).toEqual(
      expect.arrayContaining([
        ADMIN_USER.userId,
        'announcement.send',
        'announcement',
        ANNOUNCEMENT_ID,
      ]),
    );
  });

  it('rejects a missing AR field (400 VALIDATION_ERROR)', async () => {
    const { bodyAr: _omit, ...noBodyAr } = VALID_BODY;
    const res = await request(app)
      .post('/api/v1/admin/announcements')
      .set(adminAuth())
      .send(noBodyAr);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // No transaction started on a validation failure.
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('rejects a blank (whitespace-only) EN title after trim', async () => {
    const res = await request(app)
      .post('/api/v1/admin/announcements')
      .set(adminAuth())
      .send({ ...VALID_BODY, titleEn: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a title longer than 200 characters', async () => {
    const res = await request(app)
      .post('/api/v1/admin/announcements')
      .set(adminAuth())
      .send({ ...VALID_BODY, titleEn: 'a'.repeat(201) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a body longer than 2000 characters', async () => {
    const res = await request(app)
      .post('/api/v1/admin/announcements')
      .set(adminAuth())
      .send({ ...VALID_BODY, bodyEn: 'a'.repeat(2001) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// POST push path (fire-and-forget safety)
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/announcements — push path', () => {
  it('still 201s and issues no push queries when FCM is unavailable', async () => {
    mockIsFcmAvailable.mockReturnValue(false);
    queueTransaction(4);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit_logs

    const res = await request(app)
      .post('/api/v1/admin/announcements')
      .set(adminAuth())
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(mockSendMulticast).not.toHaveBeenCalled();
    // Only the audit INSERT should hit the pool (no device-token fetch).
    expect(findPoolCall('device_tokens')).toBeUndefined();
  });

  it('still 201s and never rejects the request when the push multicast throws', async () => {
    const rejections: unknown[] = [];
    const onRej = (e: unknown): void => {
      rejections.push(e);
    };
    process.on('unhandledRejection', onRej);

    try {
      mockIsFcmAvailable.mockReturnValue(true);
      mockSendMulticast.mockRejectedValue(new Error('FCM exploded'));

      queueTransaction(2);
      // Catch-all for pool.query: serves the device-token fetch AND the audit insert
      // regardless of ordering, so the fire-and-forget push has data to work with.
      mockQuery.mockResolvedValue({ rows: [{ token: 't1', language: 'en' }], rowCount: 1 });

      const res = await request(app)
        .post('/api/v1/admin/announcements')
        .set(adminAuth())
        .send(VALID_BODY);

      expect(res.status).toBe(201);

      // Let the fire-and-forget push settle its rejected multicast.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockSendMulticast).toHaveBeenCalled();
      expect(rejections).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onRej);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/announcements
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/announcements', () => {
  const now = new Date();

  const MOCK_ROW = {
    id: ANNOUNCEMENT_ID,
    title_en: 'Maintenance',
    body_en: 'Body EN',
    title_ar: 'صيانة',
    body_ar: 'المحتوى',
    audience: 'all_active',
    recipient_count: 12,
    push_success_count: 9,
    push_failure_count: 1,
    created_at: now,
    admin_name: 'Admin Ann',
  };

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/announcements');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await request(app).get('/api/v1/admin/announcements').set(userAuth());
    expect(res.status).toBe(403);
  });

  it('lists announcements newest-first with camelCase items and pagination meta', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_ROW] }); // items
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] }); // count

    const res = await request(app).get('/api/v1/admin/announcements').set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual({
      id: ANNOUNCEMENT_ID,
      titleEn: 'Maintenance',
      titleAr: 'صيانة',
      bodyEn: 'Body EN',
      bodyAr: 'المحتوى',
      audience: 'all_active',
      recipientCount: 12,
      pushSuccessCount: 9,
      pushFailureCount: 1,
      createdAt: now.toISOString(),
      adminName: 'Admin Ann',
    });
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
  });

  it('items query LEFT JOINs the admin name and orders by created_at desc', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // items
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // count

    await request(app).get('/api/v1/admin/announcements').set(adminAuth());

    const itemsCall = findPoolCall('u.name AS admin_name');
    expect(itemsCall).toBeDefined();
    expect(itemsCall![0]).toContain('LEFT JOIN users u ON u.id = a.admin_id');
    expect(itemsCall![0]).toContain('ORDER BY a.created_at DESC');
  });

  it('rejects limit above 100 (400 VALIDATION_ERROR)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/announcements?limit=101')
      .set(adminAuth());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
